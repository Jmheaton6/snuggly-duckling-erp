// Prints a letter-size PDF of large barcode labels (3 × 5 = 15 per page) for physical
// products at the demo. Defaults to the 15 resale items; pass SKUs to choose others.
//   node scripts/print/labels-pdf.ts [SKU ...]
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { ITEMS, upc } from '../seed/catalog.ts'

const want = process.argv.slice(2)
const items = ITEMS.map((it, i) => ({ ...it, barcode: upc(i + 101) }))
  .filter((it) => (want.length ? want.includes(it.sku) : it.kind === 'resale'))
const jsbarcode = readFileSync('node_modules/jsbarcode/dist/JsBarcode.all.min.js', 'utf8')
const out = `${homedir()}/Desktop/ERP Project/Snuggly Duckling barcode labels.pdf`

const cells = items.map((it) => `
  <div class="label">
    <div class="name">${it.name}</div>
    <div class="meta">${it.sku} · $${it.price.toFixed(2)}</div>
    <svg class="bc" data-code="${it.barcode}"></svg>
  </div>`).join('')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: letter; margin: 0.35in 0.35in; }
  body { margin: 0; font-family: -apple-system, Helvetica, Arial, sans-serif; }
  .sheet { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 2.03in; }
  .label { border: 1px dashed #bbb; box-sizing: border-box; padding: 0.12in 0.12in 0.08in; display: flex; flex-direction: column; align-items: center; break-inside: avoid; }
  .name { font-weight: 700; font-size: 10.5pt; text-align: center; line-height: 1.15; min-height: 2.3em; }
  .meta { font-size: 8.5pt; color: #444; margin: 2px 0 4px; }
  .bc { width: 2.15in; height: auto; }
</style></head><body><div class="sheet">${cells}</div>
<script>${jsbarcode}</script>
<script>document.querySelectorAll('.bc').forEach(el => JsBarcode(el, el.dataset.code, { format: 'UPC', height: 70, width: 2, fontSize: 16, margin: 0 }))</script>
</body></html>`

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const page = await browser.newPage()
await page.setContent(html, { waitUntil: 'load' })
await page.pdf({ path: out, format: 'Letter', printBackground: true, preferCSSPageSize: true })
await browser.close()
console.log(`${items.length} labels → ${out}`)
