// Runs the MRP engine on the two worked problems from the Chapter 10 slides and checks
// every row against the hand-calculated answers. Usage: node tests/mrp-slides.ts
import assert from 'node:assert/strict'
import { addDays, runMrp, type MrpItem, type Peg } from '../src/modules/mrp/engine.ts'

const MON = '2026-11-16'                                  // week 1 starts on this Monday
const wk = (n: number) => addDays(MON, 7 * (n - 1))       // Monday of week n
const item = (id: number, name: string, onHand: number, ltWeeks: number, lot: number | null): MrpItem => ({
  id, sku: name, name, kind: 'component', uom: 'ea', onHand, leadDays: 7 * ltWeeks, leadSource: 'item',
  lotRule: lot ? 'FOQ' : 'L4L', lotQty: lot, supplierId: null, supplierName: null,
})
const peg = (itemId: number, qty: number, week: number): Peg => ({ itemId, qty, date: wk(week), label: 'test' })
const rows = (r: ReturnType<typeof runMrp>, id: number) => {
  const x = r.records.get(id)!
  return { gross: x.gross, scheduled: x.scheduled, projected: x.projected, net: x.net, receipts: x.receipts, releases: x.releases }
}

// MRP Calculations #1 — Item A: GR 600 in week 6, 200 on hand, SR 100 in week 4, LT 2, L4L.
{
  const r = runMrp({ items: [item(1, 'A', 200, 2, null)], boms: [], demand: [peg(1, 600, 6)], receipts: [peg(1, 100, 4)], today: MON, weeks: 8 })
  assert.deepEqual(rows(r, 1), {
    gross:     [0, 0, 0, 0, 0, 600, 0, 0],
    scheduled: [0, 0, 0, 100, 0, 0, 0, 0],
    projected: [200, 200, 200, 300, 300, 0, 0, 0],
    net:       [0, 0, 0, 0, 0, 300, 0, 0],
    receipts:  [0, 0, 0, 0, 0, 300, 0, 0],
    releases:  [0, 0, 0, 300, 0, 0, 0, 0],
  })
  console.log('ok   slide 18: item A (L4L, LT 2)')
}

// MRP Calculations #2 — 300 tables in week 7; table = 4 legs + 1 top.
{
  const items = [item(1, 'Table', 40, 1, null), item(2, 'Legs', 120, 2, 250), item(3, 'Top', 0, 3, null)]
  const boms = [{ parent_id: 1, component_id: 2, qty_per: 4 }, { parent_id: 1, component_id: 3, qty_per: 1 }]
  const r = runMrp({ items, boms, demand: [peg(1, 300, 7)], receipts: [peg(2, 200, 2), peg(3, 60, 3)], today: MON, weeks: 7 })
  assert.deepEqual(rows(r, 1), {
    gross:     [0, 0, 0, 0, 0, 0, 300],
    scheduled: [0, 0, 0, 0, 0, 0, 0],
    projected: [40, 40, 40, 40, 40, 40, 0],
    net:       [0, 0, 0, 0, 0, 0, 260],
    receipts:  [0, 0, 0, 0, 0, 0, 260],
    releases:  [0, 0, 0, 0, 0, 260, 0],
  })
  console.log('ok   slide 20: table (L4L, LT 1)')
  assert.deepEqual(rows(r, 2), {
    gross:     [0, 0, 0, 0, 0, 1040, 0],
    scheduled: [0, 200, 0, 0, 0, 0, 0],
    projected: [120, 320, 320, 320, 320, 30, 30],
    net:       [0, 0, 0, 0, 0, 720, 0],
    receipts:  [0, 0, 0, 0, 0, 750, 0],
    releases:  [0, 0, 0, 750, 0, 0, 0],
  })
  console.log('ok   slide 21: table legs (FOQ 250, LT 2)')
  assert.deepEqual(rows(r, 3), {
    gross:     [0, 0, 0, 0, 0, 260, 0],
    scheduled: [0, 0, 60, 0, 0, 0, 0],
    projected: [0, 0, 60, 60, 60, 0, 0],
    net:       [0, 0, 0, 0, 0, 200, 0],
    receipts:  [0, 0, 0, 0, 0, 200, 0],
    releases:  [0, 0, 200, 0, 0, 0, 0],
  })
  console.log('ok   slide 22: table top (L4L, LT 3)')
}
console.log('\nMRP engine matches the slide answers')
