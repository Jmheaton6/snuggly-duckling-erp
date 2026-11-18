import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { must, rpc, supabase } from '../../lib/supabase'
import { useItems, useLocations } from '../../lib/queries'
import { addDays, date, money, pct, qty, today } from '../../lib/format'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, Card, ErrorNote, Field, Input, Kpi, MathNote, PageHeader, Spinner, cx } from '../../components/ui'

type Activity = { code: string; name: string; type: string; sort: number; debit: number; credit: number }

// Everything here comes from the journal (the books) and the stock ledger, for the chosen period.
export function FinancialsPage() {
  const t = today()
  const monthStart = t.slice(0, 8) + '01'
  const presets: [string, string, string][] = [
    ['This month', monthStart, t],
    ['Last month', addDays(monthStart, -1).slice(0, 8) + '01', addDays(monthStart, -1)],
    ['Last 90 days', addDays(t, -89), t],
    ['Year to date', t.slice(0, 4) + '-01-01', t],
  ]
  const [from, setFrom] = useState(presets[1][1])
  const [to, setTo] = useState(presets[1][2])

  const activity = useQuery({
    queryKey: ['journal_lines', 'activity', from, to],
    queryFn: () => rpc<Activity[]>('account_activity', { p_from: from, p_to: to }),
  })
  const balances = useQuery({
    queryKey: ['journal_lines', 'balances', from, to],
    queryFn: async () => {
      const [begin, end, wip] = await Promise.all([
        rpc<number>('account_balance', { p_code: '1200', p_as_of: addDays(from, -1) }),
        rpc<number>('account_balance', { p_code: '1200', p_as_of: to }),
        rpc<number>('account_balance', { p_code: '1300', p_as_of: to }),
      ])
      return { begin: Number(begin), end: Number(end), wip: Number(wip) }
    },
  })

  const a = (code: string) => activity.data?.find((x) => x.code === code)
  const cr = (code: string) => Number(a(code)?.credit ?? 0) - Number(a(code)?.debit ?? 0)   // revenue side
  const dr = (code: string) => Number(a(code)?.debit ?? 0) - Number(a(code)?.credit ?? 0)   // contra / cost side
  const revenue = cr('4000'), discounts = dr('4100'), returns = dr('4200')
  const netSales = revenue - discounts - returns
  const cogs = dr('5000'), shrink = dr('5100'), scrap = dr('5200')
  const costOfSales = cogs + shrink + scrap
  const gross = netSales - costOfSales
  const opex = (activity.data ?? []).filter((x) => x.type === 'expense')
  const opexTotal = opex.reduce((s, x) => s + dr(x.code), 0)
  const net = gross - opexTotal
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1
  const b = balances.data
  const avgInv = b ? (b.begin + b.end) / 2 : 0
  const turns = avgInv > 0 ? cogs / avgInv : 0
  const annual = turns * (365 / days)

  return (
    <>
      <PageHeader title="Financials"
        description="Profit & loss, inventory turnover and inventory valuation, built live from the journal. Every sale, return, receipt, adjustment and work order posts here the moment it happens." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" className="w-44" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" className="w-44" value={to} min={from} max={t} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-1 pb-0.5">
          {presets.map(([label, f, tt]) => (
            <Button key={label} size="sm" variant="ghost" className={cx(from === f && to === tt && 'bg-gold-100 text-gold-800')} onClick={() => { setFrom(f); setTo(tt) }}>{label}</Button>
          ))}
        </div>
      </div>
      <ErrorNote error={activity.error ?? balances.error} />
      {activity.isLoading ? <Spinner /> : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card title={`Profit & loss · ${date(from)} – ${date(to)}`} padded={false}>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-zinc-200 text-xs text-zinc-600"><th className="px-4 py-2 text-left font-medium">Account</th><th className="px-4 py-2 text-right font-medium">Amount</th><th className="px-4 py-2 text-right font-medium">% of net sales</th></tr></thead>
              <tbody>
                <Line label="Sales revenue" v={revenue} base={netSales} />
                <Line label="Less sales discounts" v={-discounts} base={netSales} indent />
                <Line label="Less sales returns" v={-returns} base={netSales} indent />
                <Line label="Net sales" v={netSales} base={netSales} total />
                <Line label="Cost of goods sold" v={-cogs} base={netSales} indent />
                <Line label="Inventory shrink & write-offs" v={-shrink} base={netSales} indent />
                <Line label="Production scrap" v={-scrap} base={netSales} indent />
                <Line label="Gross profit" v={gross} base={netSales} total />
                {opex.map((x) => <Line key={x.code} label={x.name} v={-dr(x.code)} base={netSales} indent />)}
                <Line label="Net income" v={net} base={netSales} total strong />
              </tbody>
            </table>
          </Card>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Kpi label="Gross margin" value={pct(netSales ? gross / netSales : null, 1)} sub={`${money(gross)} gross profit`} />
              <Kpi label="Net income" value={money(net)} tone={net >= 0 ? 'good' : 'bad'} sub={`${days} days`} />
              <Kpi label="Inventory turnover" value={`${annual.toFixed(1)}× / year`} sub={`${turns.toFixed(2)} turns in these ${days} days`} />
              <Kpi label="Days of inventory" value={turns > 0 ? `${(days / turns).toFixed(0)} days` : '—'} sub="Average time stock sits before it sells" />
            </div>
            {b && (
              <MathNote title="Inventory turnover = cost of goods sold ÷ average inventory" lines={[
                ['Cost of goods sold', money(cogs)],
                [`Inventory at start (${date(addDays(from, -1))})`, money(b.begin)],
                [`Inventory at end (${date(to)})`, money(b.end)],
                ['Average inventory', `(${money(b.begin)} + ${money(b.end)}) ÷ 2 = ${money(avgInv)}`],
                ['Turnover', `${money(cogs)} ÷ ${money(avgInv)} = ${turns.toFixed(2)} turns`],
                ['Per year', `${turns.toFixed(2)} × 365 ÷ ${days} days = ${annual.toFixed(1)}×`],
                ['Days of inventory', `${days} ÷ ${turns.toFixed(2)} = ${turns > 0 ? (days / turns).toFixed(0) : '—'} days`],
              ]} />
            )}
          </div>
        </div>
      )}
      <Valuation glInventory={b?.end} glWip={b?.wip} asOf={to} />
    </>
  )
}

