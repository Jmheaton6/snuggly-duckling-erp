import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { rpc } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { findByCode, useAvailability, useCustomers, useItems, useLocations, useSettings } from '../../lib/queries'
import { money } from '../../lib/format'
import { useToast } from '../../lib/toast'
import type { ItemOverview } from '../../lib/types'
import { ScanInput } from '../../components/ScanInput'
import { ReceiptModal } from '../../components/Receipt'
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner, cx } from '../../components/ui'

type Line = { item_id: number; qty: number; discount: number }
const round2 = (n: number) => Math.round(n * 100) / 100

export function PosPage() {
  const { profile } = useAuth()
  const { data: items, isLoading } = useItems()
  const { data: locations } = useLocations()
  const { data: customers } = useCustomers()
  const availability = useAvailability()
  const settings = useSettings()
  const qc = useQueryClient()
  const toast = useToast()

  const stores = (locations ?? []).filter((l) => l.kind === 'store')
  const [locationId, setLocationId] = useState<number | null>(null)
  const store = locationId ?? (stores.find((s) => s.id === profile?.home_location_id) ?? stores[0])?.id
  const [cart, setCart] = useState<Line[]>([])
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [discMode, setDiscMode] = useState<'%' | '$'>('%')
  const [discValue, setDiscValue] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [tender, setTender] = useState<'card' | 'cash'>('card')
  const [cashGiven, setCashGiven] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [receipt, setReceipt] = useState<number | null>(null)

  const sellable = useMemo(() => (items ?? []).filter((i) => i.kind !== 'component' && i.active), [items])
  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items])
  const categories = [...new Set(sellable.map((i) => i.category))]
  const shown = sellable.filter((i) => (!category || i.category === category) && (!search || i.name.toLowerCase().includes(search.toLowerCase())))
  const avail = (id: number) => (store ? availability.at(id, store)?.available ?? 0 : 0)
  const inCart = (id: number) => cart.find((l) => l.item_id === id)?.qty ?? 0

  function add(item: ItemOverview, n = 1) {
    if (item.kind === 'component') { toast(`${item.name} is a component and isn't sold on its own`, 'error'); return }
    if (inCart(item.id) + n > avail(item.id)) toast(`Only ${avail(item.id)} ${item.name} available here`, 'error')
    setCart((c) => c.some((l) => l.item_id === item.id)
      ? c.map((l) => (l.item_id === item.id ? { ...l, qty: l.qty + n } : l))
      : [...c, { item_id: item.id, qty: n, discount: 0 }])
  }
  const setQty = (id: number, q: number) => setCart((c) => (q <= 0 ? c.filter((l) => l.item_id !== id) : c.map((l) => (l.item_id === id ? { ...l, qty: q } : l))))
  const setLineDisc = (id: number, d: number) => setCart((c) => c.map((l) => (l.item_id === id ? { ...l, discount: Math.max(0, d) } : l)))

  function onScan(code: string) {
    const item = findByCode(items, code)
    if (!item) toast(`No item has barcode ${code}`, 'error')
    else add(item)
  }

  // Same arithmetic the database uses in post_sale, so the preview matches the receipt.
  const rate = settings.get('tax_rate') ?? 0
  const subtotal = round2(cart.reduce((s, l) => s + round2(l.qty * (byId.get(l.item_id)?.price ?? 0)), 0))
  const lineDisc = round2(cart.reduce((s, l) => s + round2(l.discount), 0))
  const base = subtotal - lineDisc
  const dv = Number(discValue) || 0
  const orderDisc = Math.min(round2(discMode === '%' ? (base * dv) / 100 : dv), Math.max(base, 0))
  const discount = round2(lineDisc + orderDisc)
  const tax = round2((subtotal - discount) * rate)
  const total = round2(subtotal - discount + tax)
  const change = tender === 'cash' && cashGiven ? round2(Number(cashGiven) - total) : null

  async function charge() {
    if (!store || !cart.length) return
    setBusy(true); setError(null)
    try {
      const id = await rpc<number>('post_sale', {
        p_location_id: store,
        p_lines: cart.map((l) => ({ item_id: l.item_id, qty: l.qty, discount: l.discount })),
        p_order_discount: orderDisc,
        p_customer_id: customerId ? Number(customerId) : null,
        p_tender: tender,
      })
      setReceipt(id)
      setCart([]); setDiscValue(''); setCustomerId(''); setCashGiven(''); setTender('card')
      await qc.invalidateQueries()
      toast(`Sale complete: ${money(total)}`)
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  if (isLoading) return <Spinner />
  return (
    <>
      <PageHeader title="Point of Sale"
        description="Scan a label (USB scanner or camera) or tap a product. Completing the sale lowers stock at this store and posts revenue, tax and cost of goods sold."
        actions={
          <Select value={store ?? ''} onChange={(e) => { setLocationId(Number(e.target.value)); setCart([]) }} className="w-52">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        } />
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-3">
          <ScanInput onScan={onScan} autoFocus continuous placeholder="Scan a barcode, or type one and press Enter" />
          <div className="flex flex-wrap items-center gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" className="h-8 w-56" />
            {['', ...categories].map((c) => (
              <button key={c || 'all'} onClick={() => setCategory(c)}
                className={cx('rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset', category === c ? 'bg-gray-900 text-white ring-gray-900' : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-50')}>
                {c || 'All'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((i) => {
              const a = avail(i.id) - inCart(i.id)
              return (
                <button key={i.id} onClick={() => add(i)} disabled={a <= 0}
                  className="flex min-h-24 flex-col justify-between rounded-lg border border-gray-200 bg-white p-3 text-left shadow-xs transition hover:border-duck-400 hover:bg-duck-50 disabled:cursor-not-allowed disabled:opacity-45">
                  <span className="text-sm font-medium leading-snug">{i.name}</span>
                  <span className="mt-2 flex items-end justify-between">
                    <span className="num font-semibold">{money(i.price)}</span>
                    <span className={cx('text-[11px]', a <= 0 ? 'text-red-600' : a < 5 ? 'text-duck-700' : 'text-gray-500')}>{a <= 0 ? 'Out here' : `${a} here`}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <Card title={`Current sale · ${cart.reduce((s, l) => s + l.qty, 0)} items`} className="h-fit xl:sticky xl:top-0"
          actions={cart.length > 0 && <Button size="sm" variant="ghost" onClick={() => setCart([])}>Clear</Button>}>
          {cart.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">Scan or tap a product to start a sale.</p> : (
            <ul className="-mx-1 mb-3 max-h-[42vh] divide-y divide-gray-100 overflow-y-auto">
              {cart.map((l) => {
                const it = byId.get(l.item_id)!
                return (
                  <li key={l.item_id} className="px-1 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{it.name}</p>
                        <p className="text-xs text-gray-500">{money(it.price)} each{it.kind === 'kit' && <> · <Badge tone="purple">packed at counter</Badge></>}</p>
                      </div>
                      <p className="num text-sm font-semibold">{money(round2(l.qty * it.price) - l.discount)}</p>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex items-center rounded-md border border-gray-300">
                        <button onClick={() => setQty(l.item_id, l.qty - 1)} className="px-2 py-1 text-gray-500 hover:text-gray-900" aria-label="Less"><Minus className="size-3.5" /></button>
                        <span className="num w-7 text-center text-sm">{l.qty}</span>
                        <button onClick={() => setQty(l.item_id, l.qty + 1)} className="px-2 py-1 text-gray-500 hover:text-gray-900" aria-label="More"><Plus className="size-3.5" /></button>
                      </div>
                      <label className="flex items-center gap-1 text-xs text-gray-500">
                        Line discount $
                        <input type="number" min="0" step="0.01" value={l.discount || ''} onChange={(e) => setLineDisc(l.item_id, Number(e.target.value))}
                          className="h-7 w-16 rounded border border-gray-300 px-1.5 text-right text-xs" />
                      </label>
                      <button onClick={() => setQty(l.item_id, 0)} className="ml-auto text-gray-400 hover:text-red-600" aria-label="Remove"><Trash2 className="size-4" /></button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="space-y-3 border-t border-gray-100 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Order discount">
                <div className="flex">
                  <Input type="number" min="0" step="0.01" value={discValue} onChange={(e) => setDiscValue(e.target.value)} className="rounded-r-none" placeholder="0" />
                  <button onClick={() => setDiscMode(discMode === '%' ? '$' : '%')} className="h-9 rounded-r-md border border-l-0 border-gray-300 bg-gray-50 px-2.5 text-sm font-medium" title="Switch between percent and dollars">{discMode}</button>
                </div>
              </Field>
              <Field label="Customer (optional)">
                <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Walk-in</option>
                  {(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            </div>
            <dl className="num space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-gray-600">Subtotal</dt><dd>{money(subtotal)}</dd></div>
              {discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Discounts</dt><dd>−{money(discount)}</dd></div>}
              <div className="flex justify-between"><dt className="text-gray-600">Sales tax ({(rate * 100).toFixed(2)}%)</dt><dd>{money(tax)}</dd></div>
              <div className="flex justify-between border-t border-gray-100 pt-1 text-lg font-semibold"><dt>Total</dt><dd>{money(total)}</dd></div>
            </dl>
            <div className="grid grid-cols-2 gap-2">
              {(['card', 'cash'] as const).map((t) => (
                <button key={t} onClick={() => setTender(t)}
                  className={cx('h-9 rounded-md text-sm font-medium ring-1 ring-inset', tender === t ? 'bg-duck-50 ring-duck-500' : 'ring-gray-300 hover:bg-gray-50')}>
                  {t === 'card' ? 'Card' : 'Cash'}
                </button>
              ))}
            </div>
            {tender === 'cash' && (
              <Field label="Cash received">
                <Input type="number" min="0" step="0.01" value={cashGiven} onChange={(e) => setCashGiven(e.target.value)} placeholder={total.toFixed(2)} />
                {change != null && <p className={cx('mt-1 text-sm font-medium', change < 0 ? 'text-red-600' : 'text-emerald-700')}>{change < 0 ? `Short ${money(-change)}` : `Change due ${money(change)}`}</p>}
              </Field>
            )}
            <ErrorNote error={error} />
            <Button variant="accent" className="h-11 w-full text-base" busy={busy} disabled={!cart.length || (change != null && change < 0)} onClick={charge}>
              Charge {money(total)}
            </Button>
          </div>
        </Card>
      </div>
      <ReceiptModal saleId={receipt} onClose={() => setReceipt(null)} />
    </>
  )
}
