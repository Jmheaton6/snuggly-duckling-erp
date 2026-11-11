// Sets up the Supabase project through the Supabase CLI login (`npx supabase login`),
// so no database password or secret key is needed. Same steps as setup-remote.ts.
//
//   node scripts/db/cli-setup.ts migrate
//   node scripts/db/cli-setup.ts seed [YYYY-MM-DD]
//   node scripts/db/cli-setup.ts users          (password from DEMO_PASSWORD in .env.local)
//   node scripts/db/cli-setup.ts pin <PIN>      (Reset demo PIN; stored only in the database)
//
// Project ref comes from VITE_SUPABASE_URL in .env.local.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simulate } from '../seed/simulate.ts'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')
const ref = (process.env.VITE_SUPABASE_URL ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (!ref) { console.error('Set VITE_SUPABASE_URL in .env.local first'); process.exit(1) }
const work = mkdtempSync(join(tmpdir(), 'sd-erp-'))
let n = 0

function run(sql: string, label: string): string {
  const file = join(work, `${String(++n).padStart(3, '0')}.sql`)
  writeFileSync(file, sql)
  try {
    return execFileSync('npx', ['supabase', 'db', 'query', `--remote=${ref}`, '--yes', '-f', file, '-o', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    console.error(`\n${label} FAILED\n${(err.stdout ?? '').slice(-2000)}\n${(err.stderr ?? '').slice(-2000)}`)
    process.exit(1)
  }
}
const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`

const cmd = process.argv[2]
if (cmd === 'migrate') {
  run(`create schema if not exists ops; create table if not exists ops.applied_migrations (name text primary key, applied_at timestamptz default now())`, 'tracking table')
  const done = run(`select coalesce(json_agg(name), '[]') as names from ops.applied_migrations`, 'list')
  for (const f of readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()) {
    if (done.includes(f)) { console.log(`skip ${f}`); continue }
    process.stdout.write(`applying ${f} … `)
    run(`begin;\n${readFileSync(join('supabase/migrations', f), 'utf8')}\ninsert into ops.applied_migrations (name) values (${sqlString(f)});\ncommit;`, f)
    console.log('ok')
  }
} else if (cmd === 'seed') {
  const end = process.argv[3] ?? new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  const sim = simulate({ end })
  console.log(`simulated ${sim.start} → ${sim.end}: ${sim.sql.length} statements`)
  const existing = run(`select count(*)::int as n from sales`, 'check')
  if (!/"n":\s*0\b/.test(existing)) { console.error('The database already has sales. Use Settings → Reset demo, or wipe it first.'); process.exit(1) }
  const CHUNK = 1500
  for (let i = 0; i < sim.sql.length; i += CHUNK) {
    run(`begin;\n${sim.sql.slice(i, i + CHUNK).join(';\n')};\ncommit;`, `seed chunk ${i}`)
    process.stdout.write(`\r${Math.min(i + CHUNK, sim.sql.length)} / ${sim.sql.length}`)
  }
  run(`select snapshot_seed('${sim.end}'); drop table seed.map;`, 'snapshot')
  console.log('\nloaded and snapshotted for Reset demo')
} else if (cmd === 'users') {
  const password = process.env.DEMO_PASSWORD
  if (!password) { console.error('Set DEMO_PASSWORD in .env.local'); process.exit(1) }
  const USERS: [string, string, string, number | null, number | null][] = [
    // email, name, role, home location, customer id
    ['manager@snugglyduckling.example', 'Store Manager', 'manager', 1, null],
    ['joe@snugglyduckling.example', 'Joe', 'manager', 1, null],
    ['leah@snugglyduckling.example', 'Leah', 'manager', 1, null],
    ['david@snugglyduckling.example', 'David', 'manager', 2, null],
    ['eric@snugglyduckling.example', 'Eric', 'manager', 3, null],
    ['andrew@snugglyduckling.example', 'Andrew', 'manager', 3, null],
    ['cashier@snugglyduckling.example', 'Front Counter', 'cashier', 1, null],
    ['warehouse@snugglyduckling.example', 'Warehouse & Kitchen', 'warehouse', 3, null],
    ['emma.larsen@example.com', 'Emma Larsen', 'customer', null, 7],
    ['office@provotechhub.example', 'Provo Tech Hub', 'customer', null, 1],
  ]
  const values = USERS.map(([e, name, role, home, cust]) => `(${sqlString(e)}, ${sqlString(name)}, '${role}', ${home ?? 'null'}, ${cust ?? 'null'})`).join(',\n')
  run(`do $$
declare u record; uid uuid;
begin
  for u in select * from (values ${values}) as t(email, full_name, role, home, cust) loop
    select id into uid from auth.users where email = u.email;
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', u.email,
        extensions.crypt(${sqlString(password)}, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, jsonb_build_object('sub', uid::text, 'email', u.email, 'email_verified', true),
        'email', uid::text, now(), now(), now());
    else
      update auth.users set encrypted_password = extensions.crypt(${sqlString(password)}, extensions.gen_salt('bf')) where id = uid;
    end if;
    insert into public.profiles (id, full_name, role, home_location_id, customer_id)
    values (uid, u.full_name, u.role, u.home, u.cust)
    on conflict (id) do update set full_name = excluded.full_name, role = excluded.role,
      home_location_id = excluded.home_location_id, customer_id = excluded.customer_id;
  end loop;
end $$;`, 'users')
  console.log(`${USERS.length} logins ready`)
} else if (cmd === 'pin') {
  const pin = process.argv[3]
  if (!pin) { console.error('usage: pin <PIN>'); process.exit(1) }
  run(`insert into admin_secrets (key, value) values ('reset_pin', ${sqlString(pin)}) on conflict (key) do update set value = excluded.value`, 'pin')
  console.log('reset PIN set')
} else {
  console.log('usage: node scripts/db/cli-setup.ts migrate | seed [YYYY-MM-DD] | users | pin <PIN>')
}