function Line({ label, v: raw, base, indent, total, strong }: { label: string; v: number; base: number; indent?: boolean; total?: boolean; strong?: boolean }) {
  const v = Math.abs(raw) < 0.005 ? 0 : raw   // no "−$0.00"
  return (
    <tr className={cx(total && 'border-t border-zinc-200 font-semibold', strong && 'bg-zinc-50 text-base')}>
      <td className={cx('px-4 py-1.5', indent && 'pl-8 text-zinc-700')}>{label}</td>
      <td className={cx('num px-4 py-1.5 text-right', v < 0 && 'text-zinc-700')}>{v < 0 ? `(${money(-v)})` : money(v)}</td>
      <td className="num px-4 py-1.5 text-right text-zinc-600">{base ? pct(v / base, 1) : '—'}</td>
    </tr>
  )
}

// Inventory valuation at weighted average cost, by location and by item.
function Valuation({ glInventory, glWip, asOf }: { glInventory?: number; glWip?: number; asOf: string }) {
  const { data: items } = useItems()
  const { data: locations } = useLocations()
  const stock = useQuery({
    queryKey: ['stock', 'valuation'],
    queryFn: () => must(supabase.from('v_stock_by_location').select('item_id, location_id, qty, value')) as Promise<{ item_id: number; location_id: number; qty: number; value: number }[]>,
  })
  if (stock.isLoading || !items) return null
  const rows = items.map((i) => ({ ...i, qty_all: (stock.data ?? []).filter((s) => s.item_id === i.id).reduce((t, s) => t + Number(s.qty), 0) }))
    .filter((i) => i.qty_all > 0)
  const total = (stock.data ?? []).reduce((t, s) => t + Number(s.value), 0)
  const live = asOf === today()
  type Row = (typeof rows)[number]
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Item', render: (r) => <span className="font-medium">{r.name}<span className="block text-xs font-normal text-zinc-600">{r.sku} · {r.category}</span></span> },
    ...(locations ?? []).map((l): Column<Row> => ({ key: `loc${l.id}`, header: l.name, align: 'right', value: (r) => Number(r.by_location[l.code] ?? 0), render: (r) => (r.by_location[l.code] ? qty(Number(r.by_location[l.code]), r.uom) : <span className="text-zinc-500">—</span>) })),
    { key: 'avg_cost', header: 'Avg cost', align: 'right', render: (r) => money(Number(r.avg_cost)) },
    { key: 'inventory_value', header: 'Value', align: 'right', render: (r) => <span className="font-medium">{money(Number(r.inventory_value))}</span> },
  ]
  return (
    <Card title="Inventory valuation (weighted average cost, right now)" className="mt-4" padded={false}>
      <div className="grid gap-3 border-b border-zinc-100 p-4 sm:grid-cols-2 lg:grid-cols-5">
        {(locations ?? []).map((l) => {
          const v = (stock.data ?? []).filter((s) => s.location_id === l.id).reduce((t, s) => t + Number(s.value), 0)
          return <Kpi key={l.id} label={l.name} value={money(v)} sub={pct(total ? v / total : null, 0) + ' of total'} />
        })}
        <Kpi label="Total (on hand × avg cost)" value={money(total)}
          sub={live && glInventory != null ? `Books say ${money(glInventory)}${glWip ? ` + ${money(glWip)} in production` : ''}` : 'Set the period to end today to compare with the books'} />
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} dense search initialSort={{ key: 'inventory_value', dir: 'desc' }} />
      <p className="px-4 pb-3 text-xs text-zinc-600">On hand × average cost should match the Inventory account in the books; any small difference is cents of rounding across thousands of postings.</p>
    </Card>
  )
}
