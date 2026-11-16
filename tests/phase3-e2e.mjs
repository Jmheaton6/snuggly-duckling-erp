// Phase 3 on the live database: create + send a PO, open its document, scan-receive it,
// pay the bill, close it; then the supplier scorecard and replenishment screens.
// WRITES DATA: run `node tests/reset-demo.mjs` afterwards. Usage: node tests/phase3-e2e.mjs [url]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
process.loadEnvFile('.env.local')
const URL = process.argv[2] ?? 'http://localhost:4173/'
const OUT = 'tests/shots'; mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const step = (s) => console.log('·', s)
const alerts = async () => (await page.locator('[role=alert]').allInnerTexts()).filter(Boolean)

await page.goto(URL)
await page.getByLabel('Email').fill('manager@snugglyduckling.example')
await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.getByText('Dashboard').first().waitFor()

// 1. New PO → send
await page.goto(URL + '#/purchasing')
await page.getByRole('button', { name: 'New purchase order' }).click()
const modal = page.locator('[role=dialog]')
await modal.getByLabel('Supplier').selectOption({ label: 'Wasatch Beverage Co.' })
await modal.locator('tbody select').first().selectOption({ label: 'Cola 12 oz Can' })
await modal.locator('tbody input[type=number]').first().fill('48')
console.log('  expected if sent today:', await modal.getByText(/\(\+\d+ days\)/).innerText())
await page.screenshot({ path: `${OUT}/p3-new-po.png` })
await modal.getByRole('button', { name: 'Send PO' }).click()
await page.getByText(/PO-\d+ sent to Wasatch/).waitFor()
step('PO created and sent')
const drawerTitle = await page.locator('[role=dialog] h2').first().innerText()
console.log('  drawer:', drawerTitle)
await page.screenshot({ path: `${OUT}/p3-po-drawer.png` })

// 2. PO document + email link
await page.getByRole('button', { name: 'PO document' }).click()
const href = await page.locator('a[href^="mailto:"]').getAttribute('href')
console.log('  email link:', href.slice(0, 90) + '…')
await page.screenshot({ path: `${OUT}/p3-po-document.png` })
await page.keyboard.press('Escape')

// 3. Scan to receive
await page.getByRole('button', { name: 'Receive items' }).click()
const scan = page.getByPlaceholder('Scan an item label to count it in')
for (let i = 0; i < 3; i++) { await scan.fill('850010001067'); await scan.press('Enter') }
console.log('  after 3 scans:', await page.getByText(/Cola 12 oz Can: \d+ of/).innerText())
await scan.fill('850010001012'); await scan.press('Enter')
console.log('  wrong label:', await page.getByText(/is not on this PO/).innerText())
await page.screenshot({ path: `${OUT}/p3-receive.png` })
await page.getByRole('button', { name: 'Fill in everything still open' }).click()
await page.locator('[role=dialog]').last().getByRole('button', { name: 'Receive', exact: true }).click()
await page.getByText(/Received into/).waitFor()
step('received; status: ' + await page.locator('[role=dialog]').first().getByText(/^(Received|Partly received)$/).first().innerText())

// 4. Pay bill, close PO
await page.getByRole('button', { name: /^Pay/ }).click()
await page.getByText(/^Paid \$/).first().waitFor()
step('bill paid')
await page.getByRole('button', { name: 'Close PO' }).click()
await page.getByText(/PO-\d+ closed/).waitFor()
step('PO closed')
await page.screenshot({ path: `${OUT}/p3-po-closed.png` })
await page.keyboard.press('Escape')

// 5. Scorecard
await page.goto(URL + '#/suppliers')
await page.getByText('Lead time: actual vs quoted').waitFor()
await page.locator('tbody').getByText(/^(Keep|Watch|Replace)$/).first().waitFor()
const ratings = await page.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.innerText.split('\n')[0] + ' → ' + tr.innerText.trim().split(/\s+/).pop()))
console.log('  ratings:', ratings.join(' | '))
await page.screenshot({ path: `${OUT}/p3-scorecard.png`, fullPage: true })

// 6. Replenishment
await page.goto(URL + '#/replenishment')
await page.getByText('Reorder point (continuous)').waitFor()
await page.getByRole('button', { name: /All items/ }).click()
await page.locator('tbody tr', { hasText: 'Cola 12 oz Can' }).click()
console.log('  ROP math:', (await page.locator('.bg-sky-50\\/60').nth(1).innerText()).replace(/\n/g, ' | '))
await page.screenshot({ path: `${OUT}/p3-replenishment.png` })
await page.keyboard.press('Escape')
await page.getByRole('button', { name: /Periodic review/ }).click()
await page.getByRole('button', { name: /Needs an order/ }).click()
const n = await page.locator('tbody tr').count()
console.log('  periodic review rows needing an order:', n)
const createPo = page.getByRole('button', { name: 'Create PO' }).first()
if (await createPo.count()) { await createPo.click(); console.log('  prefilled PO lines:', await page.locator('[role=dialog] tbody tr').count()); await page.screenshot({ path: `${OUT}/p3-prefilled-po.png` }); await page.keyboard.press('Escape') }
await page.screenshot({ path: `${OUT}/p3-periodic.png`, fullPage: true })

const a = await alerts()
console.log(a.length ? 'ALERTS: ' + a.join('; ') : 'no alerts', '·', errors.length ? 'ERRORS: ' + errors.join('; ') : 'no errors')
await browser.close()
