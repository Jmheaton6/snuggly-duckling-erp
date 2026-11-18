import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Play, Plus, X } from 'lucide-react'
import { must, rpc, supabase } from '../../lib/supabase'
import { useBoms, useItems, useLocations } from '../../lib/queries'
import { addDays, date, dateTime, docNo, money, pct, qty, today } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { DataTable, type Column } from '../../components/DataTable'
import { Badge, Button, Card, Drawer, ErrorNote, Field, Input, Kpi, MathNote, Modal, PageHeader, Select, Spinner, cx, type Tone } from '../../components/ui'

type Wo = {
  id: number; item_id: number; location_id: number; status: 'planned' | 'in_progress' | 'completed' | 'cancelled'
  qty_planned: number; qty_started: number | null; qty_good: number | null; qty_scrapped: number | null; qty_reworked: number | null
  reason_code: string | null; due_date: string | null; started_at: string | null; finished_at: string | null
  material_cost: number | null; unit_cost: number | null; created_at: string; note: string | null
  items: { name: string; sku: string; uom: string }; locations: { name: string; code: string }
}
type Reason = { code: string; label: string }

const STATUS: Record<Wo['status'], { label: string; tone: Tone }> = {
  planned: { label: 'Planned', tone: 'gray' },
  in_progress: { label: 'In progress', tone: 'yellow' },
  completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
}
const TABS = ['planned', 'in_progress', 'completed', 'cancelled', ''] as const
const localDay = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
// datetime-local inputs work in the browser's own time zone.
const nowLocal = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16) }
const n = (v: unknown) => Number(v ?? 0)

// Metrics for one completed work order (and, summed, for the report).
const minutes = (w: Wo) => (w.started_at && w.finished_at ? (Date.parse(w.finished_at) - Date.parse(w.started_at)) / 6e4 : 0)
const onTime = (w: Wo) => !!w.finished_at && !!w.due_date && localDay(w.finished_at) <= w.due_date

function useWorkOrders() {
  return useQuery({
    queryKey: ['production_orders', 'list'],
    queryFn: () => must(supabase.from('production_orders').select('*, items(name, sku, uom), locations(name, code)').order('id', { ascending: false })) as Promise<Wo[]>,
  })
}
function useScrapReasons() {
  return useQuery({ queryKey: ['reason_codes', 'scrap'], queryFn: () => must(supabase.from('reason_codes').select('code, label').eq('applies_to', 'scrap').order('label')) as Promise<Reason[]>, staleTime: 60_000 })
}

