-- reset_demo: requests through the Supabase API run with pg-safeupdate, which refuses
-- a DELETE with no WHERE clause. Same function, with an explicit WHERE.

create or replace function reset_demo(p_pin text default null) returns jsonb
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
  delete from bom_lines where true;   -- Supabase's API rejects DELETE without WHERE
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
