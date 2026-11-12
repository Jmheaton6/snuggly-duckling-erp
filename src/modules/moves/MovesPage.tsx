import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ClipboardCheck, PackageSearch } from 'lucide-react'
import { must, rpc, supabase } from '../../lib/supabase'
import { findByCode, useItems, useLocations } from '../../lib/queries'
import { dateTime, money, qty } from '../../lib/format'
import { useToast } from '../../lib/toast'
import type { ItemOverview } from '../../lib/types'
import { ScanInput } from '../../components/ScanInput'
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, cx } from '../../components/ui'

type Reason = { code: string; label: string; applies_to: string; is_quality: boolean }
type Transfer = { id: number; ts: string; item_id: number; from_location_id: number; to_location_id: number; qty: number; note: string | null }
type Adjustment = { id: number; ts: string; item_id: number; location_id: number; qty_before: number; qty_after: number; delta: number; unit_cost: number | null; reason_code: string; note: string | null }

export function MovesPage() {
  const { data: items } = useItems()
  const toast = useToast()
  const [itemId, setItemId] = useState<number | null>(null)
  const item = items?.find((i) => i.id === itemId)

  function onScan(code: string) {
    const found = findByCode(items, code)
    if (!found) toast(`No item has barcode ${code}`, 'error')
    else setItemId(found.id)
  }

  return (
    <>
      <PageHeader title="Transfers & counts"
        description="Move stock between locations, record cycle counts, and write off damaged or expired stock with a reason code. Every change is a ledger entry; write-offs also post to Inventory Shrink." />
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <Field label="Scan a label to pick the item">
            <ScanInput onScan={onScan} autoFocus />
          </Field>
          <Field label="…or choose it">
            <Select value={itemId ?? ''} onChange={(e) => setItemId(e.target.value ? Number(e.target.value) : null)} className="h-10">
              <option value="">Choose an item…</option>
              {(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}
            </Select>
          </Field>
        </div>
        {item && <StockStrip item={item} />}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <TransferForm item={item} />
        <AdjustForm item={item} />
      </div>
      <RecentActivity />
    </>
  )
}

function StockStrip({ item }: { item: ItemOverview }) {
  const { data: locations } = useLocations()
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm">
      <PackageSearch className="size-4 text-gray-400" />
      <span className="font-medium">{item.name}</span>
      <span className="text-gray-400">·</span>
      {(locations ?? []).map((l) => (
        <span key={l.id} className="text-gray-600">{l.name}: <b className="num text-gray-900">{qty(item.by_location[l.code] ?? 0, item.uom)}</b></span>
      ))}
    </div>
  )
}

