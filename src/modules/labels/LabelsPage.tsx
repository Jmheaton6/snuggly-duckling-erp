import { useState } from 'react'
import { Printer } from 'lucide-react'
import { useItems } from '../../lib/queries'
import { KIND_LABEL, money } from '../../lib/format'
import { Barcode } from '../../components/Barcode'
import { Button, Card, Field, Input, PageHeader, Select, Spinner } from '../../components/ui'

// Printable UPC labels, sized like a 30-up address-label sheet (2⅝" × 1", 3 across).
export function LabelsPage() {
  const { data: items, isLoading } = useItems()
  const [which, setWhich] = useState<'sellable' | 'all' | 'component'>('sellable')
  const [copies, setCopies] = useState('1')
  const [only, setOnly] = useState('')
  if (isLoading) return <Spinner />
  const chosen = (items ?? []).filter((i) => (only ? i.id === Number(only) : which === 'all' ? true : which === 'sellable' ? i.kind !== 'component' : i.kind === 'component'))
  const labels = chosen.flatMap((i) => Array.from({ length: Math.max(1, Math.min(30, Number(copies) || 1)) }, (_, k) => ({ key: `${i.id}-${k}`, item: i })))

  return (
    <>
      <div className="no-print">
        <PageHeader title="Barcode labels"
          description="Print on plain paper or 30-up address labels and stick them on products. They scan with a USB scanner or the Camera button anywhere in the system (POS, Transfers & Counts, Receiving)."
          actions={<Button variant="primary" onClick={() => window.print()}><Printer className="size-4" />Print {labels.length} labels</Button>} />
        <Card className="mb-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Items">
              <Select value={which} onChange={(e) => { setWhich(e.target.value as typeof which); setOnly('') }}>
                <option value="sellable">Everything we sell ({(items ?? []).filter((i) => i.kind !== 'component').length})</option>
                <option value="component">Components & packaging</option>
                <option value="all">All items</option>
              </Select>
            </Field>
            <Field label="Or just one item">
              <Select value={only} onChange={(e) => setOnly(e.target.value)}>
                <option value="">—</option>
                {(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
            </Field>
            <Field label="Copies of each"><Input type="number" min="1" max="30" value={copies} onChange={(e) => setCopies(e.target.value)} /></Field>
          </div>
        </Card>
      </div>
      <div className="label-sheet grid grid-cols-[repeat(3,2.625in)] gap-x-[0.125in] gap-y-0 print:mx-auto">
        {labels.map(({ key, item }) => (
          <div key={key} className="flex h-[1in] w-[2.625in] items-center gap-2 overflow-hidden rounded border border-dashed border-gray-300 bg-white px-2 print:rounded-none print:border-gray-200">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[8.5pt] font-semibold leading-tight">{item.name}</p>
              <p className="text-[7.5pt] text-gray-600">{item.sku} · {KIND_LABEL[item.kind]}</p>
              {item.kind !== 'component' && <p className="text-[11pt] font-bold">{money(item.price)}</p>}
            </div>
            <div className="shrink-0"><Barcode value={item.barcode} height={36} width={1.05} fontSize={8} /></div>
          </div>
        ))}
      </div>
    </>
  )
}
