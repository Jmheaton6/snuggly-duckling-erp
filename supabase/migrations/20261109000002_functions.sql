-- The Snuggly Duckling ERP — business functions
-- Each function is one database transaction that writes the document, its
-- inventory ledger rows and its journal lines together. The app (and the seed
-- loader) only ever changes stock or money through these.

-- ─────────────────────────────── helpers ───────────────────────────────

create function setting(p_key text) returns numeric
language sql stable as $$ select value from settings where key = p_key $$;

-- The business runs on Mountain time; "which day did this happen" uses it.
create function local_date(p_ts timestamptz) returns date
language sql stable as $$ select (p_ts at time zone 'America/Denver')::date $$;

-- 'system' = no request token (direct database connection: migrations, seed loader)
-- or the service key. API calls and Realtime both carry the signed-in user's token,
-- so their role comes from the user's profile.
create function app_role() returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.role() is null or auth.role() = 'service_role' then 'system'
    when auth.role() = 'authenticated' then (select role from profiles where id = auth.uid())
    else null
  end
$$;

create function require_role(variadic p_roles text[]) returns void
language plpgsql stable as $$
declare r text := app_role();
begin
  if r = 'system' or r = any(p_roles) then return; end if;
  raise exception 'Your login (%) is not allowed to do this', coalesce(r, 'signed out')
    using errcode = '42501';
end $$;

-- Only system callers may backdate (the seed history); everyone else posts at now().
create function effective_ts(p_ts timestamptz) returns timestamptz
language sql stable as $$
  select case when p_ts is not null and app_role() = 'system' then p_ts else now() end
$$;

-- Positive amount = debit, negative = credit. Zero lines are skipped.
create function post_je(p_ts timestamptz, p_ref_type text, p_ref_id bigint, p_memo text,
                        p_account text, p_amount numeric) returns void
language sql as $$
  insert into journal_lines (ts, account, debit, credit, ref_type, ref_id, memo)
  select p_ts, p_account, greatest(round(p_amount, 2), 0), greatest(-round(p_amount, 2), 0),
         p_ref_type, p_ref_id, p_memo
  where round(p_amount, 2) <> 0
$$;

create function hold_location_id() returns int
language sql stable as $$ select id::int from locations where kind = 'hold' order by id limit 1 $$;

create function stock_qty(p_item_id int, p_location_id int) returns numeric
language sql stable as $$
  select coalesce((select qty from stock where item_id = p_item_id and location_id = p_location_id), 0)
$$;

-- How many kits could be assembled right now from components at a location.
create function kit_buildable(p_item_id int, p_location_id int) returns numeric
language sql stable as $$
  select coalesce(min(floor(stock_qty(b.component_id, p_location_id) / b.qty_per)), 0)
  from bom_lines b where b.parent_id = p_item_id
$$;

-- Most recent price paid, falling back to the current average cost.
create function last_cost(p_item_id int) returns numeric
language sql stable as $$
  select coalesce(
    (select l.unit_cost from po_lines l join purchase_orders p on p.id = l.po_id
      where l.item_id = p_item_id and p.status <> 'cancelled' order by p.created_at desc, l.id desc limit 1),
    (select avg_cost from items where id = p_item_id))
$$;

-- ───────────────────────────── point of sale ─────────────────────────────

