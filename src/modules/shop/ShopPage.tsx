import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut, MapPin, Minus, Plus, Search, ShoppingBag, X } from 'lucide-react'
import { must, rpc, supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useLocations } from '../../lib/queries'
import { addDays, date, docNo, isSunday, money, nextOpenDay, today } from '../../lib/format'
import { useRealtimeSync } from '../../lib/realtime'
import { useToast } from '../../lib/toast'
import type { Availability, Item, SalesOrderLineRow, SalesOrderRow } from '../../lib/types'
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner, cx } from '../../components/ui'
import { Logo } from '../../app/Shell'

const STATUS: Record<string, { label: string; tone: 'yellow' | 'blue' | 'green' | 'gray' }> = {
  placed: { label: 'Order placed', tone: 'yellow' }, fulfilled: { label: 'Ready for pickup', tone: 'blue' },
  closed: { label: 'Picked up', tone: 'green' }, cancelled: { label: 'Cancelled', tone: 'gray' },
}

// Customer-facing portal: live stock by location, ordering for pickup, and the customer's own orders.
export function ShopPage() {
  const { profile, session, signOut } = useAuth()
  const { data: locations } = useLocations()
  useRealtimeSync(session?.user.id, () => '')
  const qc = useQueryClient()
  const toast = useToast()
  const [term, setTerm] = useState('')
  const [cart, setCart] = useState<Record<number, number>>({})
  const [pickupAt, setPickupAt] = useState('1')
  const [pickupOn, setPickupOn] = useState(nextOpenDay(addDays(today(), 1)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const catalog = useQuery({
    queryKey: ['items', 'stock', 'shop'],
    queryFn: async () => {
      const [items, stock] = await Promise.all([
        must(supabase.from('items').select('*').neq('kind', 'component').eq('active', true).order('category').order('name')) as Promise<Item[]>,
        rpc<Availability[]>('item_availability'),
      ])
      return { items, stock }
    },
  })
  const orders = useQuery({
    queryKey: ['sales_orders', 'mine'],
    queryFn: async () => {
      const list = await must(supabase.from('v_sales_orders').select('*').order('id', { ascending: false }).limit(15)) as SalesOrderRow[]
      const lines = list.length ? await must(supabase.from('v_sales_order_lines').select('*').in('sales_order_id', list.map((o) => o.id))) as SalesOrderLineRow[] : []
      return list.map((o) => ({ ...o, items: lines.filter((l) => l.sales_order_id === o.id) }))
    },
  })

  const pickup = (locations ?? []).filter((l) => l.kind !== 'hold')
  const avail = (itemId: number, loc: number) => catalog.data?.stock.find((s) => s.item_id === itemId && s.location_id === loc)
  const items = (catalog.data?.items ?? []).filter((i) => !term || i.name.toLowerCase().includes(term.toLowerCase()))
  const byId = new Map((catalog.data?.items ?? []).map((i) => [i.id, i]))
  const cartLines = Object.entries(cart).filter(([, n]) => n > 0).map(([id, n]) => ({ item: byId.get(Number(id))!, n })).filter((l) => l.item)
  const subtotal = cartLines.reduce((s, l) => s + l.n * l.item.price, 0)
  const setN = (id: number, n: number) => setCart((c) => ({ ...c, [id]: Math.max(0, n) }))

  async function placeOrder() {
    setBusy(true); setError(null)
    try {
      const id = await rpc<number>('create_sales_order', {
        p_customer_id: profile?.customer_id, p_location_id: Number(pickupAt), p_requested_date: pickupOn,
        p_lines: cartLines.map((l) => ({ item_id: l.item.id, qty: l.n })),
      })
      setCart({})
      await qc.invalidateQueries()
      toast(`Order ${docNo('sales_order', id)} placed. We'll have it ready ${date(pickupOn)}.`)
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  async function cancel(id: number) {
    try { await rpc('cancel_sales_order', { p_id: id }); await qc.invalidateQueries(); toast('Order cancelled') }
    catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className="min-h-full bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Logo />
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">Hi, {profile?.full_name}</span>
            <button onClick={signOut} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Sign out"><LogOut className="size-4" /></button>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_340px]">
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">Order snacks for pickup</h1>
              <p className="text-sm text-gray-500">Live stock at each location. Order today, pick up from tomorrow.</p>
            </div>
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search snacks…"
                className="h-9 w-full rounded-md border border-gray-300 pl-8 pr-2 text-sm focus:border-duck-500 focus:outline-none focus:ring-2 focus:ring-duck-200" />
            </div>
          </div>
          <ErrorNote error={catalog.error} />
          {catalog.isLoading ? <Spinner /> : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((i) => (
                <div key={i.id} className="flex flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium leading-snug">{i.name}</p>
                      <p className="text-xs text-gray-500">{i.category}</p>
                    </div>
                    <p className="num font-semibold">{money(i.price)}</p>
                  </div>
                  <ul className="mt-3 flex-1 space-y-1 text-xs">
                    {pickup.map((l) => {
                      const n = avail(i.id, l.id)?.available ?? 0
                      return (
                        <li key={l.id} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1 text-gray-600"><MapPin className="size-3 shrink-0" /><span className="truncate">{l.name}</span></span>
                          <span className={cx('num shrink-0 whitespace-nowrap font-medium', n <= 0 ? 'text-gray-400' : n < 5 ? 'text-duck-700' : 'text-emerald-700')}>
                            {n <= 0 ? 'Out of stock' : n < 5 ? `Only ${n} left` : `${n} available`}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    {cart[i.id] ? (
                      <div className="flex items-center rounded-md border border-gray-300">
                        <button onClick={() => setN(i.id, (cart[i.id] ?? 0) - 1)} className="px-2 py-1 text-gray-500" aria-label="Less"><Minus className="size-3.5" /></button>
                        <span className="num w-8 text-center text-sm">{cart[i.id]}</span>
                        <button onClick={() => setN(i.id, (cart[i.id] ?? 0) + 1)} className="px-2 py-1 text-gray-500" aria-label="More"><Plus className="size-3.5" /></button>
                      </div>
                    ) : <Button size="sm" onClick={() => setN(i.id, 1)}><Plus className="size-3.5" />Add</Button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <Card title={<span className="flex items-center gap-2"><ShoppingBag className="size-4" />Your order</span>}>
            {cartLines.length === 0 ? <p className="text-sm text-gray-500">Add snacks to start a pickup order.</p> : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Pick up at">
                    <Select value={pickupAt} onChange={(e) => setPickupAt(e.target.value)}>
                      {pickup.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Pick up on" hint={isSunday(pickupOn) ? <span className="text-red-600">We're closed Sundays</span> : undefined}>
                    <Input type="date" min={addDays(today(), 1)} value={pickupOn} onChange={(e) => setPickupOn(e.target.value)} />
                  </Field>
                </div>
                <ul className="divide-y divide-gray-100 text-sm">
                  {cartLines.map(({ item, n }) => {
                    const a = avail(item.id, Number(pickupAt))
                    const short = a && n > a.available
                    return (
                      <li key={item.id} className="py-2">
                        <div className="flex justify-between gap-2">
                          <span>{n}× {item.name}</span>
                          <span className="num">{money(n * item.price)}</span>
                        </div>
                        {short && <p className="text-xs text-duck-700">{Math.max(0, a.available)} ready now; the rest should be in by {date(a.eta)}</p>}
                        <button onClick={() => setN(item.id, 0)} className="text-xs text-gray-400 hover:text-red-600">Remove</button>
                      </li>
                    )
                  })}
                </ul>
                <div className="flex justify-between border-t border-gray-100 pt-2 font-semibold"><span>Subtotal</span><span className="num">{money(subtotal)}</span></div>
                <p className="text-xs text-gray-500">Tax is added and you pay at pickup.</p>
                <ErrorNote error={error} />
                <Button variant="accent" className="w-full" busy={busy} disabled={isSunday(pickupOn)} onClick={placeOrder}>Place pickup order</Button>
              </div>
            )}
          </Card>

          <Card title="Your pickup orders">
            <ErrorNote error={orders.error} />
            {(orders.data ?? []).length === 0 && <p className="text-sm text-gray-500">No orders yet.</p>}
            <ul className="divide-y divide-gray-100">
              {(orders.data ?? []).map((o) => (
                <li key={o.id} className="py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{docNo('sales_order', o.id)}</span>
                    <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                  </div>
                  <p className="text-xs text-gray-500">Pickup {date(o.requested_date)} · {o.location_name} · {money(o.total)}</p>
                  <p className="mt-1 text-xs text-gray-600">{o.items.map((l) => `${l.qty}× ${l.item_name}`).join(', ')}</p>
                  {o.status === 'placed' && o.backordered_lines > 0 && <p className="mt-1 text-xs text-duck-700">Some items are on the way, expected by {date(o.est_available_date)}.</p>}
                  {o.status === 'placed' && (
                    <button onClick={() => cancel(o.id)} className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600"><X className="size-3" />Cancel order</button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </main>
    </div>
  )
}
