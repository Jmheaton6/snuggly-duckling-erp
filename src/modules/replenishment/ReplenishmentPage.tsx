import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Factory, ShoppingCart } from 'lucide-react'
import { must, rpc, supabase } from '../../lib/supabase'
import { useLocations } from '../../lib/queries'
import { addDays, date, docNo, money, qty, today } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { DataTable, type Column } from '../../components/DataTable'
import { Badge, Button, Card, Drawer, ErrorNote, MathNote, PageHeader, Spinner, cx } from '../../components/ui'
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

export function ReplenishmentPage() {
  const q = useQuery({ queryKey: ['stock', 'replenishment'], queryFn: () => must(supabase.from('v_replenishment').select('*').order('sku')) as Promise<Rep[]> })
  const [mode, setMode] = useState<Mode>('rop')
  const [filter, setFilter] = useState<Filter>('now')
  const [picked, setPicked] = useState<number | null>(null)
  const [po, setPo] = useState<{ supplierId: number; lines: { item_id: number; qty: number }[] } | null>(null)
  if (q.isLoading) return <Spinner />
  const all = (q.data ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])) as Rep)
  const suggest = (r: Rep) => (mode === 'rop' ? (r.below_rop ? r.eoq ?? 0 : 0) : r.periodic_qty)
  const soon = addDays(today(), 7)
  const inFilter = (r: Rep) => filter === 'all' ? true
    : mode === 'periodic' ? r.periodic_qty > 0
    : filter === 'now' ? r.below_rop : r.below_rop || (r.order_by != null && r.order_by <= soon)
  const rows = all.filter(inFilter)
  const s = all[0]
  const current = all.find((r) => r.item_id === picked)

  // Group what to order now by who supplies it: one PO per supplier, one work order per made item.
  const toOrder = all.filter((r) => suggest(r) > 0)
  const bySupplier = new Map<number, Rep[]>()
  for (const r of toOrder.filter((r) => r.kind !== 'made' && r.supplier_id)) bySupplier.set(r.supplier_id!, [...(bySupplier.get(r.supplier_id!) ?? []), r])
  const toMake = toOrder.filter((r) => r.kind === 'made')

  const columns: Column<Rep>[] = [
    { key: 'name', header: 'Item', render: (r) => <span className="font-medium">{r.name}<span className="block text-xs font-normal text-zinc-600">{r.sku} · {r.kind === 'made' ? 'Made in-house' : r.supplier_name}</span></span> },
    { key: 'avg_daily', header: 'Avg use / day', align: 'right', render: (r) => qty(r.avg_daily, r.uom) },
    { key: 'lead_days', header: 'Lead time', align: 'right', render: (r) => `${r.lead_days} d` },
    { key: 'position', header: 'On hand + on order', align: 'right', render: (r) => <span>{qty(r.position, r.uom)}<span className="block text-xs text-zinc-600">{qty(r.on_hand)} + {qty(r.on_order)}</span></span> },
    ...(mode === 'rop' ? [
      { key: 'rop', header: 'Reorder point', align: 'right', render: (r: Rep) => <span className={r.below_rop ? 'font-semibold text-red-700' : ''}>{qty(r.rop, r.uom)}</span> },
      { key: 'eoq', header: 'EOQ', align: 'right', render: (r: Rep) => qty(r.eoq, r.uom) },
      { key: 'order_by', header: 'Order by', render: (r: Rep) => r.below_rop ? <Badge tone="red">Today</Badge> : r.order_by ? date(r.order_by) : <span className="text-zinc-500">No usage</span> },
    ] as Column<Rep>[] : [
      { key: 'order_up_to', header: 'Order-up-to level', align: 'right', render: (r: Rep) => qty(r.order_up_to, r.uom) },
    ] as Column<Rep>[]),
    { key: 'suggest', header: 'Suggested order', align: 'right', value: suggest,
      render: (r) => suggest(r) > 0 ? <span className="font-semibold">{qty(suggest(r), r.uom)}<span className="block text-xs font-normal text-zinc-600">{money(suggest(r) * r.avg_cost)}</span></span> : <span className="text-zinc-500">—</span> },
  ]

  return (
    <>
      <PageHeader title="Replenishment"
        description={<>Reorder rules computed from the last {s?.n_days ?? '—'} days of usage (sales, items used in sold boxes, and production). Change ordering cost, holding cost, service level or the review interval in <Link to="/settings" className="font-medium text-gold-800 hover:underline">Settings</Link> and every number here recalculates.</>} />
      <ErrorNote error={q.error} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-zinc-300 bg-white p-0.5 text-sm">
          {([['rop', 'Reorder point (continuous)'], ['periodic', `Periodic review (every ${s?.review_days ?? '—'} days)`]] as [Mode, string][]).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)} className={cx('rounded px-3 py-1.5', mode === m ? 'bg-zinc-900 font-medium text-white' : 'text-zinc-700 hover:text-zinc-900')}>{label}</button>
          ))}
        </div>
        <div className="inline-flex rounded-md border border-zinc-300 bg-white p-0.5 text-sm">
          {([['now', mode === 'rop' ? `Order now (${all.filter((r) => r.below_rop).length})` : `Needs an order (${all.filter((r) => r.periodic_qty > 0).length})`],
            ...(mode === 'rop' ? [['week', `Order within 7 days (${all.filter((r) => r.below_rop || (r.order_by != null && r.order_by <= soon)).length})`]] : []),
            ['all', `All items (${all.length})`]] as [Filter, string][]).map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)} className={cx('rounded px-3 py-1.5', filter === f ? 'bg-gold-100 font-medium text-gold-800' : 'text-zinc-700 hover:text-zinc-900')}>{label}</button>
          ))}
        </div>
      </div>

      <Card title={mode === 'rop' ? 'Orders to place now' : 'Orders from this review'} className="mb-4">
        {toOrder.length === 0 ? <p className="text-sm text-zinc-600">Nothing to order right now.</p> : (
          <ul className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
            {[...bySupplier].map(([sid, list]) => (
              <li key={sid} className="flex items-center justify-between gap-2">
                <span className="min-w-0"><span className="font-medium">{list[0].supplier_name}</span><span className="block truncate text-xs text-zinc-600">{list.map((r) => `${qty(suggest(r))} ${r.name}`).join(', ')}</span></span>
                <Button size="sm" onClick={() => setPo({ supplierId: sid, lines: list.map((r) => ({ item_id: r.item_id, qty: suggest(r) })) })}><ShoppingCart className="size-3.5" />Create PO</Button>
              </li>
            ))}
            {toMake.map((r) => <MakeRow key={r.item_id} r={r} qty={suggest(r)} />)}
          </ul>
        )}
      </Card>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.item_id} onRowClick={(r) => setPicked(r.item_id)} dense
        empty={mode === 'rop' ? 'Nothing is at or below its reorder point. Try "Order within 7 days" or "All items".' : 'Every item is at or above its order-up-to level.'} />
      <p className="mt-2 text-xs text-zinc-600">Click an item to see how its numbers were calculated.</p>
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
      <Button size="sm" busy={busy} onClick={make}><Factory className="size-3.5" />Create work order</Button>
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
