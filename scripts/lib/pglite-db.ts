// Local stand-in for the Supabase database: PGlite (Postgres in WebAssembly)
// plus a tiny stub of Supabase's auth schema, so migrations and business
// functions can be tested without a cloud project.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const AUTH_STUB = `
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create role anon; create role authenticated; create role service_role;
`

// Migrations that only make sense on Supabase (RLS grants, realtime) are skipped locally.
const SUPABASE_ONLY = /_security\.sql$/

export async function openLocalDb(migrationsDir: string) {
  const db = new PGlite()
  await db.exec(AUTH_STUB)
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (SUPABASE_ONLY.test(f)) continue
    await db.exec(readFileSync(join(migrationsDir, f), 'utf8'))
  }
  return db
}
