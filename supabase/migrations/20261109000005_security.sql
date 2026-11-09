-- Supabase-only: row-level security, function permissions and realtime.
-- (Skipped by the local PGlite test harness, which has no roles or publication.)
--
-- Model: staff logins (manager / cashier / warehouse) read everything; every
-- change to stock or money goes through the security-definer functions in 0002,
-- which check the role themselves. Customers read the catalog, availability by
-- location and their own orders, and can place pickup orders.

create function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select app_role() in ('manager', 'cashier', 'warehouse', 'system')
$$;

create function my_customer_id() returns int
language sql stable security definer set search_path = public as $$
  select customer_id from profiles where id = auth.uid()
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'settings','accounts','reason_codes','locations','suppliers','items','bom_lines','customers','profiles',
    'inventory_txns','stock','transfers','adjustments','sales_orders','sales_order_lines','sales','sale_lines',
    'returns','return_lines','purchase_orders','po_lines','po_receipts','po_receipt_lines','supplier_bills',
    'production_orders','journal_lines','expenses','admin_secrets','system_status'
  ] loop
    execute format('alter table %I enable row level security', t);
    if t <> 'admin_secrets' then
      execute format('create policy "staff read" on %I for select to authenticated using (is_staff())', t);
    end if;
  end loop;
end $$;

-- What a customer login can see.
create policy "customers read catalog" on items for select to authenticated
  using (active and kind <> 'component');
create policy "customers read pickup locations" on locations for select to authenticated
  using (kind <> 'hold');
create policy "customers read availability" on stock for select to authenticated
  using (location_id in (select id from locations where kind <> 'hold')
         and item_id in (select id from items where active and kind <> 'component'));
create policy "customers read kit recipes" on bom_lines for select to authenticated using (true);
create policy "everyone reads settings" on settings for select to authenticated using (true);
create policy "everyone reads reason codes" on reason_codes for select to authenticated using (true);
create policy "everyone reads status" on system_status for select to authenticated using (true);
create policy "read own profile" on profiles for select to authenticated using (id = auth.uid());
create policy "customers read own record" on customers for select to authenticated using (id = my_customer_id());
create policy "customers read own orders" on sales_orders for select to authenticated using (customer_id = my_customer_id());
create policy "customers read own order lines" on sales_order_lines for select to authenticated
  using (sales_order_id in (select id from sales_orders where customer_id = my_customer_id()));

-- Master data edits (no stock or money moves here).
create policy "managers edit settings" on settings for update to authenticated using (app_role() = 'manager');
create policy "staff add items" on items for insert to authenticated with check (app_role() in ('manager','warehouse'));
create policy "staff edit items" on items for update to authenticated using (app_role() in ('manager','warehouse'));
create policy "staff add suppliers" on suppliers for insert to authenticated with check (app_role() in ('manager','warehouse'));
create policy "staff edit suppliers" on suppliers for update to authenticated using (app_role() in ('manager','warehouse'));
create policy "staff edit boms" on bom_lines for all to authenticated
  using (app_role() in ('manager','warehouse')) with check (app_role() in ('manager','warehouse'));
create policy "staff add customers" on customers for insert to authenticated with check (is_staff());
create policy "staff edit customers" on customers for update to authenticated using (is_staff());
create policy "staff edit draft POs" on po_lines for all to authenticated
  using (app_role() in ('manager','warehouse') and po_id in (select id from purchase_orders where status = 'draft'))
  with check (app_role() in ('manager','warehouse') and po_id in (select id from purchase_orders where status = 'draft'));

-- Functions: signed-in users only (each function checks the role it needs).
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Seed plumbing is never callable from the app.
revoke execute on function snapshot_seed(date), seed_copy(text, int, boolean) from authenticated;

-- Realtime: changes here push to every open screen.
alter publication supabase_realtime add table
  stock, inventory_txns, sales, sales_orders, sales_order_lines, returns, purchase_orders, po_lines,
  po_receipts, supplier_bills, production_orders, transfers, adjustments, journal_lines,
  items, suppliers, customers, bom_lines, settings, system_status;
