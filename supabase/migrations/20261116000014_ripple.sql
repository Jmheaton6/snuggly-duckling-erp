-- Ripple view: show everything one transaction touched. The stock ledger now records, on
-- every row, the on-hand at that location after the movement and the item's average cost
-- before and after it, so "before → after" is read straight from the ledger.

alter table inventory_txns
  add column qty_after numeric(12,3),          -- on hand at this location after this row
  add column avg_cost_before numeric(12,4),    -- item's weighted average cost before / after
  add column avg_cost_after numeric(12,4);

-- reset_demo copies every public column from the seed snapshot.
do $$
begin
  if to_regclass('seed.inventory_txns') is not null then
    alter table seed.inventory_txns
      add column if not exists qty_after numeric(12,3),
      add column if not exists avg_cost_before numeric(12,4),
      add column if not exists avg_cost_after numeric(12,4);
  end if;
end $$;

-- Same costing rules as before (weighted average, never negative); now also records the
-- before/after values on the row.
create or replace function apply_inventory_txn() returns trigger
language plpgsql as $$
declare
  v_avg numeric;
  v_total numeric;
  v_here numeric;
  v_cost numeric;
  v_new_avg numeric;
begin
  select avg_cost into v_avg from items where id = new.item_id for update;
  select coalesce(sum(qty), 0) into v_total from stock where item_id = new.item_id;
  select coalesce((select qty from stock where item_id = new.item_id and location_id = new.location_id), 0)
    into v_here;
  v_new_avg := v_avg;

  if new.qty < 0 then
    if v_here + new.qty < 0 then
      raise exception 'Not enough % at % (on hand %, need %)',
        (select name from items where id = new.item_id),
        (select name from locations where id = new.location_id),
        v_here, -new.qty
        using errcode = 'P0001';
    end if;
    new.unit_cost := coalesce(new.unit_cost, v_avg);
  else
    v_cost := coalesce(new.unit_cost, v_avg);
    new.unit_cost := v_cost;
    if v_total + new.qty > 0 then
      v_new_avg := round(((greatest(v_total, 0) * v_avg) + (new.qty * v_cost)) / (greatest(v_total, 0) + new.qty), 4);
      update items set avg_cost = v_new_avg where id = new.item_id;
    end if;
  end if;

  new.qty_after := v_here + new.qty;
  new.avg_cost_before := v_avg;
  new.avg_cost_after := v_new_avg;

  insert into stock (item_id, location_id, qty) values (new.item_id, new.location_id, new.qty)
  on conflict (item_id, location_id) do update set qty = stock.qty + excluded.qty;
  return new;
end $$;

-- History: on-hand after each row is the running total in posting order. (Average cost
-- history isn't reconstructed; older rows show it as unknown.)
update inventory_txns t set qty_after = r.run
from (select id, sum(qty) over (partition by item_id, location_id order by id) as run from inventory_txns) r
where r.id = t.id;
do $$
begin
  if to_regclass('seed.inventory_txns') is not null then
    update seed.inventory_txns t set qty_after = r.run
    from (select id, sum(qty) over (partition by item_id, location_id order by id) as run from seed.inventory_txns) r
    where r.id = t.id;
  end if;
end $$;

-- The activity feed: one row per transaction (anything that moved stock or money), plus
-- orders placed and POs sent, which move neither but change demand and supply.
create function recent_activity(p_days int default 45, p_limit int default 60)
returns table (ref_type text, ref_id bigint, ts timestamptz, lines bigint, kinds text)
language sql stable set search_path = public as $$
  select * from (
    select t.ref_type, t.ref_id, t.ts, count(*), string_agg(distinct t.txn_type, ',')
    from inventory_txns t where t.ts > now() - make_interval(days => p_days) and t.ref_type is not null
    group by t.ref_type, t.ref_id, t.ts
    union all
    select j.ref_type, j.ref_id, j.ts, count(*), j.ref_type
    from journal_lines j where j.ts > now() - make_interval(days => p_days) and j.ref_type in ('bill_payment', 'expense')
    group by j.ref_type, j.ref_id, j.ts
    union all
    select 'sales_order', o.id, o.order_date, 0::bigint, o.source from sales_orders o where o.order_date > now() - make_interval(days => p_days)
    union all
    select 'purchase_order', p.id, p.sent_at, 0::bigint, 'sent' from purchase_orders p where p.sent_at > now() - make_interval(days => p_days)
  ) a
  order by ts desc
  limit p_limit
$$;

-- Everything one transaction wrote: its stock-ledger rows and its journal lines.
create function ripple(p_ref_type text, p_ref_id bigint, p_ts timestamptz)
returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'ledger', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'item_id', t.item_id, 'item', i.name, 'sku', i.sku, 'uom', i.uom, 'location', l.name, 'location_kind', l.kind,
        'qty', t.qty, 'qty_after', t.qty_after, 'unit_cost', t.unit_cost, 'txn_type', t.txn_type, 'reason', t.reason_code,
        'avg_before', t.avg_cost_before, 'avg_after', t.avg_cost_after) order by t.id)
      from inventory_txns t join items i on i.id = t.item_id join locations l on l.id = t.location_id
      where t.ref_type = p_ref_type and t.ref_id = p_ref_id and t.ts = p_ts), '[]'::jsonb),
    'journal', coalesce((
      select jsonb_agg(jsonb_build_object('account', j.account, 'name', a.name, 'type', a.type, 'debit', j.debit, 'credit', j.credit, 'memo', j.memo) order by j.id)
      from journal_lines j join accounts a on a.code = j.account
      where j.ref_type = p_ref_type and j.ref_id = p_ref_id and j.ts = p_ts), '[]'::jsonb)
  )
$$;

-- Make the new functions callable through the API right away.
notify pgrst, 'reload schema';
