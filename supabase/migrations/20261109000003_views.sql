-- Read models for the screens. security_invoker makes each view obey the
-- caller's row-level security, so a customer login can't read staff data through a view.

-- Open purchase-order quantity still expected, by item.
create view v_on_order with (security_invoker = true) as
select l.item_id, sum(l.qty_ordered - l.qty_received) as qty, min(p.expected_date) as next_expected
from po_lines l join purchase_orders p on p.id = l.po_id
where p.status in ('sent', 'partial') and l.qty_received < l.qty_ordered
group by l.item_id;

-- Quantity promised on open sales orders, by item and pickup location.
create view v_committed with (security_invoker = true) as
select l.item_id, o.location_id, sum(l.qty) as qty
from sales_order_lines l join sales_orders o on o.id = l.sales_order_id
where o.status = 'placed'
group by l.item_id, o.location_id;

create view v_stock_by_location with (security_invoker = true) as
select s.item_id, s.location_id, l.code as location_code, l.name as location_name, l.kind as location_kind,
       s.qty, round(s.qty * i.avg_cost, 2) as value
from stock s join locations l on l.id = s.location_id join items i on i.id = s.item_id;

create view v_item_overview with (security_invoker = true) as
select
  i.*,
  coalesce(i.lead_time_days, s.lead_time_days) as effective_lead_time,
  s.name as supplier_name,
  coalesce((select sum(st.qty) from stock st join locations l on l.id = st.location_id
             where st.item_id = i.id and l.kind <> 'hold'), 0) as on_hand,
  coalesce((select sum(st.qty) from stock st join locations l on l.id = st.location_id
             where st.item_id = i.id and l.kind = 'hold'), 0) as on_hold,
  coalesce((select qty from v_on_order o where o.item_id = i.id), 0) as on_order,
  (select next_expected from v_on_order o where o.item_id = i.id) as next_expected,
  coalesce((select sum(qty) from v_committed c where c.item_id = i.id), 0) as committed,
  coalesce((select jsonb_object_agg(l.code, st.qty) from stock st join locations l on l.id = st.location_id
             where st.item_id = i.id), '{}'::jsonb) as by_location,
  round(coalesce((select sum(st.qty) from stock st where st.item_id = i.id), 0) * i.avg_cost, 2) as inventory_value,
  exists (select 1 from bom_lines b where b.parent_id = i.id) as has_bom
from items i
left join suppliers s on s.id = i.supplier_id;

-- Sales by store-day (net of discounts, before returns) for dashboards and reports.
create view v_daily_sales with (security_invoker = true) as
select local_date(ts) as day, location_id, count(*) as tickets,
       sum(subtotal - discount_total) as net_sales, sum(tax) as tax, sum(cogs) as cogs
from sales
group by 1, 2;

-- Lifetime purchases per customer (aggregated in the database; the API caps raw rows at 1,000).
create view v_customer_totals with (security_invoker = true) as
select customer_id, count(*) as purchases, sum(total) as spend, max(ts) as last_purchase
from sales where customer_id is not null
group by customer_id;

-- Sellable quantity by item and pickup location. Kits count boxes on the shelf plus
-- what the components on hand could make. Security definer so customers get the answer
-- without reading component stock themselves.
create function item_availability() returns table (item_id int, location_id int, available numeric)
language sql stable security definer set search_path = public as $$
  select i.id, l.id::int,
         stock_qty(i.id, l.id) + case when i.kind = 'kit' then kit_buildable(i.id, l.id) else 0 end
  from items i cross join locations l
  where i.active and i.kind <> 'component' and l.kind <> 'hold'
$$;
