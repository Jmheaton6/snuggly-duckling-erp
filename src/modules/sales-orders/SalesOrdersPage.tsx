import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Check, Plus, Receipt, X } from 'lucide-react'
import { must, rpc, supabase } from '../../lib/supabase'
import { useAvailability, useCustomers, useItems, useLocations } from '../../lib/queries'
import { addDays, date, dateTime, docNo, isSunday, money, nextOpenDay, qty, today } from '../../lib/format'
import { useToast } from '../../lib/toast'
import type { SalesOrderLineRow, SalesOrderRow } from '../../lib/types'
import { DataTable, type Column } from '../../components/DataTable'
import { ReceiptModal } from '../../components/Receipt'
import { Badge, Button, Drawer, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, cx, type Tone } from '../../components/ui'

export const SO_STATUS: Record<string, { label: string; tone: Tone }> = {
  placed: { label: 'Order placed', tone: 'yellow' },
  fulfilled: { label: 'Fulfilled', tone: 'blue' },
  closed: { label: 'Closed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
}
const TABS = ['placed', 'fulfilled', 'closed', 'cancelled', ''] as const

export function SalesOrdersPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('placed')
  const [open, setOpen] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const orders = useQuery({
    queryKey: ['sales_orders', 'list'],
    queryFn: () => must(supabase.from('v_sales_orders').select('*').order('requested_date', { ascending: false }).order('id', { ascending: false })) as Promise<SalesOrderRow[]>,
  })
  const rows = (orders.data ?? []).filter((o) => !tab || o.status === tab)

  const columns: Column<SalesOrderRow>[] = [
    { key: 'id', header: 'Order', render: (o) => <span className="font-medium">{docNo('sales_order', o.id)}</span> },
    { key: 'customer_name', header: 'Customer' },
    { key: 'location_name', header: 'Pickup at' },
    { key: 'requested_date', header: 'Pickup date', render: (o) => (
      <span className="flex items-center gap-1.5">{date(o.requested_date)}{o.status === 'placed' && o.requested_date < today() && <Badge tone="red">Overdue</Badge>}</span>) },
    { key: 'order_date', header: 'Ordered', render: (o) => date(o.order_date) },
    { key: 'lines', header: 'Lines', align: 'right' },
    { key: 'total', header: 'Total', align: 'right', render: (o) => money(o.total) },
    { key: 'availability', header: 'Availability', value: (o) => o.backordered_lines,
      render: (o) => o.status !== 'placed' ? <span className="text-gray-300">—</span>
        : o.backordered_lines ? <Badge tone="red">{o.backordered_lines} backordered · ETA {date(o.est_available_date)}</Badge>
        : <Badge tone="green">Ready to fulfill</Badge> },
    { key: 'source', header: 'Source', render: (o) => <Badge tone={o.source === 'portal' ? 'purple' : 'gray'}>{o.source === 'portal' ? 'Online' : 'Staff'}</Badge> },
    { key: 'status', header: 'Status', render: (o) => <Badge tone={SO_STATUS[o.status].tone}>{SO_STATUS[o.status].label}</Badge> },
  ]

  return (
    <>
      <PageHeader title="Sales orders"
        description="Customer orders for pickup. Open orders claim stock in pickup-date order; anything the shelf can't cover is backordered with an estimated available date from open POs or lead time."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" />New order</Button>} />
      <ErrorNote error={orders.error} />
      <div className="mb-3 flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t || 'all'} onClick={() => setTab(t)}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm', tab === t ? 'border-duck-500 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800')}>
            {t ? SO_STATUS[t].label : 'All'} <span className="text-xs text-gray-400">{(orders.data ?? []).filter((o) => !t || o.status === t).length}</span>
          </button>
        ))}
      </div>
      {orders.isLoading ? <Spinner /> : (
        <DataTable rows={rows} columns={columns} rowKey={(o) => o.id} onRowClick={(o) => setOpen(o.id)} search dense searchPlaceholder="Search orders, customers…" />
      )}
      {open != null && <OrderDrawer order={orders.data?.find((o) => o.id === open)} onClose={() => setOpen(null)} />}
      <NewOrderModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setTab('placed'); setOpen(id) }} />
    </>
  )
}

