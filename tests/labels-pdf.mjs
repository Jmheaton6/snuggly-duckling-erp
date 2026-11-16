// Signs in as a manager, opens Barcode Labels, downloads the PDF in both sizes and
// saves screenshots. Usage: PW_CHROMIUM=... node tests/labels-pdf.mjs [url]
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
process.loadEnvFile('.env.local')
const URL = process.argv[2] ?? 'http://localhost:4173/'
const OUT = 'tests/shots'; mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(URL)
await page.getByLabel('Email').fill('manager@snugglyduckling.example')
await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.goto(URL + '#/settings')
await page.getByRole('button', { name: 'View & download labels' }).click()
await page.getByRole('button', { name: 'Download PDF' }).waitFor({ timeout: 15000 })
await page.screenshot({ path: `${OUT}/labels-large.png` })
for (const size of ['large', 'small']) {
  if (size === 'small') await page.getByLabel('Label size').selectOption('small')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()])
  const file = `${OUT}/labels-${size}.pdf`
  await dl.saveAs(file)
  const pdf = readFileSync(file, 'latin1')
  console.log(size, dl.suggestedFilename(), (pdf.match(/\/Type \/Page\b/g) ?? []).length, 'page(s)')
}
await page.screenshot({ path: `${OUT}/labels-small.png` })
console.log(errors.length ? 'ERRORS: ' + errors.join('; ') : 'no errors')
await browser.close()