function TransferForm({ item }: { item: ItemOverview | undefined }) {
  const { data: locations } = useLocations()
  const qc = useQueryClient()
  const toast = useToast()
  const [from, setFrom] = useState('3')
  const [to, setTo] = useState('1')
  const [n, setN] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const code = (id: string) => locations?.find((l) => l.id === Number(id))?.code ?? ''
  const have = item ? item.by_location[code(from)] ?? 0 : 0

  async function submit() {
    if (!item) return
    setBusy(true); setError(null)
    try {
      await rpc('transfer_stock', { p_item_id: item.id, p_from_location_id: Number(from), p_to_location_id: Number(to), p_qty: Number(n), p_note: note || null })
      await qc.invalidateQueries()
      toast(`Moved ${n} ${item.name}`)
      setN(''); setNote('')
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  return (
    <Card title={<span className="flex items-center gap-2"><ArrowRight className="size-4 text-gray-400" />Transfer between locations</span>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From"><Select value={from} onChange={(e) => setFrom(e.target.value)}>{(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="To"><Select value={to} onChange={(e) => setTo(e.target.value)}>{(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Quantity" hint={item ? `${qty(have, item.uom)} on hand at the source` : 'Pick an item first'}>
          <Input type="number" min="0" step="any" value={n} onChange={(e) => setN(e.target.value)} />
        </Field>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Weekend restock" /></Field>
      </div>
      {from === to && <p className="mt-2 text-xs text-red-600">Pick two different locations.</p>}
      <div className="mt-3"><ErrorNote error={error} /></div>
      <Button className="mt-3" variant="primary" busy={busy} disabled={!item || !Number(n) || from === to} onClick={submit}>Transfer</Button>
    </Card>
  )
}

function AdjustForm({ item }: { item: ItemOverview | undefined }) {
  const { data: locations } = useLocations()
  const qc = useQueryClient()
  const toast = useToast()
  const reasons = useQuery({ queryKey: ['reason_codes'], queryFn: () => must(supabase.from('reason_codes').select('*').eq('applies_to', 'adjust').neq('code', 'OPENING')) as Promise<Reason[]>, staleTime: Infinity })
  const [loc, setLoc] = useState('1')
  const [mode, setMode] = useState<'count' | 'change'>('count')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('COUNT')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const code = locations?.find((l) => l.id === Number(loc))?.code ?? ''
  const system = item ? item.by_location[code] ?? 0 : 0
  const delta = value === '' ? null : mode === 'count' ? Number(value) - system : Number(value)

  async function submit() {
    if (!item || delta == null) return
    setBusy(true); setError(null)
    try {
      await rpc('adjust_stock', {
        p_item_id: item.id, p_location_id: Number(loc), p_reason_code: reason, p_note: note || null,
        ...(mode === 'count' ? { p_new_qty: Number(value) } : { p_delta: Number(value) }),
      })
      await qc.invalidateQueries()
      toast(delta === 0 ? `Count confirmed: ${item.name} matches the system` : `Adjusted ${item.name} by ${delta > 0 ? '+' : ''}${delta}`)
      setValue(''); setNote('')
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  return (
    <Card title={<span className="flex items-center gap-2"><ClipboardCheck className="size-4 text-gray-400" />Cycle count / adjustment</span>}>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-1 text-sm">
        {(['count', 'change'] as const).map((m) => (
          <button key={m} onClick={() => { setMode(m); setReason(m === 'count' ? 'COUNT' : 'DAMAGED'); setValue('') }}
            className={cx('rounded px-2 py-1.5', mode === m ? 'bg-white font-medium shadow-xs' : 'text-gray-600')}>
            {m === 'count' ? 'Enter counted quantity' : 'Enter a change (+/−)'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Location"><Select value={loc} onChange={(e) => setLoc(e.target.value)}>{(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Reason code">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {(reasons.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </Select>
        </Field>
        <Field label={mode === 'count' ? 'Counted on the shelf' : 'Change (negative removes stock)'} hint={item ? `System says ${qty(system, item.uom)}` : 'Pick an item first'}>
          <Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      {item && delta != null && (
        <p className={cx('mt-3 text-sm', delta < 0 ? 'text-red-700' : delta > 0 ? 'text-emerald-700' : 'text-gray-600')}>
          {delta === 0 ? 'No variance: this records a confirmed count.' : `Variance ${delta > 0 ? '+' : ''}${qty(delta)} → ${money(Math.abs(delta) * item.avg_cost)} ${delta < 0 ? 'written off to Inventory Shrink' : 'added back to inventory'} at average cost.`}
        </p>
      )}
      <div className="mt-3"><ErrorNote error={error} /></div>
      <Button className="mt-3" variant="primary" busy={busy} disabled={!item || delta == null} onClick={submit}>Record</Button>
    </Card>
  )
}

function RecentActivity() {
  const { data: items } = useItems()
  const { data: locations } = useLocations()
  const q = useQuery({
    queryKey: ['transfers', 'adjustments', 'recent'],
    queryFn: async () => {
      const [t, a] = await Promise.all([
        must(supabase.from('transfers').select('*').order('id', { ascending: false }).limit(30)) as Promise<Transfer[]>,
        must(supabase.from('adjustments').select('*').order('id', { ascending: false }).limit(30)) as Promise<Adjustment[]>,
      ])
      return [...t.map((x) => ({ kind: 'transfer' as const, ts: x.ts, x })), ...a.map((x) => ({ kind: 'adjust' as const, ts: x.ts, x }))]
        .sort((p, r) => r.ts.localeCompare(p.ts)).slice(0, 40)
    },
  })
  const name = (id: number) => items?.find((i) => i.id === id)?.name ?? `#${id}`
  const loc = (id: number) => locations?.find((l) => l.id === id)?.name ?? `#${id}`
  return (
    <Card title="Recent transfers and adjustments" className="mt-4" padded={false}>
      <ErrorNote error={q.error} />
      <table className="w-full text-sm">
        <thead><tr className="border-b border-gray-200 bg-gray-50/80 text-left text-xs text-gray-600"><th className="px-4 py-2">When</th><th>Type</th><th>Item</th><th>Where</th><th className="text-right">Qty</th><th className="px-4">Reason / note</th></tr></thead>
        <tbody className="divide-y divide-gray-100">
          {(q.data ?? []).map((r) => (
            <tr key={r.kind + r.x.id}>
              <td className="px-4 py-2 whitespace-nowrap text-gray-600">{dateTime(r.ts)}</td>
              <td>{r.kind === 'transfer' ? <Badge tone="blue">Transfer</Badge> : <Badge tone={r.x.delta < 0 ? 'red' : r.x.delta > 0 ? 'green' : 'gray'}>{r.x.delta === 0 ? 'Count OK' : 'Adjustment'}</Badge>}</td>
              <td>{name(r.x.item_id)}</td>
              <td className="text-gray-600">{r.kind === 'transfer' ? `${loc(r.x.from_location_id)} → ${loc(r.x.to_location_id)}` : loc(r.x.location_id)}</td>
              <td className="num text-right">{r.kind === 'transfer' ? qty(r.x.qty) : `${r.x.delta > 0 ? '+' : ''}${qty(r.x.delta)}`}</td>
              <td className="px-4 text-gray-600">{r.kind === 'adjust' ? r.x.reason_code : ''}{r.x.note ? ` · ${r.x.note}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
