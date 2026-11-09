import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { must, supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useBoms, useItems, useLocations, useSuppliers } from '../../lib/queries'
import { KIND_LABEL, TXN_LABEL, dateTime, money, qty } from '../../lib/format'
import { useToast } from '../../lib/toast'
import type { InventoryTxn, ItemOverview } from '../../lib/types'
import { Badge, Button, Drawer, ErrorNote, Field, Input, MathNote, Select } from '../../components/ui'

export function ItemDrawer({ itemId, onClose }: { itemId: number | null; onClose: () => void }) {
  const { data: items } = useItems()
  const { data: boms } = useBoms()
  const { data: locations } = useLocations()
  const item = items?.find((i) => i.id === itemId)
  const history = useQuery({
    enabled: !!itemId,
    queryKey: ['stock', 'txns', itemId],
    queryFn: () => must(supabase.from('inventory_txns').select('*').eq('item_id', itemId!).order('ts', { ascending: false }).limit(25)) as Promise<InventoryTxn[]>,
  })
  if (!item) return null

  const bom = (boms ?? []).filter((b) => b.parent_id === item.id)
  const usedIn = (boms ?? []).filter((b) => b.component_id === item.id)
  const byId = new Map((items ?? []).map((i) => [i.id, i]))
  const rolled = bom.reduce((s, b) => s + b.qty_per * (byId.get(b.component_id)?.avg_cost ?? 0), 0)
  const loc = (id: number) => locations?.find((l) => l.id === id)

  return (
    <Drawer open onClose={onClose} title={item.name}
      subtitle={<span className="flex items-center gap-2">{item.sku} · UPC {item.barcode} <Badge tone={item.kind === 'kit' ? 'purple' : item.kind === 'made' ? 'yellow' : item.kind === 'component' ? 'gray' : 'blue'}>{KIND_LABEL[item.kind]}</Badge></span>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="On hand" value={qty(item.on_hand, item.uom)} />
        <Stat label="On order" value={qty(item.on_order, item.uom)} />
        <Stat label="Avg cost" value={money(item.avg_cost)} />
        <Stat label="Value" value={money(item.inventory_value)} />
      </div>

      <h3 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Stock by location</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(locations ?? []).map((l) => (
          <div key={l.id} className="rounded-md border border-gray-200 px-3 py-2">
            <p className="text-xs text-gray-500">{l.name}</p>
            <p className="num font-semibold">{qty(item.by_location[l.code] ?? 0, item.uom)}</p>
          </div>
        ))}
      </div>

      {bom.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Bill of materials (per 1 {item.uom})</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">Component</th><th className="text-right">Qty per</th><th className="text-right">Avg cost</th><th className="text-right">Extended</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {bom.map((b) => {
                const c = byId.get(b.component_id)
                return (
                  <tr key={b.component_id}>
                    <td className="py-1.5">{c?.name}</td>
                    <td className="num text-right">{qty(b.qty_per, c?.uom)}</td>
                    <td className="num text-right">{money(c?.avg_cost)}</td>
                    <td className="num text-right">{money(b.qty_per * (c?.avg_cost ?? 0))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="mt-3">
            <MathNote title="Rolled-up cost from today's component averages" lines={[
              ['Σ qty per × avg cost', money(rolled)],
              ['Selling price', money(item.price)],
              ['Margin at rolled-up cost', item.price ? `${(((item.price - rolled) / item.price) * 100).toFixed(1)}%` : '—'],
            ]} />
          </div>
        </>
      )}
      {usedIn.length > 0 && (
        <p className="mt-4 text-sm text-gray-600">Used in: {usedIn.map((b) => `${byId.get(b.parent_id)?.name} (${qty(b.qty_per, item.uom)} each)`).join(', ')}</p>
      )}

      <EditItem key={item.id} item={item} />

      <h3 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Recent movements (inventory ledger)</h3>
      <ErrorNote error={history.error} />
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">When</th><th>What</th><th>Where</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th></tr></thead>
        <tbody className="divide-y divide-gray-100">
          {(history.data ?? []).map((t) => (
            <tr key={t.id}>
              <td className="py-1.5 whitespace-nowrap text-gray-600">{dateTime(t.ts)}</td>
              <td>{TXN_LABEL[t.txn_type] ?? t.txn_type}{t.reason_code && <span className="text-gray-500"> · {t.reason_code}</span>}</td>
              <td className="text-gray-600">{loc(t.location_id)?.code}</td>
              <td className={`num text-right ${t.qty < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{t.qty > 0 ? '+' : ''}{qty(t.qty)}</td>
              <td className="num text-right text-gray-600">{money(t.unit_cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Drawer>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="num text-base font-semibold">{value}</p>
    </div>
  )
}

function EditItem({ item }: { item: ItemOverview }) {
  const { profile } = useAuth()
  const { data: suppliers } = useSuppliers()
  const qc = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState(item)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const canEdit = profile?.role === 'manager' || profile?.role === 'warehouse'
  if (!canEdit) return null
  const set = <K extends keyof ItemOverview>(k: K, v: ItemOverview[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    setBusy(true); setError(null)
    try {
      await must(supabase.from('items').update({
        name: form.name, category: form.category, price: Number(form.price), barcode: form.barcode,
        supplier_id: form.supplier_id, lead_time_days: form.lead_time_days === null || String(form.lead_time_days) === '' ? null : Number(form.lead_time_days),
        active: form.active,
      }).eq('id', item.id))
      await qc.invalidateQueries()
      toast(`Saved ${form.name}`)
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  return (
    <details className="mt-6 rounded-md border border-gray-200">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Edit item details</summary>
      <div className="grid grid-cols-2 gap-3 border-t border-gray-100 p-3">
        <Field label="Name" className="col-span-2"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Category"><Input value={form.category} onChange={(e) => set('category', e.target.value)} /></Field>
        <Field label="Barcode (UPC)"><Input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} /></Field>
        <Field label="Selling price">
          <Input type="number" step="0.01" min="0" value={form.price} disabled={item.kind === 'component'} onChange={(e) => set('price', e.target.value as unknown as number)} />
        </Field>
        <Field label="Preferred supplier">
          <Select value={form.supplier_id ?? ''} disabled={item.kind === 'made' || item.kind === 'kit'} onChange={(e) => set('supplier_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label={item.kind === 'made' || item.kind === 'kit' ? 'Production lead time (days)' : 'Lead time override (days)'}
          hint={item.kind === 'made' || item.kind === 'kit' ? undefined : `Blank = supplier quote (${suppliers?.find((s) => s.id === form.supplier_id)?.lead_time_days ?? '—'} days)`}>
          <Input type="number" min="0" value={form.lead_time_days ?? ''} onChange={(e) => set('lead_time_days', e.target.value === '' ? null : Number(e.target.value))} />
        </Field>
        <Field label="Status">
          <Select value={form.active ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')}>
            <option value="1">Active</option><option value="0">Inactive</option>
          </Select>
        </Field>
        <div className="col-span-2"><ErrorNote error={error} /></div>
        <div className="col-span-2 flex justify-end"><Button variant="primary" busy={busy} onClick={save}>Save changes</Button></div>
      </div>
    </details>
  )
}