create function post_sale(
  p_location_id int,
  p_lines jsonb,                       -- [{item_id, qty, unit_price?, discount?}]
  p_order_discount numeric default 0,  -- dollars off the whole ticket
  p_customer_id int default null,
  p_tender text default 'card',
  p_ts timestamptz default null,
  p_sales_order_id bigint default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_ts timestamptz := effective_ts(p_ts);
  v_rate numeric := setting('tax_rate');
  v_sale bigint;
  v_line jsonb;
  v_item items;
  v_n int := jsonb_array_length(coalesce(p_lines, '[]'::jsonb));
  v_i int := 0;
  v_qty numeric; v_price numeric; v_gross numeric; v_ldisc numeric; v_alloc numeric;
  v_subtotal numeric := 0; v_line_disc numeric := 0; v_base numeric; v_order_disc numeric; v_alloc_left numeric;
  v_line_cogs numeric; v_cogs numeric := 0; v_cost numeric;
  v_from_stock numeric; v_rest numeric;
  v_comp record;
  v_sl bigint;
  v_disc numeric; v_tax numeric; v_total numeric;
begin
  perform require_role('manager', 'cashier', 'warehouse');
  if v_n = 0 then raise exception 'The sale has no items'; end if;
  if (select kind from locations where id = p_location_id) = 'hold' then
    raise exception 'Returns Hold stock cannot be sold';
  end if;

  -- First pass: totals, so an order-level discount can be shared across lines.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from items where id = (v_line->>'item_id')::int;
    if not found then raise exception 'Unknown item %', v_line->>'item_id'; end if;
    v_qty := (v_line->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity for % must be positive', v_item.name; end if;
    v_subtotal := v_subtotal + round(v_qty * coalesce((v_line->>'unit_price')::numeric, v_item.price), 2);
    v_line_disc := v_line_disc + round(coalesce((v_line->>'discount')::numeric, 0), 2);
  end loop;
  v_base := v_subtotal - v_line_disc;
  v_order_disc := least(round(coalesce(p_order_discount, 0), 2), greatest(v_base, 0));
  v_alloc_left := v_order_disc;

  insert into sales (ts, location_id, customer_id, sales_order_id, subtotal, discount_total, tax, total, cogs, tax_rate, tender, user_id)
  values (v_ts, p_location_id, p_customer_id, p_sales_order_id, 0, 0, 0, 0, 0, v_rate, coalesce(p_tender, 'card'), auth.uid())
  returning id into v_sale;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    select * into v_item from items where id = (v_line->>'item_id')::int;
    if v_item.kind = 'component' then
      raise exception '% is a component and is not sold on its own', v_item.name;
    end if;
    v_qty := (v_line->>'qty')::numeric;
    v_price := coalesce((v_line->>'unit_price')::numeric, v_item.price);
    v_gross := round(v_qty * v_price, 2);
    v_ldisc := round(coalesce((v_line->>'discount')::numeric, 0), 2);
    v_alloc := case when v_i = v_n or v_base = 0 then v_alloc_left
                    else round(v_order_disc * (v_gross - v_ldisc) / v_base, 2) end;
    v_alloc := least(v_alloc, v_alloc_left);
    v_alloc_left := v_alloc_left - v_alloc;

    insert into sale_lines (sale_id, item_id, qty, unit_price, discount, net_amount, cogs)
    values (v_sale, v_item.id, v_qty, v_price, v_ldisc + v_alloc, v_gross - v_ldisc - v_alloc, 0)
    returning id into v_sl;

    v_line_cogs := 0;
    if v_item.kind = 'kit' then
      -- Sell pre-packed boxes first; assemble the rest at the counter (backflush components).
      v_from_stock := least(v_qty, stock_qty(v_item.id, p_location_id));
      if v_from_stock > 0 then
        insert into inventory_txns (ts, item_id, location_id, qty, txn_type, ref_type, ref_id, user_id)
        values (v_ts, v_item.id, p_location_id, -v_from_stock, 'sale', 'sale', v_sale, auth.uid())
        returning unit_cost into v_cost;
        v_line_cogs := v_line_cogs + v_cost * v_from_stock;
      end if;
      v_rest := v_qty - v_from_stock;
      if v_rest > 0 then
        for v_comp in select component_id, qty_per from bom_lines where parent_id = v_item.id loop
          insert into inventory_txns (ts, item_id, location_id, qty, txn_type, ref_type, ref_id, note, user_id)
          values (v_ts, v_comp.component_id, p_location_id, -(v_rest * v_comp.qty_per), 'sale_kit', 'sale', v_sale,
                  'Backflushed for ' || v_item.name, auth.uid())
          returning unit_cost into v_cost;
          v_line_cogs := v_line_cogs + v_cost * v_rest * v_comp.qty_per;
        end loop;
      end if;
    else
      insert into inventory_txns (ts, item_id, location_id, qty, txn_type, ref_type, ref_id, user_id)
      values (v_ts, v_item.id, p_location_id, -v_qty, 'sale', 'sale', v_sale, auth.uid())
      returning unit_cost into v_cost;
      v_line_cogs := v_cost * v_qty;
    end if;

    update sale_lines set cogs = round(v_line_cogs, 2) where id = v_sl;
    v_cogs := v_cogs + round(v_line_cogs, 2);
  end loop;

  v_disc := v_line_disc + v_order_disc;
  v_tax := round((v_subtotal - v_disc) * v_rate, 2);
  v_total := v_subtotal - v_disc + v_tax;
  update sales set subtotal = v_subtotal, discount_total = v_disc, tax = v_tax, total = v_total, cogs = v_cogs
   where id = v_sale;

  perform post_je(v_ts, 'sale', v_sale, 'Sale', '1000', v_total);
  perform post_je(v_ts, 'sale', v_sale, 'Sale', '4100', v_disc);
  perform post_je(v_ts, 'sale', v_sale, 'Sale', '4000', -v_subtotal);
  perform post_je(v_ts, 'sale', v_sale, 'Sale', '2100', -v_tax);
  perform post_je(v_ts, 'sale', v_sale, 'Sale', '5000', v_cogs);
  perform post_je(v_ts, 'sale', v_sale, 'Sale', '1200', -v_cogs);
  return v_sale;
end $$;

-- ──────────────────────────── returns & exchanges ────────────────────────────

create function process_return(
  p_sale_id bigint,
  p_lines jsonb,                    -- [{sale_line_id, qty, reason_code}]
  p_location_id int default null,   -- store taking the return (default: where it was sold)
  p_ts timestamptz default null,
  p_note text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_ts timestamptz := effective_ts(p_ts);
  v_sale sales;
  v_line jsonb;
  v_sl sale_lines;
  v_qty numeric;
  v_reason reason_codes;
  v_to int;
  v_store int;
  v_ret bigint;
  v_refund numeric; v_unit_cost numeric;
  v_net numeric := 0; v_cogs numeric := 0; v_tax numeric;
begin
  perform require_role('manager', 'cashier');
  select * into v_sale from sales where id = p_sale_id;
  if not found then raise exception 'Receipt % not found', p_sale_id; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Nothing selected to return'; end if;
  v_store := coalesce(p_location_id, v_sale.location_id);

  insert into returns (ts, sale_id, location_id, refund_net, refund_tax, refund_total, cogs_reversed, note, user_id)
  values (v_ts, p_sale_id, v_store, 0, 0, 0, 0, p_note, auth.uid())
  returning id into v_ret;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_sl from sale_lines where id = (v_line->>'sale_line_id')::bigint and sale_id = p_sale_id for update;
    if not found then raise exception 'That line is not on receipt %', p_sale_id; end if;
    v_qty := (v_line->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Return quantity must be positive'; end if;
    if v_qty > v_sl.qty - v_sl.returned_qty then
      raise exception 'Only % of % can still be returned', v_sl.qty - v_sl.returned_qty,
        (select name from items where id = v_sl.item_id);
    end if;
    select * into v_reason from reason_codes where code = v_line->>'reason_code' and applies_to = 'return';
    if not found then raise exception 'Pick a return reason'; end if;

    -- Quality failures go back into inventory, but into quarantine, not onto the shelf.
    v_to := case when v_reason.is_quality then hold_location_id() else v_store end;
    v_refund := round(v_sl.net_amount * v_qty / v_sl.qty, 2);
    v_unit_cost := round(v_sl.cogs / v_sl.qty, 4);

    insert into inventory_txns (ts, item_id, location_id, qty, unit_cost, txn_type, ref_type, ref_id, reason_code, user_id)
    values (v_ts, v_sl.item_id, v_to, v_qty, v_unit_cost, 'return', 'return', v_ret, v_reason.code, auth.uid());
    insert into return_lines (return_id, sale_line_id, item_id, qty, refund_net, unit_cost, reason_code, to_location_id)
    values (v_ret, v_sl.id, v_sl.item_id, v_qty, v_refund, v_unit_cost, v_reason.code, v_to);
    update sale_lines set returned_qty = returned_qty + v_qty where id = v_sl.id;

    v_net := v_net + v_refund;
    v_cogs := v_cogs + round(v_unit_cost * v_qty, 2);
  end loop;

  v_tax := round(v_net * v_sale.tax_rate, 2);
  update returns set refund_net = v_net, refund_tax = v_tax, refund_total = v_net + v_tax, cogs_reversed = v_cogs
   where id = v_ret;

  perform post_je(v_ts, 'return', v_ret, 'Customer return', '4200', v_net);
  perform post_je(v_ts, 'return', v_ret, 'Customer return', '2100', v_tax);
  perform post_je(v_ts, 'return', v_ret, 'Customer return', '1000', -(v_net + v_tax));
  perform post_je(v_ts, 'return', v_ret, 'Customer return', '1200', v_cogs);
  perform post_je(v_ts, 'return', v_ret, 'Customer return', '5000', -v_cogs);
  return v_ret;
end $$;

-- Exchange = a return plus a new sale; the customer pays (or gets back) the difference.
create function process_exchange(
  p_sale_id bigint,
  p_return_lines jsonb,
  p_new_lines jsonb,
  p_location_id int default null,
  p_ts timestamptz default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ret bigint;
  v_new bigint;
  v_loc int;
  v_refund numeric;
  v_charge numeric;
begin
  perform require_role('manager', 'cashier');
  v_ret := process_return(p_sale_id, p_return_lines, p_location_id, p_ts, p_note);
  select location_id, refund_total into v_loc, v_refund from returns where id = v_ret;
  v_new := post_sale(v_loc, p_new_lines, 0, (select customer_id from sales where id = p_sale_id),
                     'exchange', (select ts from returns where id = v_ret));
  select total into v_charge from sales where id = v_new;
  update returns set kind = 'exchange', exchange_sale_id = v_new where id = v_ret;
  return jsonb_build_object('return_id', v_ret, 'sale_id', v_new, 'refund', v_refund,
                            'charge', v_charge, 'customer_pays', v_charge - v_refund);
end $$;

-- ─────────────────────────────── sales orders ───────────────────────────────

create function create_sales_order(
  p_customer_id int,
  p_location_id int,
  p_requested_date date,
  p_lines jsonb,                 -- [{item_id, qty}]
  p_note text default null,
  p_ts timestamptz default null,
  p_source text default null     -- seed history only; live orders get their source from the login
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_role text := app_role();
  v_customer int := p_customer_id;
  v_so bigint;
  v_line jsonb;
  v_item items;
begin
  if v_role = 'customer' then
    v_customer := (select customer_id from profiles where id = auth.uid());
  else
    perform require_role('manager', 'cashier', 'warehouse');
  end if;
  if v_customer is null then raise exception 'Pick a customer'; end if;
  if (select kind from locations where id = p_location_id) is distinct from 'store'
     and (select kind from locations where id = p_location_id) is distinct from 'warehouse' then
    raise exception 'Pick a pickup location';
  end if;
  if p_requested_date is null or p_requested_date < local_date(effective_ts(p_ts)) then
    raise exception 'Pickup date cannot be in the past';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'The order has no items'; end if;

  insert into sales_orders (customer_id, location_id, order_date, requested_date, source, note, created_by)
  values (v_customer, p_location_id, effective_ts(p_ts), p_requested_date,
          case when v_role = 'customer' then 'portal'
               when v_role = 'system' and p_source is not null then p_source
               else 'staff' end, p_note, auth.uid())
  returning id into v_so;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from items where id = (v_line->>'item_id')::int and active;
    if not found or v_item.kind = 'component' then raise exception 'Item % cannot be ordered', v_line->>'item_id'; end if;
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then raise exception 'Quantity for % must be positive', v_item.name; end if;
    insert into sales_order_lines (sales_order_id, item_id, qty, unit_price)
    values (v_so, v_item.id, (v_line->>'qty')::numeric, v_item.price);
  end loop;
  return v_so;
end $$;

create function fulfill_sales_order(p_id bigint, p_ts timestamptz default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_so sales_orders;
  v_sale bigint;
begin
  perform require_role('manager', 'cashier', 'warehouse');
  select * into v_so from sales_orders where id = p_id for update;
  if not found then raise exception 'Order % not found', p_id; end if;
  if v_so.status <> 'placed' then raise exception 'Order % is already %', p_id, v_so.status; end if;

  v_sale := post_sale(
    v_so.location_id,
    (select jsonb_agg(jsonb_build_object('item_id', item_id, 'qty', qty, 'unit_price', unit_price) order by id)
       from sales_order_lines where sales_order_id = p_id),
    0, v_so.customer_id, 'card', p_ts, p_id);

  update sales_orders set status = 'fulfilled', sale_id = v_sale, fulfilled_at = (select ts from sales where id = v_sale)
   where id = p_id;
  return v_sale;
end $$;

create function close_sales_order(p_id bigint, p_ts timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role('manager', 'cashier', 'warehouse');
  update sales_orders set status = 'closed', closed_at = effective_ts(p_ts)
   where id = p_id and status = 'fulfilled';
  if not found then raise exception 'Only fulfilled orders can be closed'; end if;
end $$;

create function cancel_sales_order(p_id bigint, p_ts timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders;
begin
  select * into v_so from sales_orders where id = p_id for update;
  if not found then raise exception 'Order % not found', p_id; end if;
  if app_role() = 'customer' then
    if v_so.customer_id is distinct from (select customer_id from profiles where id = auth.uid()) then
      raise exception 'That is not your order';
    end if;
  else
    perform require_role('manager', 'cashier', 'warehouse');
  end if;
  if v_so.status <> 'placed' then raise exception 'Only open orders can be cancelled'; end if;
  update sales_orders set status = 'cancelled', closed_at = effective_ts(p_ts) where id = p_id;
end $$;

-- ─────────────────────────────── purchasing ───────────────────────────────

create function send_purchase_order(p_po_id bigint, p_ts timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ts timestamptz := effective_ts(p_ts);
  v_lead int;
begin
  perform require_role('manager', 'warehouse');
  select s.lead_time_days into v_lead
    from purchase_orders p join suppliers s on s.id = p.supplier_id where p.id = p_po_id;
  update purchase_orders
     set status = 'sent', sent_at = v_ts, lead_time_quoted = v_lead,
         expected_date = local_date(v_ts) + v_lead
   where id = p_po_id and status = 'draft';
  if not found then raise exception 'Only draft purchase orders can be sent'; end if;
end $$;

create function create_purchase_order(
  p_supplier_id int,
  p_location_id int,
  p_lines jsonb,                 -- [{item_id, qty, unit_cost?}]
  p_send boolean default true,
  p_ts timestamptz default null,
  p_note text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_po bigint;
  v_line jsonb;
begin
  perform require_role('manager', 'warehouse');
  if (select kind from locations where id = p_location_id) = 'hold' then
    raise exception 'Purchase orders cannot be received into Returns Hold';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'The PO has no items'; end if;

  insert into purchase_orders (supplier_id, location_id, created_at, note, created_by)
  values (p_supplier_id, p_location_id, effective_ts(p_ts), p_note, auth.uid())
  returning id into v_po;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then raise exception 'PO quantities must be positive'; end if;
    insert into po_lines (po_id, item_id, qty_ordered, unit_cost)
    values (v_po, (v_line->>'item_id')::int, (v_line->>'qty')::numeric,
            coalesce((v_line->>'unit_cost')::numeric, last_cost((v_line->>'item_id')::int)));
  end loop;

  if p_send then perform send_purchase_order(v_po, p_ts); end if;
  return v_po;
end $$;

-- p_lines null = receive everything still open on the PO.
create function receive_purchase_order(
  p_po_id bigint,
  p_lines jsonb default null,    -- [{po_line_id, qty}]
  p_location_id int default null,
  p_ts timestamptz default null,
  p_note text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_ts timestamptz := effective_ts(p_ts);
  v_po purchase_orders;
  v_loc int;
  v_rcpt bigint;
  v_line record;
  v_amount numeric := 0;
  v_count int := 0;
  v_terms int;
begin
  perform require_role('manager', 'warehouse');
  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found then raise exception 'PO % not found', p_po_id; end if;
  if v_po.status not in ('sent', 'partial') then raise exception 'PO % is %, not open for receiving', p_po_id, v_po.status; end if;
  v_loc := coalesce(p_location_id, v_po.location_id);
  if (select kind from locations where id = v_loc) = 'hold' then raise exception 'Cannot receive into Returns Hold'; end if;

  insert into po_receipts (po_id, ts, location_id, note, user_id)
  values (p_po_id, v_ts, v_loc, p_note, auth.uid()) returning id into v_rcpt;

  for v_line in
    select l.*, case when p_lines is null then l.qty_ordered - l.qty_received
                     else coalesce((select (e->>'qty')::numeric from jsonb_array_elements(p_lines) e
                                     where (e->>'po_line_id')::bigint = l.id limit 1), 0) end as qty_now
      from po_lines l where l.po_id = p_po_id order by l.id
  loop
    continue when v_line.qty_now <= 0;
    if v_line.qty_now > v_line.qty_ordered - v_line.qty_received then
      raise exception 'Receiving % of %, but only % are still open',
        v_line.qty_now, (select name from items where id = v_line.item_id), v_line.qty_ordered - v_line.qty_received;
    end if;
    insert into inventory_txns (ts, item_id, location_id, qty, unit_cost, txn_type, ref_type, ref_id, user_id)
    values (v_ts, v_line.item_id, v_loc, v_line.qty_now, v_line.unit_cost, 'po_receipt', 'po_receipt', v_rcpt, auth.uid());
    insert into po_receipt_lines (receipt_id, po_line_id, item_id, qty)
    values (v_rcpt, v_line.id, v_line.item_id, v_line.qty_now);
    update po_lines set qty_received = qty_received + v_line.qty_now where id = v_line.id;
    v_amount := v_amount + round(v_line.qty_now * v_line.unit_cost, 2);
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'Enter a quantity to receive'; end if;

  update purchase_orders
     set status = case when exists (select 1 from po_lines where po_id = p_po_id and qty_received < qty_ordered)
                       then 'partial' else 'received' end
   where id = p_po_id;

  select terms_days into v_terms from suppliers where id = v_po.supplier_id;
  insert into supplier_bills (supplier_id, po_id, receipt_id, bill_date, due_date, amount)
  values (v_po.supplier_id, p_po_id, v_rcpt, local_date(v_ts), local_date(v_ts) + v_terms, v_amount);

  perform post_je(v_ts, 'po_receipt', v_rcpt, 'PO receipt', '1200', v_amount);
  perform post_je(v_ts, 'po_receipt', v_rcpt, 'PO receipt', '2000', -v_amount);
  return v_rcpt;
end $$;

-- Received (or short-received) POs are closed once the paperwork is done.
create function close_purchase_order(p_po_id bigint, p_ts timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role('manager', 'warehouse');
  update purchase_orders set status = 'closed', closed_at = effective_ts(p_ts)
   where id = p_po_id and status in ('received', 'partial');
  if not found then raise exception 'Only received or partly received POs can be closed'; end if;
end $$;

create function cancel_purchase_order(p_po_id bigint, p_ts timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role('manager', 'warehouse');
  update purchase_orders set status = 'cancelled', closed_at = effective_ts(p_ts)
   where id = p_po_id and status in ('draft', 'sent')
     and not exists (select 1 from po_lines where po_id = p_po_id and qty_received > 0);
  if not found then raise exception 'Only POs with nothing received can be cancelled'; end if;
end $$;

create function pay_supplier_bill(p_bill_id bigint, p_ts timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ts timestamptz := effective_ts(p_ts);
  v_amount numeric;
begin
  perform require_role('manager');
  update supplier_bills set paid_at = v_ts where id = p_bill_id and paid_at is null
  returning amount into v_amount;
  if not found then raise exception 'Bill % is already paid', p_bill_id; end if;
  perform post_je(v_ts, 'bill_payment', p_bill_id, 'Supplier payment', '2000', v_amount);
  perform post_je(v_ts, 'bill_payment', p_bill_id, 'Supplier payment', '1000', -v_amount);
end $$;

-- ─────────────────────────── transfers & adjustments ───────────────────────────

create function transfer_stock(
  p_item_id int, p_from_location_id int, p_to_location_id int, p_qty numeric,
  p_ts timestamptz default null, p_note text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_ts timestamptz := effective_ts(p_ts);
  v_id bigint;
  v_cost numeric;
begin
  perform require_role('manager', 'warehouse', 'cashier');
  if coalesce(p_qty, 0) <= 0 then raise exception 'Transfer quantity must be positive'; end if;
  insert into transfers (ts, item_id, from_location_id, to_location_id, qty, note, user_id)
  values (v_ts, p_item_id, p_from_location_id, p_to_location_id, p_qty, p_note, auth.uid())
  returning id into v_id;
  insert into inventory_txns (ts, item_id, location_id, qty, txn_type, ref_type, ref_id, note, user_id)
  values (v_ts, p_item_id, p_from_location_id, -p_qty, 'transfer_out', 'transfer', v_id, p_note, auth.uid())
  returning unit_cost into v_cost;
  insert into inventory_txns (ts, item_id, location_id, qty, unit_cost, txn_type, ref_type, ref_id, note, user_id)
  values (v_ts, p_item_id, p_to_location_id, p_qty, v_cost, 'transfer_in', 'transfer', v_id, p_note, auth.uid());
  return v_id;
end $$;

-- Give either the counted quantity (cycle count) or a +/- change.
create function adjust_stock(
  p_item_id int, p_location_id int, p_reason_code text,
  p_new_qty numeric default null, p_delta numeric default null,
  p_ts timestamptz default null, p_note text default null, p_unit_cost numeric default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_ts timestamptz := effective_ts(p_ts);
  v_before numeric := stock_qty(p_item_id, p_location_id);
  v_delta numeric;
  v_cost numeric;
  v_id bigint;
  v_value numeric;
begin
  perform require_role('manager', 'warehouse', 'cashier');
  if not exists (select 1 from reason_codes where code = p_reason_code and applies_to = 'adjust') then
    raise exception 'Pick an adjustment reason';
  end if;
  if p_reason_code = 'OPENING' and app_role() <> 'system' then raise exception 'Opening balances are set by the seed only'; end if;
  v_delta := coalesce(p_delta, p_new_qty - v_before);
  if v_delta is null then raise exception 'Enter the counted quantity or the change'; end if;

  insert into adjustments (ts, item_id, location_id, qty_before, qty_after, delta, reason_code, note, user_id)
  values (v_ts, p_item_id, p_location_id, v_before, v_before + v_delta, v_delta, p_reason_code, p_note, auth.uid())
  returning id into v_id;

  if v_delta <> 0 then
    insert into inventory_txns (ts, item_id, location_id, qty, unit_cost, txn_type, ref_type, ref_id, reason_code, note, user_id)
    values (v_ts, p_item_id, p_location_id, v_delta, p_unit_cost, 'adjust', 'adjustment', v_id, p_reason_code, p_note, auth.uid())
    returning unit_cost into v_cost;
    v_value := round(v_delta * v_cost, 2);
    update adjustments set unit_cost = v_cost where id = v_id;
    perform post_je(v_ts, 'adjustment', v_id, 'Inventory adjustment', '1200', v_value);
    perform post_je(v_ts, 'adjustment', v_id, 'Inventory adjustment',
                    case when p_reason_code = 'OPENING' then '3000' else '5100' end, -v_value);
  end if;
  return v_id;
end $$;

-- ─────────────────────────────── production ───────────────────────────────

create function create_production_order(
  p_item_id int, p_qty numeric, p_location_id int,
  p_due_date date default null, p_sales_order_id bigint default null,
  p_ts timestamptz default null, p_note text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform require_role('manager', 'warehouse');
  if not exists (select 1 from bom_lines where parent_id = p_item_id) then
    raise exception 'This item has no bill of materials';
  end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'Quantity must be positive'; end if;
  insert into production_orders (item_id, location_id, qty_planned, due_date, sales_order_id, created_at, note, created_by)
  values (p_item_id, p_location_id, p_qty, p_due_date, p_sales_order_id, effective_ts(p_ts), p_note, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Issue: consume components per the BOM for the quantity actually started.
create function start_production_order(p_id bigint, p_qty_started numeric default null, p_ts timestamptz default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ts timestamptz := effective_ts(p_ts);
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
create function complete_production_order(
  p_id bigint, p_qty_good numeric, p_qty_scrapped numeric default 0, p_qty_reworked numeric default 0,
  p_reason_code text default null, p_ts timestamptz default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ts timestamptz := effective_ts(p_ts);
  v_wo production_orders;
  v_unit numeric;
  v_good_value numeric;
begin
  perform require_role('manager', 'warehouse');
  select * into v_wo from production_orders where id = p_id for update;
  if not found then raise exception 'Production order % not found', p_id; end if;
  if v_wo.status <> 'in_progress' then raise exception 'Start production order % before completing it', p_id; end if;
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

create function cancel_production_order(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role('manager', 'warehouse');
  update production_orders set status = 'cancelled' where id = p_id and status = 'planned';
  if not found then raise exception 'Only planned production orders can be cancelled'; end if;
end $$;

-- ─────────────────────────────── expenses ───────────────────────────────

create function record_expense(p_account text, p_amount numeric, p_memo text default null, p_ts timestamptz default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_ts timestamptz := effective_ts(p_ts);
  v_id bigint;
begin
  perform require_role('manager');
  if (select type from accounts where code = p_account) is distinct from 'expense' then
    raise exception 'Pick an expense account';
  end if;
  insert into expenses (ts, account, amount, memo, user_id) values (v_ts, p_account, p_amount, p_memo, auth.uid())
  returning id into v_id;
  perform post_je(v_ts, 'expense', v_id, p_memo, p_account, p_amount);
  perform post_je(v_ts, 'expense', v_id, p_memo, '1000', -p_amount);
  return v_id;
end $$;
