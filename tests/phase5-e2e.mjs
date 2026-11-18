// Phase 5 on the live database: ring two sales, return one (shelf + quality hold), exchange the
// other, scrap the held item, then open Financials and every Reports tab.
// WRITES DATA: run `node tests/reset-demo.mjs` afterwards. Usage: node tests/phase5-e2e.mjs [url]
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync } from 'node:fs'
process.loadEnvFile('.env.local')
const URL = process.argv[2] ?? 'http://localhost:4173/'
const OUT = 'tests/shots'; mkdirSync(OUT, { recursive: true })
const step = (s) => console.log('·', s)

// Two receipts to work with (rung through the same database function the POS uses).
const api = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
await api.auth.signInWithPassword({ email: 'manager@snugglyduckling.example', password: process.env.DEMO_PASSWORD })
const id = async (sku) => (await api.from('items').select('id').eq('sku', sku).single()).data.id
const [cola, gummy] = await Promise.all([id('SD-1101'), id('SD-1201')])
const sale = async (lines) => { const { data, error } = await api.rpc('post_sale', { p_location_id: 1, p_lines: lines }); if (error) throw error; return data }
const s1 = await sale([{ item_id: cola, qty: 2 }, { item_id: gummy, qty: 1 }])
const s2 = await sale([{ item_id: cola, qty: 1 }])
step(`rang S-${s1} (2 cola + 1 gummy) and S-${s2} (1 cola)`)

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(URL)
await page.getByLabel('Email').fill('manager@snugglyduckling.example')
await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.getByText('Dashboard').first().waitFor()

// Return: 1 cola to the shelf, 1 gummy bears for a quality problem (Returns Hold).
await page.goto(URL + '#/returns')
const scan = page.getByPlaceholder(/Scan the receipt barcode/)
await scan.fill(`S-${s1}`); await scan.press('Enter')
const row = (name) => page.locator('table').first().locator('tbody tr', { hasText: name })
await row('Cola 12 oz Can').locator('input').fill('1')
await row('Cola 12 oz Can').locator('select').selectOption({ label: 'Changed mind / unopened' })
await row('Gummy Bears 5 oz').locator('input').fill('1')
await row('Gummy Bears 5 oz').locator('select').selectOption({ label: 'Stale product' })
console.log('  preview:', (await page.locator('dl').last().innerText()).replace(/\n/g, ' '))
await page.screenshot({ path: `${OUT}/p5-return.png` })
await page.getByRole('button', { name: /^Refund \$/ }).click()
console.log('  ' + await page.getByText(/^R-\d+: refunded/).innerText())
await page.getByText('Gummy Bears 5 oz').first().waitFor()
step('return processed; gummy bears in Returns Hold')

// Exchange: the 1 cola on S-s2 for 2 root beers.
await scan.fill(String(s2)); await scan.press('Enter')
await page.getByRole('button', { name: 'Exchange', exact: true }).click()
await row('Cola 12 oz Can').locator('input').fill('1')
await row('Cola 12 oz Can').locator('select').selectOption({ label: 'Wrong item purchased' })
const newScan = page.getByPlaceholder('Scan or type the new item')
for (let i = 0; i < 2; i++) { await newScan.fill('SD-1103'); await newScan.press('Enter') }
console.log('  exchange preview:', (await page.locator('dl').last().innerText()).replace(/\n/g, ' '))
await page.screenshot({ path: `${OUT}/p5-exchange.png` })
await page.getByRole('button', { name: 'Complete exchange' }).click()
console.log('  ' + await page.getByText(/^Exchange R-\d+/).innerText())

// Scrap what's on hold.
const hold = page.locator('li', { hasText: 'Gummy Bears 5 oz' }).first()
await hold.getByRole('button', { name: 'Scrap' }).click()
console.log('  ' + await page.getByText(/scrapped: \$/).first().innerText())
await page.screenshot({ path: `${OUT}/p5-returns-page.png`, fullPage: true })

// Financials.
await page.goto(URL + '#/financials')
await page.getByRole('button', { name: 'This month' }).click()
await page.getByText('Net income').first().waitFor()
await page.waitForTimeout(1500)
const pl = await page.locator('table').first().innerText()
console.log('  P&L:', pl.split('\n').filter((l) => /Net sales|Gross profit|Net income/.test(l)).join(' | ').replace(/\t/g, ' '))
console.log('  turnover:', (await page.locator('.bg-sky-50\\/60').innerText()).split('\n').slice(-4).join(' | '))
console.log('  valuation:', (await page.getByText(/Books say/).innerText()))
await page.screenshot({ path: `${OUT}/p5-financials.png`, fullPage: true })

// Reports: every tab.
await page.goto(URL + '#/reports')
for (const tab of ['Sales by day / week', 'Top sellers', 'Low stock', 'Inventory by location', 'Supplier performance']) {
  await page.getByRole('button', { name: tab }).click()
  await page.waitForTimeout(1500)
  const rows = await page.locator('tbody tr').count()
  console.log(`  report "${tab}": ${rows} rows`)
  await page.screenshot({ path: `${OUT}/p5-report-${tab.split(' ')[0].toLowerCase()}.png`, fullPage: true })
}
const alerts = (await page.locator('[role=alert]').allInnerTexts()).filter(Boolean)
console.log(alerts.length ? 'ALERTS: ' + alerts.join('; ') : 'no alerts', '·', errors.length ? 'ERRORS: ' + errors.join('; ') : 'no errors')
await browser.close()
