import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { must, supabase } from '../../lib/supabase'
import { useItems, useLocations } from '../../lib/queries'
import { addDays, date, money, money0, pct, today } from '../../lib/format'
import type { DailySales } from '../../lib/types'
import { Card, ErrorNote, Kpi, PageHeader, Spinner } from '../../components/ui'

// Categorical slots 1–2 of the dataviz reference palette (validated adjacent pair, light surface).
const SERIES = ['#2a78d6', '#eb6834']

const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

export function Dashboard() {
  const t = today()
  const { data: locations } = useLocations()
  const { data: items } = useItems()
  const sales = useQuery({
    queryKey: ['sales', 'daily', t],
    queryFn: () => must(supabase.from('v_daily_sales').select('*').gte('day', addDays(t, -62)).order('day')) as Promise<DailySales[]>,
  })
  const pipeline = useQuery({
    queryKey: ['sales_orders', 'purchase_orders', 'supplier_bills', 'dashboard'],
    queryFn: async () => {
      const [openSo, openPo, bills] = await Promise.all([
        count(supabase.from('sales_orders').select('id', { count: 'exact', head: true }).eq('status', 'placed')),
        count(supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).in('status', ['sent', 'partial'])),
        must(supabase.from('supplier_bills').select('amount, due_date').is('paid_at', null)) as Promise<{ amount: number; due_date: string }[]>,
      ])
      const dueSoon = bills.filter((b) => b.due_date <= addDays(t, 7))
      return { openSo, openPo, owed: bills.reduce((s, b) => s + b.amount, 0), dueSoon: dueSoon.reduce((s, b) => s + b.amount, 0) }
    },
  })

  if (sales.isLoading) return <Spinner />
  const rows = sales.data ?? []
  const sum = (from: string, to: string, f: (r: DailySales) => number) => rows.filter((r) => r.day >= from && r.day <= to).reduce((s, r) => s + f(r), 0)
  const todaySales = sum(t, t, (r) => r.net_sales)
  const last7 = sum(addDays(t, -6), t, (r) => r.net_sales)
  const prior7 = sum(addDays(t, -13), addDays(t, -7), (r) => r.net_sales)
  const sales30 = sum(addDays(t, -29), t, (r) => r.net_sales)
  const cogs30 = sum(addDays(t, -29), t, (r) => r.cogs)
  const invValue = (items ?? []).reduce((s, i) => s + i.inventory_value, 0)
  const stores = (locations ?? []).filter((l) => l.kind === 'store')

  const chart: Record<string, string | number>[] = []
  for (let d = addDays(t, -41); d <= t; d = addDays(d, 1)) {
    const point: Record<string, string | number> = { day: d.slice(5) }
    for (const s of stores) point[s.name] = rows.find((r) => r.day === d && r.location_id === s.id)?.net_sales ?? 0
    chart.push(point)
  }

  return (
    <>
      <PageHeader title="Dashboard" description={`Today is ${date(t)}. Every figure here is computed live from posted transactions.`} />
      <ErrorNote error={sales.error ?? pipeline.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Net sales today" value={money(todaySales)} sub={todaySales === 0 ? 'Stores open 10am–8pm, closed Sunday' : undefined} />
        <Kpi label="Net sales, last 7 days" value={money0(last7)}
          sub={prior7 ? `${last7 >= prior7 ? '+' : ''}${pct((last7 - prior7) / prior7, 1)} vs prior 7 days` : undefined}
          tone={last7 >= prior7 ? 'good' : 'bad'} />
        <Kpi label="Gross margin, 30 days" value={pct(sales30 ? (sales30 - cogs30) / sales30 : null, 1)} sub={`${money0(sales30 - cogs30)} on ${money0(sales30)}`} />
        <Kpi label="Inventory value (avg cost)" value={money0(invValue)} sub={`${items?.length ?? 0} items, all locations`} />
        <Kpi label="Open sales orders" value={pipeline.data?.openSo ?? '—'} sub="Placed, waiting for pickup" />
        <Kpi label="Purchase orders in transit" value={pipeline.data?.openPo ?? '—'} sub="Sent or partly received" />
        <Kpi label="Owed to suppliers" value={money0(pipeline.data?.owed)} sub={`${money0(pipeline.data?.dueSoon)} due in the next 7 days`} />
        <Kpi label="Tickets, last 7 days" value={sum(addDays(t, -6), t, (r) => r.tickets).toLocaleString()}
          sub={`Avg ticket ${money(last7 / Math.max(1, sum(addDays(t, -6), t, (r) => r.tickets)))}`} />
      </div>

      <Card title="Net sales by store, last 6 weeks" className="mt-4">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="#eef0f2" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#d1d5db' }} interval={6} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v) => money(Number(v))} cursor={{ fill: '#f3f4f6' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
              {stores.map((s, i) => (
                <Bar key={s.id} dataKey={s.name} stackId="a" fill={SERIES[i]} stroke="#ffffff" strokeWidth={1}
                  radius={i === stores.length - 1 ? [4, 4, 0, 0] : 0} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-gray-500">Gaps are Sundays, when both stores are closed.</p>
      </Card>
    </>
  )
}