export function ProductionPage() {
  const [view, setView] = useState<'orders' | 'report'>('orders')
  const [tab, setTab] = useState<(typeof TABS)[number]>('planned')
  const [open, setOpen] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const wos = useWorkOrders()
  const rows = (wos.data ?? []).filter((w) => !tab || w.status === tab)

  const columns: Column<Wo>[] = [
    { key: 'id', header: 'Work order', render: (w) => <span className="font-medium">{docNo('production', w.id)}</span> },
    { key: 'item', header: 'Item', value: (w) => w.items.name, render: (w) => w.items.name },
    { key: 'location', header: 'Location', value: (w) => w.locations.name, render: (w) => w.locations.name },
    { key: 'qty', header: 'Qty', align: 'right', value: (w) => n(w.qty_started ?? w.qty_planned), render: (w) => qty(n(w.qty_started ?? w.qty_planned)) },
    { key: 'due_date', header: 'Due', render: (w) => <span className="flex items-center gap-1.5">{date(w.due_date)}{(w.status === 'planned' || w.status === 'in_progress') && w.due_date && w.due_date < today() && <Badge tone="red">Late</Badge>}</span> },
    { key: 'good', header: 'Good / scrap', align: 'right', value: (w) => n(w.qty_good), render: (w) => w.status === 'completed' ? <span>{qty(n(w.qty_good))} <span className="text-zinc-500">/</span> <span className={n(w.qty_scrapped) ? 'text-red-700' : 'text-zinc-600'}>{qty(n(w.qty_scrapped))}</span></span> : <span className="text-zinc-500">—</span> },
    { key: 'yield', header: 'Yield', align: 'right', value: (w) => (w.qty_started ? n(w.qty_good) / n(w.qty_started) : null), render: (w) => (w.status === 'completed' ? pct(n(w.qty_good) / n(w.qty_started), 1) : <span className="text-zinc-500">—</span>) },
    { key: 'finished_at', header: 'Finished', render: (w) => (w.finished_at ? dateTime(w.finished_at) : <span className="text-zinc-500">—</span>) },
    { key: 'status', header: 'Status', render: (w) => <Badge tone={STATUS[w.status].tone}>{STATUS[w.status].label}</Badge> },
  ]

  return (
    <>
      <PageHeader title="Production"
        description="Work orders for everything made or packed in-house. Starting one issues its components from stock per the bill of materials; completing it puts the good units on the shelf at the cost of the components used."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" />New work order</Button>} />
      <ErrorNote error={wos.error} />
      <div className="mb-4 inline-flex rounded-md border border-zinc-300 bg-white p-0.5 text-sm">
        {([['orders', 'Work orders'], ['report', 'Production report']] as const).map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} className={cx('rounded px-3 py-1.5', view === v ? 'bg-zinc-900 font-medium text-white' : 'text-zinc-700 hover:text-zinc-900')}>{label}</button>
        ))}
      </div>
      {wos.isLoading ? <Spinner /> : view === 'report' ? <Report wos={wos.data ?? []} onOpen={setOpen} /> : (
        <>
          <div className="mb-3 flex gap-1 border-b border-zinc-200">
            {TABS.map((t) => (
              <button key={t || 'all'} onClick={() => setTab(t)}
                className={cx('-mb-px border-b-2 px-3 py-2 text-sm', tab === t ? 'border-gold-500 font-medium text-zinc-900' : 'border-transparent text-zinc-600 hover:text-zinc-800')}>
                {t ? STATUS[t].label : 'All'} <span className="text-xs text-zinc-500">{(wos.data ?? []).filter((w) => !t || w.status === t).length}</span>
              </button>
            ))}
          </div>
          <DataTable rows={rows} columns={columns} rowKey={(w) => w.id} onRowClick={(w) => setOpen(w.id)} search dense searchPlaceholder="Search work orders, items…" />
        </>
      )}
      {open != null && <WoDrawer wo={wos.data?.find((w) => w.id === open)} onClose={() => setOpen(null)} />}
      <NewWoModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setView('orders'); setTab('planned'); setOpen(id) }} />
    </>
  )
}

