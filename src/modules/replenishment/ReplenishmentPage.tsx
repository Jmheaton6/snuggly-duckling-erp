import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Factory, ShoppingCart } from 'lucide-react'
import { must, rpc, supabase } from '../../lib/supabase'
import { useLocations } from '../../lib/queries'
import { addDays, date, docNo, money, pct, qty, today, weekStart } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { DataTable, type Column } from '../../components/DataTable'
import { Badge, Button, Card, Drawer, ErrorNote, MathNote, PageHeader, Spinner, cx } from '../../components/ui'
import { CalendarGrid, type CalendarEvent } from '../../components/CalendarGrid'
import { NewPoModal } from '../purchasing/PurchasingPage'

// One row per stocked item, computed in the database from usage history (v_replenishment).
type Rep = {
  item_id: number; sku: string; name: string; kind: string; uom: string; supplier_id: number | null; supplier_name: string | null
  avg_cost: number; lead_days: number; n_days: number; avg_daily: number; sd_daily: number; annual_demand: number; holding_cost: number
  z: number; ordering_cost: number; h_pct: number; review_days: number
  on_hand: number; on_order: number; position: number; safety_stock: number; rop: number; eoq: number | null
  order_up_to: number; periodic_qty: number; below_rop: boolean; order_by: string | null
}
type Mode = 'rop' | 'periodic'
type Filter = 'now' | 'week' | 'all'
type View = 'list' | 'calendar'
const WEEKS = 4

