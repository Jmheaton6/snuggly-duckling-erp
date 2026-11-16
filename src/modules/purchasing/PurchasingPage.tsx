import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileText, Mail, PackageCheck, Plus, Printer, Send, Wallet, X } from 'lucide-react'
import { must, rpc, supabase } from '../../lib/supabase'
import { findByCode, useItems, useLocations, useSuppliers } from '../../lib/queries'
import { addDays, date, dateTime, docNo, money, qty, today } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { DataTable, type Column } from '../../components/DataTable'
import { printArea } from '../../components/Receipt'
import { ScanInput } from '../../components/ScanInput'
import { Badge, Button, Drawer, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, cx, type Tone } from '../../components/ui'

type PoLine = { id: number; item_id: number; qty_ordered: number; qty_received: number; unit_cost: number; items: { name: string; sku: string; uom: string; barcode: string } }
type Bill = { id: number; amount: number; bill_date: string; due_date: string; paid_at: string | null }
export type Po = {
  id: number; status: 'draft' | 'sent' | 'partial' | 'received' | 'closed' | 'cancelled'
  created_at: string; sent_at: string | null; expected_date: string | null; lead_time_quoted: number | null; closed_at: string | null
  location_id: number; supplier_id: number
  suppliers: { name: string; email: string | null; contact_name: string | null; payment_terms: string; address: string | null }
  locations: { name: string; address: string | null }
  po_lines: PoLine[]; po_receipts: { id: number; ts: string; location_id: number }[]; supplier_bills: Bill[]
}

const PO_STATUS: Record<Po['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  sent: { label: 'Order sent', tone: 'yellow' },
  partial: { label: 'Partly received', tone: 'blue' },
  received: { label: 'Received', tone: 'blue' },
  closed: { label: 'Closed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
}
const TABS = [
  { key: 'open', label: 'Open', match: (s: Po['status']) => s === 'draft' || s === 'sent' || s === 'partial' },
  { key: 'received', label: 'Received', match: (s: Po['status']) => s === 'received' },
  { key: 'closed', label: 'Closed', match: (s: Po['status']) => s === 'closed' },
  { key: 'cancelled', label: 'Cancelled', match: (s: Po['status']) => s === 'cancelled' },
  { key: 'all', label: 'All', match: () => true },
]

const localDay = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
const poTotal = (p: Po) => p.po_lines.reduce((s, l) => s + Number(l.qty_ordered) * Number(l.unit_cost), 0)
const firstReceipt = (p: Po) => p.po_receipts.map((r) => localDay(r.ts)).sort()[0] ?? null

// On time = first receipt on or before the expected date (sent date + quoted lead time).
function Timeliness({ po }: { po: Po }) {
  const got = firstReceipt(po)
  if (!po.expected_date) return <span className="text-gray-300">—</span>
  if (got) {
    const late = daysBetween(po.expected_date, got)
    return late <= 0 ? <Badge tone="green">On time</Badge> : <Badge tone="red">{late} day{late === 1 ? '' : 's'} late</Badge>
  }
  if (po.status === 'cancelled') return <span className="text-gray-300">—</span>
  const overdue = daysBetween(po.expected_date, today())
  return overdue > 0 ? <Badge tone="red">Overdue {overdue}d</Badge> : <span className="text-xs text-gray-500">Due in {-overdue}d</span>
}

function usePurchaseOrders() {
  return useQuery({
    queryKey: ['purchase_orders', 'list'],
    queryFn: () => must(supabase.from('purchase_orders')
      .select('id, status, created_at, sent_at, expected_date, lead_time_quoted, closed_at, location_id, supplier_id, suppliers(name, email, contact_name, payment_terms, address), locations(name, address), po_lines(id, item_id, qty_ordered, qty_received, unit_cost, items(name, sku, uom, barcode)), po_receipts(id, ts, location_id), supplier_bills(id, amount, bill_date, due_date, paid_at)')
      .order('id', { ascending: false })) as unknown as Promise<Po[]>,
  })
}

export function PurchasingPage() {
  const [tab, setTab] = useState('open')
  const [open, setOpen] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const pos = usePurchaseOrders()
  const match = TABS.find((t) => t.key === tab)!.match
  const rows = (pos.data ?? []).filter((p) => match(p.status))

  const columns: Column<Po>[] = [
    { key: 'id', header: 'PO', render: (p) => <span className="font-medium">{docNo('purchase_order', p.id)}</span> },
    { key: 'supplier', header: 'Supplier', value: (p) => p.suppliers.name, render: (p) => p.suppliers.name },
    { key: 'location', header: 'Receive at', value: (p) => p.locations.name, render: (p) => p.locations.name },
    { key: 'sent_at', header: 'Sent', render: (p) => (p.sent_at ? date(localDay(p.sent_at)) : <span className="text-gray-300">—</span>) },
    { key: 'expected_date', header: 'Expected', render: (p) => date(p.expected_date) },
    { key: 'received', header: 'Received', value: (p) => firstReceipt(p), render: (p) => (firstReceipt(p) ? date(firstReceipt(p)) : <span className="text-gray-300">—</span>) },
    { key: 'timely', header: 'On time?', value: (p) => (firstReceipt(p) && p.expected_date ? daysBetween(p.expected_date, firstReceipt(p)!) : null), render: (p) => <Timeliness po={p} /> },
    { key: 'total', header: 'Total', align: 'right', value: poTotal, render: (p) => money(poTotal(p)) },
    { key: 'status', header: 'Status', render: (p) => <Badge tone={PO_STATUS[p.status].tone}>{PO_STATUS[p.status].label}</Badge> },
  ]

  return (
    <>
      <PageHeader title="Purchase orders"
        description="Send an order to a supplier, receive it into a location, then close it. Expected date = date sent + the supplier's quoted lead time, and every receipt is compared against it."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" />New purchase order</Button>} />
      <ErrorNote error={pos.error} />
      <div className="mb-3 flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm', tab === t.key ? 'border-duck-500 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800')}>
            {t.label} <span className="text-xs text-gray-400">{(pos.data ?? []).filter((p) => t.match(p.status)).length}</span>
          </button>
        ))}
      </div>
      {pos.isLoading ? <Spinner /> : (
        <DataTable rows={rows} columns={columns} rowKey={(p) => p.id} onRowClick={(p) => setOpen(p.id)} search dense searchPlaceholder="Search POs, suppliers…" />
      )}
      {open != null && <PoDrawer po={pos.data?.find((p) => p.id === open)} onClose={() => setOpen(null)} />}
      <NewPoModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setTab('open'); setOpen(id) }} />
    </>
  )
}

