// Time-phased MRP, computed the way the Chapter 10 slides fill out an MRP record:
//
//   Projected on hand  = prior projected on hand + scheduled receipts + planned order receipts − gross requirements
//   Net requirements   = gross requirements − scheduled receipts − prior projected on hand   (never below 0)
//   Planned order receipt = net requirement, sized by the lot rule (L4L, or whole multiples of the FOQ)
//   Planned order release = the same quantity, backed off from the need date by the item's lead time
//
// Items are planned top-down by BOM level (low-level code), so a parent's planned order
// releases become its children's gross requirements (dependent demand).

export type MrpItem = {
  id: number; sku: string; name: string; kind: string; uom: string
  onHand: number
  leadDays: number                 // purchased: supplier quote unless overridden · made/kit: production lead time
  leadSource: 'supplier' | 'item' | 'production'
  lotRule: 'L4L' | 'FOQ'; lotQty: number | null
  supplierId: number | null; supplierName: string | null
}
export type MrpBom = { parent_id: number; component_id: number; qty_per: number }
// Something dated that adds to gross requirements or scheduled receipts, with where it came from.
export type Peg = { itemId: number; qty: number; date: string; label: string; detail?: string; late?: boolean }

export type Bucket = { start: string; end: string }
export type PlannedOrder = {
  itemId: number; week: number                 // week the planned receipt is needed (1-based)
  qty: number; net: number
  needDate: string; orderBy: string; releaseWeek: number; pastDue: boolean
}
export type MrpRecord = {
  item: MrpItem; level: number
  gross: number[]; scheduled: number[]; projected: number[]; net: number[]; receipts: number[]; releases: number[]
  grossPegs: Peg[][]; scheduledPegs: Peg[][]
  orders: PlannedOrder[]
  beyond: number                               // gross requirements dated after the horizon
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
export const mondayOf = (d: string) => addDays(d, -((dow(d) + 6) % 7))

export function lotSize(net: number, item: Pick<MrpItem, 'lotRule' | 'lotQty'>) {
  if (net <= 0) return 0
  if (item.lotRule === 'FOQ' && item.lotQty) return r3(Math.ceil(r3(net / item.lotQty)) * item.lotQty)
  return r3(net)
}

// Order-by date: need date minus lead time. Stores are closed Sundays, so a Sunday backs up to Saturday.
export function orderByDate(needDate: string, leadDays: number) {
  const d = addDays(needDate, -leadDays)
  return dow(d) === 0 ? addDays(d, -1) : d
}

// BOM level = longest path from a top-level parent (textbook low-level code).
export function bomLevels(itemIds: number[], boms: MrpBom[]) {
  const level = new Map(itemIds.map((id) => [id, 0]))
  for (let pass = 0; pass < 10; pass++) {
    let changed = false
    for (const b of boms) {
      const want = (level.get(b.parent_id) ?? 0) + 1
      if ((level.get(b.component_id) ?? 0) < want) { level.set(b.component_id, want); changed = true }
    }
    if (!changed) break
  }
  return level
}

export function runMrp({ items, boms, demand, receipts, today, weeks }: {
  items: MrpItem[]; boms: MrpBom[]
  demand: Peg[]        // independent demand (open sales orders) and planned work-order material
  receipts: Peg[]      // open purchase orders and work orders
  today: string; weeks: number
}) {
  const first = mondayOf(today)
  const buckets: Bucket[] = Array.from({ length: weeks }, (_, k) => ({ start: addDays(first, 7 * k), end: addDays(first, 7 * k + 6) }))
  const horizonEnd = buckets[weeks - 1].end
  // Anything already overdue lands in week 1; beyond the horizon is reported, not planned.
  const weekOf = (d: string) => (d < first ? 0 : Math.floor((Date.parse(d) - Date.parse(first)) / (7 * 864e5)))

  const level = bomLevels(items.map((i) => i.id), boms)
  const order = [...items].sort((a, b) => (level.get(a.id)! - level.get(b.id)!) || a.sku.localeCompare(b.sku))
  const pending = new Map<number, Peg[]>()          // gross requirement pegs per item (filled top-down)
  for (const p of demand) pending.set(p.itemId, [...(pending.get(p.itemId) ?? []), p])

  const records = new Map<number, MrpRecord>()
  for (const item of order) {
    const zero = () => Array(weeks).fill(0) as number[]
    const rec: MrpRecord = {
      item, level: level.get(item.id)!,
      gross: zero(), scheduled: zero(), projected: zero(), net: zero(), receipts: zero(), releases: zero(),
      grossPegs: buckets.map(() => []), scheduledPegs: buckets.map(() => []), orders: [], beyond: 0,
    }
    for (const p of pending.get(item.id) ?? []) {
      if (p.date > horizonEnd) { rec.beyond = r3(rec.beyond + p.qty); continue }
      const w = weekOf(p.date)
      rec.gross[w] = r3(rec.gross[w] + p.qty); rec.grossPegs[w].push(p)
    }
    for (const p of receipts.filter((r) => r.itemId === item.id)) {
      if (p.date > horizonEnd) continue
      const w = weekOf(p.date)
      rec.scheduled[w] = r3(rec.scheduled[w] + p.qty); rec.scheduledPegs[w].push(p)
    }

    let prior = item.onHand
    for (let w = 0; w < weeks; w++) {
      const net = r3(Math.max(0, rec.gross[w] - rec.scheduled[w] - prior))
      const por = lotSize(net, item)
      rec.net[w] = net
      rec.receipts[w] = por
      rec.projected[w] = r3(prior + rec.scheduled[w] + por - rec.gross[w])
      prior = rec.projected[w]
      if (por > 0) {
        // Needed on the earliest requirement date in the week (today at the soonest).
        const earliest = rec.grossPegs[w].map((p) => p.date).sort()[0] ?? buckets[w].start
        const needDate = earliest < today ? today : earliest
        const orderBy = orderByDate(needDate, item.leadDays)
        const pastDue = orderBy < today
        const releaseWeek = pastDue ? 0 : weekOf(orderBy)
        rec.releases[releaseWeek] = r3(rec.releases[releaseWeek] + por)
        rec.orders.push({ itemId: item.id, week: w + 1, qty: por, net, needDate, orderBy, releaseWeek: releaseWeek + 1, pastDue })
        // Dependent demand: the release pulls components on its order-by (start) date.
        for (const b of boms.filter((b) => b.parent_id === item.id)) {
          const peg: Peg = {
            itemId: b.component_id, qty: r3(por * b.qty_per), date: orderBy,
            label: `Planned order: ${por.toLocaleString('en-US')} × ${item.name}`,
            detail: `${b.qty_per} per unit · released ${orderBy}`,
          }
          pending.set(b.component_id, [...(pending.get(b.component_id) ?? []), peg])
        }
      }
    }
    records.set(item.id, rec)
  }
  return { buckets, records, level, order: order.map((i) => i.id) }
}
