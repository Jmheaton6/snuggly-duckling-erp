# The Snuggly Duckling ERP

A mini-ERP for a fake local snack store: two shops (Main Street in Provo, Riverside in Orem) and a warehouse kitchen that mixes trail mix, pops popcorn and packs gift boxes. It was built for GSCM 401 (Operations Management) at BYU Marriott.

**Stack:** React + TypeScript + Vite + Tailwind on the front end, with Supabase (Postgres, Auth, Realtime) behind it. The site is hosted on GitHub Pages and was built with Claude Code.

## How it works (read this before changing anything)

Every quantity and dollar comes from a posted transaction:

- **`inventory_txns` is the inventory ledger.** On-hand by item and location (`stock`) is its running total, kept by a trigger. The same trigger does weighted-average costing and refuses to let stock go negative.
- **`journal_lines` is the general ledger.** Each business action posts balanced debits and credits. The P&L and inventory valuation read from it.
- **Business actions are Postgres functions** in `supabase/migrations/20261109000002_functions.sql`: `post_sale`, `process_return`, `process_exchange`, `create_sales_order`, `fulfill_sales_order`, `create_purchase_order`, `receive_purchase_order`, `pay_supplier_bill`, `transfer_stock`, `adjust_stock`, `create/start/complete_production_order` and `record_expense`. Each one is a single transaction that writes the document, the ledger rows and the journal together.
- **The app never inserts stock or money rows directly.** It calls those functions with `rpc()` from `src/lib/supabase.ts`. Master data (items, suppliers, customers, settings) is edited directly; row-level security controls who can edit what.
- **Realtime** (`src/lib/realtime.ts`): any change refreshes every signed-in screen.

## Project layout

```
src/app/            shell, sidebar (nav.ts), sign-in, routes
src/modules/<area>/ one folder per ERP area (inventory, items, suppliers, …)
src/components/     shared UI (ui.tsx, DataTable.tsx)
src/lib/            supabase client, auth, realtime, formatting, shared queries
supabase/migrations/ schema → functions → views → demo reset → security (applied in order)
scripts/seed/       catalog.ts (master data) + simulate.ts (8 months of history) + check-local.ts
scripts/db/         setup-remote.ts (apply migrations, load history, create demo logins)
```

## Running it locally

```bash
npm install
cp .env.example .env.local      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev
```

Teammates only need the two `VITE_` values to run the app against the shared database. Ask Joe for them.

## Testing the database without touching the live project

```bash
npm run db:check                # loads every migration + the full simulated history into PGlite
```

It checks four things: the books balance per document, stock equals the ledger, the simulation's stock count matches the database, and Reset demo round-trips. Run it after changing any SQL or the simulation.

## Setting up (or rebuilding) the Supabase project

These steps need `SUPABASE_DB_URL`, `SUPABASE_SECRET_KEY` and `DEMO_PASSWORD` in `.env.local`. Never commit them.

```bash
npm run db:migrate              # applies new files in supabase/migrations
npm run db:seed                 # simulates history ending yesterday, loads it, snapshots it for Reset
npm run db:users                # creates the demo logins (manager / cashier / warehouse / 2 customers)
```

The Reset demo PIN is set once in the Supabase SQL editor and never stored in the repo:

```sql
insert into admin_secrets (key, value) values ('reset_pin', '1234')
on conflict (key) do update set value = excluded.value;
```

## Changing things as a team

1. `git pull`, then make a branch: `git checkout -b my-change`
2. Change the code. For any SQL change, add a **new** migration file. Never edit one that's already been applied.
3. Run `npm run typecheck`, and `npm run db:check` if you touched SQL.
4. Push and open a pull request. Merging to `main` redeploys the site automatically.

## Demo accounts

| Role | Email |
|---|---|
| Manager | manager@snugglyduckling.example |
| Team managers | joe@, leah@, david@, eric@, andrew@ (all `@snugglyduckling.example`) |
| Cashier | cashier@snugglyduckling.example |
| Warehouse & Kitchen | warehouse@snugglyduckling.example |
| Customer | emma.larsen@example.com |
| Customer (business) | office@provotechhub.example |

The team shares the password privately. It's not in this repo.
