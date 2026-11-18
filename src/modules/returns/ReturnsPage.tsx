import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, PackageX, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { must, rpc, supabase } from '../../lib/supabase'
import { findByCode, useItems, useLocations, useSettings } from '../../lib/queries'
import { dateTime, docNo, money, qty } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { ScanInput } from '../../components/ScanInput'
import { DataTable, type Column } from '../../components/DataTable'
import { Badge, Button, Card, ErrorNote, Input, PageHeader, Select, Spinner, cx } from '../../components/ui'

type Reason = { code: string; label: string; is_quality: boolean }
type SaleLine = { id: number; item_id: number; qty: number; unit_price: number; net_amount: number; returned_qty: number; items: { name: string; sku: string; kind: string } }
type Sale = {
  id: number; ts: string; location_id: number; total: number; tax_rate: number; customer_id: number | null
  locations: { name: string }; customers: { name: string } | null; sale_lines: SaleLine[]
}
type ReturnRow = {
  id: number; ts: string; kind: 'return' | 'exchange'; sale_id: number; refund_total: number; exchange_sale_id: number | null
  return_lines: { qty: number; reason_code: string; to_location_id: number; items: { name: string } }[]
}
type Pick = { qty: string; reason: string }

const round2 = (n: number) => Math.round(n * 100) / 100
// Receipt barcodes read "S-17164"; people may also type just the number.
const parseReceipt = (code: string) => Number(code.trim().toUpperCase().replace(/^S-?/, '')) || null

export function ReturnsPage() {
  const [saleId, setSaleId] = useState<number | null>(null)
  const [notFound, setNotFound] = useState<string | null>(null)
  const recent = useQuery({
    queryKey: ['sales', 'recent'],
    queryFn: () => must(supabase.from('sales').select('id, ts, total, locations(name)').order('id', { ascending: false }).limit(8)) as unknown as Promise<{ id: number; ts: string; total: number; locations: { name: string } }[]>,
  })
  function lookup(code: string) {
    const id = parseReceipt(code)
    setNotFound(id ? null : `"${code}" isn't a receipt number`)
    setSaleId(id)
  }

  return (
    <>
      <PageHeader title="Returns & exchanges"
        description="Find the receipt, pick what's coming back and why. Good items go back on the store shelf; quality problems go to Returns Hold (still inventory, but not sellable). Revenue, tax and cost of goods sold reverse automatically." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card title="Find the receipt">
            <ScanInput onScan={lookup} autoFocus placeholder="Scan the receipt barcode or type its number (S-17164)" />
            {notFound && <p className="mt-2 text-sm text-red-700">{notFound}</p>}
            {(recent.data ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-zinc-600">Latest receipts:</span>
                {recent.data!.map((s) => (
                  <button key={s.id} onClick={() => lookup(String(s.id))} className={cx('rounded-full px-2.5 py-1 ring-1 ring-inset', saleId === s.id ? 'bg-zinc-900 text-white ring-zinc-900' : 'ring-zinc-300 hover:bg-zinc-50')}>
                    {docNo('sale', s.id)} · {money(s.total)}
                  </button>
                ))}
              </div>
            )}
          </Card>
          {saleId != null && <ReceiptReturn key={saleId} saleId={saleId} onDone={() => setSaleId((cur) => (cur === saleId ? null : cur))} />}
        </div>
        <div className="space-y-4">
          <ReturnsHold />
          <RecentReturns />
        </div>
      </div>
    </>
  )
}

function useReturnReasons() {
  return useQuery({ queryKey: ['reason_codes', 'return'], queryFn: () => must(supabase.from('reason_codes').select('code, label, is_quality').eq('applies_to', 'return').order('is_quality').order('label')) as Promise<Reason[]>, staleTime: 60_000 })
}