export function ReplenishmentPage() {
  const q = useQuery({ queryKey: ['stock', 'replenishment'], queryFn: () => must(supabase.from('v_replenishment').select('*').order('sku')) as Promise<Rep[]> })
  const [mode, setMode] = useState<Mode>('rop')
  const [filter, setFilter] = useState<Filter>('now')
  const [view, setView] = useState<View>('list')
  const [day, setDay] = useState(today())
  const [picked, setPicked] = useState<number | null>(null)
  const [po, setPo] = useState<{ supplierId: number; lines: { item_id: number; qty: number }[] } | null>(null)
  if (q.isLoading) return <Spinner />
  const all = (q.data ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])) as Rep)
  const suggest = (r: Rep) => (mode === 'rop' ? (r.below_rop ? r.eoq ?? 0 : 0) : r.periodic_qty)
  const soon = addDays(today(), 7)
  const inFilter = (r: Rep) => filter === 'all' ? true
    : mode === 'periodic' ? r.periodic_qty > 0
    : filter === 'now' ? r.below_rop : r.below_rop || (r.order_by != null && r.order_by <= soon)
  // The calendar only applies to the reorder-point method: periodic review orders everything on the review day.
  const calendar = mode === 'rop' && view === 'calendar'
  const rows = calendar ? all.filter((r) => r.order_by === day) : all.filter(inFilter)
  const s = all[0]
  const current = all.find((r) => r.item_id === picked)

  // Group what to order now by who supplies it: one PO per supplier, one work order per made item.
  const toOrder = all.filter((r) => suggest(r) > 0)
  const bySupplier = new Map<number, Rep[]>()
  for (const r of toOrder.filter((r) => r.kind !== 'made' && r.supplier_id)) bySupplier.set(r.supplier_id!, [...(bySupplier.get(r.supplier_id!) ?? []), r])
  const toMake = toOrder.filter((r) => r.kind === 'made')

  // One calendar entry per supplier per order-by day (made items group under the kitchen).
  const events: CalendarEvent[] = []
  const calEnd = addDays(weekStart(today()), WEEKS * 7)   // first day after the grid
  const dated = all.filter((r) => r.order_by != null)
  for (const r of dated) {
    const who = r.kind === 'made' ? 'Kitchen' : r.supplier_name ?? 'No supplier'
    const key = `${r.order_by}|${who}`
    if (events.some((e) => e.key === key)) continue
    const n = dated.filter((x) => x.order_by === r.order_by && (x.kind === 'made' ? 'Kitchen' : x.supplier_name ?? 'No supplier') === who).length
    // Red only when stock is already at or below the reorder point (the same rule as "Order now").
    const now = dated.some((x) => x.order_by === r.order_by && x.below_rop && (x.kind === 'made' ? 'Kitchen' : x.supplier_name ?? 'No supplier') === who)
    events.push({ date: r.order_by!, key, label: who, count: n, tone: now ? 'red' : r.order_by! <= soon ? 'gold' : 'gray' })
  }
  const later = dated.filter((r) => r.order_by! >= calEnd).length

  // On the calendar, a day's order is the EOQ it will need when it reaches its reorder point.
  const planned = (r: Rep) => (calendar ? r.eoq ?? 0 : suggest(r))
  const columns: Column<Rep>[] = [
    { key: 'name', header: 'Item', render: (r) => <span className="font-medium">{r.name}<span className="block text-xs font-normal text-zinc-600">{r.sku} · {r.kind === 'made' ? 'Made in-house' : r.supplier_name}</span></span> },
    { key: 'avg_daily', header: 'Avg use / day', align: 'right', render: (r) => qty(r.avg_daily, r.uom) },
    { key: 'lead_days', header: 'Lead time', align: 'right', render: (r) => `${r.lead_days} ${r.lead_days === 1 ? 'day' : 'days'}` },
    { key: 'position', header: 'On hand + on order', align: 'right', render: (r) => <span>{qty(r.position, r.uom)}<span className="block text-xs text-zinc-600">{qty(r.on_hand)} + {qty(r.on_order)}</span></span> },
    ...(mode === 'rop' ? [
      { key: 'rop', header: 'Reorder point', align: 'right', render: (r: Rep) => <span className={r.below_rop ? 'font-semibold text-red-700' : ''}>{qty(r.rop, r.uom)}</span> },
      { key: 'eoq', header: 'EOQ', align: 'right', render: (r: Rep) => qty(r.eoq, r.uom) },
      { key: 'order_by', header: 'Order by', render: (r: Rep) => r.below_rop ? <Badge tone="red">Today</Badge> : r.order_by ? date(r.order_by) : <span className="text-zinc-500">No usage</span> },
    ] as Column<Rep>[] : [
      { key: 'order_up_to', header: 'Order-up-to level', align: 'right', render: (r: Rep) => qty(r.order_up_to, r.uom) },
    ] as Column<Rep>[]),
    { key: 'suggest', header: calendar ? 'Order that day' : 'Suggested order', align: 'right', value: (r) => planned(r),
      render: (r) => planned(r) > 0 ? <span className="font-semibold">{qty(planned(r), r.uom)}<span className="block text-xs font-normal text-zinc-600">{money(planned(r) * r.avg_cost)}</span></span> : <span className="text-zinc-500">—</span> },
  ]

  return (
    <>
      <PageHeader title="Replenishment"
        description="When to reorder each item and how much, computed from usage history. Click an item to see its math." />
      <ErrorNote error={q.error} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Method" className="inline-flex max-w-full overflow-x-auto rounded-md bg-zinc-100 p-0.5 text-sm">
          {([['rop', 'Reorder point (continuous)'], ['periodic', `Periodic review (every ${s?.review_days ?? '—'} days)`]] as [Mode, string][]).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={cx('whitespace-nowrap rounded px-3 py-1.5', segment(mode === m))}>{label}</button>
          ))}
        </div>
        {!calendar && <div role="group" aria-label="Show" className="inline-flex max-w-full overflow-x-auto rounded-md bg-zinc-100 p-0.5 text-sm">
          {([['now', mode === 'rop' ? `Order now (${all.filter((r) => r.below_rop).length})` : `Needs an order (${all.filter((r) => r.periodic_qty > 0).length})`],
            ...(mode === 'rop' ? [['week', `Order within 7 days (${all.filter((r) => r.below_rop || (r.order_by != null && r.order_by <= soon)).length})`]] : []),
            ['all', `All items (${all.length})`]] as [Filter, string][]).map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={cx('whitespace-nowrap rounded px-3 py-1.5', segment(filter === f))}>{label}</button>
          ))}
        </div>}
        {mode === 'rop' && (
          <div role="group" aria-label="View" className="ml-auto inline-flex rounded-md bg-zinc-100 p-0.5 text-sm">
            {([['list', 'List'], ['calendar', 'Calendar']] as [View, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={cx('whitespace-nowrap rounded px-3 py-1.5', segment(view === v))}>{label}</button>
            ))}
          </div>
        )}
      </div>

      {s && (
        <div className="mb-4 grid gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span className="w-16 font-medium text-zinc-800">Formulas</span>
            {mode === 'rop' ? <>
              <span><b className="font-medium">Reorder point</b> = d̄ × L + z × σ × √L</span>
              <span><b className="font-medium">EOQ</b> = √(2 × D × S ÷ H)</span>
              <span>Order when on hand + on order ≤ reorder point</span>
            </> : <>
              <span><b className="font-medium">Order-up-to</b> = d̄ × (R + L) + z × σ × √(R + L)</span>
              <span><b className="font-medium">Order</b> = order-up-to − (on hand + on order)</span>
            </>}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span className="w-16 font-medium text-zinc-800">Inputs</span>
            <span>d̄, σ from the last {s.n_days} days of usage</span>
            <span>z = {s.z}</span>
            <span>S = {money(s.ordering_cost)} per order</span>
            <span>H = {pct(s.h_pct, 0)} of avg cost per year</span>
            {mode === 'periodic' && <span>R = {s.review_days} days</span>}
            <Link to="/settings" className="font-medium text-gold-800 hover:underline">Change in Settings</Link>
          </div>
        </div>
      )}

      <Card title={mode === 'rop' ? 'Orders to place now' : 'Orders from this review'} className="mb-4">
        {toOrder.length === 0 ? <p className="text-sm text-zinc-600">Nothing to order right now.</p> : (
          <ul className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
            {[...bySupplier].map(([sid, list]) => (
              <li key={sid} className="flex items-center justify-between gap-2">
                <span className="min-w-0"><span className="font-medium">{list[0].supplier_name}</span><span className="block truncate text-xs text-zinc-600">{list.map((r) => `${qty(suggest(r))} ${r.name}`).join(', ')}</span></span>
                <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setPo({ supplierId: sid, lines: list.map((r) => ({ item_id: r.item_id, qty: suggest(r) })) })}><ShoppingCart className="size-3.5" />Create PO</Button>
              </li>
            ))}
            {toMake.map((r) => <MakeRow key={r.item_id} r={r} qty={suggest(r)} />)}
          </ul>
        )}
      </Card>
      {calendar && (
        <div className="mb-4">
          <CalendarGrid from={today()} weeks={WEEKS} events={events} selected={day} onSelect={setDay} />
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
            <span>Each box is a supplier and how many of its items reach their reorder point that day.</span>
            <span><span className="mr-1 inline-block size-2.5 rounded-sm bg-red-200 align-middle" />At or below reorder point: order now</span>
            <span><span className="mr-1 inline-block size-2.5 rounded-sm bg-gold-300 align-middle" />Within 7 days</span>
            {later > 0 && <span>{later} more {later === 1 ? 'item' : 'items'} after {date(addDays(calEnd, -1))}</span>}
          </p>
          <h2 className="mt-4 text-sm font-semibold text-zinc-900">Reaching the reorder point on {date(day)}</h2>
        </div>
      )}
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.item_id} onRowClick={(r) => setPicked(r.item_id)} dense noun="items"
        empty={calendar ? 'Nothing reaches its reorder point on this day. Pick another day.' : mode === 'rop' ? 'Nothing is at or below its reorder point. Try "Order within 7 days" or "All items".' : 'Every item is at or above its order-up-to level.'} />
      <Drawer open={!!current} onClose={() => setPicked(null)} title={current?.name ?? ''} subtitle={current && `${current.sku} · ${current.kind === 'made' ? 'made in-house' : current.supplier_name}`}>
        {current && <ItemMath r={current} mode={mode} />}
      </Drawer>
      {po && <NewPoModal key={po.supplierId} open initial={po} onClose={() => setPo(null)} onCreated={() => setPo(null)} />}
    </>
  )
}

