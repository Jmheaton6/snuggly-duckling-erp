// Day-by-day simulation of The Snuggly Duckling that emits SQL calls to the real
// business functions (post_sale, receive_purchase_order, ...). Because history is
// posted through the same code the app uses, on-hand, costs and the books are
// internally consistent, and reorder points / EOQ / scorecards computed later
// have realistic, non-flat demand and supplier behavior to discover.
//
// The simulation keeps its own copy of stock (in thousandths, so pounds of
// almonds stay exact) to make decisions; the database re-checks every move.

import {
  BOMS, CUSTOMERS, HOLD, ITEMS, LOCATIONS, MAIN, RIVR, STORES, SUPPLIERS, WHSE, upc,
  type Item, type Season,
} from './catalog.ts'

const M = 1000

// ───────────────────────────── random numbers ─────────────────────────────

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
let rand = mulberry32(1)
const randInt = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1))
const pickOne = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]
function normal() {
  const u = 1 - rand(), v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
function poisson(lambda: number) {
  if (lambda <= 0) return 0
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal()))
  const L = Math.exp(-lambda)
  let k = 0, p = 1
  do { k++; p *= rand() } while (p > L)
  return k - 1
}
const binomial = (n: number, p: number) => { let k = 0; for (let i = 0; i < n; i++) if (rand() < p) k++; return k }
function weighted<T>(pairs: [T, number][]): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0)
  let r = rand() * total
  for (const [v, w] of pairs) { if ((r -= w) <= 0) return v }
  return pairs[pairs.length - 1][0]
}

// ─────────────────────────────── calendar ───────────────────────────────

const DAY_MS = 86_400_000
const dayOf = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY_MS)
const iso = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10)
const dow = (d: number) => new Date(d * DAY_MS).getUTCDay()     // 0 = Sunday
const isOpen = (d: number) => dow(d) !== 0                      // closed Sundays
const nextOpen = (d: number) => (isOpen(d) ? d : d + 1)
const ts = (d: number, minutes: number) => {
  const h = Math.floor(minutes / 60), m = Math.floor(minutes % 60)
  return `'${iso(d)} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} America/Denver'`
}

// Monthly shape (Jan..Dec), interpolated between mid-month anchors.
const SEASON: Record<Season, number[]> = {
  drink:   [0.8, 0.8, 0.85, 0.95, 1.1, 1.3, 1.4, 1.3, 1.05, 0.9, 0.85, 0.85],
  candy:   [0.9, 1.0, 0.95, 1.05, 0.9, 0.9, 0.9, 0.95, 1.0, 1.2, 0.95, 1.15],
  salty:   [0.95, 1.0, 0.95, 0.95, 1.0, 1.05, 1.05, 1.05, 1.2, 1.25, 1.2, 1.1],
  popcorn: [1.1, 1.05, 1.0, 0.95, 0.9, 0.9, 0.95, 0.95, 1.05, 1.2, 1.35, 1.45],
  gift:    [0.8, 1.1, 0.8, 0.95, 1.05, 0.8, 0.7, 0.8, 0.9, 1.1, 1.5, 1.9],
  trail:   [0.85, 0.85, 0.9, 1.0, 1.15, 1.3, 1.3, 1.2, 1.05, 0.95, 0.9, 0.85],
  flat:    Array(12).fill(1),
}
function seasonal(s: Season, d: number) {
  const date = new Date(d * DAY_MS)
  const y = date.getUTCFullYear(), m = date.getUTCMonth()
  const mid = (mm: number) => Date.UTC(y, mm, 15) / DAY_MS
  const here = mid(m)
  const [a, b] = d >= here ? [m, m + 1] : [m - 1, m]
  const da = mid(a), db = mid(b)
  const va = SEASON[s][(a + 12) % 12], vb = SEASON[s][(b + 12) % 12]
  return va + ((vb - va) * (d - da)) / (db - da)
}

// Home football Saturdays drive Game Day Boxes and chips; holidays drive candy and drinks.
const GAME_DAYS = new Set(['2026-09-05', '2026-09-19', '2026-10-03', '2026-10-17', '2026-10-31', '2026-11-14', '2026-11-28'])
function eventLift(item: Item, d: number) {
  const date = iso(d)
  let f = 1
  if (item.season === 'candy') {
    const toHalloween = dayOf(date.slice(0, 4) + '-10-31') - d
    if (toHalloween >= 0 && toHalloween <= 14) f *= 1 + 1.3 * Math.exp(-((toHalloween - 2) ** 2) / 18)
    if (['2026-04-02', '2026-04-03', '2026-04-04'].includes(date)) f *= 1.6   // Easter weekend
  }
  if (item.season === 'drink' && ['2026-07-02', '2026-07-03', '2026-07-23'].includes(date)) f *= 1.6
  if (item.season === 'salty') {
    if (GAME_DAYS.has(date)) f *= 1.5
    if (GAME_DAYS.has(iso(d + 1))) f *= 1.2
  }
  if (item.sku === 'SD-4001' && dow(d) === 5) f *= 1.4   // Movie Night Box on Fridays
  return f
}

