-- Speed: "staff read" policies called is_staff() once per row (16 s for a view over the
-- inventory ledger). Wrapped in a scalar subquery, Postgres evaluates it once per query.
-- Same rule, same result; Supabase's recommended pattern for RLS performance.
do $$
declare t text;
begin
  foreach t in array array[
    'settings','accounts','reason_codes','locations','suppliers','items','bom_lines','customers','profiles',
    'inventory_txns','stock','transfers','adjustments','sales_orders','sales_order_lines','sales','sale_lines',
    'returns','return_lines','purchase_orders','po_lines','po_receipts','po_receipt_lines','supplier_bills',
    'production_orders','journal_lines','expenses','system_status'
  ] loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'staff read') then
      execute format('alter policy "staff read" on %I using ((select is_staff()))', t);
    end if;
  end loop;
end $$;
