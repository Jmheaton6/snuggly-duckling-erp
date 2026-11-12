// Loads the full simulated history into a local PGlite database and checks it:
// every call succeeds, the books balance, stock matches the ledger and the
// simulation's own count, and demand is varied enough for EOQ/ROP to mean something.
import { openLocalDb } from '../lib/pglite-db.ts'
import { simulate } from './simulate.ts'

const end = process.argv[2] ?? new Date(Date.now() - 864e5).toISOString().slice(0, 10)
const t0 = Date.now()
const sim = simulate({ end })
console.log(`simulated ${sim.start} → ${sim.end}: ${sim.sql.length} statements in ${Date.now() - t0} ms`)
console.log(sim.stats)

const db = await openLocalDb('supabase/migrations')
const t1 = Date.now()
const CHUNK = 400
for (let i = 0; i < sim.sql.length; i += CHUNK) {
  const chunk = sim.sql.slice(i, i + CHUNK)
  try {
    await db.exec('begin;' + chunk.join(';\n') + ';commit;')
  } catch {
    await db.exec('rollback')
    for (const [j, s] of chunk.entries()) {
      try { await db.exec(s) } catch (e) { console.error(`FAILED at statement ${i + j}:\n${s.slice(0, 600)}\n→ ${(e as Error).message}`); process.exit(1) }
    }
  }
}
console.log(`loaded in ${((Date.now() - t1) / 1000).toFixed(1)} s`)

const q = async (s: string) => (await db.query<Record<string, unknown>>(s)).rows
const one = async (s: string) => (await q(s))[0]
const fails: string[] = []
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg) }

const jb = await one(`select sum(debit) - sum(credit) as diff from journal_lines`)
check(Number(jb.diff) === 0, `journal balances overall (diff ${jb.diff})`)
const unbalanced = await one(`select count(*) n from (select ref_type, ref_id from journal_lines group by 1,2 having sum(debit) <> sum(credit)) x`)
check(Number(unbalanced.n) === 0, `every document's journal entry balances (${unbalanced.n} unbalanced)`)
const ledger = await one(`select count(*) n from (select item_id, location_id, sum(qty) q from inventory_txns group by 1,2) l
  full join stock s using (item_id, location_id) where coalesce(l.q,0) <> coalesce(s.qty,0)`)
check(Number(ledger.n) === 0, `stock table equals the sum of the ledger (${ledger.n} mismatches)`)
const neg = await one(`select count(*) n from stock where qty < 0`)
check(Number(neg.n) === 0, `no negative on-hand`)
const dbStock = new Map((await q(`select item_id || ':' || location_id k, qty::float q from stock where qty <> 0`)).map((r) => [r.k as string, r.q as number]))
const simMismatch = sim.finalStock.filter((s) => Math.abs((dbStock.get(s.key) ?? 0) - s.qty) > 1e-6)
check(simMismatch.length === 0 && dbStock.size === sim.finalStock.length, `simulation's stock matches the database (${simMismatch.length} mismatches)`)
const inv = await one(`select (select coalesce(sum(debit - credit),0) from journal_lines where account = '1200') gl,
  (select sum(s.qty * i.avg_cost) from stock s join items i on i.id = s.item_id) perpetual`)
check(Math.abs(Number(inv.gl) - Number(inv.perpetual)) < 25, `GL inventory ${Number(inv.gl).toFixed(2)} ≈ on-hand × avg cost ${Number(inv.perpetual).toFixed(2)}`)

console.log('\n— monthly P&L —')
console.table(await q(`select to_char(date_trunc('month', ts at time zone 'America/Denver'), 'YYYY-MM') m,
  round(sum(case when a.type in ('revenue','contra_revenue') then credit - debit else 0 end)) net_sales,
  round(sum(case when a.type = 'cogs' then debit - credit else 0 end)) cogs,
  round(sum(case when a.type = 'expense' then debit - credit else 0 end)) opex,
  round(sum(case when a.type in ('revenue','contra_revenue') then credit - debit when a.type in ('cogs','expense') then credit - debit else 0 end)) net_income
  from journal_lines j join accounts a on a.code = j.account group by 1 order by 1`))

console.log('— supplier behavior (what the scorecard must rediscover) —')
console.table(await q(`select s.name, count(distinct p.id) pos,
  round(100.0 * avg(case when local_date(r.ts) <= p.expected_date then 1 else 0 end)) on_time_pct,
  round(avg(local_date(r.ts) - local_date(p.sent_at)), 1) actual_lead, max(s.lead_time_days) quoted,
  round(100.0 * sum(l.qty_received) / sum(l.qty_ordered)) fill_pct
  from purchase_orders p join suppliers s on s.id = p.supplier_id
  join po_receipts r on r.po_id = p.id and r.id = (select min(id) from po_receipts where po_id = p.id)
  join po_lines l on l.po_id = p.id group by s.name order by 1`))

console.log('— demand variety (daily units, last 180 days) —')
console.table(await q(`with d as (select i.name, local_date(t.ts) as dt, -sum(t.qty) u from inventory_txns t join items i on i.id = t.item_id
    where t.txn_type in ('sale','sale_kit','prod_issue') and t.ts > (select max(ts) from sales) - interval '180 days' group by 1,2)
  select name, round(avg(u),2) avg_daily, round(stddev(u),2) sd_daily, count(*) days from d group by 1 order by 2 desc limit 12`))

