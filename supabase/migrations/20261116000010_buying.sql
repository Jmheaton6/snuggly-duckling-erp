-- Phase 3 read models: the supplier scorecard and the reorder rules (ROP, EOQ, periodic review).
-- Both are views over stored history, so every number recomputes the moment anything changes.

-- Supplier scorecard, from purchase-order history.
--  • A PO counts once it has been received at least once.
--  • On time: first receipt on or before the expected date (sent date + quoted lead time).
--  • Actual lead time: first receipt date − sent date.
--  • Fill rate: received ÷ ordered, on POs that are finished (received or closed).
--  • Rating: Keep = ≥ 90% on time and ≥ 95% fill · Replace = < 70% on time or < 90% fill · otherwise Watch.
create view v_supplier_scorecard with (security_invoker = true) as
with po as (
  select p.id, p.supplier_id, p.status, p.expected_date, local_date(p.sent_at) as sent,
         (select min(local_date(r.ts)) from po_receipts r where r.po_id = p.id) as first_receipt,
         (select sum(qty_ordered) from po_lines where po_id = p.id) as ordered,
         (select sum(qty_received) from po_lines where po_id = p.id) as received
  from purchase_orders p
  where p.status in ('partial', 'received', 'closed')
),
perf as (
  select supplier_id,
         count(*) filter (where first_receipt is not null) as pos_received,
         avg(case when first_receipt <= expected_date then 1.0 else 0.0 end) filter (where first_receipt is not null) as on_time_rate,
         avg(first_receipt - sent) filter (where first_receipt is not null) as avg_actual_lead,
         sum(received) filter (where status in ('received', 'closed')) / nullif(sum(ordered) filter (where status in ('received', 'closed')), 0) as fill_rate
  from po group by supplier_id
),
bills as (
  select supplier_id,
         sum(amount) filter (where paid_at is null) as owed,
         sum(amount) filter (where paid_at is null and due_date < local_date(now())) as overdue,
         min(due_date) filter (where paid_at is null) as next_due,
         count(*) filter (where paid_at is null) as open_bills
  from supplier_bills group by supplier_id
)
select s.id as supplier_id, s.name, s.lead_time_days as quoted_lead, s.payment_terms,
       coalesce(p.pos_received, 0) as pos_received,
       round(p.on_time_rate, 4) as on_time_rate,
       round(p.avg_actual_lead, 1) as avg_actual_lead,
       round(p.fill_rate, 4) as fill_rate,
       coalesce(b.owed, 0) as owed, coalesce(b.overdue, 0) as overdue, b.next_due, coalesce(b.open_bills, 0) as open_bills,
       case
         when p.pos_received is null or p.pos_received = 0 then 'New'
         when p.on_time_rate < 0.70 or p.fill_rate < 0.90 then 'Replace'
         when p.on_time_rate >= 0.90 and coalesce(p.fill_rate, 1) >= 0.95 then 'Keep'
         else 'Watch'
       end as rating
from suppliers s
left join perf p on p.supplier_id = s.id
left join bills b on b.supplier_id = s.id;

-- Reorder rules for every stocked item (kits are packed to order, so they have none).
-- Usage = units sold + units used inside sold boxes + units issued to production, per day,
-- over the demand window (Settings), counting days with zero usage.
--   ROP           = d̄ × L + z × σ × √L          (lead-time demand + safety stock)
--   EOQ           = √(2 × D × S ÷ H)            D = d̄ × 365, H = holding rate × average cost
--   Order-up-to   = d̄ × (R + L) + z × σ × √(R + L)   (periodic review every R days)
--   Inventory position = on hand + on order (open POs, open work orders)
create view v_replenishment with (security_invoker = true) as
with cfg as (
  select setting('demand_window_days')::int as window_days, setting('service_level_z') as z,
         setting('ordering_cost') as s, setting('holding_cost_pct') as h_pct, setting('review_period_days')::int as r,
         local_date(now()) as today
),
days as (
  select generate_series(cfg.today - cfg.window_days, cfg.today - 1, interval '1 day')::date as d from cfg
),
usage as (
  select t.item_id, local_date(t.ts) as d, -sum(t.qty) as units
  from inventory_txns t, cfg
  where t.txn_type in ('sale', 'sale_kit', 'prod_issue')
    and t.ts >= (cfg.today - cfg.window_days)::timestamp at time zone 'America/Denver'
    and t.ts < cfg.today::timestamp at time zone 'America/Denver'
  group by 1, 2
),
daily as (
  select i.id as item_id, days.d, coalesce(u.units, 0) as units
  from items i cross join days left join usage u on u.item_id = i.id and u.d = days.d
  where i.active and i.kind <> 'kit'
),
stats as (
  select item_id, avg(units) as d_bar, stddev_pop(units) as sigma, count(*) as n_days from daily group by item_id
),
supply as (
  select i.id as item_id,
         coalesce((select sum(st.qty) from stock st join locations l on l.id = st.location_id where st.item_id = i.id and l.kind <> 'hold'), 0) as on_hand,
         coalesce((select sum(pl.qty_ordered - pl.qty_received) from po_lines pl join purchase_orders p on p.id = pl.po_id
                    where pl.item_id = i.id and p.status in ('sent', 'partial')), 0)
       + coalesce((select sum(coalesce(w.qty_started, w.qty_planned)) from production_orders w
                    where w.item_id = i.id and w.status in ('planned', 'in_progress')), 0) as on_order
  from items i
),
base as (
  select i.id as item_id, i.sku, i.name, i.kind, i.uom, i.supplier_id, sp.name as supplier_name, i.avg_cost,
         coalesce(i.lead_time_days, sp.lead_time_days, 1) as lead_days,
         st.d_bar, st.sigma, st.n_days, su.on_hand, su.on_order, su.on_hand + su.on_order as position,
         cfg.z, cfg.s, cfg.h_pct, cfg.r, cfg.today
  from items i
  join stats st on st.item_id = i.id
  join supply su on su.item_id = i.id
  left join suppliers sp on sp.id = i.supplier_id
  cross join cfg
),
calc as (
  select b.*,
         b.d_bar * 365 as annual_demand,
         b.h_pct * b.avg_cost as holding_cost,
         b.z * b.sigma * sqrt(b.lead_days)::numeric as safety_stock,
         b.d_bar * b.lead_days + b.z * b.sigma * sqrt(b.lead_days)::numeric as rop,
         case when b.d_bar > 0 and b.avg_cost > 0
              then sqrt(2 * b.d_bar * 365 * b.s / (b.h_pct * b.avg_cost))::numeric end as eoq,
         b.d_bar * (b.r + b.lead_days) + b.z * b.sigma * sqrt(b.r + b.lead_days)::numeric as order_up_to
  from base b
)
select item_id, sku, name, kind, uom, supplier_id, supplier_name, avg_cost, lead_days, n_days,
       round(d_bar, 3) as avg_daily, round(sigma, 3) as sd_daily,
       round(annual_demand, 1) as annual_demand, round(holding_cost, 4) as holding_cost,
       z, s as ordering_cost, h_pct, r as review_days,
       on_hand, on_order, position,
       round(safety_stock, 1) as safety_stock, round(rop, 1) as rop,
       ceil(eoq) as eoq,
       round(order_up_to, 1) as order_up_to,
       greatest(0, ceil(order_up_to - position)) as periodic_qty,
       position <= rop as below_rop,
       case when position <= rop then today
            when d_bar > 0 then today + floor((position - rop) / d_bar)::int end as order_by
from calc;