function MakeRow({ r, qty: n }: { r: Rep; qty: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: locations } = useLocations()
  const [busy, setBusy] = useState(false)
  async function make() {
    setBusy(true)
    try {
      const id = await rpc<number>('create_production_order', { p_item_id: r.item_id, p_qty: n, p_location_id: locations?.find((l) => l.kind === 'warehouse')?.id, p_due_date: addDays(today(), r.lead_days), p_note: 'From replenishment review' })
      await qc.invalidateQueries()
      toast(`${docNo('production', id)} created: make ${qty(n)} ${r.name}`)
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not create the work order', 'error') } finally { setBusy(false) }
  }
  return (
    <li className="flex items-center justify-between gap-2">
      <span><span className="font-medium">{r.name}</span><span className="block text-xs text-zinc-600">Make {qty(n)} in the kitchen</span></span>
      <Button size="sm" className="shrink-0 whitespace-nowrap" busy={busy} onClick={make}><Factory className="size-3.5" />Create work order</Button>
    </li>
  )
}

function ItemMath({ r, mode }: { r: Rep; mode: Mode }) {
  const f = (n: number, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d })
  return (
    <div className="space-y-3">
      <MathNote title="Usage history" lines={[
        ['Days of history', f(r.n_days, 0)],
        ['Average use per day (d̄)', f(r.avg_daily, 3)],
        ['Std. deviation per day (σ)', f(r.sd_daily, 3)],
        ['Lead time (L)', `${r.lead_days} days`],
      ]} />
      <MathNote title="Reorder point = d̄ × L + z × σ × √L" lines={[
        ['Lead-time demand', `${f(r.avg_daily, 3)} × ${r.lead_days} = ${f(r.avg_daily * r.lead_days, 1)}`],
        ['Safety stock', `${r.z} × ${f(r.sd_daily, 3)} × √${r.lead_days} = ${f(r.safety_stock, 1)}`],
        ['Reorder point', <b key="rop">{f(r.rop, 1)}</b>],
        ['On hand + on order', `${f(r.on_hand)} + ${f(r.on_order)} = ${f(r.position)}`],
        ['Status', r.below_rop ? 'At or below the reorder point: order now' : `Above it; at ${f(r.avg_daily, 1)}/day it hits the reorder point by ${date(r.order_by)}`],
      ]} />
      <MathNote title="EOQ = √(2 × D × S ÷ H)" lines={[
        ['Annual demand D', `${f(r.avg_daily, 3)} × 365 = ${f(r.annual_demand, 0)}`],
        ['Ordering cost S', money(r.ordering_cost)],
        ['Holding cost H', `${r.h_pct} × ${money(r.avg_cost)} = ${money(r.holding_cost)} per unit per year`],
        ['EOQ', <b key="eoq">√(2 × {f(r.annual_demand, 0)} × {r.ordering_cost} ÷ {f(r.holding_cost, 4)}) = {f(r.eoq ?? 0, 0)}</b>],
      ]} />
      {mode === 'periodic' && (
        <MathNote title={`Periodic review: order up to d̄ × (R + L) + z × σ × √(R + L)`} lines={[
          ['Review interval R', `${r.review_days} days`],
          ['Order-up-to level', `${f(r.avg_daily, 3)} × ${r.review_days + r.lead_days} + ${r.z} × ${f(r.sd_daily, 3)} × √${r.review_days + r.lead_days} = ${f(r.order_up_to, 1)}`],
          ['Order now', <b key="pq">{f(r.order_up_to, 1)} − {f(r.position)} = {f(r.periodic_qty, 0)}</b>],
        ]} />
      )}
    </div>
  )
}

const segment = (on: boolean) => (on ? 'bg-white font-medium text-zinc-900 shadow-xs' : 'text-zinc-600 hover:text-zinc-900')
