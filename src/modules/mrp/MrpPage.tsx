import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Pencil, Send } from 'lucide-react'
import { must, rpc, supabase } from '../../lib/supabase'
import { useBoms, useItems, useLocations, useSuppliers } from '../../lib/queries'
import { date, docNo, qty, today } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { Badge, Button, Card, ErrorNote, Field, Input, Kpi, MathNote, Modal, PageHeader, Select, Spinner } from '../../components/ui'
import { lotSize, runMrp, type Bucket, type MrpItem, type MrpRecord, type Peg, type PlannedOrder } from './engine'

type Row = 'gross' | 'scheduled' | 'projected' | 'net' | 'receipts' | 'releases'
const ROWS: [Row, string][] = [
  ['gross', 'Gross requirements'], ['scheduled', 'Scheduled receipts'], ['projected', 'Projected on hand'],
  ['net', 'Net requirements'], ['receipts', 'Planned order receipts'], ['releases', 'Planned order releases'],
]
const short = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
const makes = (i: Pick<MrpItem, 'kind'>) => i.kind === 'made' || i.kind === 'kit'
const ltText = (i: MrpItem) => `${i.leadDays} day${i.leadDays === 1 ? '' : 's'} (${i.leadSource === 'production' ? 'production' : i.leadSource === 'item' ? 'item override' : 'supplier quote'})`
const qText = (i: MrpItem) => (i.lotRule === 'FOQ' ? `FOQ ${qty(i.lotQty, i.uom)}` : 'L4L')

// Everything MRP reads: open sales orders (demand), open POs and work orders (scheduled
// receipts), on-hand, BOMs, lead times and lot sizes. Realtime refreshes it on any change.
function useMrpInputs() {
  const items = useItems()
  const boms = useBoms()
  const lots = useQuery({
    queryKey: ['items', 'lots'],
    queryFn: () => must(supabase.from('items').select('id, lot_rule, lot_qty')) as Promise<{ id: number; lot_rule: 'L4L' | 'FOQ'; lot_qty: number | null }[]>,
  })
  const sos = useQuery({
    queryKey: ['sales_orders', 'mrp'],
    queryFn: () => must(supabase.from('sales_order_lines')
      .select('item_id, qty, sales_orders!inner(id, status, requested_date, customers(name))')
      .eq('sales_orders.status', 'placed')) as unknown as Promise<{ item_id: number; qty: number; sales_orders: { id: number; requested_date: string; customers: { name: string } | null } }[]>,
  })
  const pos = useQuery({
    queryKey: ['purchase_orders', 'mrp'],
    queryFn: () => must(supabase.from('po_lines')
      .select('item_id, qty_ordered, qty_received, purchase_orders!inner(id, status, expected_date, suppliers(name))')
      .in('purchase_orders.status', ['sent', 'partial'])) as unknown as Promise<{ item_id: number; qty_ordered: number; qty_received: number; purchase_orders: { id: number; expected_date: string | null; suppliers: { name: string } | null } }[]>,
  })
  const wos = useQuery({
    queryKey: ['production_orders', 'mrp'],
    queryFn: () => must(supabase.from('production_orders').select('id, item_id, qty_planned, qty_started, status, due_date')
      .in('status', ['planned', 'in_progress'])) as Promise<{ id: number; item_id: number; qty_planned: number; qty_started: number | null; status: string; due_date: string | null }[]>,
  })
  const all = [items, boms, lots, sos, pos, wos]
  return { items, boms, lots, sos, pos, wos, isLoading: all.some((q) => q.isLoading), error: all.find((q) => q.error)?.error }
}

