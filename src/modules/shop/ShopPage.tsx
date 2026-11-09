import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LogOut, MapPin, Search } from 'lucide-react'
import { must, rpc, supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useLocations } from '../../lib/queries'
import { date, docNo, money } from '../../lib/format'
import { useRealtimeSync } from '../../lib/realtime'
import type { Item } from '../../lib/types'
import { Badge, Card, ErrorNote, Spinner, cx } from '../../components/ui'
import { Logo } from '../../app/Shell'

type Availability = { item_id: number; location_id: number; available: number }
type Order = { id: number; status: string; requested_date: string; location_id: number; sales_order_lines: { item_id: number; qty: number; unit_price: number }[] }

// Customer-facing portal: what's in stock where, and the customer's own pickup orders.
export function ShopPage() {
  const { profile, session, signOut } = useAuth()
  const { data: locations } = useLocations()
  useRealtimeSync(session?.user.id, () => '')
  const [term, setTerm] = useState('')
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
    queryFn: () => must(supabase.from('sales_orders').select('id, status, requested_date, location_id, sales_order_lines(item_id, qty, unit_price)').order('id', { ascending: false }).limit(20)) as Promise<Order[]>,
  })

  const pickup = (locations ?? []).filter((l) => l.kind !== 'hold')
  // Gift boxes count as available when the components on hand could pack them.
  const available = useMemo(() => {
    const rows = catalog.data?.stock ?? []
    return (item: Item, loc: number) => rows.find((s) => s.item_id === item.id && s.location_id === loc)?.available ?? 0
  }, [catalog.data])

  const items = (catalog.data?.items ?? []).filter((i) => !term || i.name.toLowerCase().includes(term.toLowerCase()))
  const name = (id: number) => catalog.data?.items.find((i) => i.id === id)?.name ?? `Item ${id}`

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
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_320px]">
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">Shop for pickup</h1>
              <p className="text-sm text-gray-500">Live stock at each location. Online ordering opens in the next build phase.</p>
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
                <div key={i.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium leading-snug">{i.name}</p>
                      <p className="text-xs text-gray-500">{i.category}</p>
                    </div>
                    <p className="num font-semibold">{money(i.price)}</p>
                  </div>
                  <ul className="mt-3 space-y-1 text-xs">
                    {pickup.map((l) => {
                      const n = available(i, l.id)
                      return (
                        <li key={l.id} className="flex items-center justify-between">
                          <span className="flex items-center gap-1 text-gray-600"><MapPin className="size-3" />{l.name}</span>
                          <span className={cx('num font-medium', n <= 0 ? 'text-gray-400' : n < 5 ? 'text-duck-700' : 'text-emerald-700')}>
                            {n <= 0 ? 'Out of stock' : n < 5 ? `Only ${n} left` : `${n} available`}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
        <aside>
          <Card title="Your pickup orders">
            <ErrorNote error={orders.error} />
            {(orders.data ?? []).length === 0 && <p className="text-sm text-gray-500">No orders yet.</p>}
            <ul className="divide-y divide-gray-100">
              {(orders.data ?? []).map((o) => (
                <li key={o.id} className="py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{docNo('sales_order', o.id)}</span>
                    <Badge tone={o.status === 'placed' ? 'yellow' : o.status === 'cancelled' ? 'gray' : 'green'}>
                      {o.status === 'placed' ? 'Order placed' : o.status[0].toUpperCase() + o.status.slice(1)}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-500">Pickup {date(o.requested_date)} · {locations?.find((l) => l.id === o.location_id)?.name}</p>
                  <p className="mt-1 text-xs text-gray-600">{o.sales_order_lines.map((l) => `${l.qty}× ${name(l.item_id)}`).join(', ')}</p>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </main>
    </div>
  )
}
