import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { must, supabase } from '../../lib/supabase'
import { useCustomers } from '../../lib/queries'
import { date, money } from '../../lib/format'
import { useToast } from '../../lib/toast'
import type { Customer } from '../../lib/types'
import { DataTable, type Column } from '../../components/DataTable'
import { Badge, Button, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui'

type Totals = Record<number, { orders: number; spend: number; last: string }>

export function CustomersPage() {
  const { data: customers, isLoading, error } = useCustomers()
  const [editing, setEditing] = useState<Partial<Customer> | null>(null)
  const totals = useQuery({
    queryKey: ['sales', 'by-customer'],
    queryFn: async () => {
      const rows = await must(supabase.from('v_customer_totals').select('*')) as { customer_id: number; purchases: number; spend: number; last_purchase: string }[]
      return Object.fromEntries(rows.map((r) => [r.customer_id, { orders: r.purchases, spend: r.spend, last: r.last_purchase }])) as Totals
    },
  })

  const columns: Column<Customer>[] = [
    { key: 'name', header: 'Customer', render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'kind', header: 'Type', render: (c) => <Badge tone={c.kind === 'business' ? 'blue' : 'gray'}>{c.kind === 'business' ? 'Business' : 'Individual'}</Badge> },
    { key: 'email', header: 'Email', className: 'text-gray-600' },
    { key: 'phone', header: 'Phone', className: 'text-gray-600' },
    { key: 'city', header: 'City' },
    { key: 'orders', header: 'Purchases', align: 'right', value: (c) => totals.data?.[c.id]?.orders ?? 0 },
    { key: 'spend', header: 'Lifetime spend', align: 'right', value: (c) => totals.data?.[c.id]?.spend ?? 0, render: (c) => money(totals.data?.[c.id]?.spend ?? 0) },
    { key: 'last', header: 'Last purchase', value: (c) => totals.data?.[c.id]?.last ?? '', render: (c) => (totals.data?.[c.id] ? date(totals.data[c.id].last) : '—') },
  ]

  if (isLoading) return <Spinner />
  return (
    <>
      <PageHeader title="Customers" description="Walk-in regulars, local businesses that order for pickup, and customers who use the online portal."
        actions={<Button variant="primary" onClick={() => setEditing({ kind: 'individual' })}><Plus className="size-4" />New customer</Button>} />
      <ErrorNote error={error ?? totals.error} />
      <DataTable rows={customers ?? []} columns={columns} rowKey={(c) => c.id} onRowClick={setEditing} search initialSort={{ key: 'spend', dir: 'desc' }} />
      {editing && <CustomerForm customer={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function CustomerForm({ customer, onClose }: { customer: Partial<Customer>; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState(customer)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const set = <K extends keyof Customer>(k: K, v: Customer[K]) => setF((x) => ({ ...x, [k]: v }))

  async function save() {
    setBusy(true); setError(null)
    const row = { name: f.name?.trim(), email: f.email || null, phone: f.phone || null, kind: f.kind ?? 'individual', city: f.city || null }
    try {
      if (f.id) await must(supabase.from('customers').update(row).eq('id', f.id))
      else await must(supabase.from('customers').insert(row))
      await qc.invalidateQueries()
      toast(`Saved ${row.name}`)
      onClose()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={f.id ? f.name : 'New customer'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!f.name} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2"><Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Type">
          <Select value={f.kind} onChange={(e) => set('kind', e.target.value as Customer['kind'])}>
            <option value="individual">Individual</option><option value="business">Business</option>
          </Select>
        </Field>
        <Field label="City"><Input value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Phone"><Input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <div className="col-span-2"><ErrorNote error={error} /></div>
      </div>
    </Modal>
  )
}