const DOW = [0, 0.85, 0.9, 0.95, 1.0, 1.25, 1.45]
const AVG_DOW = DOW.slice(1).reduce((a, b) => a + b) / 6
const HOURS: [number, number][] = [[10, 0.6], [11, 0.9], [12, 1.4], [13, 1.2], [14, 0.8], [15, 0.9], [16, 1.2], [17, 1.3], [18, 1.1], [19, 0.6]]

// ─────────────────────────────── catalog index ───────────────────────────────

const id = (sku: string) => ITEMS.findIndex((i) => i.sku === sku) + 1
const item = (itemId: number) => ITEMS[itemId - 1]
const BOM = new Map<number, { comp: number; per: number }[]>()   // per = thousandths per parent unit
for (const [p, comps] of Object.entries(BOMS)) BOM.set(id(p), comps.map(([c, q]) => ({ comp: id(c), per: Math.round(q * M) })))
const KITS = ITEMS.map((_, i) => i + 1).filter((i) => item(i).kind === 'kit')
const MADE = ITEMS.map((_, i) => i + 1).filter((i) => item(i).kind === 'made')
const SELLABLE = ITEMS.map((_, i) => i + 1).filter((i) => item(i).kind !== 'component')
const PURCHASED = ITEMS.map((_, i) => i + 1).filter((i) => item(i).sup !== null)
const storeFactor = (it: Item, store: number) => (store === MAIN ? 1 : it.rivr ?? 0.7)

// ─────────────────────────────── simulation ───────────────────────────────

export type SimOptions = { end: string; weeks?: number; seed?: number }
export type SimResult = {
  sql: string[]; start: string; end: string; stats: Record<string, number>
  finalStock: { key: string; qty: number }[]
}

