import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { must, supabase } from '../../lib/supabase'
import { useSuppliers } from '../../lib/queries'
import { date, money, pct, today } from '../../lib/format'
import { useToast } from '../../lib/toast'
import type { Supplier } from '../../lib/types'
import { DataTable, type Column } from '../../components/DataTable'
import { Badge, Button, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, type Tone } from '../../components/ui'

const TERMS = [
  { label: 'Net 15', days: 15, disc: 0, discDays: 0 },
  { label: 'Net 30', days: 30, disc: 0, discDays: 0 },
  { label: 'Net 45', days: 45, disc: 0, discDays: 0 },
  { label: '2/10 Net 30', days: 30, disc: 2, discDays: 10 },
]

// Computed in the database from PO history (v_supplier_scorecard); nothing here is typed in.
type Score = {
  supplier_id: number; pos_received: number; on_time_rate: number | null; avg_actual_lead: number | null; quoted_lead: number
  fill_rate: number | null; owed: number; overdue: number; next_due: string | null; open_bills: number; rating: 'Keep' | 'Watch' | 'Replace' | 'New'
}
const RATING: Record<Score['rating'], Tone> = { Keep: 'green', Watch: 'yellow', Replace: 'red', New: 'gray' }
type Row = Supplier & { score?: Score }

export function SuppliersPage() {
  const { data: suppliers, isLoading, error } = useSuppliers()
  const scores = useQuery({ queryKey: ['suppliers', 'scorecard'], queryFn: () => must(supabase.from('v_supplier_scorecard').select('*')) as Promise<Score[]> })
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null)
  const rows: Row[] = (suppliers ?? []).map((s) => ({ ...s, score: scores.data?.find((x) => x.supplier_id === s.id) }))
  const n = (v: unknown) => (v == null ? null : Number(v))

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Supplier', render: (s) => <span className="font-medium">{s.name}<span className="block text-xs font-normal text-gray-500">{s.contact_name} · {s.phone}</span></span> },
    { key: 'pos', header: 'POs received', align: 'right', value: (s) => n(s.score?.pos_received) },
    { key: 'on_time', header: 'On time', align: 'right', value: (s) => n(s.score?.on_time_rate),
      render: (s) => <span className={n(s.score?.on_time_rate) != null && n(s.score?.on_time_rate)! < 0.7 ? 'font-semibold text-red-700' : ''}>{pct(n(s.score?.on_time_rate))}</span> },
    { key: 'lead', header: 'Lead time: actual vs quoted', align: 'right', value: (s) => n(s.score?.avg_actual_lead),
      render: (s) => {
        const a = n(s.score?.avg_actual_lead)
        if (a == null) return <span className="text-gray-300">—</span>
        const diff = Math.round((a - s.lead_time_days) * 10) / 10
        return <span>{a} vs {s.lead_time_days} days <span className={diff > 0.5 ? 'text-red-700' : 'text-gray-500'}>({diff > 0 ? '+' : ''}{diff})</span></span>
      } },
    { key: 'fill', header: 'Fill rate', align: 'right', value: (s) => n(s.score?.fill_rate),
      render: (s) => <span className={n(s.score?.fill_rate) != null && n(s.score?.fill_rate)! < 0.9 ? 'font-semibold text-red-700' : ''}>{pct(n(s.score?.fill_rate), 1)}</span> },
    { key: 'owed', header: 'Owed', align: 'right', value: (s) => n(s.score?.owed),
      render: (s) => <span>{money(n(s.score?.owed) ?? 0)}{(n(s.score?.overdue) ?? 0) > 0 && <span className="block text-xs text-red-700">{money(n(s.score?.overdue))} overdue</span>}</span> },
    { key: 'next_due', header: 'Next due', value: (s) => s.score?.next_due,
      render: (s) => s.score?.next_due ? <span className={s.score.next_due < today() ? 'text-red-700' : ''}>{date(s.score.next_due)}<span className="block text-xs text-gray-500">{s.payment_terms}</span></span> : <span className="text-gray-300">—</span> },
    { key: 'rating', header: 'Rating', value: (s) => s.score?.rating, render: (s) => s.score ? <Badge tone={RATING[s.score.rating]}>{s.score.rating}</Badge> : null },
  ]

  if (isLoading) return <Spinner />
  return (
    <>
      <PageHeader title="Suppliers"
        description="The scorecard is computed from purchase-order history. On time = first receipt on or before the expected date (sent date + quoted lead time). Fill rate = quantity received ÷ ordered on finished POs. Owed = unpaid bills, each due on its receipt date + payment terms."
        actions={<Button variant="primary" onClick={() => setEditing({ lead_time_days: 7, payment_terms: 'Net 30', terms_days: 30, discount_pct: 0, discount_days: 0, active: true })}><Plus className="size-4" />New supplier</Button>} />
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
        <span className="font-medium text-gray-800">Rating</span>
        <span><Badge tone="green">Keep</Badge> on time ≥ 90% and fill ≥ 95%</span>
        <span><Badge tone="red">Replace</Badge> on time &lt; 70% or fill &lt; 90%</span>
        <span><Badge tone="yellow">Watch</Badge> everything in between</span>
      </div>
      <ErrorNote error={error ?? scores.error} />
      <DataTable rows={rows} columns={columns} rowKey={(s) => s.id} onRowClick={setEditing} search dense />
      {editing && <SupplierForm supplier={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function SupplierForm({ supplier, onClose }: { supplier: Partial<Supplier>; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState(supplier)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const set = <K extends keyof Supplier>(k: K, v: Supplier[K]) => setF((x) => ({ ...x, [k]: v }))

  async function save() {
    setBusy(true); setError(null)
    const t = TERMS.find((x) => x.label === f.payment_terms) ?? TERMS[1]
    const row = {
      name: f.name?.trim(), contact_name: f.contact_name, email: f.email, phone: f.phone, address: f.address,
      lead_time_days: Number(f.lead_time_days), payment_terms: t.label, terms_days: t.days, discount_pct: t.disc, discount_days: t.discDays,
      active: f.active ?? true,
    }
    try {
      if (f.id) await must(supabase.from('suppliers').update(row).eq('id', f.id))
      else await must(supabase.from('suppliers').insert(row))
      await qc.invalidateQueries()
      toast(`Saved ${row.name}`)
      onClose()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={f.id ? f.name : 'New supplier'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!f.name || !f.lead_time_days} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company name" className="col-span-2"><Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Contact"><Input value={f.contact_name ?? ''} onChange={(e) => set('contact_name', e.target.value)} /></Field>
        <Field label="Phone"><Input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email" className="col-span-2"><Input type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Address" className="col-span-2"><Input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Quoted lead time (days)" hint="Used for PO expected dates and MRP order-by dates">
          <Input type="number" min="1" value={f.lead_time_days ?? ''} onChange={(e) => set('lead_time_days', Number(e.target.value))} />
        </Field>
        <Field label="Payment terms" hint="Bill due date = receipt date + terms">
          <Select value={f.payment_terms} onChange={(e) => set('payment_terms', e.target.value)}>
            {TERMS.map((t) => <option key={t.label}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.active === false ? '0' : '1'} onChange={(e) => set('active', e.target.value === '1')}>
            <option value="1">Active</option><option value="0">Inactive</option>
          </Select>
        </Field>
        <div className="col-span-2"><ErrorNote error={error} /></div>
      </div>
    </Modal>
  )
}
