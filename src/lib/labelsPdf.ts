import JsBarcode from 'jsbarcode'
import type { Item } from './types'
import { KIND_LABEL } from './format'

export type LabelSize = 'large' | 'small'
type LabelItem = Pick<Item, 'name' | 'sku' | 'kind' | 'price' | 'barcode'>

// Letter-size sheets, in inches:
//  • large: 3 × 5 = 15 per page, big barcodes that a phone camera reads from across a table
//  • small: 3 × 10 = 30 per page, the standard 2⅝" × 1" address-label sheet (Avery 5160)
const LAYOUT = {
  large: { cols: 3, rows: 5, left: 0.35, top: 0.35, w: 2.6, h: 2.03, gapX: 0, gapY: 0 },
  small: { cols: 3, rows: 10, left: 0.1875, top: 0.5, w: 2.625, h: 1, gapX: 0.125, gapY: 0 },
} as const

// Draws the barcode at high resolution so it stays sharp in the PDF and on paper.
function barcodePng(code: string) {
  const canvas = document.createElement('canvas')
  const opts = { height: 140, width: 4, fontSize: 30, margin: 0, background: '#ffffff' }
  try { JsBarcode(canvas, code, { ...opts, format: 'UPC' }) } catch { JsBarcode(canvas, code, { ...opts, format: 'CODE128' }) }
  return { data: canvas.toDataURL('image/png'), ratio: canvas.height / canvas.width }
}

export async function buildLabelsPdf(items: LabelItem[], size: LabelSize) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'in', format: 'letter' })
  const L = LAYOUT[size]
  const perPage = L.cols * L.rows
  const images = new Map<string, ReturnType<typeof barcodePng>>()

  items.forEach((item, n) => {
    if (n > 0 && n % perPage === 0) doc.addPage()
    const slot = n % perPage
    const x = L.left + (slot % L.cols) * (L.w + L.gapX)
    const y = L.top + Math.floor(slot / L.cols) * (L.h + L.gapY)
    if (!images.has(item.barcode)) images.set(item.barcode, barcodePng(item.barcode))
    const bc = images.get(item.barcode)!
    const sellable = item.kind !== 'component'

    // Dashed cut line
    doc.setDrawColor(190).setLineWidth(0.005).setLineDashPattern([0.05, 0.04], 0)
    doc.rect(x, y, L.w, L.h)
    doc.setLineDashPattern([], 0)

    if (size === 'large') {
      const cx = x + L.w / 2
      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(17)
      const name = doc.splitTextToSize(item.name, L.w - 0.3).slice(0, 2)
      doc.text(name, cx, y + 0.3, { align: 'center' })
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(80)
      doc.text(`${item.sku}${sellable ? ` · $${item.price.toFixed(2)}` : ` · ${KIND_LABEL[item.kind]}`}`, cx, y + 0.68, { align: 'center' })
      const bw = 2.1
      doc.addImage(bc.data, 'PNG', cx - bw / 2, y + 0.82, bw, Math.min(bw * bc.ratio, L.h - 0.95))
    } else {
      const bw = 1.2
      const bh = Math.min(bw * bc.ratio, 0.72)
      doc.addImage(bc.data, 'PNG', x + L.w - bw - 0.1, y + (L.h - bh) / 2, bw, bh)
      const tw = L.w - bw - 0.3
      doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(17)
      const name = doc.splitTextToSize(item.name, tw).slice(0, 2)
      doc.text(name, x + 0.1, y + 0.24)
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(80)
      doc.text(item.sku, x + 0.1, y + 0.6)
      if (sellable) {
        doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(17)
        doc.text(`$${item.price.toFixed(2)}`, x + 0.1, y + 0.84)
      }
    }
  })
  return doc
}
