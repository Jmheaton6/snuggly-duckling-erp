import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowRight, BookOpen, CircleCheck, FileText, Package, Radio, Waves } from 'lucide-react'
import { must, rpc, supabase } from '../../lib/supabase'
import { addDays, date, dateTime, docNo, money, qty, today } from '../../lib/format'
import { Badge, Card, ErrorNote, PageHeader, Spinner, cx } from '../../components/ui'
import { mondayOf } from '../mrp/engine'

// One row per transaction (from recent_activity) and what it wrote (from ripple).
type Activity = { ref_type: string; ref_id: number; ts: string; lines: number; kinds: string }
type Ledger = {
  id: number; item_id: number; item: string; sku: string; uom: string; location: string; location_kind: string
  qty: number; qty_after: number | null; unit_cost: number; txn_type: string; reason: string | null; avg_before: number | null; avg_after: number | null
}
type Journal = { account: string; name: string; type: string; debit: number; credit: number; memo: string }
type Rep = { item_id: number; name: string; uom: string; on_hand: number; on_order: number; position: number; rop: number; eoq: number | null; below_rop: boolean; order_by: string | null; kind: string }

const LABEL: Record<string, string> = {
  sale: 'Sale', return: 'Return', transfer: 'Transfer', adjustment: 'Stock adjustment', po_receipt: 'PO receipt',
  production: 'Production', bill_payment: 'Supplier payment', expense: 'Expense', sales_order: 'Sales order placed', purchase_order: 'Purchase order sent',
}
const docOf = (a: Pick<Activity, 'ref_type' | 'ref_id' | 'kinds'>) => {
  switch (a.ref_type) {
    case 'sale': return docNo('sale', a.ref_id)
    case 'return': return docNo('return', a.ref_id)
    case 'transfer': return docNo('transfer', a.ref_id)
    case 'production': return docNo('production', a.ref_id)
    case 'sales_order': return docNo('sales_order', a.ref_id)
    case 'purchase_order': return docNo('purchase_order', a.ref_id)
    default: return `#${a.ref_id}`
  }
}
const title = (a: Activity) => a.ref_type === 'production' ? (a.kinds.includes('prod_receipt') ? 'Production completed' : 'Production started') : LABEL[a.ref_type] ?? a.ref_type
// Which screens show something different afterwards (same map as the System Map).
const SCREENS: Record<string, string[]> = {
  sale: ['Inventory', 'Dashboard', 'Customer Shop', 'MRP', 'Replenishment', 'Financials', 'Reports'],
  return: ['Returns', 'Inventory', 'Customer Shop', 'MRP', 'Financials', 'Reports'],
  transfer: ['Inventory', 'Customer Shop', 'Sales Orders (backorders)'],
  adjustment: ['Inventory', 'MRP', 'Replenishment', 'Financials'],
  po_receipt: ['Purchase Orders', 'Inventory', 'Items (avg cost)', 'Suppliers (scorecard)', 'MRP', 'Replenishment', 'Financials'],
  production: ['Production', 'Inventory', 'MRP', 'Financials', 'Reports'],
  bill_payment: ['Purchase Orders', 'Suppliers (owed)', 'Financials', 'Dashboard'],
  expense: ['Financials'],
  sales_order: ['Sales Orders', 'Customer Shop', 'Inventory (committed / backordered)', 'MRP (gross requirements)'],
  purchase_order: ['Purchase Orders', 'Inventory (on order)', 'Sales Orders (est. available dates)', 'MRP (scheduled receipts)', 'Replenishment'],
}
const mrpWeek = (d: string) => Math.max(1, Math.floor((Date.parse(d) - Date.parse(mondayOf(today()))) / (7 * 864e5)) + 1)
const signed = (n: number, f: (n: number) => string) => (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n))