console.log(await q(`select status, count(*) from purchase_orders group by 1 order by 1`))
console.log(await q(`select status, count(*) from sales_orders group by 1 order by 1`))
console.log(await q(`select status, count(*) from production_orders group by 1 order by 1`))
console.log(await q(`select count(*) bills_open, sum(amount) owed, min(due_date) earliest_due from supplier_bills where paid_at is null`))

// The read models the screens use.
const ov = await one(`select count(*) n, sum(inventory_value) v, sum(on_order) oo, sum(committed) c from v_item_overview`)
check(Number(ov.n) === 35 && Math.abs(Number(ov.v) - Number(inv.perpetual)) < 1, `v_item_overview: ${ov.n} items, value ${ov.v}, on order ${ov.oo}, committed ${ov.c}`)
const av = await one(`select count(*) n, sum(available) a, min(eta) eta from item_availability()`)
check(Number(av.n) === 21 * 3, `item_availability: ${av.n} rows, ${av.a} units sellable`)
const ds = await one(`select count(*) n, sum(net_sales) s from v_daily_sales`)
check(Number(ds.n) > 400, `v_daily_sales: ${ds.n} store-days, $${ds.s}`)
const ct = await one(`select count(*) n from v_customer_totals`)
check(Number(ct.n) >= 10, `v_customer_totals: ${ct.n} customers with purchases`)

const sol = await one(`select count(*) filter (where status = 'placed') open_lines, sum(backordered) bo, min(est_available_date) eta from v_sales_order_lines`)
check(Number(sol.open_lines) > 0, `v_sales_order_lines: ${sol.open_lines} open lines, ${sol.bo} units backordered, earliest ETA ${sol.eta}`)
const t0v = Date.now(); const so2 = await one(`select count(*) n, sum(backordered_lines) b from v_sales_orders`)
check(Number(so2.n) > 100, `v_sales_orders: ${so2.n} orders, ${so2.b} backordered lines (${Date.now() - t0v} ms)`)
console.log(await q(`select * from v_backorders`))

// Role enforcement inside the business functions (as the API would call them).
await db.exec(`insert into auth.users values ('00000000-0000-0000-0000-00000000000c', 'c@x'), ('00000000-0000-0000-0000-00000000000e', 'e@x');
  insert into profiles (id, full_name, role) values ('00000000-0000-0000-0000-00000000000c', 'Cashier', 'cashier');
  insert into profiles (id, full_name, role, customer_id) values ('00000000-0000-0000-0000-00000000000e', 'Emma', 'customer', 7)`)
const as = async (sub: string, sql: string) => {
  await db.exec(`select set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', '${sub}', false)`)
  try { await db.exec(sql); return 'allowed' } catch (e) { return (e as Error).message } finally {
    await db.exec(`select set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)`)
  }
}
const CASHIER = '00000000-0000-0000-0000-00000000000c', EMMA = '00000000-0000-0000-0000-00000000000e'
check((await as(CASHIER, `select post_sale(1, '[{"item_id":6,"qty":1}]')`)) === 'allowed', 'cashier can ring a sale')
check((await as(CASHIER, `select create_purchase_order(3, 3, '[{"item_id":6,"qty":24}]')`)).includes('not allowed'), 'cashier cannot create purchase orders')
check((await as(EMMA, `select post_sale(1, '[{"item_id":6,"qty":1}]')`)).includes('not allowed'), 'customer cannot ring sales')
check((await as(EMMA, `select create_sales_order(1, 1, current_date + 1, '[{"item_id":6,"qty":2}]')`)) === 'allowed', 'customer can place a pickup order')
const emmaOrder = await one(`select customer_id, source from sales_orders order by id desc limit 1`)
check(Number(emmaOrder.customer_id) === 7 && emmaOrder.source === 'portal', 'portal order is forced onto the customer\'s own account')
check((await as(EMMA, `select adjust_stock(6, 1, 'COUNT', p_new_qty => 0)`)).includes('not allowed'), 'customer cannot adjust stock')
check((await as(EMMA, `select reset_demo('x')`)).includes('not allowed'), 'customer cannot reset the demo')

// Reset round-trip: snapshot, change things, reset, and confirm we're back.
const fingerprint = async () => one(`select (select count(*) from sales) sales, (select sum(qty) from stock) stock,
  (select sum(debit) from journal_lines) debits, (select sum(avg_cost) from items) costs, (select value from settings where key = 'ordering_cost') s`)
await db.exec(`select snapshot_seed('${sim.end}')`)
const before = await fingerprint()
await db.exec(`select post_sale(1, '[{"item_id":1,"qty":1}]'); update settings set value = 99 where key = 'ordering_cost'`)
const changed = await fingerprint()
const r = await one(`select reset_demo()`)
const after = await fingerprint()
check(JSON.stringify(before) !== JSON.stringify(changed) && JSON.stringify(before) === JSON.stringify(after),
  `reset_demo restores the snapshot (${JSON.stringify(r.reset_demo)})`)
await db.exec(`select post_sale(1, '[{"item_id":1,"qty":1}]')`)
const nextId = await one(`select max(id) id from sales`)
check(Number(nextId.id) === Number(before.sales) + 1, `ids continue after reset (next sale #${nextId.id})`)
if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1) }
console.log('\nall checks passed')