function ReceiptReturn({ saleId, onDone }: { saleId: number; onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const settings = useSettings()
  const reasons = useReturnReasons()
  const { data: items } = useItems()
  const sale = useQuery({
    queryKey: ['sales', 'for-return', saleId],
    queryFn: () => must(supabase.from('sales').select('id, ts, location_id, total, tax_rate, customer_id, locations(name), customers(name), sale_lines(id, item_id, qty, unit_price, net_amount, returned_qty, items(name, sku, kind))').eq('id', saleId).maybeSingle()) as unknown as Promise<Sale | null>,
  })
  const [picks, setPicks] = useState<Record<number, Pick>>({})
  const [mode, setMode] = useState<'return' | 'exchange'>('return')
  const [newLines, setNewLines] = useState<{ item_id: number; qty: number }[]>([])
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  if (sale.isLoading) return <Spinner />
  if (!sale.data) return <Card><p className="text-sm text-red-700">Receipt {docNo('sale', saleId)} wasn't found.</p></Card>
  const s = sale.data
  const reasonOf = (code: string) => reasons.data?.find((r) => r.code === code)
  const left = (l: SaleLine) => Number(l.qty) - Number(l.returned_qty)
  const chosen = s.sale_lines.filter((l) => Number(picks[l.id]?.qty) > 0)
  const set = (id: number, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { qty: p[id]?.qty ?? '', reason: p[id]?.reason ?? '', ...patch } }))

  // Same arithmetic the database uses: refund = net paid per unit × qty; tax at the receipt's rate.
  const refundNet = round2(chosen.reduce((sum, l) => sum + round2(Number(l.net_amount) * Number(picks[l.id].qty) / Number(l.qty)), 0))
  const refundTax = round2(refundNet * Number(s.tax_rate))
  const refundTotal = round2(refundNet + refundTax)
  const rate = Number(settings.get('tax_rate') ?? 0)
  const newSub = round2(newLines.reduce((sum, l) => sum + round2(l.qty * Number(items?.find((i) => i.id === l.item_id)?.price ?? 0)), 0))
  const newTotal = round2(newSub + round2(newSub * rate))
  const diff = round2(newTotal - refundTotal)
  const valid = chosen.length > 0 && chosen.every((l) => picks[l.id].reason && Number(picks[l.id].qty) <= left(l)) && (mode === 'return' || newLines.length > 0)

  function addNew(code: string) {
    const item = findByCode(items?.filter((i) => i.kind !== 'component'), code)
    if (!item) { setScanMsg(`${code} isn't a product we sell`); return }
    setNewLines((ls) => ls.some((l) => l.item_id === item.id) ? ls.map((l) => (l.item_id === item.id ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { item_id: item.id, qty: 1 }])
    setScanMsg(`Added ${item.name}`)
  }
  async function save() {
    setBusy(true); setError(null)
    const lines = chosen.map((l) => ({ sale_line_id: l.id, qty: Number(picks[l.id].qty), reason_code: picks[l.id].reason }))
    try {
      if (mode === 'return') {
        const id = await rpc<number>('process_return', { p_sale_id: s.id, p_lines: lines })
        toast(`${docNo('return', id)}: refunded ${money(refundTotal)}`)
        onDone()
      } else {
        const r = await rpc<{ return_id: number; sale_id: number; customer_pays: number }>('process_exchange', { p_sale_id: s.id, p_return_lines: lines, p_new_lines: newLines })
        toast(`Exchange ${docNo('return', r.return_id)} + ${docNo('sale', r.sale_id)}: ${r.customer_pays >= 0 ? `customer pays ${money(r.customer_pays)}` : `refund ${money(-r.customer_pays)}`}`)
        onDone()
      }
      // Close the receipt first, then refresh, so a receipt scanned meanwhile isn't closed.
      await qc.invalidateQueries()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  return (
    <Card title={<span>{docNo('sale', s.id)} <span className="font-normal text-zinc-600">· {dateTime(s.ts)} · {s.locations.name}{s.customers ? ` · ${s.customers.name}` : ''}</span></span>}
      actions={<div className="inline-flex rounded-md border border-zinc-300 p-0.5 text-sm">
        {([['return', 'Return'], ['exchange', 'Exchange']] as const).map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)} className={cx('rounded px-3 py-1', mode === m ? 'bg-zinc-900 font-medium text-white' : 'text-zinc-700')}>{label}</button>
        ))}
      </div>}>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-zinc-200 text-left text-xs text-zinc-600">
          <th className="py-1.5">Item</th><th className="text-right">Bought</th><th className="text-right">Paid each</th><th className="w-24 pl-3">Return</th><th className="pl-3">Reason</th><th className="pl-3">Goes to</th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-100">
          {s.sale_lines.map((l) => {
            const p = picks[l.id]
            const r = p?.reason ? reasonOf(p.reason) : undefined
            const over = Number(p?.qty) > left(l)
            return (
              <tr key={l.id} className="align-top">
                <td className="py-2">{l.items.name}<span className="block text-xs text-zinc-500">{l.items.sku}{Number(l.returned_qty) > 0 && <span className="text-red-700"> · {qty(Number(l.returned_qty))} already returned</span>}</span></td>
                <td className="num py-2 text-right">{qty(Number(l.qty))}</td>
                <td className="num py-2 text-right">{money(Number(l.net_amount) / Number(l.qty))}</td>
                <td className="py-1 pl-3">
                  {left(l) > 0 ? <Input type="number" min="0" max={left(l)} value={p?.qty ?? ''} placeholder="0" onChange={(e) => set(l.id, { qty: e.target.value })} className={over ? 'border-red-500' : ''} /> : <span className="text-xs text-zinc-500">All returned</span>}
                </td>
                <td className="py-1 pl-3">
                  {left(l) > 0 && (
                    <Select value={p?.reason ?? ''} onChange={(e) => set(l.id, { reason: e.target.value })}>
                      <option value="">Choose…</option>
                      <optgroup label="Back on the shelf">{(reasons.data ?? []).filter((x) => !x.is_quality).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</optgroup>
                      <optgroup label="Quality problem → Returns Hold">{(reasons.data ?? []).filter((x) => x.is_quality).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</optgroup>
                    </Select>
                  )}
                </td>
                <td className="py-2 pl-3 text-xs">{r ? (r.is_quality ? <Badge tone="red">Returns Hold</Badge> : <Badge tone="green">{s.locations.name} shelf</Badge>) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {mode === 'exchange' && (
        <div className="mt-4 rounded-md border border-zinc-200 p-3">
          <p className="mb-2 text-sm font-medium">New items going out</p>
          <ScanInput onScan={addNew} continuous placeholder="Scan or type the new item" />
          {scanMsg && <p className="mt-1.5 text-xs text-zinc-700">{scanMsg}</p>}
          {newLines.length > 0 && (
            <ul className="mt-2 divide-y divide-zinc-100 text-sm">
              {newLines.map((l) => {
                const it = items?.find((i) => i.id === l.item_id)
                return (
                  <li key={l.item_id} className="flex items-center justify-between gap-2 py-1.5">
                    <span>{it?.name}</span>
                    <span className="flex items-center gap-2">
                      <Input type="number" min="1" className="w-20" value={l.qty} onChange={(e) => setNewLines((ls) => ls.map((x) => (x.item_id === l.item_id ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)))} />
                      <span className="num w-16 text-right">{money(round2(l.qty * Number(it?.price ?? 0)))}</span>
                      <button onClick={() => setNewLines((ls) => ls.filter((x) => x.item_id !== l.item_id))} className="text-zinc-500 hover:text-red-600" aria-label="Remove"><X className="size-4" /></button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <dl className="mt-4 grid gap-x-6 gap-y-1 rounded-md bg-zinc-50 p-3 text-sm sm:grid-cols-2">
        <div className="flex justify-between"><dt className="text-zinc-700">Refund before tax</dt><dd className="num">{money(refundNet)}</dd></div>
        <div className="flex justify-between"><dt className="text-zinc-700">Tax refunded ({(Number(s.tax_rate) * 100).toFixed(2)}%)</dt><dd className="num">{money(refundTax)}</dd></div>
        <div className="flex justify-between font-semibold"><dt>Refund total</dt><dd className="num">{money(refundTotal)}</dd></div>
        {mode === 'exchange' && <>
          <div className="flex justify-between"><dt className="text-zinc-700">New items incl. tax</dt><dd className="num">{money(newTotal)}</dd></div>
          <div className="flex justify-between font-semibold sm:col-span-2"><dt>{diff >= 0 ? 'Customer pays' : 'Refund to customer'}</dt><dd className="num">{money(Math.abs(diff))}</dd></div>
        </>}
      </dl>
      <p className="mt-2 text-xs text-zinc-600">Books: Dr Sales Returns + Dr Sales Tax Payable / Cr Cash for the refund, and Dr Inventory / Cr Cost of Goods Sold at the cost the item sold at.{mode === 'exchange' ? ' The new items post as a normal sale.' : ''}</p>
      <div className="mt-3 space-y-2">
        <ErrorNote error={error} />
        <Button variant="primary" busy={busy} disabled={!valid} onClick={save}>
          {mode === 'return' ? <><Undo2 className="size-4" />Refund {money(refundTotal)}</> : <><ArrowLeftRight className="size-4" />Complete exchange</>}
        </Button>
      </div>
    </Card>
  )
}

// Stock quarantined by quality returns: inspect it, then restock it or scrap it.
function ReturnsHold() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: locations } = useLocations()
  const { data: items } = useItems()
  const held = useQuery({
    queryKey: ['stock', 'hold'],
    queryFn: () => must(supabase.from('v_stock_by_location').select('item_id, location_id, qty, value').eq('location_kind', 'hold').gt('qty', 0)) as Promise<{ item_id: number; location_id: number; qty: number; value: number }[]>,
  })
  const stores = (locations ?? []).filter((l) => l.kind === 'store')
  const [to, setTo] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  async function act(key: string, fn: string, args: Record<string, unknown>, done: string) {
    setBusy(key)
    try { await rpc(fn, args); await qc.invalidateQueries(); toast(done) } catch (e) { toast(e instanceof Error ? e.message : 'That didn\'t work', 'error') } finally { setBusy(null) }
  }
  return (
    <Card title={<span className="flex items-center gap-2"><PackageX className="size-4 text-red-600" />Returns Hold</span>}>
      {held.isLoading ? <Spinner /> : !(held.data ?? []).length ? <p className="text-sm text-zinc-600">Nothing on hold.</p> : (
        <ul className="space-y-3 text-sm">
          {held.data!.map((row) => ({ ...row, items: { name: items?.find((i) => i.id === row.item_id)?.name ?? '…' } })).map((h) => (
            <li key={h.item_id} className="space-y-1.5">
              <div className="flex justify-between"><span className="font-medium">{h.items.name}</span><span className="num text-zinc-700">{qty(Number(h.qty))} · {money(Number(h.value))}</span></div>
              <div className="flex flex-wrap gap-1.5">
                <Select className="w-36" value={to[h.item_id] ?? String(stores[0]?.id ?? '')} onChange={(e) => setTo((t) => ({ ...t, [h.item_id]: e.target.value }))}>
                  {stores.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
                <Button size="sm" busy={busy === `r${h.item_id}`} onClick={() => act(`r${h.item_id}`, 'transfer_stock', { p_item_id: h.item_id, p_from_location_id: h.location_id, p_to_location_id: Number(to[h.item_id] ?? stores[0]?.id), p_qty: Number(h.qty), p_note: 'Passed inspection' }, `${h.items.name} restocked`)}>
                  <RotateCcw className="size-3.5" />Restock
                </Button>
                <Button size="sm" variant="ghost" busy={busy === `s${h.item_id}`} onClick={() => act(`s${h.item_id}`, 'adjust_stock', { p_item_id: h.item_id, p_location_id: h.location_id, p_reason_code: 'HOLD_SCRAP', p_new_qty: 0 }, `${h.items.name} scrapped: ${money(Number(h.value))} written off`)}>
                  <Trash2 className="size-3.5" />Scrap
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-zinc-600">Restock moves it to a store shelf at the same cost. Scrap writes its cost off to Inventory Shrink & Write-offs.</p>
    </Card>
  )
}

function RecentReturns() {
  const { data: locations } = useLocations()
  const reasons = useReturnReasons()
  const q = useQuery({
    queryKey: ['returns', 'recent'],
    queryFn: () => must(supabase.from('returns').select('id, ts, kind, sale_id, refund_total, exchange_sale_id, return_lines(qty, reason_code, to_location_id, items(name))').order('id', { ascending: false }).limit(40)) as unknown as Promise<ReturnRow[]>,
  })
  const columns: Column<ReturnRow>[] = [
    { key: 'id', header: 'Return', render: (r) => <span className="font-medium">{docNo('return', r.id)}<span className="block text-xs font-normal text-zinc-600">{dateTime(r.ts)}</span></span> },
    { key: 'items', header: 'Items', value: (r) => r.return_lines.map((l) => l.items.name).join(', '),
      render: (r) => <span className="text-xs">{r.return_lines.map((l, i) => (
        <span key={i} className="block">{qty(Number(l.qty))} × {l.items.name} <span className="text-zinc-600">· {reasons.data?.find((x) => x.code === l.reason_code)?.label} → {locations?.find((x) => x.id === l.to_location_id)?.name}</span></span>
      ))}</span> },
    { key: 'refund_total', header: 'Refund', align: 'right', render: (r) => <span>{money(Number(r.refund_total))}{r.kind === 'exchange' && <span className="block"><Badge tone="purple">Exchange</Badge></span>}</span> },
  ]
  return (
    <Card title="Recent returns" padded={false}>
      {q.isLoading ? <Spinner /> : <DataTable rows={q.data ?? []} columns={columns} rowKey={(r) => r.id} dense />}
    </Card>
  )
}