export function RipplePage() {
  const [params, setParams] = useSearchParams()
  const [follow, setFollow] = useState(!params.get('type'))
  const feed = useQuery({ queryKey: ['inventory_txns', 'journal_lines', 'activity'], queryFn: () => rpc<Activity[]>('recent_activity', { p_days: 45, p_limit: 60 }) })
  const wanted = params.get('type') ? { ref_type: params.get('type')!, ref_id: Number(params.get('id')) } : null
  const [picked, setPicked] = useState<Activity | null>(null)

  // Follow live: always show the newest transaction. A deep link (from a receipt) picks that one.
  const list = feed.data ?? []
  const fromLink = wanted ? list.find((a) => a.ref_type === wanted.ref_type && a.ref_id === wanted.ref_id) : undefined
  const current = follow ? list[0] : picked ?? fromLink ?? list[0]
  function choose(a: Activity) { setFollow(false); setPicked(a); if (wanted) setParams({}) }

  return (
    <>
      <PageHeader title="Ripple view"
        description="Every action in the system is one database step that writes the document, the stock ledger and the books together, and everything downstream recalculates. Pick a transaction, or leave Follow live on and make a sale anywhere." />
      <ErrorNote error={feed.error} />
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card padded={false} className="lg:sticky lg:top-4 lg:self-start"
          title="Activity"
          actions={<button onClick={() => setFollow((f) => !f)} className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', follow ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'text-gray-600 ring-gray-300 hover:bg-gray-50')}>
            <Radio className={cx('size-3.5', follow && 'animate-pulse')} />{follow ? 'Following live' : 'Follow live'}
          </button>}>
          {feed.isLoading ? <Spinner /> : (
            <ul className="max-h-[70vh] divide-y divide-gray-100 overflow-y-auto text-sm">
              {list.map((a) => {
                const on = current && a.ref_type === current.ref_type && a.ref_id === current.ref_id && a.ts === current.ts
                return (
                  <li key={`${a.ref_type}-${a.ref_id}-${a.ts}`}>
                    <button onClick={() => choose(a)} className={cx('flex w-full items-start justify-between gap-2 px-4 py-2 text-left', on ? 'bg-duck-50' : 'hover:bg-gray-50')}>
                      <span className="min-w-0"><span className={cx('block', on && 'font-semibold')}>{title(a)}</span><span className="block text-xs text-gray-500">{dateTime(a.ts)}</span></span>
                      <span className="shrink-0 font-mono text-xs text-gray-500">{docOf(a)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
        <div className="min-w-0">{current ? <Ripple key={`${current.ref_type}-${current.ref_id}-${current.ts}`} a={current} /> : !feed.isLoading && <Card><p className="text-sm text-gray-500">No activity in the last 45 days.</p></Card>}</div>
      </div>
    </>
  )
}

function Ripple({ a }: { a: Activity }) {
  const r = useQuery({ queryKey: ['inventory_txns', 'journal_lines', 'ripple', a.ref_type, a.ref_id, a.ts], queryFn: () => rpc<{ ledger: Ledger[]; journal: Journal[] }>('ripple', { p_ref_type: a.ref_type, p_ref_id: a.ref_id, p_ts: a.ts }) })
  const doc = useDocument(a)
  const ledger = r.data?.ledger ?? []
  const journal = r.data?.journal ?? []
  const itemIds = [...new Set([...ledger.map((l) => l.item_id), ...(doc.data?.itemIds ?? [])])]
  const rep = useQuery({
    enabled: itemIds.length > 0,
    queryKey: ['stock', 'replenishment', 'ripple', itemIds.join(',')],
    queryFn: () => must(supabase.from('v_replenishment').select('item_id, name, uom, kind, on_hand, on_order, position, rop, eoq, below_rop, order_by').in('item_id', itemIds)) as Promise<Rep[]>,
  })
  const bo = useQuery({
    enabled: itemIds.length > 0,
    queryKey: ['sales_orders', 'backorders', 'ripple', itemIds.join(',')],
    queryFn: () => must(supabase.from('v_backorders').select('*').in('item_id', itemIds)) as Promise<{ item_id: number; backordered: number; est_available_date: string; orders: number }[]>,
  })
  if (r.isLoading || doc.isLoading) return <Spinner />

  const debits = journal.reduce((s, j) => s + Number(j.debit), 0)
  const credits = journal.reduce((s, j) => s + Number(j.credit), 0)
  const acct = (code: string) => journal.filter((j) => j.account === code).reduce((s, j) => s + Number(j.debit) - Number(j.credit), 0)
  const profit = journal.reduce((s, j) => s + (['revenue', 'contra_revenue'].includes(j.type) ? Number(j.credit) - Number(j.debit) : ['cogs', 'expense'].includes(j.type) ? -(Number(j.debit) - Number(j.credit)) : 0), 0)
  // Company-wide on-hand change per item (Returns Hold isn't sellable, so MRP doesn't count it).
  const delta = new Map<number, number>()
  for (const l of ledger) if (l.location_kind !== 'hold') delta.set(l.item_id, (delta.get(l.item_id) ?? 0) + Number(l.qty))
  const effects: ReactNode[] = []
  for (const e of doc.data?.effects ?? []) effects.push(e)
  for (const [id, d] of delta) {
    const x = rep.data?.find((y) => y.item_id === id)
    if (!x || d === 0) continue
    effects.push(<>MRP: <b>{x.name}</b> starts week 1 with {qty(Number(x.on_hand), x.uom)} on hand ({signed(d, (n) => qty(n, x.uom))}).</>)
  }
  for (const x of rep.data ?? []) {
    effects.push(x.below_rop
      ? <><Badge tone="red">Reorder</Badge> <b>{x.name}</b>: {qty(Number(x.position), x.uom)} on hand + on order is at or below the reorder point ({qty(Number(x.rop), x.uom)}). Order {qty(Number(x.eoq), x.uom)} (EOQ) today.</>
      : <><b>{x.name}</b>: {qty(Number(x.position), x.uom)} on hand + on order vs reorder point {qty(Number(x.rop), x.uom)}; reorder by {date(x.order_by)}.</>)
  }
  for (const b of bo.data ?? []) {
    const x = rep.data?.find((y) => y.item_id === b.item_id)
    effects.push(<><Badge tone="yellow">Backorder</Badge> <b>{x?.name ?? 'Item'}</b>: {qty(Number(b.backordered))} still backordered on {b.orders} order{b.orders === 1 ? '' : 's'}, est. available {date(b.est_available_date)}.</>)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title(a)} <span className="font-mono text-base text-gray-500">{docOf(a)}</span></h2>
        <span className="text-sm text-gray-500">{dateTime(a.ts)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Step icon={FileText} label="Document" n={1} />
        <ArrowRight className="size-3.5 text-gray-400" />
        <Step icon={Package} label={`${ledger.length} stock move${ledger.length === 1 ? '' : 's'}`} n={ledger.length} />
        <ArrowRight className="size-3.5 text-gray-400" />
        <Step icon={BookOpen} label={`${journal.length} journal line${journal.length === 1 ? '' : 's'}`} n={journal.length} />
        <ArrowRight className="size-3.5 text-gray-400" />
        <Step icon={Waves} label={`${effects.length} ripple${effects.length === 1 ? '' : 's'}`} n={effects.length} />
      </div>

      <Section n={1} title="Document">
        {doc.error ? <ErrorNote error={doc.error} /> : (
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {(doc.data?.facts ?? []).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-gray-500">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}
          </dl>
        )}
      </Section>
      <Down />
      <Section n={2} title="Stock ledger">
        {ledger.length === 0 ? <p className="text-sm text-gray-500">{doc.data?.noStock ?? 'No stock moved.'}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-gray-200 text-left text-xs text-gray-500"><th className="py-1.5">Item</th><th>Location</th><th className="text-right">Change</th><th className="text-right">On hand there</th><th className="text-right">Cost</th><th className="text-right">Average cost</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {ledger.map((l) => {
                  const after = l.qty_after == null ? null : Number(l.qty_after)
                  const moved = l.avg_before != null && l.avg_after != null && Number(l.avg_before) !== Number(l.avg_after)
                  return (
                    <tr key={l.id}>
                      <td className="py-1.5">{l.item}{l.txn_type === 'sale_kit' && <span className="block text-xs text-gray-500">used in a gift box</span>}{l.txn_type === 'prod_issue' && <span className="block text-xs text-gray-500">issued to production</span>}</td>
                      <td>{l.location}{l.location_kind === 'hold' && <span className="ml-1"><Badge tone="red">Hold</Badge></span>}</td>
                      <td className={cx('num text-right font-semibold', Number(l.qty) < 0 ? 'text-red-700' : 'text-emerald-700')}>{signed(Number(l.qty), (n) => qty(n, l.uom))}</td>
                      <td className="num text-right">{after == null ? '—' : <>{qty(after - Number(l.qty))} → <b>{qty(after)}</b></>}</td>
                      <td className="num text-right">{money(Number(l.unit_cost))}</td>
                      <td className="num text-right">{moved ? <>{money(Number(l.avg_before))} → <b>{money(Number(l.avg_after))}</b></> : <span className="text-gray-400">{l.avg_after != null ? 'unchanged' : '—'}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Down />
      <Section n={3} title="Books (journal)">
        {journal.length === 0 ? <p className="text-sm text-gray-500">{doc.data?.noBooks ?? 'No journal entry.'}</p> : <>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 text-left text-xs text-gray-500"><th className="py-1.5">Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {journal.map((j, i) => (
                <tr key={i}><td className={cx('py-1.5', Number(j.credit) > 0 && 'pl-6')}>{j.name} <span className="text-xs text-gray-400">{j.account}</span></td>
                  <td className="num text-right">{Number(j.debit) ? money(Number(j.debit)) : ''}</td><td className="num text-right">{Number(j.credit) ? money(Number(j.credit)) : ''}</td></tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-gray-200 font-semibold"><td className="py-1.5"><span className="inline-flex items-center gap-1.5">{Math.abs(debits - credits) < 0.005 ? <><CircleCheck className="size-4 text-emerald-600" />Balanced</> : 'Out of balance'}</span></td><td className="num text-right">{money(debits)}</td><td className="num text-right">{money(credits)}</td></tr></tfoot>
          </table>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Chip label="Profit" v={profit} />
            <Chip label="Cash" v={acct('1000')} />
            <Chip label="Inventory" v={acct('1200') + acct('1300')} />
            <Chip label="Owed to suppliers" v={-acct('2000')} />
            <Chip label="Sales tax owed" v={-acct('2100')} />
          </div>
        </>}
      </Section>
      <Down />
      <Section n={4} title="Ripples">
        {effects.length === 0 ? <p className="text-sm text-gray-500">Nothing downstream changed.</p> : (
          <ul className="space-y-1.5 text-sm">{effects.map((e, i) => <li key={i} className="flex gap-2"><Waves className="mt-0.5 size-4 shrink-0 text-sky-600" /><span>{e}</span></li>)}</ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-500">Screens that updated for everyone:</span>
          {(SCREENS[a.ref_type] ?? []).map((s) => <span key={s} className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">{s}</span>)}
        </div>
      </Section>
    </div>
  )
}

function Step({ icon: Icon, label, n }: { icon: typeof Waves; label: string; n: number }) {
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ring-1 ring-inset', n ? 'bg-duck-50 text-duck-700 ring-duck-300' : 'text-gray-400 ring-gray-200')}><Icon className="size-3.5" />{label}</span>
}
function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card title={<span className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white">{n}</span>{title}</span>}>
      {children}
    </Card>
  )
}
const Down = () => <div className="flex justify-center"><ArrowDown className="size-4 text-gray-300" /></div>
function Chip({ label, v }: { label: string; v: number }) {
  if (Math.abs(v) < 0.005) return null
  return <span className={cx('rounded-full px-2.5 py-1 font-medium ring-1 ring-inset', v > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200')}>{label} {signed(v, money)}</span>
}

// The source document for each kind of transaction, plus effects that only it knows about.
type Doc = { facts: [string, ReactNode][]; effects?: ReactNode[]; itemIds?: number[]; noStock?: string; noBooks?: string }
function useDocument(a: Activity) {
  return useQuery({
    queryKey: [a.ref_type === 'sales_order' ? 'sales_orders' : a.ref_type === 'purchase_order' ? 'purchase_orders' : 'documents', 'ripple-doc', a.ref_type, a.ref_id],
    queryFn: async (): Promise<Doc> => {
      const one = async <T,>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>) => must(q) as Promise<T>
      switch (a.ref_type) {
        case 'sale': {
          const s = await one<{ subtotal: number; discount_total: number; tax: number; total: number; cogs: number; sales_order_id: number | null; tender: string; locations: { name: string }; customers: { name: string } | null }>(
            supabase.from('sales').select('subtotal, discount_total, tax, total, cogs, sales_order_id, tender, locations(name), customers(name)').eq('id', a.ref_id).single())
          return { facts: [['Store', s.locations.name], ['Customer', s.customers?.name ?? 'Walk-in'], ['Subtotal', money(s.subtotal)], ['Discounts', money(s.discount_total)], ['Tax', money(s.tax)], ['Total paid', `${money(s.total)} (${s.tender})`], ['Cost of goods', money(s.cogs)], ...(s.sales_order_id ? [['Fulfilled', docNo('sales_order', s.sales_order_id)] as [string, ReactNode]] : [])] }
        }
        case 'return': {
          const x = await one<{ kind: string; sale_id: number; refund_total: number; cogs_reversed: number; exchange_sale_id: number | null; locations: { name: string } }>(
            supabase.from('returns').select('kind, sale_id, refund_total, cogs_reversed, exchange_sale_id, locations(name)').eq('id', a.ref_id).single())
          return { facts: [['Original receipt', docNo('sale', x.sale_id)], ['Store', x.locations.name], ['Refund', money(x.refund_total)], ['Cost put back', money(x.cogs_reversed)], ...(x.exchange_sale_id ? [['Exchanged for', docNo('sale', x.exchange_sale_id)] as [string, ReactNode]] : [])] }
        }
        case 'transfer': {
          const x = await one<{ qty: number; note: string | null; items: { name: string }; from: { name: string }; to: { name: string } }>(
            supabase.from('transfers').select('qty, note, items(name), from:locations!transfers_from_location_id_fkey(name), to:locations!transfers_to_location_id_fkey(name)').eq('id', a.ref_id).single())
          return { facts: [['Item', x.items.name], ['Quantity', qty(x.qty)], ['From', x.from.name], ['To', x.to.name], ...(x.note ? [['Note', x.note] as [string, ReactNode]] : [])], noBooks: 'No journal entry: the company owns the same stock, just in a different place.' }
        }
        case 'adjustment': {
          const x = await one<{ qty_before: number; qty_after: number; delta: number; reason_code: string; items: { name: string }; locations: { name: string }; reason_codes: { label: string } }>(
            supabase.from('adjustments').select('qty_before, qty_after, delta, reason_code, items(name), locations(name), reason_codes(label)').eq('id', a.ref_id).single())
          return { facts: [['Item', x.items.name], ['Location', x.locations.name], ['Reason', x.reason_codes.label], ['Counted', `${qty(x.qty_before)} → ${qty(x.qty_after)}`]] }
        }
        case 'po_receipt': {
          const x = await one<{ po_id: number; locations: { name: string }; purchase_orders: { expected_date: string; status: string; suppliers: { name: string; payment_terms: string } }; supplier_bills: { amount: number; due_date: string }[] }>(
            supabase.from('po_receipts').select('po_id, locations(name), purchase_orders(expected_date, status, suppliers(name, payment_terms)), supplier_bills(amount, due_date)').eq('id', a.ref_id).single())
          const got = new Date(a.ts).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
          const late = Math.round((Date.parse(got) - Date.parse(x.purchase_orders.expected_date)) / 864e5)
          const bill = x.supplier_bills[0]
          return {
            facts: [['Purchase order', docNo('purchase_order', x.po_id)], ['Supplier', x.purchase_orders.suppliers.name], ['Received at', x.locations.name], ['Expected', date(x.purchase_orders.expected_date)], ['PO status now', x.purchase_orders.status]],
            effects: [
              ...(bill ? [<>Supplier bill created: <b>{money(bill.amount)}</b> owed to {x.purchase_orders.suppliers.name}, due {date(bill.due_date)} ({x.purchase_orders.suppliers.payment_terms}).</>] : []),
              <>Scorecard: arrived {late <= 0 ? <Badge tone="green">on time</Badge> : <Badge tone="red">{late} days late</Badge>} against the expected date.</>,
            ],
          }
        }
        case 'production': {
          const x = await one<{ item_id: number; status: string; qty_planned: number; qty_started: number | null; qty_good: number | null; qty_scrapped: number | null; material_cost: number | null; unit_cost: number | null; items: { name: string }; locations: { name: string } }>(
            supabase.from('production_orders').select('item_id, status, qty_planned, qty_started, qty_good, qty_scrapped, material_cost, unit_cost, items(name), locations(name)').eq('id', a.ref_id).single())
          return { facts: [['Item', x.items.name], ['Location', x.locations.name], ['Started', qty(Number(x.qty_started ?? 0))], ['Good / scrapped', x.qty_good == null ? '—' : `${qty(x.qty_good)} / ${qty(Number(x.qty_scrapped))}`], ['Material cost', money(x.material_cost)], ['Unit cost', x.unit_cost == null ? '—' : money(x.unit_cost)], ['Status now', x.status]] }
        }
        case 'bill_payment': {
          const x = await one<{ amount: number; due_date: string; po_id: number; suppliers: { name: string } }>(supabase.from('supplier_bills').select('amount, due_date, po_id, suppliers(name)').eq('id', a.ref_id).single())
          return { facts: [['Supplier', x.suppliers.name], ['Amount', money(x.amount)], ['Was due', date(x.due_date)], ['For', docNo('purchase_order', x.po_id)]], noStock: 'No stock moved: paying a bill only settles what is owed.' }
        }
        case 'expense': {
          const x = await one<{ amount: number; memo: string | null; accounts: { name: string } }>(supabase.from('expenses').select('amount, memo, accounts(name)').eq('id', a.ref_id).single())
          return { facts: [['Account', x.accounts.name], ['Amount', money(x.amount)], ['Memo', x.memo ?? '—']], noStock: 'No stock moved.' }
        }
        case 'sales_order': {
          const lines = await one<{ item_id: number; item_name: string; qty: number; backordered: number; est_available_date: string | null; requested_date: string; status: string }[]>(
            supabase.from('v_sales_order_lines').select('item_id, item_name, qty, backordered, est_available_date, requested_date, status').eq('sales_order_id', a.ref_id))
          const o = await one<{ requested_date: string; status: string; source: string; customers: { name: string }; locations: { name: string } }>(
            supabase.from('sales_orders').select('requested_date, status, source, customers(name), locations(name)').eq('id', a.ref_id).single())
          const wk = mrpWeek(o.requested_date)
          return {
            facts: [['Customer', o.customers.name], ['Pickup', `${o.locations.name}, ${date(o.requested_date)}`], ['Placed', o.source === 'portal' ? 'Online (customer)' : 'By staff'], ['Status now', o.status]],
            itemIds: [],
            effects: o.status === 'placed' ? lines.map((l) => <>MRP: <b>{qty(Number(l.qty))} {l.item_name}</b> added to gross requirements in week {wk}{wk === 1 && o.requested_date < addDays(today(), 0) ? ' (overdue)' : ''}. {Number(l.backordered) > 0 ? <><Badge tone="red">{qty(Number(l.backordered))} backordered</Badge> est. {date(l.est_available_date)}</> : <Badge tone="green">Stock reserved</Badge>}</>) : [<>This order is now {o.status}, so it no longer counts as demand.</>],
            noStock: 'No stock moved: a placed order is demand. It claims stock in pickup-date order and shows up in MRP.',
            noBooks: 'No journal entry until the order is fulfilled (then it posts as a sale).',
          }
        }
        case 'purchase_order': {
          const p = await one<{ expected_date: string; status: string; suppliers: { name: string }; po_lines: { item_id: number; qty_ordered: number; qty_received: number; items: { name: string; uom: string } }[] }>(
            supabase.from('purchase_orders').select('expected_date, status, suppliers(name), po_lines(item_id, qty_ordered, qty_received, items(name, uom))').eq('id', a.ref_id).single())
          const wk = mrpWeek(p.expected_date)
          return {
            facts: [['Supplier', p.suppliers.name], ['Expected', date(p.expected_date)], ['Status now', p.status], ['Lines', String(p.po_lines.length)]],
            itemIds: p.po_lines.map((l) => l.item_id),
            effects: p.po_lines.map((l) => <>MRP: <b>{qty(Number(l.qty_ordered), l.items.uom)} {l.items.name}</b> is a scheduled receipt in week {wk}; it also counts as on order for reorder points and sets backorder dates.</>),
            noStock: 'No stock moved yet: it arrives when the PO is received.',
            noBooks: 'No journal entry until the goods arrive (then Dr Inventory / Cr Accounts Payable).',
          }
        }
        default: return { facts: [] }
      }
    },
  })
}