function WoDrawer({ wo, onClose }: { wo: Wo | undefined; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: boms } = useBoms()
  const { data: items } = useItems()
  const reasons = useScrapReasons()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [starting, setStarting] = useState(false)
  const [completing, setCompleting] = useState(false)
  if (!wo) return null
  const units = n(wo.qty_started ?? wo.qty_planned)
  const lines = (boms ?? []).filter((b) => b.parent_id === wo.item_id).map((b) => {
    const comp = items?.find((i) => i.id === b.component_id)
    return { ...b, comp, need: units * n(b.qty_per), have: comp?.by_location[wo.locations.code] ?? 0 }
  })
  const short = wo.status === 'planned' && lines.some((l) => l.need > l.have)
  const steps = ['planned', 'in_progress', 'completed'] as const
  const reached = steps.indexOf(wo.status as (typeof steps)[number])

  async function cancel() {
    setBusy('cancel'); setError(null)
    try { await rpc('cancel_production_order', { p_id: wo!.id }); await qc.invalidateQueries(); toast('Work order cancelled') } catch (e) { setError(e) } finally { setBusy(null) }
  }

  return (
    <Drawer open onClose={onClose} title={`${docNo('production', wo.id)} · ${wo.items.name}`}
      subtitle={<>{qty(n(wo.qty_planned))} planned at {wo.locations.name} · due {date(wo.due_date)}{wo.note ? ` · ${wo.note}` : ''}</>}>
      <ol className="mb-5 flex items-center gap-2 text-xs">
        {wo.status === 'cancelled' ? <Badge tone="gray">Cancelled</Badge> : steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={cx('flex size-5 items-center justify-center rounded-full text-[10px] font-bold', i <= reached ? 'bg-zinc-900 text-white' : 'bg-zinc-200 text-zinc-600')}>{i + 1}</span>
            <span className={i <= reached ? 'font-medium' : 'text-zinc-600'}>{STATUS[s].label}</span>
            {i < 2 && <span className="h-px w-6 bg-zinc-300" />}
          </li>
        ))}
      </ol>

      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-600">Bill of materials × {qty(units)} {wo.status === 'planned' ? 'planned' : 'started'}</p>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-zinc-200 text-left text-xs text-zinc-600">
          <th className="py-1.5">Component</th><th className="text-right">Per unit</th><th className="text-right">{wo.status === 'planned' ? 'Needed' : 'Issued'}</th>
          {wo.status === 'planned' && <th className="text-right">On hand at {wo.locations.name}</th>}
        </tr></thead>
        <tbody className="divide-y divide-zinc-100">
          {lines.map((l) => (
            <tr key={l.component_id}>
              <td className="py-1.5">{l.comp?.name}</td>
              <td className="num text-right">{qty(n(l.qty_per), l.comp?.uom)}</td>
              <td className="num text-right">{qty(Math.round(l.need * 1000) / 1000, l.comp?.uom)}</td>
              {wo.status === 'planned' && <td className={cx('num text-right', l.need > l.have && 'font-semibold text-red-700')}>{qty(l.have, l.comp?.uom)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {wo.status !== 'planned' && wo.status !== 'cancelled' && (
        <dl className="mt-5 grid grid-cols-2 gap-3 rounded-md bg-zinc-50 p-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-zinc-600">Started</dt><dd className="font-medium">{wo.started_at && dateTime(wo.started_at)}</dd></div>
          <div><dt className="text-xs text-zinc-600">Material issued</dt><dd className="font-medium">{money(n(wo.material_cost))}</dd></div>
          <div><dt className="text-xs text-zinc-600">Material per unit started</dt><dd className="font-medium">{money(n(wo.material_cost) / units)}</dd></div>
          {wo.status === 'completed' && <>
            <div><dt className="text-xs text-zinc-600">Finished</dt><dd className="font-medium">{wo.finished_at && dateTime(wo.finished_at)} {onTime(wo) ? <Badge tone="green">On time</Badge> : <Badge tone="red">Late</Badge>}</dd></div>
            <div><dt className="text-xs text-zinc-600">Good / scrapped / reworked</dt><dd className="font-medium">{qty(n(wo.qty_good))} / {qty(n(wo.qty_scrapped))} / {qty(n(wo.qty_reworked))}</dd></div>
            <div><dt className="text-xs text-zinc-600">Reason</dt><dd className="font-medium">{reasons.data?.find((r) => r.code === wo.reason_code)?.label ?? '—'}</dd></div>
          </>}
        </dl>
      )}
      {wo.status === 'completed' && (
        <div className="mt-4"><MathNote title="This work order" lines={[
          ['Yield', `${qty(n(wo.qty_good))} good ÷ ${qty(units)} started = ${pct(n(wo.qty_good) / units, 1)}`],
          ['First-pass yield', `(${qty(n(wo.qty_good))} − ${qty(n(wo.qty_reworked))} reworked) ÷ ${qty(units)} = ${pct((n(wo.qty_good) - n(wo.qty_reworked)) / units, 1)}`],
          ['Cycle time', `${(minutes(wo) / 60).toFixed(1)} hours start to finish · ${Math.round(minutes(wo))} min ÷ ${qty(units)} started = ${(minutes(wo) / units).toFixed(1)} min per unit`],
          ['Unit cost (rolled up)', `${money(n(wo.material_cost))} material ÷ ${qty(units)} started = ${money(n(wo.unit_cost))}`],
          ['Scrap cost', `${qty(n(wo.qty_scrapped))} × ${money(n(wo.unit_cost))} = ${money(n(wo.qty_scrapped) * n(wo.unit_cost))} → Production Scrap`],
        ]} /></div>
      )}

      <div className="mt-5 space-y-3">
        <ErrorNote error={error} />
        {short && <p className="text-sm text-red-700">Not enough components at {wo.locations.name} to start all {qty(units)}. Start fewer, or move stock there first.</p>}
        <div className="flex flex-wrap gap-2">
          {wo.status === 'planned' && <>
            <Button variant="primary" onClick={() => setStarting(true)}><Play className="size-4" />Start (issue components)</Button>
            <Button variant="ghost" busy={busy === 'cancel'} onClick={cancel}><X className="size-4" />Cancel work order</Button>
          </>}
          {wo.status === 'in_progress' && <Button variant="primary" onClick={() => setCompleting(true)}><Check className="size-4" />Complete</Button>}
        </div>
      </div>
      {starting && <StartModal wo={wo} onClose={() => setStarting(false)} />}
      {completing && <CompleteModal wo={wo} reasons={reasons.data ?? []} onClose={() => setCompleting(false)} />}
    </Drawer>
  )
}

function StartModal({ wo, onClose }: { wo: Wo; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [started, setStarted] = useState(String(n(wo.qty_planned)))
  const [at, setAt] = useState(nowLocal())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  async function save() {
    setBusy(true); setError(null)
    try {
      await rpc('start_production_order', { p_id: wo.id, p_qty_started: Number(started), p_ts: new Date(at).toISOString() })
      await qc.invalidateQueries()
      toast(`${docNo('production', wo.id)} started: components issued from ${wo.locations.name}`)
      onClose()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Start ${docNo('production', wo.id)}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!(Number(started) > 0)} onClick={save}><Play className="size-4" />Start</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quantity started" hint={`Planned ${qty(n(wo.qty_planned))}`}><Input type="number" min="1" step="any" value={started} onChange={(e) => setStarted(e.target.value)} /></Field>
        <Field label="Start time" hint="When work actually began"><Input type="datetime-local" value={at} max={nowLocal()} onChange={(e) => setAt(e.target.value)} /></Field>
        <p className="text-sm text-zinc-700 sm:col-span-2">Starting issues each component (quantity started × quantity per unit) out of {wo.locations.name} and moves its cost into Work in Process.</p>
        <div className="sm:col-span-2"><ErrorNote error={error} /></div>
      </div>
    </Modal>
  )
}

function CompleteModal({ wo, reasons, onClose }: { wo: Wo; reasons: Reason[]; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const started = n(wo.qty_started)
  const [good, setGood] = useState(String(started))
  const [reworked, setReworked] = useState('0')
  const [reason, setReason] = useState('')
  const [at, setAt] = useState(nowLocal())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const scrapped = Math.max(0, started - Number(good || 0))
  const needsReason = scrapped > 0 || Number(reworked) > 0
  const valid = Number(good) >= 0 && Number(good) <= started && Number(reworked) >= 0 && Number(reworked) <= Number(good) && (!needsReason || !!reason)
  const mins = (Date.parse(new Date(at).toISOString()) - Date.parse(wo.started_at!)) / 6e4

  async function save() {
    setBusy(true); setError(null)
    try {
      await rpc('complete_production_order', { p_id: wo.id, p_qty_good: Number(good), p_qty_scrapped: scrapped, p_qty_reworked: Number(reworked), p_reason_code: needsReason ? reason : null, p_ts: new Date(at).toISOString() })
      await qc.invalidateQueries()
      toast(`${docNo('production', wo.id)} completed: ${qty(Number(good))} ${wo.items.name} added to ${wo.locations.name}`)
      onClose()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Complete ${docNo('production', wo.id)}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!valid} onClick={save}><Check className="size-4" />Complete</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Good units" hint={`of ${qty(started)} started`}><Input type="number" min="0" max={started} step="any" value={good} onChange={(e) => setGood(e.target.value)} /></Field>
        <Field label="Scrapped" hint="started − good"><p className={cx('num flex h-9 items-center text-sm font-semibold', scrapped > 0 && 'text-red-700')}>{qty(scrapped)}</p></Field>
        <Field label="Reworked" hint="fixed, counted as good"><Input type="number" min="0" step="any" value={reworked} onChange={(e) => setReworked(e.target.value)} /></Field>
        <Field label="Quality reason" className="sm:col-span-2" hint={needsReason ? 'Required when anything is scrapped or reworked' : 'Only needed for scrap or rework'}>
          <Select value={reason} disabled={!needsReason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose…</option>
            {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </Select>
        </Field>
        <Field label="Finish time" hint={mins > 0 ? `${Math.round(mins)} min after start` : 'Must be after the start'}><Input type="datetime-local" value={at} max={nowLocal()} onChange={(e) => setAt(e.target.value)} /></Field>
        <p className="text-sm text-zinc-700 sm:col-span-3">Good units go on the shelf at {money(n(wo.material_cost) / started)} each (material ÷ units started). The scrapped units' cost is written off to Production Scrap.</p>
        <div className="sm:col-span-3"><ErrorNote error={error} /></div>
      </div>
    </Modal>
  )
}

function NewWoModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const { data: items } = useItems()
  const { data: boms } = useBoms()
  const { data: locations } = useLocations()
  const qc = useQueryClient()
  const toast = useToast()
  const [itemId, setItemId] = useState('')
  const [units, setUnits] = useState('24')
  const [loc, setLoc] = useState('')
  const [due, setDue] = useState(addDays(today(), 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const makeable = (items ?? []).filter((i) => i.active && i.has_bom)
  const location = locations?.find((l) => l.id === Number(loc)) ?? locations?.find((l) => l.kind === 'warehouse')
  const lines = (boms ?? []).filter((b) => b.parent_id === Number(itemId)).map((b) => {
    const comp = items?.find((i) => i.id === b.component_id)
    return { ...b, comp, need: Number(units || 0) * n(b.qty_per), have: location ? comp?.by_location[location.code] ?? 0 : 0 }
  })

  async function save() {
    setBusy(true); setError(null)
    try {
      const id = await rpc<number>('create_production_order', { p_item_id: Number(itemId), p_qty: Number(units), p_location_id: location?.id, p_due_date: due })
      await qc.invalidateQueries()
      toast(`${docNo('production', id)} created`)
      setItemId('')
      onCreated(id)
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="New work order" wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!itemId || !(Number(units) > 0)} onClick={save}>Create work order</Button></>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Item to make or pack" className="sm:col-span-2">
          <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Choose…</option>
            {makeable.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </Field>
        <Field label="Quantity"><Input type="number" min="1" step="any" value={units} onChange={(e) => setUnits(e.target.value)} /></Field>
        <Field label="Due date"><Input type="date" min={today()} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Location" className="sm:col-span-2">
          <Select value={location?.id ?? ''} onChange={(e) => setLoc(e.target.value)}>
            {(locations ?? []).filter((l) => l.kind !== 'hold').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
      </div>
      {lines.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead><tr className="border-b border-zinc-200 text-left text-xs text-zinc-600"><th className="py-1.5">Component</th><th className="text-right">Per unit</th><th className="text-right">Needed</th><th className="text-right">On hand at {location?.name}</th></tr></thead>
          <tbody className="divide-y divide-zinc-100">
            {lines.map((l) => (
              <tr key={l.component_id}>
                <td className="py-1.5">{l.comp?.name}</td>
                <td className="num text-right">{qty(n(l.qty_per), l.comp?.uom)}</td>
                <td className="num text-right">{qty(Math.round(l.need * 1000) / 1000, l.comp?.uom)}</td>
                <td className={cx('num text-right', l.need > l.have && 'font-semibold text-red-700')}>{qty(l.have, l.comp?.uom)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3"><ErrorNote error={error} /></div>
    </Modal>
  )
}

// Production report: completed work orders that finished in a date range.
function Report({ wos, onOpen }: { wos: Wo[]; onOpen: (id: number) => void }) {
  const reasons = useScrapReasons()
  const [from, setFrom] = useState(addDays(today(), -30))
  const [to, setTo] = useState(today())
  const done = wos.filter((w) => w.status === 'completed' && w.finished_at && localDay(w.finished_at) >= from && localDay(w.finished_at) <= to)
  const sum = (f: (w: Wo) => number, list = done) => list.reduce((s, w) => s + f(w), 0)
  const started = sum((w) => n(w.qty_started)), good = sum((w) => n(w.qty_good)), scrap = sum((w) => n(w.qty_scrapped)), rework = sum((w) => n(w.qty_reworked))
  const mins = sum(minutes)
  const late = done.filter((w) => !onTime(w)).length
  const scrapCost = sum((w) => n(w.qty_scrapped) * n(w.unit_cost))

  const byItem = [...new Set(done.map((w) => w.item_id))].map((id) => {
    const list = done.filter((w) => w.item_id === id)
    const s = sum((w) => n(w.qty_started), list)
    return {
      id, name: list[0].items.name, orders: list.length, started: s, good: sum((w) => n(w.qty_good), list),
      scrap: sum((w) => n(w.qty_scrapped), list), rework: sum((w) => n(w.qty_reworked), list),
      minPerUnit: sum(minutes, list) / s, hours: sum(minutes, list) / list.length / 60, onTime: list.filter(onTime).length / list.length,
      scrapCost: sum((w) => n(w.qty_scrapped) * n(w.unit_cost), list),
    }
  })
  const byReason = [...new Set(done.filter((w) => w.reason_code).map((w) => w.reason_code!))].map((code) => {
    const list = done.filter((w) => w.reason_code === code)
    return { code, label: reasons.data?.find((r) => r.code === code)?.label ?? code, orders: list.length, scrap: sum((w) => n(w.qty_scrapped), list), rework: sum((w) => n(w.qty_reworked), list) }
  }).sort((a, b) => b.scrap - a.scrap)
  type ItemRow = (typeof byItem)[number]

  const itemCols: Column<ItemRow>[] = [
    { key: 'name', header: 'Item', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'orders', header: 'Orders', align: 'right' },
    { key: 'started', header: 'Started', align: 'right', render: (r) => qty(r.started) },
    { key: 'good', header: 'Good', align: 'right', render: (r) => qty(r.good) },
    { key: 'yield', header: 'Yield', align: 'right', value: (r) => r.good / r.started, render: (r) => pct(r.good / r.started, 1) },
    { key: 'fpy', header: 'First-pass', align: 'right', value: (r) => (r.good - r.rework) / r.started, render: (r) => pct((r.good - r.rework) / r.started, 1) },
    { key: 'scrap', header: 'Scrap rate', align: 'right', value: (r) => r.scrap / r.started, render: (r) => pct(r.scrap / r.started, 1) },
    { key: 'hours', header: 'Hours / order', align: 'right', render: (r) => r.hours.toFixed(1) },
    { key: 'minPerUnit', header: 'Min / unit', align: 'right', render: (r) => r.minPerUnit.toFixed(1) },
    { key: 'onTime', header: 'On time', align: 'right', render: (r) => pct(r.onTime) },
    { key: 'scrapCost', header: 'Scrap cost', align: 'right', render: (r) => money(r.scrapCost) },
  ]
  const woCols: Column<Wo>[] = [
    { key: 'id', header: 'Work order', render: (w) => <span className="font-medium">{docNo('production', w.id)}</span> },
    { key: 'item', header: 'Item', value: (w) => w.items.name, render: (w) => w.items.name },
    { key: 'finished_at', header: 'Finished', render: (w) => dateTime(w.finished_at!) },
    { key: 'started', header: 'Started', align: 'right', value: (w) => n(w.qty_started), render: (w) => qty(n(w.qty_started)) },
    { key: 'good', header: 'Good', align: 'right', value: (w) => n(w.qty_good), render: (w) => qty(n(w.qty_good)) },
    { key: 'scrap', header: 'Scrap', align: 'right', value: (w) => n(w.qty_scrapped), render: (w) => qty(n(w.qty_scrapped)) },
    { key: 'rework', header: 'Rework', align: 'right', value: (w) => n(w.qty_reworked), render: (w) => qty(n(w.qty_reworked)) },
    { key: 'reason', header: 'Reason', value: (w) => w.reason_code, render: (w) => reasons.data?.find((r) => r.code === w.reason_code)?.label ?? '' },
    { key: 'cycle', header: 'Minutes', align: 'right', value: minutes, render: (w) => Math.round(minutes(w)) },
    { key: 'ontime', header: 'On time', value: (w) => (onTime(w) ? 1 : 0), render: (w) => (onTime(w) ? <Badge tone="green">Yes</Badge> : <Badge tone="red">Late</Badge>) },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Finished from"><Input type="date" className="w-44" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="to"><Input type="date" className="w-44" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="flex gap-1 pb-0.5">
          {[7, 30, 90].map((d) => <Button key={d} size="sm" variant="ghost" onClick={() => { setFrom(addDays(today(), -d)); setTo(today()) }}>Last {d} days</Button>)}
        </div>
      </div>
      {done.length === 0 ? <Card><p className="text-sm text-zinc-600">No work orders finished in this range.</p></Card> : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Yield" value={pct(good / started, 1)} sub={`${qty(good)} good of ${qty(started)} started`} />
          <Kpi label="First-pass yield" value={pct((good - rework) / started, 1)} sub={`${qty(rework)} reworked before passing`} />
          <Kpi label="Scrap rate" value={pct(scrap / started, 1)} sub={`${qty(scrap)} units · ${money(scrapCost)} written off`} />
          <Kpi label="Cycle time" value={`${(mins / done.length / 60).toFixed(1)} h`} sub={`per work order · ${(mins / started).toFixed(1)} min per unit`} />
          <Kpi label="On-time completion" value={pct((done.length - late) / done.length)} sub={`${done.length - late} of ${done.length} finished by the due date`} tone={late / done.length > 0.1 ? 'bad' : 'good'} />
        </div>
        <MathNote title="How these are calculated (completed work orders that finished in the range)" lines={[
          ['Yield', 'good ÷ started'],
          ['First-pass yield', '(good − reworked) ÷ started: units that were right the first time'],
          ['Scrap rate', 'scrapped ÷ started; scrap cost = scrapped × unit cost'],
          ['Cycle time', 'start-to-finish time per work order; per unit = total minutes ÷ units started'],
          ['On-time completion', 'finished on or before the due date ÷ work orders'],
        ]} />
        <Card title="By item" padded={false}><DataTable rows={byItem} columns={itemCols} rowKey={(r) => r.id} dense /></Card>
        {byReason.length > 0 && (
          <Card title="Scrap and rework by reason">
            <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {byReason.map((r) => (
                <li key={r.code} className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2">
                  <span>{r.label}<span className="block text-xs text-zinc-600">{r.orders} work order{r.orders === 1 ? '' : 's'}</span></span>
                  <span className="num text-right text-sm">{qty(r.scrap)} scrapped<span className="block text-xs text-zinc-600">{qty(r.rework)} reworked</span></span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card title={`Work orders finished ${date(from)} – ${date(to)}`} padded={false}>
          <DataTable rows={done} columns={woCols} rowKey={(w) => w.id} onRowClick={(w) => onOpen(w.id)} dense search />
        </Card>
      </>}
    </div>
  )
}