export function simulate(opts: SimOptions): SimResult {
  rand = mulberry32(opts.seed ?? 20261109)
  const END = dayOf(opts.end)
  let START = END - 7 * (opts.weeks ?? 38)
  while (dow(START) !== 1) START++                               // start on a Monday
  const SPAN = END - START

  const sql: string[] = []
  const stats: Record<string, number> = {}
  const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n)
  const emit = (s: string) => sql.push(s)
  const def = (key: string, expr: string) => emit(`insert into m values ('${key}', (${expr}))`)
  const ref = (key: string) => `(select id from m where k = '${key}')`
  const lineRef = (table: 'sale_lines' | 'po_lines', parent: string, idx: number) =>
    `(select id from ${table} where ${table === 'sale_lines' ? 'sale_id' : 'po_id'} = ${ref(parent)} order by id offset ${idx} limit 1)`

  // ── stock mirror ──
  const stock = new Map<string, number>()
  const get = (it: number, loc: number) => stock.get(`${it}:${loc}`) ?? 0
  const add = (it: number, loc: number, milli: number) => {
    const v = get(it, loc) + milli
    if (v < 0) throw new Error(`sim stock negative: ${item(it).name} @${loc} on ${iso(curDay)}`)
    stock.set(`${it}:${loc}`, v)
  }
  const units = (it: number, loc: number) => Math.floor(get(it, loc) / M)
  const companyStock = (it: number) => get(it, MAIN) + get(it, RIVR) + get(it, WHSE)
  const buildable = (kit: number, loc: number) =>
    Math.min(...BOM.get(kit)!.map(({ comp, per }) => Math.floor(get(comp, loc) / per)))

  // Sell up to `want` units; kits use finished boxes first, then components (backflush).
  function take(it: number, loc: number, want: number, commit: boolean): number {
    if (item(it).kind === 'kit') {
      const fromStock = Math.min(want, units(it, loc))
      const rest = Math.min(want - fromStock, buildable(it, loc))
      if (commit) {
        if (fromStock) add(it, loc, -fromStock * M)
        if (rest) for (const { comp, per } of BOM.get(it)!) add(comp, loc, -rest * per)
      }
      return fromStock + rest
    }
    const n = Math.min(want, units(it, loc))
    if (commit && n) add(it, loc, -n * M)
    return n
  }

  // ── planning rates (expected units per open day, no noise) ──
  const trend = (d: number) => 1 + 0.12 * ((d - START) / SPAN)
  const planRate = (it: number, store: number, d: number) => {
    const x = item(it)
    return x.base * storeFactor(x, store) * seasonal(x.season, d) * trend(d) * AVG_DOW
  }
  // Units of `it` a store consumes per open day: sold directly + backflushed into kits.
  const storeUsage = (it: number, store: number, d: number) =>
    planRate(it, store, d) +
    KITS.reduce((s, k) => s + planRate(k, store, d) * ((BOM.get(k)!.find((b) => b.comp === it)?.per ?? 0) / M), 0)
  const madeUsage = (m: number, d: number) => STORES.reduce((s, st) => s + storeUsage(m, st, d), 0)
  const companyUsage = (it: number, d: number) =>
    STORES.reduce((s, st) => s + storeUsage(it, st, d), 0) +
    MADE.reduce((s, m) => s + madeUsage(m, d) * ((BOM.get(m)!.find((b) => b.comp === it)?.per ?? 0) / M), 0)

  // ── event queue for one day ──
  type Ev = { t: number; seq: number; run: () => void }
  const queue = new Map<number, Ev[]>()
  let seq = 0
  let curDay = START
  const at = (d: number, t: number, run: () => void) => {
    const list = queue.get(d) ?? []
    list.push({ t, seq: seq++, run })
    queue.set(d, list)
  }

  // ── master data ──
  emit(`create temp table if not exists m (k text primary key, id bigint)`)
  LOCATIONS.forEach((l, i) => emit(
    `insert into locations (id, code, name, kind, address) overriding system value values (${i + 1}, ${q(l.code)}, ${q(l.name)}, '${l.kind}', ${q(l.address)})`))
  SUPPLIERS.forEach((s, i) => emit(
    `insert into suppliers (id, name, contact_name, email, phone, address, lead_time_days, payment_terms, terms_days, discount_pct, discount_days, created_at) overriding system value values ` +
    `(${i + 1}, ${q(s.name)}, ${q(s.contact)}, ${q(s.email)}, ${q(s.phone)}, ${q(s.address)}, ${s.lead}, ${q(s.terms)}, ${s.termsDays}, ${s.discPct}, ${s.discDays}, ${ts(START - 30, 600)})`))
  ITEMS.forEach((x, i) => emit(
    `insert into items (id, sku, barcode, name, category, kind, uom, price, avg_cost, supplier_id, lead_time_days, minutes_per_unit, created_at) overriding system value values ` +
    `(${i + 1}, ${q(x.sku)}, '${upc(i + 101)}', ${q(x.name)}, ${q(x.category)}, '${x.kind}', '${x.uom}', ${x.price}, ${x.cost}, ${x.sup ?? 'null'}, ${x.lead ?? 'null'}, ${x.mpu}, ${ts(START - 30, 600)})`))
  for (const [p, comps] of BOM) for (const { comp, per } of comps)
    emit(`insert into bom_lines (parent_id, component_id, qty_per) values (${p}, ${comp}, ${per / M})`)
  CUSTOMERS.forEach((c, i) => emit(
    `insert into customers (id, name, email, phone, kind, city, created_at) overriding system value values (${i + 1}, ${q(c.name)}, ${q(c.email)}, ${q(c.phone)}, '${c.kind}', ${q(c.city)}, ${ts(START - 30 + i * 9, 600)})`))
  for (const t of ['locations', 'suppliers', 'items', 'customers'])
    emit(`select setval(pg_get_serial_sequence('${t}', 'id'), (select max(id) from ${t}))`)

  // ── opening balances (the night before day one) ──
  for (const it of ITEMS.map((_, i) => i + 1)) {
    const x = item(it)
    if (x.kind === 'kit') continue
    const plan: [number, number][] = []
    for (const st of STORES) {
      const u = storeUsage(it, st, START)
      if (u > 0 && x.uom === 'ea') plan.push([st, Math.ceil(u * 6)])
    }
    if (x.kind === 'made') plan.push([WHSE, Math.ceil(madeUsage(it, START) * 4)])
    else if (x.sup) {
      const lead = SUPPLIERS[x.sup - 1].lead
      const qty = companyUsage(it, START) * (lead * 0.86 + 10)
      plan.push([WHSE, x.uom === 'lb' ? Math.ceil(qty) : Math.ceil(qty)])
    }
    for (const [loc, n] of plan) {
      if (n <= 0) continue
      emit(`select adjust_stock(${it}, ${loc}, 'OPENING', p_delta => ${n}, p_unit_cost => ${x.cost}, p_ts => ${ts(START - 1, 1080)}, p_note => 'Opening balance')`)
      add(it, loc, n * M)
    }
  }

  // ── purchasing state ──
  type Po = {
    key: string; sup: number; lines: { it: number; qty: number; cost: number; got: number }[]
    deliveries: { day: number; qty: number[] }[]; delivered: number; receipts: string[]; closed: boolean
  }
  const openPos: Po[] = []
  type Bill = { rkey: string; po: Po; due: number; payBy: number; paid: boolean }
  const bills: Bill[] = []
  let nPo = 0, nRcpt = 0
  // Units still expected on open POs (short-shipped remainders that will never come don't count).
  const onOrder = (it: number) =>
    openPos.reduce((s, p) => {
      const idx = p.lines.findIndex((l) => l.it === it)
      if (idx < 0) return s
      return s + p.deliveries.slice(p.delivered).reduce((t, dl) => t + dl.qty[idx], 0) * M
    }, 0)

  function placePo(sup: number, lines: { it: number; qty: number }[], d: number, t: number) {
    const s = SUPPLIERS[sup - 1]
    const key = `p${++nPo}`
    const progress = (d - START) / SPAN
    const po: Po = {
      key, sup, delivered: 0, receipts: [], closed: false, deliveries: [],
      lines: lines.map(({ it, qty }) => {
        const base = item(it).cost * (1 + 0.035 * progress) * (1 + 0.012 * normal())
        return { it, qty, got: 0, cost: base >= 1 ? Math.round(base * 100) / 100 : Math.round(base * 1000) / 1000 }
      }),
    }
    // Supplier behavior decides when and how much actually arrives.
    const r = rand()
    const delay = r < s.early ? -1 : r < s.early + s.onTime ? 0 : weighted([[1, 5], [2, 3], [3, 2], [Math.max(4, s.lateMax), 1]].filter(([v]) => v <= s.lateMax) as [number, number][])
    // Closed Sundays: an on-time truck comes Saturday instead; a late one slips to Monday.
    let arrive = Math.max(d + 1, d + s.lead + delay)
    if (!isOpen(arrive)) arrive = delay <= 0 && arrive - 1 > d ? arrive - 1 : arrive + 1
    if (rand() < s.shortP) {
      const first = po.lines.map((l) => Math.max(0, Math.floor(l.qty * (0.6 + rand() * 0.3))))
      po.deliveries.push({ day: arrive, qty: first })
      bump(`short_shipped_${sup}`)
      if (rand() < s.splitP) po.deliveries.push({ day: nextOpen(arrive + randInt(3, 6)), qty: po.lines.map((l, i) => l.qty - first[i]) })
    } else {
      po.deliveries.push({ day: arrive, qty: po.lines.map((l) => l.qty) })
    }
    def(key, `select create_purchase_order(${sup}, ${WHSE}, '${JSON.stringify(po.lines.map((l) => ({ item_id: l.it, qty: l.qty, unit_cost: l.cost })))}'::jsonb, true, ${ts(d, t)})`)
    openPos.push(po)
    po.deliveries.forEach((dl, i) => at(dl.day, 540 + i, () => receive(po, i)))
    bump('purchase_orders')
  }

  function receive(po: Po, i: number) {
    const dl = po.deliveries[i]
    const parts = po.lines.map((l, idx) => ({ idx, qty: dl.qty[idx] })).filter((p) => p.qty > 0)
    po.delivered = i + 1
    if (!parts.length) return
    const rkey = `r${++nRcpt}`
    const json = parts.map((p) => `jsonb_build_object('po_line_id', ${lineRef('po_lines', po.key, p.idx)}, 'qty', ${p.qty})`).join(', ')
    def(rkey, `select receive_purchase_order(${ref(po.key)}, jsonb_build_array(${json}), null, ${ts(curDay, 540 + i)})`)
    let amount = 0
    for (const p of parts) {
      const l = po.lines[p.idx]
      l.got += p.qty
      add(l.it, WHSE, p.qty * M)
      amount += p.qty * l.cost
    }
    po.receipts.push(rkey)
    const s = SUPPLIERS[po.sup - 1]
    bills.push({ rkey, po, due: curDay + s.termsDays, payBy: curDay + (s.discDays || s.termsDays), paid: false })
    bump('po_receipts')
    void amount
  }

  // ── sales orders ──
  type So = { key: string; cust: number; loc: number; placed: number; req: number; lines: { it: number; qty: number }[]; status: 'placed' | 'fulfilled' | 'closed' | 'cancelled'; tries: number; source: 'staff' | 'portal' }
  const sos: So[] = []
  let nSo = 0
  const L = (sku: string, qty: number) => ({ it: id(sku), qty })
  function planSo(cust: number, loc: number, placed: number, req: number, lines: { it: number; qty: number }[], source: 'staff' | 'portal' = 'staff') {
    req = nextOpen(req); placed = nextOpen(placed)
    if (placed >= req) placed = dow(req - 1) === 0 ? req - 2 : req - 1   // always placed at least a day ahead
    if (placed > END || placed < START) return
    sos.push({ key: '', cust, loc, placed, req, lines, status: 'placed', tries: 0, source })
  }
  for (let d = START + 7; d <= END + 28; d++) {
    const date = iso(d), w = dow(d)
    if (w === 2) planSo(1, MAIN, d - 5, d, [L('SD-3001', randInt(12, 20)), L('SD-1005', 24), L('SD-1104', 24), L('SD-1001', 12)])
    if (w === 4 && Math.floor((d - START) / 7) % 2 === 0) planSo(2, MAIN, d - 4, d, [L('SD-3001', randInt(8, 12)), L('SD-4003', randInt(2, 4))])
    if (GAME_DAYS.has(iso(d + 1))) planSo(3, WHSE, d - 8, d, [L('SD-4002', randInt(10, 20)), L('SD-1101', 48)])
    const month = Number(date.slice(5, 7))
    if (w === 6 && ((month >= 4 && month <= 6) || (month >= 9 && month <= 10))) planSo(4, RIVR, d - 3, d, [L('SD-1104', 48), L('SD-1005', 48), L('SD-1203', 24)])
    if (w === 1 && Number(date.slice(8)) <= 7) planSo(5, WHSE, d - 7, d, [L('SD-3002', randInt(40, 60)), L('SD-3003', randInt(30, 50)), L('SD-1101', 48)])
    if (w === 3 && (d - START) % 42 === 9) planSo(6, WHSE, d - 10, d, [L('SD-4003', randInt(10, 20)), L('SD-4001', randInt(8, 12))])
    if (w !== 0 && rand() < 0.3) {
      const cust = randInt(7, 12)
      const n = randInt(1, 3)
      const lines = [...new Set(Array.from({ length: n }, () => pickOne(SELLABLE)))].map((it) => ({ it, qty: randInt(1, 3) }))
      planSo(cust, pickOne(STORES), d - randInt(1, 3), d, lines, 'portal')
    }
  }
  // The open pipeline a planner would see today (requested dates in the next four weeks).
  planSo(7, MAIN, END - 1, END + 2, [L('SD-4001', 2), L('SD-1201', 3)], 'portal')
  planSo(8, RIVR, END - 2, END + 4, [L('SD-3001', 4)], 'portal')
  planSo(2, MAIN, END - 3, END + 6, [L('SD-3001', 30), L('SD-4003', 6)])
  planSo(3, WHSE, END - 4, END + 10, [L('SD-4002', 40), L('SD-1101', 96)])
  planSo(5, WHSE, END - 2, END + 12, [L('SD-3002', 80), L('SD-3003', 80)])
  planSo(1, WHSE, END - 5, END + 17, [L('SD-4001', 60), L('SD-1104', 48)])
  planSo(6, WHSE, END - 1, END + 24, [L('SD-4003', 50)])
  sos.sort((a, b) => a.placed - b.placed)
  for (const so of sos) {
    at(so.placed, randInt(600, 1080), () => {
      so.key = `o${++nSo}`
      def(so.key, `select create_sales_order(${so.cust}, ${so.loc}, '${iso(so.req)}', '${JSON.stringify(so.lines.map((l) => ({ item_id: l.it, qty: l.qty })))}'::jsonb, null, ${ts(curDay, 600)}, '${so.source}')`)
      bump('sales_orders')
      if (rand() < 0.04 && so.req <= END) {
        at(Math.min(so.req - 1, END), 1020, () => {
          if (so.status !== 'placed') return
          so.status = 'cancelled'
          emit(`select cancel_sales_order(${ref(so.key)}, ${ts(curDay, 1020)})`)
          bump('so_cancelled')
        })
      }
    })
    if (so.req <= END) scheduleFulfill(so, so.req)
  }
  function scheduleFulfill(so: So, d: number) {
    if (d > END) return
    // Move stock to the pickup store in the morning if it is short.
    if (so.loc !== WHSE) at(d, 480, () => {
      if (so.status !== 'placed') return
      for (const l of so.lines) {
        if (item(l.it).kind === 'kit') continue
        const short = l.qty - units(l.it, so.loc)
        const n = Math.min(short, units(l.it, WHSE))
        if (n > 0) transfer(l.it, WHSE, so.loc, n, 480, 'For customer order')
      }
    })
    // Kits for big orders are pre-packed at the warehouse the day before.
    const packDay = Math.max(START, dow(d - 1) === 0 ? d - 2 : d - 1)
    if (so.loc === WHSE) for (const l of so.lines) if (item(l.it).kind === 'kit') at(packDay, 780, () => {
      if (so.status !== 'placed') return
      const need = l.qty - units(l.it, WHSE)
      if (need > 0) produce(l.it, Math.min(need, buildable(l.it, WHSE)), curDay, 780, so.key)
    })
    at(d, 570, () => {
      if (so.status !== 'placed') return
      const ok = so.lines.every((l) => take(l.it, so.loc, l.qty, false) >= l.qty)
      // Two lines can share a component (a kit and its parts), so check them together.
      if (ok && canFulfillAll(so)) {
        for (const l of so.lines) take(l.it, so.loc, l.qty, true)
        def(`f${so.key}`, `select fulfill_sales_order(${ref(so.key)}, ${ts(curDay, 570)})`)
        so.status = 'fulfilled'
        recent.push({ key: `f${so.key}`, store: so.loc, day: curDay, lines: so.lines.map((l) => ({ ...l, returned: 0 })), fromSo: true })
        bump('so_fulfilled')
        const closeDay = rand() < 0.85 ? curDay : nextOpen(curDay + 1)
        if (closeDay <= END) at(closeDay, 1020, () => {
          so.status = 'closed'
          emit(`select close_sales_order(${ref(so.key)}, ${ts(curDay, 1020)})`)
        })
      } else if (++so.tries < 3) {
        scheduleFulfill(so, nextOpen(d + 1))
      } else {
        so.status = 'cancelled'
        emit(`select cancel_sales_order(${ref(so.key)}, ${ts(curDay, 1000)})`)
        bump('so_cancelled')
      }
    })
  }
  function canFulfillAll(so: So) {
    const snapshot = new Map(stock)
    try {
      for (const l of so.lines) if (take(l.it, so.loc, l.qty, true) < l.qty) return false
      return true
    } catch { return false } finally { stock.clear(); for (const [k, v] of snapshot) stock.set(k, v) }
  }

  // ── transfers, production, adjustments ──
  let nXfer = 0
  function transfer(it: number, from: number, to: number, n: number, t: number, note: string) {
    if (n <= 0) return
    add(it, from, -n * M); add(it, to, n * M)
    emit(`select transfer_stock(${it}, ${from}, ${to}, ${n}, ${ts(curDay, t)}, ${q(note)})`)
    nXfer++
    bump('transfers')
  }

  let nWo = 0
  function produce(it: number, qty: number, d: number, t: number, soKey?: string) {
    if (qty <= 0) return t
    const x = item(it)
    const key = `w${++nWo}`
    def(key, `select create_production_order(${it}, ${qty}, ${WHSE}, '${iso(nextOpen(d + (x.lead ?? 1)))}', ${soKey ? ref(soKey) : 'null'}, ${ts(d, t - 30)})`)
    for (const { comp, per } of BOM.get(it)!) add(comp, WHSE, -qty * per)
    emit(`select start_production_order(${ref(key)}, null, ${ts(d, t)})`)
    const isPopcorn = x.sku === 'SD-3002' || x.sku === 'SD-3003'
    const burnt = isPopcorn && rand() < 0.08
    const pScrap = x.kind === 'kit' ? 0.01 : burnt ? 0.12 : isPopcorn ? 0.025 : 0.012
    const scrapped = binomial(qty, pScrap)
    const good = qty - scrapped
    const reworked = x.kind === 'kit' ? 0 : binomial(good, 0.02)
    const reason = !scrapped && !reworked ? null
      : burnt ? 'BURNT'
      : x.kind === 'kit' ? 'SPILL'
      : weighted<string>(isPopcorn ? [['SEAL_FAIL', 4], ['UNDERWEIGHT', 2], ['SPILL', 1]] : [['UNDERWEIGHT', 3], ['SPILL', 2], ['MISLABEL', 1], ['SEAL_FAIL', 2]])
    const dur = qty * x.mpu * (0.9 + rand() * 0.35)
    const delayDays = rand() < 0.07 ? 1 : rand() < 0.04 ? 2 : 0
    const finishDay = delayDays ? Math.min(END, nextOpen(d + delayDays)) : d
    const finishT = delayDays && finishDay !== d ? 450 + dur : Math.min(t + dur, 1380)
    at(finishDay, finishT, () => {
      add(it, WHSE, good * M)
      emit(`select complete_production_order(${ref(key)}, ${good}, ${scrapped}, ${reworked}, ${reason ? `'${reason}'` : 'null'}, ${ts(curDay, finishT)})`)
      bump('production_completed')
    })
    bump('production_orders')
    return t + dur + 10
  }

  type Sold = { key: string; store: number; day: number; lines: { it: number; qty: number; returned: number }[]; fromSo?: boolean }
  const recent: Sold[] = []
  const hold: { it: number; qty: number; day: number }[] = []
  let nSale = 0, nRet = 0

  const RETURN_REASONS: [string, number][] = [['CHANGED_MIND', 35], ['WRONG_ITEM', 15], ['STALE', 20], ['CRUSHED', 15], ['SEAL', 12], ['FOREIGN', 3]]
  const QUALITY = new Set(['STALE', 'CRUSHED', 'SEAL', 'FOREIGN'])

  // ── the day loop ──
  for (curDay = START; curDay <= END; curDay++) {
    const d = curDay
    const open = isOpen(d)
    const date = iso(d)

    if (open) {
      // Production runs Mon/Wed/Fri on one line in the kitchen.
      if ([1, 3, 5].includes(dow(d))) at(d, 360, () => {
        let t = 360
        for (const m of MADE) {
          const u = madeUsage(m, d)
          const soNeed = sos.filter((s) => s.status === 'placed' && s.req >= d && s.req <= d + 7)
            .reduce((n, s) => n + s.lines.filter((l) => l.it === m).reduce((a, l) => a + l.qty, 0), 0)
          const have = companyStock(m) / M
          if (have >= u * 3.5 + soNeed) continue
          let batch = Math.max(24, Math.ceil((u * 7 + soNeed - have) / 12) * 12)
          batch = Math.min(batch, Math.floor(buildable(m, WHSE) / 12) * 12)
          if (batch >= 12) t = produce(m, batch, d, t)
        }
      })

      // Store replenishment from the warehouse, Monday and Thursday afternoons.
      if (dow(d) === 1 || dow(d) === 4) at(d, 960, () => {
        for (const st of STORES) for (const it of ITEMS.map((_, i) => i + 1)) {
          const x = item(it)
          if (x.kind === 'kit' || x.uom !== 'ea') continue
          const u = storeUsage(it, st, d)
          if (u <= 0) continue
          const need = Math.ceil(u * 5.5) - units(it, st)
          transfer(it, WHSE, st, Math.min(need, units(it, WHSE)), 960, 'Store replenishment')
        }
      })
      // Store-to-store rescue when one store is about to run out.
      if (dow(d) === 2 || dow(d) === 5) at(d, 720, () => {
        for (const it of SELLABLE) {
          if (item(it).kind === 'kit') continue
          for (const [to, from] of [[MAIN, RIVR], [RIVR, MAIN]]) {
            const u = storeUsage(it, to, d)
            if (units(it, to) < u * 0.8 && units(it, from) > storeUsage(it, from, d) * 6) {
              transfer(it, from, to, Math.ceil(u * 2), 720, 'Store-to-store rebalance')
            }
          }
        }
      })

      // Walk-in sales.
      for (const st of STORES) {
        const noise = Math.exp(0.08 * normal())
        const chunks: { it: number; qty: number }[] = []
        let total = 0
        for (const it of SELLABLE) {
          const x = item(it)
          const lambda = x.base * storeFactor(x, st) * seasonal(x.season, d) * eventLift(x, d) * trend(d) * DOW[dow(d)] * noise
          let k = poisson(lambda)
          total += k
          while (k > 0) {
            const r = rand()
            const c = k >= 3 && r < 0.06 ? 3 : k >= 2 && r < 0.22 ? 2 : 1
            chunks.push({ it, qty: c }); k -= c
          }
        }
        const nTickets = Math.max(1, Math.round((total / 2.3) * (0.9 + rand() * 0.2)))
        const tickets: Map<number, number>[] = Array.from({ length: nTickets }, () => new Map())
        for (const c of chunks) {
          const tk = tickets[Math.floor(rand() * nTickets)]
          tk.set(c.it, (tk.get(c.it) ?? 0) + c.qty)
        }
        for (const tk of tickets) {
          if (!tk.size) continue
          const hour = weighted(HOURS)
          at(d, hour * 60 + rand() * 60, () => {
            const lines: { it: number; qty: number }[] = []
            for (const [it, want] of tk) {
              const got = take(it, st, want, true)
              if (got > 0) lines.push({ it, qty: got })
              if (got < want) bump('lost_units', want - got)
            }
            if (!lines.length) return
            const subtotal = lines.reduce((s, l) => s + l.qty * item(l.it).price, 0)
            const disc = subtotal >= 10 && rand() < 0.06 ? Math.round(subtotal * 10) / 100 : 0
            const cust = rand() < 0.09 ? randInt(7, 12) : null
            const tender = rand() < 0.22 ? 'cash' : 'card'
            const key = `s${++nSale}`
            def(key, `select post_sale(${st}, '${JSON.stringify(lines.map((l) => ({ item_id: l.it, qty: l.qty })))}'::jsonb, ${disc}, ${cust ?? 'null'}, '${tender}', ${ts(d, Math.floor(this_t()))})`)
            recent.push({ key, store: st, day: d, lines: lines.map((l) => ({ ...l, returned: 0 })) })
            bump('sales')
          })
        }

        // Returns and exchanges from the last ten days.
        const nReturns = poisson(nTickets * 0.007)
        for (let i = 0; i < nReturns; i++) at(d, 660 + rand() * 480, () => {
          const pool = recent.filter((s) => s.store === st && s.day < d && s.day >= d - 10 && s.lines.some((l) => l.returned < l.qty))
          if (!pool.length) return
          const sale = pickOne(pool)
          const idx = sale.lines.findIndex((l) => l.returned < l.qty)
          const line = sale.lines[idx]
          const qty = line.qty - line.returned >= 2 && rand() < 0.3 ? line.qty - line.returned : 1
          const reason = weighted(RETURN_REASONS)
          const quality = QUALITY.has(reason)
          const to = quality ? HOLD : st
          const retJson = `jsonb_build_array(jsonb_build_object('sale_line_id', ${lineRef('sale_lines', sale.key, idx)}, 'qty', ${qty}, 'reason_code', '${reason}'))`
          line.returned += qty
          add(line.it, to, qty * M)
          if (quality) hold.push({ it: line.it, qty, day: d })
          // Some customers swap for a fresh one (quality) or something else (changed mind).
          let swap: number | null = null
          if (rand() < 0.3) {
            const candidate = quality ? line.it : pickOne(SELLABLE.filter((x) => item(x).kind === 'resale'))
            if (take(candidate, st, qty, false) >= qty) swap = candidate
          }
          const t = Math.floor(this_t())
          if (swap) {
            take(swap, st, qty, true)
            emit(`select process_exchange(${ref(sale.key)}, ${retJson}, '${JSON.stringify([{ item_id: swap, qty }])}'::jsonb, ${st}, ${ts(d, t)})`)
            nSale++
            bump('exchanges')
          } else {
            emit(`select process_return(${ref(sale.key)}, ${retJson}, ${st}, ${ts(d, t)})`)
            bump('returns')
          }
          nRet++
        })

        // Shrink: cycle counts on Wednesdays, plus the odd damaged or expired item.
        if (dow(d) === 3) at(d, 1110, () => {
          for (let i = 0; i < 5; i++) {
            const it = pickOne(SELLABLE.filter((x) => item(x).kind !== 'kit'))
            const have = units(it, st)
            const r = rand()
            const delta = r < 0.7 ? 0 : r < 0.92 ? -randInt(1, 2) : r < 0.97 ? 1 : -3
            const counted = Math.max(0, have + delta)
            add(it, st, (counted - have) * M)
            emit(`select adjust_stock(${it}, ${st}, '${counted > have ? 'FOUND' : 'COUNT'}', p_new_qty => ${counted}, p_ts => ${ts(d, 1110 + i)}, p_note => 'Weekly cycle count')`)
            bump('cycle_counts')
          }
        })
        if (rand() < 0.15) at(d, 1140, () => {
          const it = pickOne(SELLABLE.filter((x) => item(x).kind !== 'kit' && units(x, st) > 0))
          if (!it) return
          add(it, st, -M)
          emit(`select adjust_stock(${it}, ${st}, 'DAMAGED', p_delta => -1, p_ts => ${ts(d, 1140)})`)
          bump('damaged')
        })
        if (dow(d) === 6 && rand() < 0.5) at(d, 1150, () => {
          const it = pickOne(SELLABLE.filter((x) => ['candy', 'popcorn'].includes(item(x).season) && item(x).kind !== 'kit' && units(x, st) >= 3))
          if (!it) return
          const n = randInt(1, 3)
          add(it, st, -n * M)
          emit(`select adjust_stock(${it}, ${st}, 'EXPIRED', p_delta => ${-n}, p_ts => ${ts(d, 1150)}, p_note => 'Past best-by date')`)
          bump('expired')
        })
      }

      // Purchasing review every open afternoon: reorder point check on inventory position.
      at(d, 900, () => {
        SUPPLIERS.forEach((s, si) => {
          const sup = si + 1
          const leadOpen = s.lead * 0.86
          const want: { it: number; qty: number }[] = []
          let triggered = false
          for (const it of PURCHASED.filter((x) => item(x).sup === sup)) {
            const u = companyUsage(it, d) * 1.1
            if (u <= 0) continue
            const ip = (companyStock(it) + onOrder(it)) / M
            const rop = u * (leadOpen * 1.25 + 3)
            if (ip <= rop) triggered = true
            if (ip <= rop * 1.3) {
              const pack = item(it).pack
              want.push({ it, qty: Math.max(pack, Math.ceil((u * s.coverDays * 0.86 + rop - ip) / pack) * pack) })
            }
          }
          if (triggered && want.length) placePo(sup, want, d, 900)
        })
      })

      // Accounts payable runs Monday and Thursday: pay what's due (2/10 suppliers early).
      if (dow(d) === 1 || dow(d) === 4) at(d, 630, () => {
        for (const b of bills) {
          if (b.paid || b.payBy > d + 3) continue
          const skip = SUPPLIERS[b.po.sup - 1].name.startsWith('Kraft') ? 0.3 : 0.08
          if (rand() < skip) continue
          b.paid = true
          emit(`select pay_supplier_bill((select id from supplier_bills where receipt_id = ${ref(b.rkey)}), ${ts(d, 630)})`)
          bump('bills_paid')
          const po = b.po
          if (!po.closed && po.delivered >= po.deliveries.length && bills.filter((x) => x.po === po).every((x) => x.paid)) {
            po.closed = true
            emit(`select close_purchase_order(${ref(po.key)}, ${ts(d, 1020)})`)
          }
        }
        for (let i = openPos.length - 1; i >= 0; i--) if (openPos[i].closed) openPos.splice(i, 1)
      })

      // Quality-hold items are scrapped at the end of each week.
      if (dow(d) === 6) at(d, 1170, () => {
        const byItem = new Map<number, number>()
        for (let i = hold.length - 1; i >= 0; i--) if (hold[i].day <= d - 3) {
          byItem.set(hold[i].it, (byItem.get(hold[i].it) ?? 0) + hold[i].qty)
          hold.splice(i, 1)
        }
        for (const [it, n] of byItem) {
          add(it, HOLD, -n * M)
          emit(`select adjust_stock(${it}, ${HOLD}, 'HOLD_SCRAP', p_delta => ${-n}, p_ts => ${ts(d, 1170)}, p_note => 'Quality returns scrapped')`)
          bump('hold_scrapped', n)
        }
      })
    }

    // Operating expenses.
    if (date.endsWith('-01')) at(d, 540, () => { emit(`select record_expense('6100', 2450, 'Monthly rent — two stores and kitchen', ${ts(d, 540)})`) })
    if (date.endsWith('-10')) at(d, 545, () => { emit(`select record_expense('6200', ${(380 + rand() * 140).toFixed(2)}, 'Utilities, card fees and supplies', ${ts(d, 545)})`) })
    if (dow(d) === 5 && Math.floor((d - START) / 7) % 2 === 1) at(d, 1080, () => {
      const busy = 1 + 0.4 * (seasonal('trail', d) - 1)   // more summer hours, but not one-for-one with sales
      emit(`select record_expense('6000', ${(3000 * busy * trend(d) + normal() * 120).toFixed(2)}, 'Biweekly payroll', ${ts(d, 1080)})`)
    })

    // Run the day in time order (events may schedule later events today).
    const list = queue.get(d) ?? []
    queue.delete(d)
    list.sort((a, b) => a.t - b.t || a.seq - b.seq)
    while (list.length) {
      const ev = list.shift()!
      nowT = ev.t
      ev.run()
      const more = queue.get(d)
      if (more) { queue.delete(d); list.push(...more); list.sort((a, b) => a.t - b.t || a.seq - b.seq) }
    }
    for (let i = recent.length - 1; i >= 0; i--) if (recent[i].day < d - 10) recent.splice(i, 1)
  }

  // One production order already planned for the coming week.
  def('wplan', `select create_production_order(${id('SD-3002')}, 96, ${WHSE}, '${iso(nextOpen(END + 3))}', null, ${ts(END, 1000)}, 'Restock ahead of the Orem Rec order')`)

  stats.days = SPAN + 1
  stats.transfers_total = nXfer
  stats.returns_total = nRet
  const finalStock = [...stock].filter(([, v]) => v !== 0).map(([k, v]) => ({ key: k, qty: v / M }))
  return { sql, start: iso(START), end: iso(END), stats, finalStock }
}

let nowT = 0
const this_t = () => nowT
function q(s: string) { return `'${s.replace(/'/g, "''")}'` }
