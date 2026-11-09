// Sets up the Supabase project from this repo. Reads .env.local.
//
//   node scripts/db/setup-remote.ts migrate            apply new migrations
//   node scripts/db/setup-remote.ts seed [YYYY-MM-DD]  load history ending that day (default yesterday)
//                                                      and snapshot it for Reset demo
//   node scripts/db/setup-remote.ts users              create the demo logins
//
// Needs SUPABASE_DB_URL (Session pooler connection string) for migrate/seed and
// VITE_SUPABASE_URL + SUPABASE_SECRET_KEY + DEMO_PASSWORD for users.

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { simulate } from '../seed/simulate.ts'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')
const need = (k: string) => process.env[k] ?? (console.error(`Missing ${k} in .env.local`), process.exit(1))

const cmd = process.argv[2]

async function withDb<T>(fn: (c: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: need('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false } })
  await client.connect()
  try { return await fn(client) } finally { await client.end() }
}

if (cmd === 'migrate') {
  await withDb(async (c) => {
    await c.query(`create schema if not exists ops; create table if not exists ops.applied_migrations (name text primary key, applied_at timestamptz default now())`)
    const done = new Set((await c.query(`select name from ops.applied_migrations`)).rows.map((r) => r.name))
    for (const f of readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue
      process.stdout.write(`applying ${f} … `)
      await c.query('begin')
      try {
        await c.query(readFileSync(join('supabase/migrations', f), 'utf8'))
        await c.query(`insert into ops.applied_migrations (name) values ($1)`, [f])
        await c.query('commit')
        console.log('ok')
      } catch (e) {
        await c.query('rollback')
        console.log('FAILED'); throw e
      }
    }
    console.log('migrations up to date')
  })
} else if (cmd === 'seed') {
  const end = process.argv[3] ?? new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  const sim = simulate({ end })
  console.log(`simulated ${sim.start} → ${sim.end}: ${sim.sql.length} statements`)
  await withDb(async (c) => {
    const { rows } = await c.query(`select count(*)::int n from sales`)
    if (rows[0].n > 0 && !process.argv.includes('--force')) {
      console.error(`The database already has ${rows[0].n} sales. Re-run with --force to wipe it and reload.`)
      process.exit(1)
    }
    if (rows[0].n > 0) {
      await c.query(`truncate journal_lines, expenses, inventory_txns, stock, transfers, adjustments, return_lines, returns,
        sale_lines, sales_order_lines, production_orders, supplier_bills, po_receipt_lines, po_receipts, po_lines,
        purchase_orders, sales, sales_orders, bom_lines restart identity cascade`)
      await c.query(`delete from items; delete from suppliers;
        delete from customers where id not in (select customer_id from profiles where customer_id is not null);
        delete from locations where id not in (select home_location_id from profiles where home_location_id is not null)`)
    }
    const CHUNK = 500
    const t0 = Date.now()
    for (let i = 0; i < sim.sql.length; i += CHUNK) {
      await c.query('begin;' + sim.sql.slice(i, i + CHUNK).join(';\n') + ';commit;')
      process.stdout.write(`\r${Math.min(i + CHUNK, sim.sql.length)} / ${sim.sql.length}`)
    }
    console.log(`\nloaded in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    await c.query(`select snapshot_seed($1)`, [sim.end])
    console.log('snapshot taken: Reset demo now restores this history')
  })
} else if (cmd === 'users') {
  const admin = createClient(need('VITE_SUPABASE_URL'), need('SUPABASE_SECRET_KEY'), { auth: { persistSession: false } })
  const password = need('DEMO_PASSWORD')
  const USERS = [
    { email: 'manager@snugglyduckling.example', full_name: 'Store Manager', role: 'manager', home: 1 },
    // Team logins (managers), one per teammate, so each person demos from their own laptop.
    { email: 'joe@snugglyduckling.example', full_name: 'Joe', role: 'manager', home: 1 },
    { email: 'leah@snugglyduckling.example', full_name: 'Leah', role: 'manager', home: 1 },
    { email: 'david@snugglyduckling.example', full_name: 'David', role: 'manager', home: 2 },
    { email: 'eric@snugglyduckling.example', full_name: 'Eric', role: 'manager', home: 3 },
    { email: 'andrew@snugglyduckling.example', full_name: 'Andrew', role: 'manager', home: 3 },
    { email: 'cashier@snugglyduckling.example', full_name: 'Front Counter', role: 'cashier', home: 1 },
    { email: 'warehouse@snugglyduckling.example', full_name: 'Warehouse & Kitchen', role: 'warehouse', home: 3 },
    { email: 'emma.larsen@example.com', full_name: 'Emma Larsen', role: 'customer', customer: 7 },
    { email: 'office@provotechhub.example', full_name: 'Provo Tech Hub', role: 'customer', customer: 1 },
  ]
  for (const u of USERS) {
    const existing = (await admin.auth.admin.listUsers()).data.users.find((x) => x.email === u.email)
    const id = existing?.id ?? (await admin.auth.admin.createUser({ email: u.email, password, email_confirm: true })).data.user?.id
    if (!id) throw new Error(`could not create ${u.email}`)
    const { error } = await admin.from('profiles').upsert({
      id, full_name: u.full_name, role: u.role, customer_id: u.customer ?? null, home_location_id: u.home ?? null,
    })
    if (error) throw error
    console.log(`${existing ? 'updated' : 'created'} ${u.role.padEnd(9)} ${u.email}`)
  }
} else {
  console.log('usage: node scripts/db/setup-remote.ts migrate | seed [YYYY-MM-DD] [--force] | users')
}