function PoDrawer({ po, onClose }: { po: Po | undefined; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { profile } = useAuth()
  const { data: locations } = useLocations()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [receiving, setReceiving] = useState(false)
  const [doc, setDoc] = useState(false)
  if (!po) return null

  async function act(key: string, fn: string, args: Record<string, unknown>, done: string) {
    setBusy(key); setError(null)
    try { await rpc(fn, args); await qc.invalidateQueries(); toast(done) } catch (e) { setError(e) } finally { setBusy(null) }
  }
  const steps = ['sent', 'received', 'closed'] as const
  const reached = po.status === 'draft' ? -1 : po.status === 'sent' ? 0 : po.status === 'partial' || po.status === 'received' ? 1 : 2
  const got = firstReceipt(po)
  const nothingReceived = po.po_lines.every((l) => Number(l.qty_received) === 0)

  return (
    <Drawer open onClose={onClose} title={`${docNo('purchase_order', po.id)} · ${po.suppliers.name}`}
      subtitle={<>Receive at {po.locations.name} · created {dateTime(po.created_at)}</>}>
      <ol className="mb-5 flex items-center gap-2 text-xs">
        {po.status === 'cancelled' ? <Badge tone="gray">Cancelled {po.closed_at && dateTime(po.closed_at)}</Badge>
          : po.status === 'draft' ? <Badge tone="gray">Draft: not sent yet</Badge>
          : steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className={cx('flex size-5 items-center justify-center rounded-full text-[10px] font-bold', i <= reached ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-500')}>{i + 1}</span>
              <span className={i <= reached ? 'font-medium' : 'text-gray-500'}>{s === 'sent' ? 'Order sent' : s === 'received' ? (po.status === 'partial' ? 'Partly received' : 'Received') : 'Closed'}</span>
              {i < 2 && <span className="h-px w-6 bg-gray-300" />}
            </li>
          ))}
      </ol>

      {po.sent_at && (
        <dl className="mb-5 grid grid-cols-3 gap-3 rounded-md bg-gray-50 p-3 text-sm">
          <div><dt className="text-xs text-gray-500">Sent</dt><dd className="font-medium">{date(localDay(po.sent_at))}</dd></div>
          <div><dt className="text-xs text-gray-500">Expected (+{po.lead_time_quoted} days quoted)</dt><dd className="font-medium">{date(po.expected_date)}</dd></div>
          <div><dt className="text-xs text-gray-500">First received</dt><dd className="flex flex-wrap items-center gap-1.5 font-medium">{got ? date(got) : '—'} <Timeliness po={po} /></dd></div>
        </dl>
      )}

      <table className="w-full text-sm">
        <thead><tr className="border-b border-gray-200 text-left text-xs text-gray-500">
          <th className="py-1.5">Item</th><th className="text-right">Ordered</th><th className="text-right">Received</th><th className="text-right">Unit cost</th><th className="text-right">Total</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100">
          {po.po_lines.map((l) => (
            <tr key={l.id}>
              <td className="py-2">{l.items.name}<span className="block text-xs text-gray-400">{l.items.sku}</span></td>
              <td className="num text-right">{qty(Number(l.qty_ordered), l.items.uom)}</td>
              <td className={cx('num text-right', Number(l.qty_received) < Number(l.qty_ordered) && po.status !== 'sent' && 'text-red-700')}>{qty(Number(l.qty_received), l.items.uom)}</td>
              <td className="num text-right">{money(Number(l.unit_cost))}</td>
              <td className="num text-right">{money(Number(l.qty_ordered) * Number(l.unit_cost))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t border-gray-200 font-semibold"><td className="py-2" colSpan={4}>PO total</td><td className="num text-right">{money(poTotal(po))}</td></tr></tfoot>
      </table>

      {po.po_receipts.length > 0 && (
        <div className="mt-5">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Receipts</p>
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm">
            {po.po_receipts.map((r) => (
              <li key={r.id} className="flex justify-between px-3 py-1.5"><span>{dateTime(r.ts)}</span><span className="text-gray-600">{locations?.find((l) => l.id === r.location_id)?.name}</span></li>
            ))}
          </ul>
        </div>
      )}

      {po.supplier_bills.length > 0 && (
        <div className="mt-5">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Supplier bills · {po.suppliers.payment_terms}</p>
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm">
            {po.supplier_bills.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="num font-medium">{money(Number(b.amount))}</span>
                <span className="text-gray-600">billed {date(b.bill_date)} · due {date(b.due_date)}</span>
                {b.paid_at ? <Badge tone="green">Paid {date(localDay(b.paid_at))}</Badge>
                  : profile?.role === 'manager' ? (
                    <Button size="sm" busy={busy === `pay${b.id}`} onClick={() => act(`pay${b.id}`, 'pay_supplier_bill', { p_bill_id: b.id }, `Paid ${money(Number(b.amount))} to ${po.suppliers.name}`)}>
                      <Wallet className="size-3.5" />Pay{b.due_date < today() ? ' (overdue)' : ''}
                    </Button>
                  ) : <Badge tone={b.due_date < today() ? 'red' : 'yellow'}>{b.due_date < today() ? 'Overdue' : 'Unpaid'}</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 space-y-3">
        <ErrorNote error={error} />
        <div className="flex flex-wrap gap-2">
          {po.status === 'draft' && (
            <Button variant="primary" busy={busy === 'send'} onClick={() => act('send', 'send_purchase_order', { p_po_id: po.id }, `${docNo('purchase_order', po.id)} sent to ${po.suppliers.name}`)}>
              <Send className="size-4" />Send to supplier
            </Button>
          )}
          {(po.status === 'sent' || po.status === 'partial') && (
            <Button variant="primary" onClick={() => setReceiving(true)}><PackageCheck className="size-4" />Receive items</Button>
          )}
          {(po.status === 'partial' || po.status === 'received') && (
            <Button busy={busy === 'close'} onClick={() => act('close', 'close_purchase_order', { p_po_id: po.id }, `${docNo('purchase_order', po.id)} closed`)}>
              <Check className="size-4" />{po.status === 'partial' ? 'Close short' : 'Close PO'}
            </Button>
          )}
          {po.status !== 'draft' && <Button onClick={() => setDoc(true)}><FileText className="size-4" />PO document</Button>}
          {(po.status === 'draft' || (po.status === 'sent' && nothingReceived)) && (
            <Button variant="ghost" busy={busy === 'cancel'} onClick={() => act('cancel', 'cancel_purchase_order', { p_po_id: po.id }, 'PO cancelled')}><X className="size-4" />Cancel PO</Button>
          )}
        </div>
      </div>
      {receiving && <ReceiveModal po={po} onClose={() => setReceiving(false)} />}
      {doc && <PoDocument po={po} onClose={() => setDoc(false)} />}
    </Drawer>
  )
}

// Scan to receive: each scan of a label adds 1 to that line; quantities can also be typed.
function ReceiveModal({ po, onClose }: { po: Po; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: locations } = useLocations()
  const open = (l: PoLine) => Number(l.qty_ordered) - Number(l.qty_received)
  const [loc, setLoc] = useState(String(po.location_id))
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const openLines = po.po_lines.filter((l) => open(l) > 0)
  const lateBy = po.expected_date ? daysBetween(po.expected_date, today()) : 0

  function onScan(code: string) {
    const line = findByCode(openLines.map((l) => ({ ...l.items, line: l })), code)?.line
    if (!line) { setMsg({ ok: false, text: `${code} is not on this PO` }); return }
    const next = Math.min(open(line), Number(counts[line.id] || 0) + 1)
    setCounts((c) => ({ ...c, [line.id]: String(next) }))
    setMsg({ ok: true, text: `${line.items.name}: ${next} of ${qty(open(line))}` })
  }
  async function save() {
    setBusy(true); setError(null)
    try {
      const lines = openLines.filter((l) => Number(counts[l.id]) > 0).map((l) => ({ po_line_id: l.id, qty: Number(counts[l.id]) }))
      await rpc('receive_purchase_order', { p_po_id: po.id, p_lines: lines, p_location_id: Number(loc) })
      await qc.invalidateQueries()
      toast(`Received into ${locations?.find((l) => l.id === Number(loc))?.name}: stock, average cost and the supplier bill updated`)
      onClose()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  const any = openLines.some((l) => Number(counts[l.id]) > 0)

  return (
    <Modal open onClose={onClose} title={`Receive ${docNo('purchase_order', po.id)}`} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!any} onClick={save}><PackageCheck className="size-4" />Receive</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Receive into">
          <Select value={loc} onChange={(e) => setLoc(e.target.value)}>
            {(locations ?? []).filter((l) => l.kind !== 'hold').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Arrival vs expected">
          <p className={cx('flex h-9 items-center text-sm font-medium', lateBy > 0 ? 'text-red-700' : 'text-emerald-700')}>
            Expected {date(po.expected_date)} · today is {lateBy > 0 ? `${lateBy} day${lateBy === 1 ? '' : 's'} late` : 'on time'}
          </p>
        </Field>
        <div className="sm:col-span-2">
          <ScanInput onScan={onScan} autoFocus continuous placeholder="Scan an item label to count it in" />
          {msg && <p className={cx('mt-1.5 text-sm', msg.ok ? 'text-emerald-700' : 'text-red-700')}>{msg.text}</p>}
        </div>
      </div>
      <table className="mt-4 w-full text-sm">
        <thead><tr className="border-b border-gray-200 text-left text-xs text-gray-500"><th className="py-1.5">Item</th><th className="text-right">Ordered</th><th className="text-right">Already in</th><th className="text-right">Still open</th><th className="w-28 pl-3">Receiving now</th></tr></thead>
        <tbody className="divide-y divide-gray-100">
          {openLines.map((l) => (
            <tr key={l.id}>
              <td className="py-2">{l.items.name}<span className="block text-xs text-gray-400">{l.items.sku}</span></td>
              <td className="num text-right">{qty(Number(l.qty_ordered))}</td>
              <td className="num text-right">{qty(Number(l.qty_received))}</td>
              <td className="num text-right">{qty(open(l))}</td>
              <td className="pl-3"><Input type="number" min="0" max={open(l)} step="any" value={counts[l.id] ?? ''} placeholder="0" onChange={(e) => setCounts((c) => ({ ...c, [l.id]: e.target.value }))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={() => setCounts(Object.fromEntries(openLines.map((l) => [l.id, String(open(l))])))}>Fill in everything still open</Button>
        <span className="text-xs text-gray-500">Receiving less than ordered leaves the PO partly received.</span>
      </div>
      <div className="mt-3"><ErrorNote error={error} /></div>
    </Modal>
  )
}

// The PO as the supplier sees it: print it, or send it as an email.
function PoDocument({ po, onClose }: { po: Po; onClose: () => void }) {
  const no = docNo('purchase_order', po.id)
  const body = [
    `Hello ${po.suppliers.contact_name ?? ''},`.trim(), '',
    `Please supply the following on purchase order ${no}:`, '',
    ...po.po_lines.map((l) => `• ${qty(Number(l.qty_ordered), l.items.uom)} × ${l.items.name} (${l.items.sku}) @ ${money(Number(l.unit_cost))}`), '',
    `Total: ${money(poTotal(po))}`, `Deliver to: ${po.locations.name}${po.locations.address ? `, ${po.locations.address}` : ''}`,
    `Expected by: ${date(po.expected_date)} · Terms: ${po.suppliers.payment_terms}`, '', 'Thank you,', 'The Snuggly Duckling',
  ].join('\n')
  const mailto = `mailto:${po.suppliers.email ?? ''}?subject=${encodeURIComponent(`Purchase order ${no} from The Snuggly Duckling`)}&body=${encodeURIComponent(body)}`
  return (
    <Modal open onClose={onClose} title={`Purchase order ${no}`} wide
      footer={<><Button onClick={printArea}><Printer className="size-4" />Print</Button><a href={mailto}><Button variant="primary" tabIndex={-1}><Mail className="size-4" />Email {po.suppliers.email}</Button></a></>}>
      <div className="print-area space-y-4 bg-white p-2 text-sm">
        <div className="flex justify-between">
          <div><p className="text-lg font-bold">The Snuggly Duckling</p><p className="text-gray-600">Snacks · Provo & Orem</p></div>
          <div className="text-right"><p className="text-lg font-bold">PURCHASE ORDER</p><p className="font-mono">{no}</p></div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div><p className="text-xs text-gray-500">Supplier</p><p className="font-medium">{po.suppliers.name}</p><p className="text-gray-600">{po.suppliers.contact_name}<br />{po.suppliers.address}<br />{po.suppliers.email}</p></div>
          <div><p className="text-xs text-gray-500">Ship to</p><p className="font-medium">{po.locations.name}</p><p className="text-gray-600">{po.locations.address}</p></div>
          <div><p className="text-xs text-gray-500">Dates & terms</p><p>Ordered {po.sent_at ? date(localDay(po.sent_at)) : '—'}</p><p>Expected {date(po.expected_date)}</p><p>Terms {po.suppliers.payment_terms}</p></div>
        </div>
        <table className="w-full">
          <thead><tr className="border-b border-gray-300 text-left text-xs text-gray-500"><th className="py-1">SKU</th><th>Item</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{po.po_lines.map((l) => (
            <tr key={l.id} className="border-b border-gray-100"><td className="py-1 font-mono text-xs">{l.items.sku}</td><td>{l.items.name}</td><td className="num text-right">{qty(Number(l.qty_ordered), l.items.uom)}</td><td className="num text-right">{money(Number(l.unit_cost))}</td><td className="num text-right">{money(Number(l.qty_ordered) * Number(l.unit_cost))}</td></tr>
          ))}</tbody>
          <tfoot><tr className="font-semibold"><td className="py-1.5" colSpan={4}>Total</td><td className="num text-right">{money(poTotal(po))}</td></tr></tfoot>
        </table>
      </div>
    </Modal>
  )
}

type DraftLine = { item_id: string; qty: string }

// Also opened from Replenishment with the supplier and lines filled in.
export function NewPoModal({ open, onClose, onCreated, initial }: {
  open: boolean; onClose: () => void; onCreated: (id: number) => void
  initial?: { supplierId: number; lines: { item_id: number; qty: number }[] }
}) {
  const { data: suppliers } = useSuppliers()
  const { data: locations } = useLocations()
  const { data: items } = useItems()
  const qc = useQueryClient()
  const toast = useToast()
  const warehouse = locations?.find((l) => l.kind === 'warehouse')?.id
  const [supplier, setSupplier] = useState(initial ? String(initial.supplierId) : '')
  const [location, setLocation] = useState('')
  const [lines, setLines] = useState<DraftLine[]>(initial ? initial.lines.map((l) => ({ item_id: String(l.item_id), qty: String(l.qty) })) : [{ item_id: '', qty: '' }])
  const [busy, setBusy] = useState<'draft' | 'send' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const sup = suppliers?.find((s) => s.id === Number(supplier))
  const buyable = (items ?? []).filter((i) => i.active && (i.kind === 'resale' || i.kind === 'component'))
  const fromSupplier = buyable.filter((i) => i.supplier_id === Number(supplier))
  const valid = lines.filter((l) => l.item_id && Number(l.qty) > 0)
  const set = (i: number, k: keyof DraftLine, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const loc = location || String(warehouse ?? '')

  async function save(send: boolean) {
    setBusy(send ? 'send' : 'draft'); setError(null)
    try {
      const id = await rpc<number>('create_purchase_order', {
        p_supplier_id: Number(supplier), p_location_id: Number(loc), p_send: send,
        p_lines: valid.map((l) => ({ item_id: Number(l.item_id), qty: Number(l.qty) })),
      })
      await qc.invalidateQueries()
      toast(send ? `${docNo('purchase_order', id)} sent to ${sup?.name}` : `${docNo('purchase_order', id)} saved as a draft`)
      setLines([{ item_id: '', qty: '' }]); setSupplier('')
      onCreated(id)
    } catch (e) { setError(e) } finally { setBusy(null) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New purchase order" wide
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button busy={busy === 'draft'} disabled={!supplier || !valid.length} onClick={() => save(false)}>Save draft</Button>
        <Button variant="primary" busy={busy === 'send'} disabled={!supplier || !valid.length} onClick={() => save(true)}><Send className="size-4" />Send PO</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Supplier">
          <Select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">Choose…</option>
            {(suppliers ?? []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Receive at">
          <Select value={loc} onChange={(e) => setLocation(e.target.value)}>
            {(locations ?? []).filter((l) => l.kind !== 'hold').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Expected if sent today">
          <p className="flex h-9 items-center text-sm font-medium">{sup ? `${date(addDays(today(), sup.lead_time_days))} (+${sup.lead_time_days} days)` : '—'}</p>
        </Field>
      </div>
      <table className="mt-4 w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-500"><th className="pb-1">Item</th><th className="w-28 pb-1">Qty</th><th className="pb-1 text-right">Est. cost</th><th className="pb-1 pl-3 text-right">On hand</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => {
            const item = buyable.find((x) => x.id === Number(l.item_id))
            return (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <Select value={l.item_id} onChange={(e) => set(i, 'item_id', e.target.value)}>
                    <option value="">Choose an item…</option>
                    {fromSupplier.length > 0 && <optgroup label={`From ${sup?.name}`}>{fromSupplier.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
                    <optgroup label="Other items">{buyable.filter((x) => x.supplier_id !== Number(supplier)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                  </Select>
                </td>
                <td className="py-1"><Input type="number" min="0" step="any" value={l.qty} onChange={(e) => set(i, 'qty', e.target.value)} /></td>
                <td className="num py-1 text-right">{item && Number(l.qty) > 0 ? money(Number(item.avg_cost) * Number(l.qty)) : ''}</td>
                <td className="num py-1 pl-3 text-right text-gray-600">{item ? qty(item.on_hand, item.uom) : ''}</td>
                <td className="py-1 pl-2">{lines.length > 1 && <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove line"><X className="size-4" /></button>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, { item_id: '', qty: '' }])}><Plus className="size-3.5" />Add line</Button>
        <span className="text-xs text-gray-500">Priced at the last price paid.</span>
      </div>
      <div className="mt-3"><ErrorNote error={error} /></div>
    </Modal>
  )
}
