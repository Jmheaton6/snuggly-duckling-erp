-- MRP lot sizing. Each item orders either lot for lot (L4L: exactly the net requirement)
-- or in fixed order quantities (FOQ: whole multiples of lot_qty, e.g. a full case).
alter table items
  add column lot_rule text not null default 'L4L' check (lot_rule in ('L4L', 'FOQ')),
  add column lot_qty numeric(12,3) check (lot_qty > 0),
  add constraint items_foq_needs_qty check (lot_rule = 'L4L' or lot_qty is not null);

-- reset_demo copies every public.items column from seed.items, so the snapshot needs them too.
do $$
begin
  if to_regclass('seed.items') is not null then
    alter table seed.items
      add column if not exists lot_rule text not null default 'L4L',
      add column if not exists lot_qty numeric(12,3);
  end if;
end $$;

-- Starting values: bought items come in full supplier cases, house-made items in batches
-- of 12, and kits stay lot for lot (packed to order). Same rule as scripts/seed/catalog.ts.
create temp table lot_seed (sku text primary key, q numeric) on commit drop;
insert into lot_seed values
  ('SD-1001', 24), ('SD-1002', 24), ('SD-1003', 24), ('SD-1004', 12), ('SD-1005', 48), ('SD-1101', 24),
  ('SD-1102', 24), ('SD-1103', 24), ('SD-1104', 24), ('SD-1105', 24), ('SD-1201', 24), ('SD-1202', 36),
  ('SD-1203', 24), ('SD-1204', 36), ('SD-1205', 24), ('SD-2001', 25), ('SD-2002', 25), ('SD-2003', 25),
  ('SD-2004', 25), ('SD-2005', 10), ('SD-2006', 50), ('SD-2007', 36), ('SD-2008', 50), ('SD-2009', 10),
  ('SD-2010', 35), ('SD-2101', 500), ('SD-2102', 500), ('SD-2103', 100), ('SD-2104', 1000), ('SD-3001', 12),
  ('SD-3002', 12), ('SD-3003', 12);
update items i set lot_rule = 'FOQ', lot_qty = s.q from lot_seed s where s.sku = i.sku;
do $$
begin
  if to_regclass('seed.items') is not null then
    update seed.items i set lot_rule = 'FOQ', lot_qty = s.q from lot_seed s where s.sku = i.sku;
  end if;
end $$;
