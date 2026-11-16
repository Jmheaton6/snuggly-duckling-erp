// Phase 4 on the live database: create a work order, start it (issue components) with a start
// time 2 hours ago, complete it with scrap + rework, then open the production report.
// WRITES DATA: run `node tests/reset-demo.mjs` afterwards. Usage: node tests/phase4-e2e.mjs [url]
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
const local = (minsAgo) => { const d = new Date(Date.now() - minsAgo * 6e4); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16) }
const dialog = () => page.locator('[role=dialog]').last()

await page.goto(URL)
await page.getByLabel('Email').fill('manager@snugglyduckling.example')
await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.getByText('Dashboard').first().waitFor()
await page.goto(URL + '#/production')
await page.getByRole('button', { name: 'New work order' }).click()
await dialog().getByLabel('Item to make or pack').selectOption({ label: 'Caramel Popcorn 8 oz' })
await dialog().getByLabel('Quantity').fill('24')
await page.screenshot({ path: `${OUT}/p4-new-wo.png` })
await dialog().getByRole('button', { name: 'Create work order' }).click()
await page.getByText(/WO-\d+ created/).waitFor()
step('created ' + (await page.locator('[role=dialog] h2').first().innerText()))

await page.getByRole('button', { name: 'Start (issue components)' }).click()
await dialog().getByLabel('Start time').fill(local(120))
await dialog().getByRole('button', { name: 'Start', exact: true }).click()
await page.getByText(/started: components issued/).waitFor()
step('started 2 hours ago')
await page.screenshot({ path: `${OUT}/p4-started.png` })

await page.getByRole('button', { name: 'Complete', exact: true }).click()
await dialog().getByRole('spinbutton', { name: /^Good units/ }).fill('22')
await dialog().getByRole('spinbutton', { name: /^Reworked/ }).fill('1')
await dialog().getByLabel('Quality reason').selectOption({ label: 'Burnt batch' })
await dialog().getByLabel('Finish time').fill(local(30))
console.log('  modal says:', await dialog().getByText(/min after start/).innerText())
await page.screenshot({ path: `${OUT}/p4-complete.png` })
await dialog().getByRole('button', { name: 'Complete', exact: true }).click()
await page.getByText(/completed: 22 Caramel Popcorn/).waitFor()
step('completed')
await page.waitForTimeout(800)
console.log('  math:', (await page.locator('.bg-sky-50\\/60').innerText()).replace(/\n/g, ' | '))
await page.screenshot({ path: `${OUT}/p4-completed.png` })
await page.keyboard.press('Escape')

await page.getByRole('button', { name: 'Production report' }).click()
await page.getByText('First-pass yield').first().waitFor()
await page.getByRole('button', { name: 'Last 90 days' }).click()
const kpis = await page.locator('.grid > div').filter({ hasText: /Yield|Scrap rate|Cycle time|On-time/ }).allInnerTexts()
console.log('  KPIs:', kpis.slice(0, 5).map((k) => k.replace(/\n/g, ' ')).join(' || '))
await page.screenshot({ path: `${OUT}/p4-report.png`, fullPage: true })
const alerts = (await page.locator('[role=alert]').allInnerTexts()).filter(Boolean)
console.log(alerts.length ? 'ALERTS: ' + alerts.join('; ') : 'no alerts', '·', errors.length ? 'ERRORS: ' + errors.join('; ') : 'no errors')
await browser.close()
