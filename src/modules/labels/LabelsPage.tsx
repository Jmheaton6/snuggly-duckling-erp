import { useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useItems } from '../../lib/queries'
import { KIND_LABEL, money } from '../../lib/format'
import { buildLabelsPdf, type LabelSize } from '../../lib/labelsPdf'
import { useToast } from '../../lib/toast'
import { Barcode } from '../../components/Barcode'
import { Button, Card, Field, Input, PageHeader, Select, Spinner } from '../../components/ui'

type Which = 'resale' | 'sellable' | 'component' | 'all'
const FILE_NAME = 'Snuggly Duckling barcode labels.pdf'

// Every item's UPC barcode, shown on screen and downloadable as a print-ready PDF.
export function LabelsPage() {
  const { data: items, isLoading } = useItems()
  const toast = useToast()
  const [which, setWhich] = useState<Which>('resale')
  const [size, setSize] = useState<LabelSize>('large')
  const [copies, setCopies] = useState('1')
  const [only, setOnly] = useState('')
  const [busy, setBusy] = useState<'download' | 'open' | null>(null)
  if (isLoading) return <Spinner />

  const all = items ?? []
  const count = (w: Which) => all.filter((i) => matches(i.kind, w)).length
  const chosen = all.filter((i) => (only ? i.id === Number(only) : matches(i.kind, which)))
  const n = Math.max(1, Math.min(30, Number(copies) || 1))
  const labels = chosen.flatMap((i) => Array.from({ length: n }, (_, k) => ({ key: `${i.id}-${k}`, item: i })))
  const pages = Math.ceil(labels.length / (size === 'large' ? 15 : 30))

  async function makePdf(mode: 'download' | 'open') {
    // Open the tab before the async work so Safari doesn't treat it as a pop-up.
    const tab = mode === 'open' ? window.open('', '_blank') : null
    setBusy(mode)
    try {
      const doc = await buildLabelsPdf(labels.map((l) => l.item), size)
      if (mode === 'download') doc.save(FILE_NAME)
      else if (tab) tab.location.href = String(doc.output('bloburl'))
      else window.location.href = String(doc.output('bloburl'))
    } catch (e) {
      tab?.close()
      toast(e instanceof Error ? e.message : 'Could not build the PDF', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader title="Barcode labels"
        description="Every product's barcode. Download them as a PDF, print on plain paper or address labels, and stick them on products. They scan with a USB scanner or the Camera button (POS, Transfers & Counts, and the customer shop)."
        actions={<>
          <Button onClick={() => makePdf('open')} busy={busy === 'open'} disabled={!labels.length}><Printer className="size-4" />Open to print</Button>
          <Button variant="primary" onClick={() => makePdf('download')} busy={busy === 'download'} disabled={!labels.length}><Download className="size-4" />Download PDF</Button>
        </>} />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Items">
            <Select value={which} onChange={(e) => { setWhich(e.target.value as Which); setOnly('') }}>
              <option value="resale">Store shelf products ({count('resale')})</option>
              <option value="sellable">Everything we sell, incl. made & kits ({count('sellable')})</option>
              <option value="component">Components & packaging ({count('component')})</option>
              <option value="all">All items ({count('all')})</option>
            </Select>
          </Field>
          <Field label="Or just one item">
            <Select value={only} onChange={(e) => setOnly(e.target.value)}>
              <option value="">—</option>
              {all.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
          </Field>
          <Field label="Label size">
            <Select value={size} onChange={(e) => setSize(e.target.value as LabelSize)}>
              <option value="large">Large · 15 per page</option>
              <option value="small">Small · 30 per page</option>
            </Select>
          </Field>
          <Field label="Copies of each"><Input type="number" min="1" max="30" value={copies} onChange={(e) => setCopies(e.target.value)} /></Field>
        </div>
        <p className="mt-3 text-xs text-zinc-600">{labels.length} label{labels.length === 1 ? '' : 's'} · {pages} page{pages === 1 ? '' : 's'} (letter size). Print at 100% / “Actual size” so the barcodes keep their proportions.</p>
      </Card>

      {size === 'large' ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {labels.map(({ key, item }) => (
            <div key={key} className="flex flex-col items-center rounded-lg border border-dashed border-zinc-300 bg-white px-3 pb-3 pt-4 text-center">
              <p className="text-sm font-semibold leading-tight">{item.name}</p>
              <p className="mb-2 mt-1 text-xs text-zinc-700">{item.sku} · {item.kind === 'component' ? KIND_LABEL[item.kind] : money(item.price)}</p>
              <Barcode value={item.barcode} height={64} width={1.8} fontSize={13} />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {labels.map(({ key, item }) => (
            <div key={key} className="flex h-24 items-center gap-2 overflow-hidden rounded border border-dashed border-zinc-300 bg-white px-3">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs font-semibold leading-tight">{item.name}</p>
                <p className="text-[11px] text-zinc-700">{item.sku} · {KIND_LABEL[item.kind]}</p>
                {item.kind !== 'component' && <p className="text-sm font-bold">{money(item.price)}</p>}
              </div>
              <div className="shrink-0"><Barcode value={item.barcode} height={40} width={1.2} fontSize={9} /></div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function matches(kind: string, which: Which) {
  if (which === 'all') return true
  if (which === 'resale') return kind === 'resale'
  if (which === 'sellable') return kind !== 'component'
  return kind === 'component'
}
