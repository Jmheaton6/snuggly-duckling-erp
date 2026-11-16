-- Production orders record when work actually started and finished (the cycle-time metric
-- depends on it), so staff may enter those times: any time in the last 7 days, never in the
-- future. Every other business function still stamps "now" (effective_ts).
create function production_ts(p_ts timestamptz) returns timestamptz
language plpgsql stable as $$
begin
  if p_ts is null or app_role() = 'system' then return coalesce(p_ts, now()); end if;
  if p_ts > now() + interval '1 minute' then raise exception 'Production times cannot be in the future'; end if;
  if p_ts < now() - interval '7 days' then raise exception 'Production times can be at most 7 days back'; end if;
  return p_ts;
end $$;

-- Issue: consume components per the BOM for the quantity actually started.
create or replace function start_production_order(p_id bigint, p_qty_started numeric default null, p_ts timestamptz default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ts timestamptz := production_ts(p_ts);
  v_wo production_orders;
  v_qty numeric;
  v_comp record;
  v_cost numeric;
  v_material numeric := 0;
begin
  perform require_role('manager', 'warehouse');
  select * into v_wo from production_orders where id = p_id for update;
  if not found then raise exception 'Production order % not found', p_id; end if;
  if v_wo.status <> 'planned' then raise exception 'Production order % is already %', p_id, v_wo.status; end if;
  v_qty := coalesce(p_qty_started, v_wo.qty_planned);
  if v_qty <= 0 then raise exception 'Quantity started must be positive'; end if;

  for v_comp in select component_id, qty_per from bom_lines where parent_id = v_wo.item_id loop
    insert into inventory_txns (ts, item_id, location_id, qty, txn_type, ref_type, ref_id, user_id)
    values (v_ts, v_comp.component_id, v_wo.location_id, -(v_qty * v_comp.qty_per), 'prod_issue', 'production', p_id, auth.uid())
    returning unit_cost into v_cost;
    v_material := v_material + round(v_cost * v_qty * v_comp.qty_per, 2);
  end loop;

  update production_orders set status = 'in_progress', qty_started = v_qty, started_at = v_ts, material_cost = v_material
   where id = p_id;
  perform post_je(v_ts, 'production', p_id, 'Components issued to production', '1300', v_material);
  perform post_je(v_ts, 'production', p_id, 'Components issued to production', '1200', -v_material);
end $$;

-- Complete: good units go to stock at rolled-up cost; scrapped units' cost goes to Production Scrap.
create or replace function complete_production_order(
  p_id bigint, p_qty_good numeric, p_qty_scrapped numeric default 0, p_qty_reworked numeric default 0,
  p_reason_code text default null, p_ts timestamptz default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ts timestamptz := production_ts(p_ts);
  v_wo production_orders;
  v_unit numeric;
  v_good_value numeric;
begin
  perform require_role('manager', 'warehouse');
  select * into v_wo from production_orders where id = p_id for update;
  if not found then raise exception 'Production order % not found', p_id; end if;
  if v_wo.status <> 'in_progress' then raise exception 'Start production order % before completing it', p_id; end if;
  if v_ts < v_wo.started_at then raise exception 'The finish time must be after the start time (%)', to_char(v_wo.started_at at time zone 'America/Denver', 'Mon DD HH12:MI AM'); end if;
  if coalesce(p_qty_good, -1) < 0 or coalesce(p_qty_scrapped, 0) < 0 or coalesce(p_qty_reworked, 0) < 0 then
    raise exception 'Quantities cannot be negative';
  end if;
  if p_qty_good + coalesce(p_qty_scrapped, 0) <> v_wo.qty_started then
    raise exception 'Good (%) + scrapped (%) must equal the % started', p_qty_good, coalesce(p_qty_scrapped, 0), v_wo.qty_started;
  end if;
  if coalesce(p_qty_reworked, 0) > p_qty_good then raise exception 'Reworked units are counted inside good units'; end if;
  if (coalesce(p_qty_scrapped, 0) > 0 or coalesce(p_qty_reworked, 0) > 0)
     and not exists (select 1 from reason_codes where code = p_reason_code and applies_to = 'scrap') then
    raise exception 'Scrap or rework needs a quality reason code';
  end if;

  v_unit := round(v_wo.material_cost / v_wo.qty_started, 4);
  v_good_value := least(round(v_unit * p_qty_good, 2), v_wo.material_cost);
  if p_qty_good > 0 then
    insert into inventory_txns (ts, item_id, location_id, qty, unit_cost, txn_type, ref_type, ref_id, user_id)
    values (v_ts, v_wo.item_id, v_wo.location_id, p_qty_good, v_unit, 'prod_receipt', 'production', p_id, auth.uid());
  end if;

  update production_orders
     set status = 'completed', qty_good = p_qty_good, qty_scrapped = coalesce(p_qty_scrapped, 0),
         qty_reworked = coalesce(p_qty_reworked, 0), reason_code = p_reason_code,
         finished_at = v_ts, unit_cost = v_unit
   where id = p_id;

  perform post_je(v_ts, 'production', p_id, 'Production completed', '1200', v_good_value);
  perform post_je(v_ts, 'production', p_id, 'Production scrap', '5200', v_wo.material_cost - v_good_value);
  perform post_je(v_ts, 'production', p_id, 'Production completed', '1300', -v_wo.material_cost);
end $$;