function OrderDrawer({ order, onClose }: { order: SalesOrderRow | undefined; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: items } = useItems()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [receipt, setReceipt] = useState<number | null>(null)
  const lines = useQuery({
    enabled: !!order,
    queryKey: ['sales_orders', 'lines', order?.id],
    queryFn: () => must(supabase.from('v_sales_order_lines').select('*').eq('sales_order_id', order!.id).order('id')) as Promise<SalesOrderLineRow[]>,
  })
  if (!order) return null

  async function act(label: string, fn: string, args: Record<string, unknown>, done: string) {
    setBusy(label); setError(null)
    try {
      const r = await rpc<number>(fn, args)
      await qc.invalidateQueries()
      toast(done)
      if (fn === 'fulfill_sales_order') setReceipt(r)
    } catch (e) { setError(e) } finally { setBusy(null) }
  }
  const warehouse = (itemId: number) => items?.find((i) => i.id === itemId)?.by_location['WHSE'] ?? 0
  const blocked = order.status === 'placed' && order.backordered_lines > 0
  const steps = ['placed', 'fulfilled', 'closed'] as const
  const reached = order.status === 'cancelled' ? 0 : steps.indexOf(order.status as (typeof steps)[number])

  return (
    <Drawer open onClose={onClose} title={`${docNo('sales_order', order.id)} · ${order.customer_name}`}
      subtitle={<>Pickup {date(order.requested_date)} at {order.location_name} · ordered {dateTime(order.order_date)} {order.source === 'portal' ? '(online)' : ''}</>}>
      <ol className="mb-5 flex items-center gap-2 text-xs">
        {order.status === 'cancelled' ? <Badge tone="gray">Cancelled {order.closed_at && dateTime(order.closed_at)}</Badge> : steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={cx('flex size-5 items-center justify-center rounded-full text-[10px] font-bold', i <= reached ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-500')}>{i + 1}</span>
            <span className={i <= reached ? 'font-medium' : 'text-gray-500'}>{SO_STATUS[s].label}</span>
            {i < 2 && <span className="h-px w-6 bg-gray-300" />}
          </li>
        ))}
      </ol>

      {lines.isLoading ? <Spinner /> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-200 text-left text-xs text-gray-500">
            <th className="py-1.5">Item</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th>
            {order.status === 'placed' && <><th className="text-right">Available</th><th className="pl-3">Status</th></>}
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(lines.data ?? []).map((l) => (
              <tr key={l.id} className="align-top">
                <td className="py-2">{l.item_name}<span className="block text-xs text-gray-400">{l.sku}</span></td>
                <td className="num text-right">{qty(l.qty)}</td>
                <td className="num text-right">{money(l.unit_price)}</td>
                <td className="num text-right">{money(l.line_total)}</td>
                {order.status === 'placed' && <>
                  <td className="num text-right">{qty(l.available)}</td>
                  <td className="pl-3">
                    {l.backordered > 0 ? (
                      <div className="space-y-1">
                        <Badge tone="red">{qty(l.backordered)} backordered</Badge>
                        <p className="text-xs text-gray-600">Est. available {date(l.est_available_date)}</p>
                        {order.location_id !== 3 && l.kind !== 'kit' && warehouse(l.item_id) > 0 && (
                          <Button size="sm" busy={busy === `move${l.id}`}
                            onClick={() => act(`move${l.id}`, 'transfer_stock', { p_item_id: l.item_id, p_from_location_id: 3, p_to_location_id: order.location_id, p_qty: Math.min(l.backordered, warehouse(l.item_id)), p_note: `For ${docNo('sales_order', order.id)}` },
                              `Moved ${Math.min(l.backordered, warehouse(l.item_id))} from the warehouse`)}>
                            <ArrowRightLeft className="size-3.5" />Move {qty(Math.min(l.backordered, warehouse(l.item_id)))} from warehouse
                          </Button>
                        )}
                      </div>
                    ) : <Badge tone="green">Ready</Badge>}
                  </td>
                </>}
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-gray-200 font-semibold"><td className="py-2" colSpan={3}>Order total (before tax)</td><td className="num text-right">{money(order.total)}</td></tr></tfoot>
        </table>
      )}

      <div className="mt-5 space-y-3">
        <ErrorNote error={error} />
        {blocked && <p className="text-sm text-gray-600">This order can't be fulfilled until the backordered items are in stock at {order.location_name}.</p>}
        <div className="flex flex-wrap gap-2">
          {order.status === 'placed' && <>
            <Button variant="primary" disabled={blocked} busy={busy === 'fulfill'}
              onClick={() => act('fulfill', 'fulfill_sales_order', { p_id: order.id }, `${docNo('sales_order', order.id)} fulfilled: stock picked and the sale posted`)}>
              <Check className="size-4" />Fulfill order
            </Button>
            <Button variant="ghost" busy={busy === 'cancel'} onClick={() => act('cancel', 'cancel_sales_order', { p_id: order.id }, 'Order cancelled')}><X className="size-4" />Cancel order</Button>
          </>}
          {order.status === 'fulfilled' && (
            <Button variant="primary" busy={busy === 'close'} onClick={() => act('close', 'close_sales_order', { p_id: order.id }, 'Order closed: customer picked it up')}>
              <Check className="size-4" />Mark picked up (close)
            </Button>
          )}
          {order.sale_id && <Button onClick={() => setReceipt(order.sale_id)}><Receipt className="size-4" />Receipt</Button>}
        </div>
      </div>
      <ReceiptModal saleId={receipt} onClose={() => setReceipt(null)} />
    </Drawer>
  )
}

type DraftLine = { item_id: string; qty: string }

export function NewOrderModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const { data: customers } = useCustomers()
  const { data: locations } = useLocations()
  const { data: items } = useItems()
  const availability = useAvailability()
  const qc = useQueryClient()
  const toast = useToast()
  const [customer, setCustomer] = useState('')
  const [location, setLocation] = useState('1')
  const [pickup, setPickup] = useState(nextOpenDay(addDays(today(), 1)))
  const [lines, setLines] = useState<DraftLine[]>([{ item_id: '', qty: '1' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const sellable = (items ?? []).filter((i) => i.kind !== 'component' && i.active)
  const valid = lines.filter((l) => l.item_id && Number(l.qty) > 0)
  const set = (i: number, k: keyof DraftLine, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)))

  async function save() {
    setBusy(true); setError(null)
    try {
      const id = await rpc<number>('create_sales_order', {
        p_customer_id: Number(customer), p_location_id: Number(location), p_requested_date: pickup,
        p_lines: valid.map((l) => ({ item_id: Number(l.item_id), qty: Number(l.qty) })),
      })
      await qc.invalidateQueries()
      toast(`${docNo('sales_order', id)} placed`)
      setLines([{ item_id: '', qty: '1' }]); setCustomer('')
      onCreated(id)
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New sales order" wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!customer || !valid.length || isSunday(pickup)} onClick={save}>Place order</Button></>}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Customer">
          <Select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">Choose…</option>
            {(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Pickup location">
          <Select value={location} onChange={(e) => setLocation(e.target.value)}>
            {(locations ?? []).filter((l) => l.kind !== 'hold').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Pickup date" hint={isSunday(pickup) ? <span className="text-red-600">Closed Sundays</span> : undefined}>
          <Input type="date" min={addDays(today(), 0)} value={pickup} onChange={(e) => setPickup(e.target.value)} />
        </Field>
      </div>
      <table className="mt-4 w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-500"><th className="pb-1">Item</th><th className="w-24 pb-1">Qty</th><th className="pb-1 text-right">Price</th><th className="pb-1 pl-3">At pickup location</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => {
            const item = sellable.find((x) => x.id === Number(l.item_id))
            const a = item ? availability.at(item.id, Number(location)) : undefined
            const short = a && Number(l.qty) > a.available
            return (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <Select value={l.item_id} onChange={(e) => set(i, 'item_id', e.target.value)}>
                    <option value="">Choose an item…</option>
                    {sellable.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Select>
                </td>
                <td className="py-1"><Input type="number" min="1" value={l.qty} onChange={(e) => set(i, 'qty', e.target.value)} /></td>
                <td className="num py-1 text-right">{item ? money(item.price * Number(l.qty || 0)) : ''}</td>
                <td className="py-1 pl-3 text-xs">
                  {a && (short ? <span className="text-red-700">{qty(a.available)} available · rest backordered, est. {date(a.eta)}</span>
                    : <span className="text-emerald-700">{qty(a.available)} available</span>)}
                </td>
                <td className="py-1 pl-2">{lines.length > 1 && <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove line"><X className="size-4" /></button>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Button size="sm" variant="ghost" className="mt-2" onClick={() => setLines((ls) => [...ls, { item_id: '', qty: '1' }])}><Plus className="size-3.5" />Add line</Button>
      <div className="mt-3"><ErrorNote error={error} /></div>
    </Modal>
  )
}
