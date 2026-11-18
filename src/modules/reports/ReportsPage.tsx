import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { must, rpc, supabase } from '../../lib/supabase'
import { useItems, useLocations } from '../../lib/queries'
import { addDays, date, money, money0, pct, qty, today } from '../../lib/format'
import type { DailySales } from '../../lib/types'
import { DataTable, type Column } from '../../components/DataTable'
import { Badge, Button, Card, ErrorNote, Field, Input, Spinner, PageHeader, cx } from '../../components/ui'

// Chart series from the Graphite and gold design system (chart-series-1, chart-series-2), same as the dashboard.
const SERIES = ['#52525b', '#eab308']
const TABS = [['sales', 'Sales by day / week'], ['top', 'Top sellers'], ['low', 'Low stock'], ['locations', 'Inventory by location'], ['suppliers', 'Supplier performance']] as const
type Tab = (typeof TABS)[number][0]
const mondayOf = (d: string) => addDays(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7))

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('sales')
  const [from, setFrom] = useState(addDays(today(), -55))
  const [to, setTo] = useState(today())
  const ranged = tab === 'sales' || tab === 'top'
  return (
    <>
      <PageHeader title="Reports" description="Manager reports, computed live from posted transactions." />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-200">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm', tab === k ? 'border-gold-500 font-medium text-zinc-900' : 'border-transparent text-zinc-600 hover:text-zinc-800')}>{label}</button>
        ))}
      </div>
      {ranged && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" className="w-44" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" className="w-44" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="flex gap-1 pb-0.5">
            {[[7, 'Last 7 days'], [30, 'Last 30 days'], [56, 'Last 8 weeks'], [182, 'Last 6 months']].map(([d, label]) => (
              <Button key={d} size="sm" variant="ghost" onClick={() => { setFrom(addDays(today(), -(Number(d) - 1))); setTo(today()) }}>{label}</Button>
            ))}
          </div>
        </div>
      )}
      {tab === 'sales' && <SalesReport from={from} to={to} />}
      {tab === 'top' && <TopSellers from={from} to={to} />}
      {tab === 'low' && <LowStock />}
      {tab === 'locations' && <ByLocation />}
      {tab === 'suppliers' && <SupplierPerformance />}
    </>
  )
}

function SalesReport({ from, to }: { from: string; to: string }) {
  const [by, setBy] = useState<'day' | 'week'>('week')
  const { data: locations } = useLocations()
  const q = useQuery({
    queryKey: ['sales', 'daily', from, to],
    queryFn: () => must(supabase.from('v_daily_sales').select('*').gte('day', from).lte('day', to).order('day')) as Promise<DailySales[]>,
  })
  if (q.isLoading) return <Spinner />
  const stores = (locations ?? []).filter((l) => l.kind === 'store')
  const key = (d: string) => (by === 'week' ? mondayOf(d) : d)
  const buckets = [...new Set((q.data ?? []).map((r) => key(r.day)))].sort()
  const rows = buckets.map((b) => {
    const list = (q.data ?? []).filter((r) => key(r.day) === b)
    const sales = list.reduce((s, r) => s + Number(r.net_sales), 0), cogs = list.reduce((s, r) => s + Number(r.cogs), 0)
    const point: Record<string, string | number> = { period: b, label: by === 'week' ? `Wk of ${b.slice(5)}` : b.slice(5), tickets: list.reduce((s, r) => s + r.tickets, 0), sales, cogs, margin: sales - cogs }
    for (const s of stores) point[s.name] = list.filter((r) => r.location_id === s.id).reduce((t, r) => t + Number(r.net_sales), 0)
    return point
  })
  type Row = (typeof rows)[number]
  const total = rows.reduce((s, r) => s + Number(r.sales), 0)
  const columns: Column<Row>[] = [
    { key: 'period', header: by === 'week' ? 'Week of' : 'Day', render: (r) => date(String(r.period)) },
    ...stores.map((s): Column<Row> => ({ key: s.name, header: s.name, align: 'right', render: (r) => money(Number(r[s.name])) })),
    { key: 'sales', header: 'Net sales', align: 'right', render: (r) => <span className="font-medium">{money(Number(r.sales))}</span> },
    { key: 'tickets', header: 'Tickets', align: 'right' },
    { key: 'avg', header: 'Avg ticket', align: 'right', value: (r) => Number(r.sales) / Number(r.tickets), render: (r) => money(Number(r.sales) / Math.max(1, Number(r.tickets))) },
    { key: 'margin', header: 'Gross margin', align: 'right', value: (r) => Number(r.margin) / Number(r.sales), render: (r) => pct(Number(r.sales) ? Number(r.margin) / Number(r.sales) : null, 1) },
  ]
  return (
    <div className="space-y-4">
      <ErrorNote error={q.error} />
      <Card title={`Net sales by store · ${money0(total)}`} actions={
        <div className="inline-flex rounded-md border border-zinc-300 p-0.5 text-sm">
          {(['day', 'week'] as const).map((b) => <button key={b} onClick={() => setBy(b)} className={cx('rounded px-3 py-1', by === b ? 'bg-zinc-900 font-medium text-white' : 'text-zinc-700')}>By {b}</button>)}
        </div>}>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={by === 'week' ? 6 : 2}>
              <CartesianGrid vertical={false} stroke="#f4f4f5" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#52525b' }} tickLine={false} axisLine={{ stroke: '#d4d4d8' }} interval={by === 'week' ? 0 : 6} />
              <YAxis tick={{ fontSize: 11, fill: '#52525b' }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => money0(Number(v))} />
              <Tooltip formatter={(v) => money(Number(v))} cursor={{ fill: '#f4f4f5' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} itemStyle={{ color: '#18181b' }} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: '#3f3f46' }}>{v}</span>} />
              {stores.map((s, i) => <Bar key={s.id} dataKey={s.name} stackId="a" fill={SERIES[i]} stroke="#ffffff" strokeWidth={1} radius={i === stores.length - 1 ? [4, 4, 0, 0] : 0} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card padded={false}><DataTable rows={rows} columns={columns} rowKey={(r) => String(r.period)} dense /></Card>
    </div>
  )
}

