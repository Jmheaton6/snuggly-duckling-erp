import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { must, supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useItems, useSuppliers } from '../../lib/queries'
import { KIND_LABEL, money, pct } from '../../lib/format'
import { useToast } from '../../lib/toast'
import type { ItemKind, ItemOverview } from '../../lib/types'
import { DataTable, type Column } from '../../components/DataTable'
import { Badge, Button, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, cx } from '../../components/ui'
import { ItemDrawer } from './ItemDrawer'

const TABS: { key: '' | ItemKind; label: string }[] = [
  { key: '', label: 'All' }, { key: 'resale', label: 'Resale' }, { key: 'made', label: 'Made in-house' },
  { key: 'kit', label: 'Kits' }, { key: 'component', label: 'Components' },
]

export function ItemsPage() {
  const { profile } = useAuth()
  const { data: items, isLoading, error } = useItems()
  const [tab, setTab] = useState<'' | ItemKind>('')
  const [open, setOpen] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const rows = useMemo(() => (items ?? []).filter((i) => !tab || i.kind === tab), [items, tab])

  const columns: Column<ItemOverview>[] = [
    { key: 'sku', header: 'SKU', className: 'text-gray-500' },
    { key: 'name', header: 'Item', render: (i) => <span className={cx('font-medium', !i.active && 'text-gray-400 line-through')}>{i.name}</span> },
    { key: 'kind', header: 'Type', render: (i) => <Badge tone={i.kind === 'kit' ? 'purple' : i.kind === 'made' ? 'yellow' : i.kind === 'component' ? 'gray' : 'blue'}>{KIND_LABEL[i.kind]}</Badge> },
    { key: 'category', header: 'Category' },
    { key: 'barcode', header: 'Barcode', className: 'font-mono text-xs text-gray-600' },
    { key: 'price', header: 'Price', align: 'right', render: (i) => (i.kind === 'component' ? <span className="text-gray-300">—</span> : money(i.price)) },
    { key: 'avg_cost', header: 'Avg cost', align: 'right', render: (i) => money(i.avg_cost) },
    { key: 'margin', header: 'Margin', align: 'right', value: (i) => (i.price ? (i.price - i.avg_cost) / i.price : -1),
      render: (i) => (i.kind === 'component' || !i.price || !i.avg_cost ? <span className="text-gray-300">—</span> : pct((i.price - i.avg_cost) / i.price, 1)) },
    { key: 'supplier_name', header: 'Supplier / source', render: (i) => i.supplier_name ?? <span className="text-gray-500">{i.has_bom ? 'Made from BOM' : '—'}</span> },
    { key: 'effective_lead_time', header: 'Lead time', align: 'right', render: (i) => (i.effective_lead_time == null ? '—' : `${i.effective_lead_time} d`) },
  ]

  if (isLoading) return <Spinner />
  return (
    <>
      <PageHeader title="Items & bills of materials"
        description="Every item carries a barcode, cost, price and lead time. Made items and kits are BOM parents; click one to see its components and rolled-up cost."
        actions={(profile?.role === 'manager' || profile?.role === 'warehouse') && <Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" />New item</Button>} />
      <ErrorNote error={error} />
      <div className="mb-3 flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm', tab === t.key ? 'border-duck-500 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800')}>
            {t.label} <span className="text-xs text-gray-400">{(items ?? []).filter((i) => !t.key || i.kind === t.key).length}</span>
          </button>
        ))}
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(i) => i.id} onRowClick={(i) => setOpen(i.id)} search dense initialSort={{ key: 'sku', dir: 'asc' }} />
      <ItemDrawer itemId={open} onClose={() => setOpen(null)} />
      <NewItem open={adding} onClose={() => setAdding(false)} nextNumber={Math.max(0, ...(items ?? []).map((i) => i.id)) + 101} />
    </>
  )
}

function upc(n: number) {
  const body = '85001' + String(n).padStart(6, '0')
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 3 : 1), 0)
  return body + ((10 - (sum % 10)) % 10)
}

function NewItem({ open, onClose, nextNumber }: { open: boolean; onClose: () => void; nextNumber: number }) {
  const { data: suppliers } = useSuppliers()
  const qc = useQueryClient()
  const toast = useToast()
  const blank = { sku: '', name: '', category: '', kind: 'resale' as ItemKind, uom: 'ea', price: '', cost: '', supplier_id: '', lead: '' }
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const set = (k: keyof typeof blank, v: string) => setF((x) => ({ ...x, [k]: v }))

  async function save() {
    setBusy(true); setError(null)
    try {
      await must(supabase.from('items').insert({
        sku: f.sku.trim(), name: f.name.trim(), category: f.category.trim() || 'Other', kind: f.kind, uom: f.uom,
        barcode: upc(nextNumber), price: f.kind === 'component' ? 0 : Number(f.price || 0), avg_cost: Number(f.cost || 0),
        supplier_id: f.supplier_id ? Number(f.supplier_id) : null, lead_time_days: f.lead ? Number(f.lead) : null,
      }))
      await qc.invalidateQueries()
      toast(`Added ${f.name}. Stock starts at zero until it is received.`)
      setF(blank); onClose()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New item"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save} disabled={!f.sku || !f.name}>Add item</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="SKU"><Input value={f.sku} onChange={(e) => set('sku', e.target.value)} placeholder="SD-1206" /></Field>
        <Field label="Type">
          <Select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Name" className="col-span-2"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Category"><Input value={f.category} onChange={(e) => set('category', e.target.value)} /></Field>
        <Field label="Unit"><Select value={f.uom} onChange={(e) => set('uom', e.target.value)}><option value="ea">Each</option><option value="lb">Pound</option></Select></Field>
        <Field label="Selling price"><Input type="number" step="0.01" value={f.price} disabled={f.kind === 'component'} onChange={(e) => set('price', e.target.value)} /></Field>
        <Field label="Starting cost" hint="Becomes the average cost until the first receipt"><Input type="number" step="0.01" value={f.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
        <Field label="Supplier">
          <Select value={f.supplier_id} onChange={(e) => set('supplier_id', e.target.value)}>
            <option value="">—</option>
            {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Lead time override (days)"><Input type="number" value={f.lead} onChange={(e) => set('lead', e.target.value)} /></Field>
        <p className="col-span-2 text-xs text-gray-500">Barcode {upc(nextNumber)} is assigned automatically (UPC-A with check digit).</p>
        <div className="col-span-2"><ErrorNote error={error} /></div>
      </div>
    </Modal>
  )
}
