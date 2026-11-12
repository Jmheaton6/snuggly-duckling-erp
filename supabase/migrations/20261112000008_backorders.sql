-- Phase 2: availability, backorders and estimated available dates.

-- Same definitions as the security migration, repeated here so this file also
-- runs in the local test harness (which skips the Supabase-only security file).
create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select app_role() in ('manager', 'cashier', 'warehouse', 'system')
$$;
create or replace function my_customer_id() returns int
language sql stable security definer set search_path = public as $$
  select customer_id from profiles where id = auth.uid()
$$;

-- Availability helpers read component stock, which customers can't see directly.
alter function stock_qty(int, int) security definer set search_path = public;
alter function kit_buildable(int, int) security definer set search_path = public;

-- Units that could be sold at a location right now (kits: boxes on hand + what components can pack).
create function item_available(p_item_id int, p_location_id int) returns numeric
language sql stable security definer set search_path = public as $$
  select stock_qty(p_item_id, p_location_id)
       + case when (select kind from items where id = p_item_id) = 'kit' then kit_buildable(p_item_id, p_location_id) else 0 end
$$;

-- When more of an item should be on hand: the earliest open PO's expected date, or,
-- with nothing on order, today + lead time (supplier quote, or production lead time
-- for items made or packed in-house). Never earlier than tomorrow.
create function item_eta(p_item_id int) returns date
language sql stable security definer set search_path = public as $$
  select greatest(local_date(now()) + 1, coalesce(
    (select min(p.expected_date) from po_lines l join purchase_orders p on p.id = l.po_id
      where l.item_id = p_item_id and p.status in ('sent', 'partial') and l.qty_received < l.qty_ordered),
    local_date(now()) + coalesce(i.lead_time_days, s.lead_time_days, 1)))
  from items i left join suppliers s on s.id = i.supplier_id
  where i.id = p_item_id
$$;

drop function item_availability();
create function item_availability() returns table (item_id int, location_id int, available numeric, eta date)
language sql stable security definer set search_path = public as $$
  select i.id, l.id::int, item_available(i.id, l.id), item_eta(i.id)
  from items i cross join locations l
  where i.active and i.kind <> 'component' and l.kind <> 'hold'
$$;

-- Open orders claim stock in pickup-date order; a line is backordered for whatever
-- the earlier orders and the stock on hand can't cover. Not security_invoker on purpose:
-- allocation must count every customer's orders, so rows are filtered explicitly instead.
create view v_sales_order_lines as
with x as (
  select l.id, l.sales_order_id, l.item_id, l.qty, l.unit_price,
         o.location_id, o.status, o.requested_date, o.customer_id,
         sum(l.qty) over (partition by l.item_id, o.location_id, o.status = 'placed'
                          order by o.requested_date, o.id, l.id) as claimed_through_line
  from sales_order_lines l join sales_orders o on o.id = l.sales_order_id
)
select x.id, x.sales_order_id, x.item_id, x.qty, x.unit_price, round(x.qty * x.unit_price, 2) as line_total,
       x.location_id, x.status, x.requested_date, x.customer_id,
       i.sku, i.name as item_name, i.kind,
       a.available,
       case when x.status = 'placed' then greatest(0, least(x.qty, x.claimed_through_line - a.available)) else 0 end as backordered,
       case when x.status = 'placed' and x.claimed_through_line > a.available then item_eta(x.item_id) end as est_available_date,
       case when x.status = 'placed' then (select coalesce(sum(item_available(x.item_id, l2.id)), 0) from locations l2
                                           where l2.id <> x.location_id and l2.kind <> 'hold') end as available_elsewhere
from x
join items i on i.id = x.item_id
cross join lateral (select case when x.status = 'placed' then item_available(x.item_id, x.location_id) end as available) a
where is_staff() or x.customer_id = my_customer_id();

create view v_sales_orders as
select o.*, c.name as customer_name, c.kind as customer_kind, l.name as location_name,
       coalesce(t.lines, 0) as lines, coalesce(t.total, 0) as total,
       coalesce(t.backordered_lines, 0) as backordered_lines, t.est_available_date
from sales_orders o
join customers c on c.id = o.customer_id
join locations l on l.id = o.location_id
left join (
  select sales_order_id, count(*) as lines, sum(line_total) as total,
         count(*) filter (where backordered > 0) as backordered_lines,
         max(est_available_date) as est_available_date
  from v_sales_order_lines group by sales_order_id
) t on t.sales_order_id = o.id
where is_staff() or o.customer_id = my_customer_id();

-- Per-item backorder totals for the Inventory screen.
create view v_backorders as
select item_id, sum(backordered) as backordered, min(est_available_date) as est_available_date, count(*) as orders
from v_sales_order_lines
where backordered > 0
group by item_id;