type Top = { item_id: number; sku: string; name: string; category: string; units: number; net_sales: number; cogs: number; tickets: number }
function TopSellers({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['sales', 'top', from, to], queryFn: () => rpc<Top[]>('top_items', { p_from: from, p_to: to }) })
  if (q.isLoading) return <Spinner />
  const rows = (q.data ?? []).map((r) => ({ ...r, units: Number(r.units), net_sales: Number(r.net_sales), cogs: Number(r.cogs) }))
  const total = rows.reduce((s, r) => s + r.net_sales, 0)
  const max = Math.max(1, ...rows.map((r) => r.net_sales))
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'rank', header: '#', value: (r) => rows.indexOf(r) + 1, render: (r) => <span className="text-zinc-600">{rows.indexOf(r) + 1}</span> },
    { key: 'name', header: 'Item', render: (r) => <span className="font-medium">{r.name}<span className="block text-xs font-normal text-zinc-600">{r.sku} · {r.category}</span></span> },
    { key: 'units', header: 'Units', align: 'right', render: (r) => qty(r.units) },
    { key: 'net_sales', header: 'Net sales', align: 'right', render: (r) => (
      <span className="flex items-center justify-end gap-2"><span className="hidden h-2 rounded-full bg-zinc-600 sm:block" style={{ width: `${(r.net_sales / max) * 120}px` }} /><span className="w-20 font-medium">{money(r.net_sales)}</span></span>) },
    { key: 'share', header: 'Share', align: 'right', value: (r) => r.net_sales / total, render: (r) => pct(r.net_sales / total, 1) },
    { key: 'margin', header: 'Gross margin', align: 'right', value: (r) => (r.net_sales - r.cogs) / r.net_sales, render: (r) => pct(r.net_sales ? (r.net_sales - r.cogs) / r.net_sales : null, 1) },
  ]
  return (
    <>
      <ErrorNote error={q.error} />
      <Card padded={false} title={`${date(from)} – ${date(to)} · ${money0(total)} net sales (before returns)`}>
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.item_id} dense />
      </Card>
    </>
  )
}

type Rep = { item_id: number; sku: string; name: string; uom: string; kind: string; supplier_name: string | null; position: number; on_hand: number; on_order: number; rop: number; eoq: number | null; below_rop: boolean; order_by: string | null; avg_daily: number }
function LowStock() {
  const q = useQuery({ queryKey: ['stock', 'replenishment'], queryFn: () => must(supabase.from('v_replenishment').select('*').order('order_by')) as Promise<Rep[]> })
  if (q.isLoading) return <Spinner />
  const soon = addDays(today(), 7)
  const rows = (q.data ?? []).filter((r) => r.below_rop || (r.order_by != null && r.order_by <= soon))
  const columns: Column<Rep>[] = [
    { key: 'name', header: 'Item', render: (r) => <span className="font-medium">{r.name}<span className="block text-xs font-normal text-zinc-600">{r.sku} · {r.kind === 'made' ? 'Made in-house' : r.supplier_name}</span></span> },
    { key: 'position', header: 'On hand + on order', align: 'right', render: (r) => qty(Number(r.position), r.uom) },
    { key: 'rop', header: 'Reorder point', align: 'right', render: (r) => qty(Number(r.rop), r.uom) },
    { key: 'eoq', header: 'Suggested qty (EOQ)', align: 'right', render: (r) => <span className="font-semibold">{qty(Number(r.eoq), r.uom)}</span> },
    { key: 'order_by', header: 'Order by', render: (r) => (r.below_rop ? <Badge tone="red">Today</Badge> : date(r.order_by)) },
  ]
  return (
    <>
      <ErrorNote error={q.error} />
      <Card padded={false} title="At or near the reorder point (order within 7 days)" actions={<Link to="/replenishment" className="text-sm font-medium text-gold-800 hover:underline">Open Replenishment to order →</Link>}>
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.item_id} dense empty="Nothing needs ordering in the next 7 days." />
      </Card>
    </>
  )
}

