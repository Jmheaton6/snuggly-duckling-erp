-- Demo reset: the seed history is snapshotted into schema `seed` once after loading;
-- reset_demo() puts every table back to that snapshot. Dates shift forward in whole
-- weeks so the history still ends within the last week (and Sundays stay Sundays).

create schema if not exists seed;

create table system_status (
  id int primary key default 1 check (id = 1),
  seed_end date,
  reset_at timestamptz
);
insert into system_status (id) values (1);

-- Order matters: parents before children on restore.
create function seed_tables() returns text[]
language sql immutable as $$
  select array[
    'settings','locations','suppliers','items','bom_lines','customers',
    'sales_orders','sales','sales_order_lines','sale_lines','returns','return_lines',
    'purchase_orders','po_lines','po_receipts','po_receipt_lines','supplier_bills',
    'production_orders','transfers','adjustments','inventory_txns','stock','journal_lines','expenses'
  ]
$$;

create function snapshot_seed(p_seed_end date) returns void
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if app_role() <> 'system' then raise exception 'Only the seed loader can snapshot'; end if;
  foreach t in array seed_tables() loop
    execute format('drop table if exists seed.%I', t);
    execute format('create table seed.%I as table public.%I', t, t);
  end loop;
  update system_status set seed_end = p_seed_end, reset_at = now() where id = 1;
end $$;

-- Copies seed.<t> into public.<t>, shifting every date/timestamp by p_days.
create function seed_copy(p_table text, p_days int, p_upsert boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cols text;
  v_exprs text;
  v_updates text;
  v_pk text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg(case
           when data_type = 'timestamp with time zone' then format('%I + make_interval(days => %s)', column_name, p_days)
           when data_type = 'date' then format('%I + %s', column_name, p_days)
           else quote_ident(column_name) end, ', ' order by ordinal_position),
         string_agg(format('%I = excluded.%I', column_name, column_name), ', ' order by ordinal_position)
    into v_cols, v_exprs, v_updates
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table and is_generated = 'NEVER';

  select string_agg(quote_ident(a.attname), ', ') into v_pk
    from pg_index x join pg_attribute a on a.attrelid = x.indrelid and a.attnum = any(x.indkey)
   where x.indrelid = ('public.' || p_table)::regclass and x.indisprimary;

  execute format('insert into public.%I (%s) overriding system value select %s from seed.%I %s',
                 p_table, v_cols, v_exprs, p_table,
                 case when p_upsert then format('on conflict (%s) do update set %s', v_pk, v_updates) else '' end);
end $$;

create function reset_demo(p_pin text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_end date := (select seed_end from system_status where id = 1);
  v_days int;
  t text;
begin
  if app_role() <> 'system' then
    perform require_role('manager');
    if p_pin is distinct from (select value from admin_secrets where key = 'reset_pin') then
      raise exception 'Wrong reset PIN';
    end if;
  end if;
  if v_end is null then raise exception 'No seed snapshot has been taken yet'; end if;
  v_days := greatest(0, 7 * floor((local_date(now()) - 1 - v_end) / 7.0)::int);

  -- Transactions go entirely; master data is restored in place so logins
  -- (profiles → customers, locations) stay valid.
  truncate journal_lines, expenses, inventory_txns, stock, transfers, adjustments,
           return_lines, returns, sale_lines, sales_order_lines, production_orders,
           supplier_bills, po_receipt_lines, po_receipts, po_lines, purchase_orders
           restart identity;
  truncate sales, sales_orders restart identity cascade;
  delete from bom_lines;
  delete from items where id not in (select id from seed.items);
  delete from suppliers where id not in (select id from seed.suppliers);
  delete from customers where id not in (select id from seed.customers)
     and id not in (select customer_id from profiles where customer_id is not null);
  delete from settings where key not in (select key from seed.settings);

  foreach t in array array['settings','locations','suppliers','items','customers'] loop
    perform seed_copy(t, v_days, true);
  end loop;
  perform seed_copy('bom_lines', v_days);

  -- Ledger rows are restored as-is; the costing trigger must not re-apply them.
  alter table inventory_txns disable trigger inventory_txns_apply;
  foreach t in array seed_tables() loop
    continue when t in ('settings','locations','suppliers','items','customers','bom_lines');
    perform seed_copy(t, v_days);
  end loop;
  alter table inventory_txns enable trigger inventory_txns_apply;

  foreach t in array seed_tables() loop
    continue when t in ('settings','bom_lines','stock');
    execute format('select setval(pg_get_serial_sequence(%L, %L), greatest(1, (select coalesce(max(id), 0) from public.%I)))',
                   'public.' || t, 'id', t);
  end loop;

  update system_status set reset_at = now() where id = 1;
  return jsonb_build_object('shifted_days', v_days, 'history_ends', v_end + v_days);
end $$;