export function MrpPage() {
  const inputs = useMrpInputs()
  const [weeks, setWeeks] = useState(6)
  const [selected, setSelected] = useState<number | null>(null)
  const now = today()

  const plan = useMemo(() => {
    const { items, boms, lots, sos, pos, wos } = inputs
    if (!items.data || !boms.data || !lots.data || !sos.data || !pos.data || !wos.data) return null
    const lot = new Map(lots.data.map((l) => [l.id, l]))
    const mrpItems: MrpItem[] = items.data.filter((i) => i.active).map((i) => ({
      id: i.id, sku: i.sku, name: i.name, kind: i.kind, uom: i.uom, onHand: Number(i.on_hand),
      leadDays: Number(i.effective_lead_time ?? 0),
      leadSource: makes(i) ? 'production' : i.lead_time_days != null ? 'item' : 'supplier',
      lotRule: lot.get(i.id)?.lot_rule ?? 'L4L', lotQty: lot.get(i.id)?.lot_qty != null ? Number(lot.get(i.id)!.lot_qty) : null,
      supplierId: i.supplier_id, supplierName: i.supplier_name,
    }))
    const byId = new Map(mrpItems.map((i) => [i.id, i]))
    const bomList = boms.data.map((b) => ({ ...b, qty_per: Number(b.qty_per) }))

    const demand: Peg[] = sos.data.map((l) => ({
      itemId: l.item_id, qty: Number(l.qty), date: l.sales_orders.requested_date,
      label: `${docNo('sales_order', l.sales_orders.id)} · ${l.sales_orders.customers?.name ?? 'Customer'}`,
      detail: `pickup ${date(l.sales_orders.requested_date)}`, late: l.sales_orders.requested_date < now,
    }))
    const receipts: Peg[] = []
    for (const l of pos.data) {
      const open = Number(l.qty_ordered) - Number(l.qty_received)
      const d = l.purchase_orders.expected_date ?? now
      if (open > 0) receipts.push({
        itemId: l.item_id, qty: open, date: d, late: d < now,
        label: `${docNo('purchase_order', l.purchase_orders.id)} · ${l.purchase_orders.suppliers?.name ?? 'Supplier'}`,
        detail: d < now ? `late, was due ${date(d)}` : `expected ${date(d)}`,
      })
    }
    for (const w of wos.data) {
      const item = byId.get(w.item_id)
      const due = w.due_date ?? now
      const q = Number(w.qty_started ?? w.qty_planned)
      receipts.push({ itemId: w.item_id, qty: q, date: due, late: due < now, label: `${docNo('production', w.id)} · work order (${w.status === 'planned' ? 'planned' : 'in progress'})`, detail: `due ${date(due)}` })
      // A planned work order hasn't issued its materials yet, so they are still required.
      if (w.status === 'planned' && item) for (const b of bomList.filter((b) => b.parent_id === w.item_id)) {
        const start = due < now ? now : due
        demand.push({ itemId: b.component_id, qty: Math.round(q * b.qty_per * 1000) / 1000, date: start,
          label: `${docNo('production', w.id)} · ${qty(q)} × ${item.name}`, detail: `${b.qty_per} per unit · materials not issued yet` })
      }
    }
    return { ...runMrp({ items: mrpItems, boms: bomList, demand, receipts, today: now, weeks }), byId, bomList, soCount: new Set(sos.data.map((l) => l.sales_orders.id)).size }
  }, [inputs, weeks, now])

  if (inputs.isLoading) return <Spinner />
  if (inputs.error || !plan) return <ErrorNote error={inputs.error} />

  const orders = plan.order.flatMap((id) => plan.records.get(id)!.orders).sort((a, b) => a.orderBy.localeCompare(b.orderBy) || plan.level.get(a.itemId)! - plan.level.get(b.itemId)!)
  const pastDue = orders.filter((o) => o.pastDue).length
  const firstWithOrders = plan.order.find((id) => plan.records.get(id)!.orders.length > 0 && plan.level.get(id) === 0)
  const current = plan.records.get(selected ?? firstWithOrders ?? plan.order[0])!
  const open = (id: number) => { setSelected(id); requestAnimationFrame(() => document.getElementById('mrp-record')?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }

  return (
    <>
      <PageHeader title="Material requirements planning"
        description="Confirmed sales orders drive the plan. Each item is netted against on-hand and open orders, sized by its lot rule, and offset by its lead time; parents' planned order releases become their components' gross requirements, one BOM level at a time."
        actions={
          <Field label="Horizon" className="w-36">
            <Select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
              {[4, 6, 8].map((n) => <option key={n} value={n}>{n} weeks</option>)}
            </Select>
          </Field>
        } />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Planned orders" value={orders.length} sub={`${orders.filter((o) => !makes(plan.byId.get(o.itemId)!)).length} to buy · ${orders.filter((o) => makes(plan.byId.get(o.itemId)!)).length} to make`} />
        <Kpi label="Past due" value={pastDue} tone={pastDue ? 'bad' : 'good'} sub={pastDue ? 'Order-by date already passed: release today' : 'Every order can still be placed on time'} />
        <Kpi label="Open sales orders in the plan" value={plan.soCount} sub="Independent demand (the MPS)" />
        <Kpi label="Week 1" value={`${short(plan.buckets[0].start)} – ${short(plan.buckets[0].end)}`} sub="Overdue demand and late receipts count in week 1" />
      </div>

      <PlannedOrders orders={orders} plan={plan} onOpen={open} />

      <div id="mrp-record" className="scroll-mt-4">
        <RecordCard rec={current} plan={plan} onOpen={open} />
      </div>
    </>
  )
}

type Plan = ReturnType<typeof runMrp> & { byId: Map<number, MrpItem>; bomList: { parent_id: number; component_id: number; qty_per: number }[] }

function PlannedOrders({ orders, plan, onOpen }: { orders: PlannedOrder[]; plan: Plan; onOpen: (id: number) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: locations } = useLocations()
  const [busy, setBusy] = useState<string | null>(null)
  const warehouse = locations?.find((l) => l.kind === 'warehouse')?.id

  // Releasing a planned order places it: it becomes a scheduled receipt (an open PO or work order).
  async function release(o: PlannedOrder) {
    const item = plan.byId.get(o.itemId)!
    const key = `${o.itemId}-${o.week}`
    setBusy(key)
    try {
      if (makes(item)) {
        const id = await rpc<number>('create_production_order', { p_item_id: item.id, p_qty: o.qty, p_location_id: warehouse, p_due_date: o.needDate, p_note: 'Released from MRP' })
        toast(`${docNo('production', id)} created: make ${qty(o.qty, item.uom)} ${item.name} by ${date(o.needDate)}`)
      } else {
        const id = await rpc<number>('create_purchase_order', { p_supplier_id: item.supplierId, p_location_id: warehouse, p_lines: [{ item_id: item.id, qty: o.qty }], p_send: true, p_note: 'Released from MRP' })
        toast(`${docNo('purchase_order', id)} sent to ${item.supplierName}: ${qty(o.qty, item.uom)} ${item.name}`)
      }
      await qc.invalidateQueries()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not release the order', 'error')
    } finally { setBusy(null) }
  }

  return (
    <Card title="Planned order releases" className="mb-4" padded={false}
      actions={<span className="text-xs text-zinc-600">Order-by date = need date − lead time</span>}>
      {orders.length === 0 ? <p className="px-4 py-6 text-sm text-zinc-600">Nothing to order: on-hand and open orders cover every requirement in the horizon.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-600">
              <tr>
                <th className="px-4 py-2 font-medium">Order by</th>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Level</th>
                <th className="px-3 py-2 font-medium">Make / buy</th>
                <th className="px-3 py-2 text-right font-medium">Net req.</th>
                <th className="px-3 py-2 text-right font-medium">Order qty</th>
                <th className="px-3 py-2 font-medium">Needed</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {orders.map((o) => {
                const item = plan.byId.get(o.itemId)!
                return (
                  <tr key={`${o.itemId}-${o.week}`} className="hover:bg-zinc-50">
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className="num">{date(o.orderBy)}</span>
                      {o.pastDue ? <span className="ml-2"><Badge tone="red">Past due</Badge></span> : <span className="ml-2 text-xs text-zinc-600">wk {o.releaseWeek}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <button className="text-left font-medium text-zinc-900 hover:underline" onClick={() => onOpen(item.id)}>{item.name}</button>
                      <span className="ml-1.5 text-xs text-zinc-600">{item.sku}</span>
                    </td>
                    <td className="px-3 py-2 text-zinc-700">{plan.level.get(item.id)}</td>
                    <td className="px-3 py-2 text-zinc-700">{makes(item) ? 'Make (work order)' : `Buy · ${item.supplierName ?? 'no supplier'}`}</td>
                    <td className="num px-3 py-2 text-right text-zinc-700">{qty(o.net, item.uom)}</td>
                    <td className="num px-3 py-2 text-right font-semibold">{qty(o.qty, item.uom)}<span className="ml-1 text-xs font-normal text-zinc-600">{qText(item)}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-700">{date(o.needDate)} <span className="text-xs text-zinc-600">wk {o.week}</span></td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" busy={busy === `${o.itemId}-${o.week}`} disabled={!makes(item) && !item.supplierId} onClick={() => release(o)}>
                        <Send className="size-3.5" />{makes(item) ? 'Create work order' : 'Send PO'}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function RecordCard({ rec, plan, onOpen }: { rec: MrpRecord; plan: Plan; onOpen: (id: number) => void }) {
  const [cell, setCell] = useState<{ row: Row; w: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const item = rec.item
  const children = plan.bomList.filter((b) => b.parent_id === item.id)
  const parents = plan.bomList.filter((b) => b.component_id === item.id)
  const levels = [...new Set(plan.order.map((id) => plan.level.get(id)!))]
  const active = cell && rec[cell.row] ? cell : null

  return (
    <Card padded={false}
      title={<span>MRP record</span>}
      actions={
        <Select className="w-72" value={item.id} onChange={(e) => { onOpen(Number(e.target.value)); setCell(null) }}>
          {levels.map((lv) => (
            <optgroup key={lv} label={`BOM level ${lv}${lv === 0 ? ' (sold finished)' : ''}`}>
              {plan.order.filter((id) => plan.level.get(id) === lv).map((id) => {
                const r = plan.records.get(id)!
                return <option key={id} value={id}>{r.orders.length ? '● ' : ''}{r.item.name}</option>
              })}
            </optgroup>
          ))}
        </Select>
      }>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="bg-zinc-50">
              <th className="w-56 border-b border-r border-zinc-200 px-3 py-2 text-left font-semibold">{item.name}</th>
              <th className="border-b border-r border-zinc-200 px-2 py-2 text-center text-xs font-medium text-zinc-600">Start</th>
              {plan.buckets.map((b, w) => (
                <th key={b.start} className="border-b border-r border-zinc-200 px-2 py-1.5 text-center last:border-r-0">
                  <div className="text-sm font-semibold">{w + 1}</div>
                  <div className="text-[11px] font-normal text-zinc-600">{short(b.start)}</div>
                </th>
              ))}
            </tr>
            <HeaderRow cols={plan.buckets.length}>
              <span>{item.sku} · BOM level {rec.level}</span>
            </HeaderRow>
            <HeaderRow cols={plan.buckets.length}>
              <span>LT = {ltText(item)}</span>
            </HeaderRow>
            <HeaderRow cols={plan.buckets.length}>
              <span className="flex items-center gap-2">Q: {qText(item)}
                <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-gold-800 hover:bg-gold-50"><Pencil className="size-3" />Edit LT / Q</button>
              </span>
            </HeaderRow>
          </thead>
          <tbody>
            {ROWS.map(([row, label]) => (
              <tr key={row} className={row === 'releases' ? 'bg-gold-50' : ''}>
                <th className="border-b border-r border-zinc-200 px-3 py-2 text-left font-medium">{label}</th>
                <td className="num border-b border-r border-zinc-200 px-2 py-2 text-center text-zinc-700">{row === 'projected' ? qty(item.onHand) : ''}</td>
                {rec[row].map((v, w) => {
                  const show = row === 'projected' || v !== 0
                  const late = row === 'releases' && v > 0 && w === 0 && rec.orders.some((o) => o.pastDue)
                  const on = active?.row === row && active.w === w
                  return (
                    <td key={w} className="border-b border-r border-zinc-200 p-0 text-center last:border-r-0">
                      <button onClick={() => setCell(on ? null : { row, w })}
                        className={`num h-full w-full px-2 py-2 ${on ? 'bg-blue-50 ring-2 ring-inset ring-blue-700' : 'hover:bg-zinc-50'} ${row === 'releases' && v > 0 ? 'font-semibold' : ''} ${late ? 'text-red-700' : v < 0 ? 'text-red-700' : ''}`}>
                        {show ? qty(v) : <span className="text-zinc-500">·</span>}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
        <div>
          {active ? <CellMath rec={rec} row={active.row} w={active.w} buckets={plan.buckets} />
            : <p className="text-sm text-zinc-600">Click any number in the record to see how it was calculated.</p>}
          {rec.beyond > 0 && <p className="mt-3 text-xs text-zinc-600">{qty(rec.beyond, item.uom)} more is required after week {plan.buckets.length}; widen the horizon to plan it.</p>}
        </div>
        <div className="space-y-3 text-sm">
          {children.length > 0 && (
            <Structure title={`Bill of materials (per 1 ${item.name})`} links={children.map((b) => ({ id: b.component_id, text: `${qty(b.qty_per)} ${plan.byId.get(b.component_id)?.uom === 'lb' ? 'lb' : '×'}`, item: plan.byId.get(b.component_id) }))} onOpen={(id) => { onOpen(id); setCell(null) }} />
          )}
          {parents.length > 0 && (
            <Structure title="Used in (parents)" links={parents.map((b) => ({ id: b.parent_id, text: `${qty(b.qty_per)} per`, item: plan.byId.get(b.parent_id) }))} onOpen={(id) => { onOpen(id); setCell(null) }} />
          )}
          {!children.length && !parents.length && <p className="text-xs text-zinc-600">Not part of any bill of materials; only sold directly.</p>}
        </div>
      </div>
      <EditPlanning item={item} open={editing} onClose={() => setEditing(false)} />
    </Card>
  )
}

function HeaderRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <th className="border-b border-r border-zinc-200 px-3 py-1.5 text-left text-xs font-medium text-zinc-700">{children}</th>
      <td colSpan={cols + 1} className="border-b border-zinc-200" />
    </tr>
  )
}

function Structure({ title, links, onOpen }: { title: string; links: { id: number; text: string; item?: MrpItem }[]; onOpen: (id: number) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-600">{title}</p>
      <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
        {links.map((l) => (
          <li key={l.id}>
            <button onClick={() => onOpen(l.id)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-zinc-50">
              <span className="min-w-0 truncate">{l.item?.name}</span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-600"><span className="num">{l.text}</span><ArrowRight className="size-3" /></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CellMath({ rec, row, w, buckets }: { rec: MrpRecord; row: Row; w: number; buckets: Bucket[] }) {
  const u = rec.item.uom
  const q = (n: number) => qty(n, u)
  const prior = w === 0 ? rec.item.onHand : rec.projected[w - 1]
  const priorLabel = w === 0 ? 'On hand at start' : `Projected on hand, week ${w}`
  const week = `Week ${w + 1} (${short(buckets[w].start)} – ${short(buckets[w].end)})`
  const pegLines = (pegs: Peg[]): [string, ReactNode][] => pegs.length
    ? pegs.map((p, i) => [`${i + 1}. ${p.label}`, <>{q(p.qty)} <span className={`font-normal ${p.late ? 'text-red-700' : 'text-blue-700'}`}>· {p.detail ?? date(p.date)}</span></>])
    : [['Nothing dated this week', q(0)]]

  if (row === 'gross') return <MathNote title={`Gross requirements · ${week}`} lines={[...pegLines(rec.grossPegs[w]), ['Total', q(rec.gross[w])]]} />
  if (row === 'scheduled') return <MathNote title={`Scheduled receipts (open orders) · ${week}`} lines={[...pegLines(rec.scheduledPegs[w]), ['Total', q(rec.scheduled[w])]]} />
  if (row === 'projected') return (
    <MathNote title={`Projected on hand · ${week}`} lines={[
      ['Formula', 'prior on hand + scheduled receipts + planned order receipts − gross requirements'],
      [priorLabel, q(prior)], ['+ Scheduled receipts', q(rec.scheduled[w])], ['+ Planned order receipts', q(rec.receipts[w])], ['− Gross requirements', q(rec.gross[w])],
      ['= Projected on hand', `${q(prior)} + ${q(rec.scheduled[w])} + ${q(rec.receipts[w])} − ${q(rec.gross[w])} = ${q(rec.projected[w])}`],
    ]} />
  )
  if (row === 'net') return (
    <MathNote title={`Net requirements · ${week}`} lines={[
      ['Formula', 'gross requirements − scheduled receipts − prior projected on hand (never below 0)'],
      ['Gross requirements', q(rec.gross[w])], ['− Scheduled receipts', q(rec.scheduled[w])], [`− ${priorLabel}`, q(prior)],
      ['= Net requirements', `max(0, ${q(rec.gross[w])} − ${q(rec.scheduled[w])} − ${q(prior)}) = ${q(rec.net[w])}`],
    ]} />
  )
  if (row === 'receipts') {
    const i = rec.item
    return (
      <MathNote title={`Planned order receipts · ${week}`} lines={[
        ['Net requirement', q(rec.net[w])],
        ['Lot rule', i.lotRule === 'FOQ' ? `FOQ ${q(i.lotQty!)}: order whole lots of ${q(i.lotQty!)}` : 'Lot for lot: order exactly the net requirement'],
        ['= Planned order receipt', i.lotRule === 'FOQ' && rec.net[w] > 0
          ? `⌈${q(rec.net[w])} ÷ ${q(i.lotQty!)}⌉ × ${q(i.lotQty!)} = ${q(lotSize(rec.net[w], i))}` : q(rec.receipts[w])],
        ...(rec.receipts[w] > rec.net[w] ? [['Extra carried forward', `${q(rec.receipts[w] - rec.net[w])} stays in projected on hand`] as [string, ReactNode]] : []),
      ]} />
    )
  }
  const released = rec.orders.filter((o) => o.releaseWeek === w + 1)
  return (
    <MathNote title={`Planned order releases · ${week}`} lines={released.length ? released.flatMap((o): [string, ReactNode][] => [
      [`Receipt needed (week ${o.week})`, `${q(o.qty)} on ${date(o.needDate)}`],
      ['− Lead time', ltText(rec.item)],
      ['= Order by', <>{date(o.orderBy)}{o.pastDue && <span className="text-red-700"> · past due, so it's released now in week 1</span>}</>],
    ]) : [['No release this week', q(0)]]} />
  )
}

function EditPlanning({ item, open, onClose }: { item: MrpItem; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: items } = useItems()
  const { data: suppliers } = useSuppliers()
  const row = items?.find((i) => i.id === item.id)
  const [lead, setLead] = useState<string | null>(null)
  const [rule, setRule] = useState<'L4L' | 'FOQ' | null>(null)
  const [lotQ, setLotQ] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const leadVal = lead ?? (row?.lead_time_days != null ? String(row.lead_time_days) : '')
  const ruleVal = rule ?? item.lotRule
  const lotVal = lotQ ?? (item.lotQty != null ? String(item.lotQty) : '')
  const supplierLead = suppliers?.find((s) => s.id === item.supplierId)?.lead_time_days

  function close() { setLead(null); setRule(null); setLotQ(null); setError(null); onClose() }
  async function save() {
    setBusy(true); setError(null)
    try {
      if (ruleVal === 'FOQ' && !(Number(lotVal) > 0)) throw new Error('A fixed order quantity needs a lot size above 0')
      await must(supabase.from('items').update({
        lead_time_days: leadVal === '' ? null : Number(leadVal),
        lot_rule: ruleVal, lot_qty: ruleVal === 'FOQ' ? Number(lotVal) : null,
      }).eq('id', item.id))
      await qc.invalidateQueries()
      toast(`Planning data saved for ${item.name}; MRP recalculated`)
      close()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={close} title={`Planning data · ${item.name}`}
      footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save & recalculate</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={makes(item) ? 'Production lead time (days)' : 'Lead time override (days)'} className="sm:col-span-2"
          hint={makes(item) ? 'Time to make or pack one batch.' : `Blank = supplier quote${supplierLead != null ? ` (${supplierLead} days)` : ''}.`}>
          <Input type="number" min="0" value={leadVal} onChange={(e) => setLead(e.target.value)} />
        </Field>
        <Field label="Lot rule">
          <Select value={ruleVal} onChange={(e) => setRule(e.target.value as 'L4L' | 'FOQ')}>
            <option value="L4L">L4L (lot for lot)</option>
            <option value="FOQ">FOQ (fixed order quantity)</option>
          </Select>
        </Field>
        <Field label={`Lot size${item.uom === 'lb' ? ' (lb)' : ''}`} hint={ruleVal === 'FOQ' ? 'Orders are whole multiples of this.' : 'Not used for lot for lot.'}>
          <Input type="number" min="0" step="any" value={ruleVal === 'FOQ' ? lotVal : ''} disabled={ruleVal !== 'FOQ'} onChange={(e) => setLotQ(e.target.value)} />
        </Field>
        <div className="sm:col-span-2"><ErrorNote error={error} /></div>
      </div>
    </Modal>
  )
}