function ByLocation() {
  const { data: items, isLoading } = useItems()
  const { data: locations } = useLocations()
  if (isLoading || !items) return <Spinner />
  const rows = items.filter((i) => i.active)
  const valueAt = (code: string) => rows.reduce((s, i) => s + Number(i.by_location[code] ?? 0) * Number(i.avg_cost), 0)
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'name', header: 'Item', render: (r) => <span className="font-medium">{r.name}<span className="block text-xs font-normal text-zinc-600">{r.sku}</span></span> },
    ...(locations ?? []).map((l): Column<(typeof rows)[number]> => ({
      key: l.code, header: l.name, align: 'right', value: (r) => Number(r.by_location[l.code] ?? 0),
      render: (r) => (Number(r.by_location[l.code] ?? 0) ? qty(Number(r.by_location[l.code]), r.uom) : <span className="text-zinc-500">0</span>),
    })),
    { key: 'inventory_value', header: 'Value', align: 'right', render: (r) => money(Number(r.inventory_value)) },
  ]
  return (
    <Card padded={false} title={<span>Inventory by location <span className="font-normal text-zinc-600">· {(locations ?? []).map((l) => `${l.name} ${money0(valueAt(l.code))}`).join(' · ')}</span></span>}>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} dense search />
    </Card>
  )
}

type Score = { supplier_id: number; name: string; quoted_lead: number; avg_actual_lead: number | null; on_time_rate: number | null; fill_rate: number | null; pos_received: number; rating: string }
function SupplierPerformance() {
  const q = useQuery({ queryKey: ['suppliers', 'scorecard'], queryFn: () => must(supabase.from('v_supplier_scorecard').select('*')) as Promise<Score[]> })
  if (q.isLoading) return <Spinner />
  const rows = (q.data ?? []).map((s) => ({ ...s, actual: Number(s.avg_actual_lead ?? 0), quoted: Number(s.quoted_lead) }))
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'name', header: 'Supplier', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'pos_received', header: 'POs', align: 'right' },
    { key: 'quoted', header: 'Quoted lead time', align: 'right', render: (r) => `${r.quoted} days` },
    { key: 'actual', header: 'Actual (average)', align: 'right', render: (r) => `${r.actual} days` },
    { key: 'gap', header: 'Difference', align: 'right', value: (r) => r.actual - r.quoted, render: (r) => { const g = Math.round((r.actual - r.quoted) * 10) / 10; return <span className={g > 0.5 ? 'font-semibold text-red-700' : 'text-zinc-700'}>{g > 0 ? '+' : ''}{g} days</span> } },
    { key: 'on_time_rate', header: 'On time', align: 'right', render: (r) => pct(Number(r.on_time_rate)) },
    { key: 'fill_rate', header: 'Fill rate', align: 'right', render: (r) => pct(Number(r.fill_rate), 1) },
    { key: 'rating', header: 'Rating', render: (r) => <Badge tone={r.rating === 'Keep' ? 'green' : r.rating === 'Replace' ? 'red' : 'yellow'}>{r.rating}</Badge> },
  ]
  return (
    <div className="space-y-4">
      <ErrorNote error={q.error} />
      <Card title="Average actual lead time vs quoted (days)">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="#f4f4f5" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#52525b' }} tickLine={false} axisLine={{ stroke: '#d4d4d8' }} interval={0} tickFormatter={(v: string) => v.split(' ')[0]} />
              <YAxis tick={{ fontSize: 11, fill: '#52525b' }} tickLine={false} axisLine={false} width={32} />
              <Tooltip formatter={(v) => `${v} days`} cursor={{ fill: '#f4f4f5' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} itemStyle={{ color: '#18181b' }} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: '#3f3f46' }}>{v}</span>} />
              <Bar dataKey="quoted" name="Quoted" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name="Actual" fill={SERIES[1]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card padded={false}><DataTable rows={rows} columns={columns} rowKey={(r) => r.supplier_id} dense /></Card>
    </div>
  )
}
