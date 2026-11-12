import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { must, supabase } from '../lib/supabase'
import { dateTime, docNo, money, qty } from '../lib/format'
import { Barcode } from './Barcode'
import { Button, ErrorNote, Modal, Spinner } from './ui'

type SaleDetail = {
  id: number; ts: string; subtotal: number; discount_total: number; tax: number; total: number; tax_rate: number; tender: string
  sales_order_id: number | null
  locations: { name: string; address: string | null }
  customers: { name: string } | null
  sale_lines: { id: number; qty: number; unit_price: number; discount: number; net_amount: number; returned_qty: number; items: { name: string; sku: string; kind: string } }[]
}

export function printArea() {
  document.body.classList.add('printing-area')
  window.print()
  document.body.classList.remove('printing-area')
}

// Receipt for a posted sale, read back from the database (so it shows what was actually recorded).
export function ReceiptModal({ saleId, onClose, title = 'Receipt' }: { saleId: number | null; onClose: () => void; title?: string }) {
  const q = useQuery({
    enabled: saleId != null,
    queryKey: ['sales', 'receipt', saleId],
    queryFn: () => must(supabase.from('sales')
      .select('id, ts, subtotal, discount_total, tax, total, tax_rate, tender, sales_order_id, locations(name, address), customers(name), sale_lines(id, qty, unit_price, discount, net_amount, returned_qty, items(name, sku, kind))')
      .eq('id', saleId!).single()) as Promise<SaleDetail>,
  })
  if (saleId == null) return null
  const s = q.data
  return (
    <Modal open onClose={onClose} title={title}
      footer={<><Button onClick={printArea}><Printer className="size-4" />Print</Button><Button variant="primary" onClick={onClose}>Done</Button></>}>
      <ErrorNote error={q.error} />
      {!s ? <Spinner /> : (
        <div className="print-area mx-auto max-w-xs font-mono text-[12px] leading-snug text-gray-900">
          <div className="text-center">
            <p className="text-sm font-bold">THE SNUGGLY DUCKLING</p>
            <p>{s.locations.name}</p>
            {s.locations.address && <p>{s.locations.address}</p>}
            <p className="mt-1">{dateTime(s.ts)}</p>
            <p>Receipt {docNo('sale', s.id)}{s.sales_order_id ? ` · Order ${docNo('sales_order', s.sales_order_id)}` : ''}</p>
            {s.customers && <p>Customer: {s.customers.name}</p>}
          </div>
          <div className="my-2 border-t border-dashed border-gray-400" />
          {[...s.sale_lines].sort((a, b) => a.id - b.id).map((l) => (
            <div key={l.id} className="mb-1">
              <div className="flex justify-between gap-2"><span className="truncate">{l.items.name}</span><span>{money(l.qty * l.unit_price)}</span></div>
              <div className="flex justify-between pl-2 text-gray-600">
                <span>{qty(l.qty)} @ {money(l.unit_price)}</span>
                {l.discount > 0 && <span>−{money(l.discount)}</span>}
              </div>
              {l.returned_qty > 0 && <p className="pl-2 text-red-700">{qty(l.returned_qty)} returned</p>}
            </div>
          ))}
          <div className="my-2 border-t border-dashed border-gray-400" />
          <Row k="Subtotal" v={money(s.subtotal)} />
          {s.discount_total > 0 && <Row k="Discounts" v={`−${money(s.discount_total)}`} />}
          <Row k={`Sales tax ${(s.tax_rate * 100).toFixed(2)}%`} v={money(s.tax)} />
          <div className="mt-1 flex justify-between text-sm font-bold"><span>TOTAL</span><span>{money(s.total)}</span></div>
          <Row k="Paid by" v={s.tender[0].toUpperCase() + s.tender.slice(1)} />
          <div className="mt-3 flex justify-center"><Barcode value={docNo('sale', s.id)} format="CODE128" height={34} width={1.3} fontSize={10} /></div>
          <p className="mt-2 text-center text-gray-600">Returns within 30 days with this receipt. Thanks for snacking with us!</p>
        </div>
      )}
    </Modal>
  )
}

const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between"><span>{k}</span><span>{v}</span></div>
