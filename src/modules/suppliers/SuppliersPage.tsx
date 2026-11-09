import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { must, supabase } from '../../lib/supabase'
import { useItems, useSuppliers } from '../../lib/queries'
import { useToast } from '../../lib/toast'
import type { Supplier } from '../../lib/types'
import { DataTable, type Column } from '../../components/DataTable'
import { Badge, Button, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui'

const TERMS = [
  { label: 'Net 15', days: 15, disc: 0, discDays: 0 },
  { label: 'Net 30', days: 30, disc: 0, discDays: 0 },
  { label: 'Net 45', days: 45, disc: 0, discDays: 0 },
  { label: '2/10 Net 30', days: 30, disc: 2, discDays: 10 },
]

export function SuppliersPage() {
  const { data: suppliers, isLoading, error } = useSuppliers()
  const { data: items } = useItems()
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null)

  const columns: Column<Supplier>[] = [
    { key: 'name', header: 'Supplier', render: (s) => <span className="font-medium">{s.name}</span> },
    { key: 'contact_name', header: 'Contact', render: (s) => <span>{s.contact_name}<span className="block text-xs text-gray-500">{s.email} · {s.phone}</span></span> },
    { key: 'lead_time_days', header: 'Quoted lead time', align: 'right', render: (s) => `${s.lead_time_days} days` },
    { key: 'payment_terms', header: 'Terms' },
    { key: 'items', header: 'Items supplied', align: 'right', value: (s) => (items ?? []).filter((i) => i.supplier_id === s.id).length },
    { key: 'active', header: 'Status', render: (s) => (s.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
  ]

  if (isLoading) return <Spinner />
  return (
    <>
      <PageHeader title="Suppliers"
        description="Contact info, quoted lead times and payment terms. Purchase-order expected dates come from the quoted lead time; the scorecard (phase 3) compares it with what actually happened."
        actions={<Button variant="primary" onClick={() => setEditing({ lead_time_days: 7, payment_terms: 'Net 30', terms_days: 30, discount_pct: 0, discount_days: 0, active: true })}><Plus className="size-4" />New supplier</Button>} />
      <ErrorNote error={error} />
      <DataTable rows={suppliers ?? []} columns={columns} rowKey={(s) => s.id} onRowClick={setEditing} search />
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
