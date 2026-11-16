// Signs in as a manager, opens MRP, clicks through a record (cells, BOM links, horizon)
// and saves screenshots. Read-only: never releases an order. Usage: node tests/mrp-page.mjs [url]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
process.loadEnvFile('.env.local')
const URL = process.argv[2] ?? 'http://localhost:4173/'
const OUT = 'tests/shots'; mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(URL)
await page.getByLabel('Email').fill('manager@snugglyduckling.example')
await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.getByText('Dashboard').first().waitFor()
await page.goto(URL + '#/mrp')
await page.getByText('Planned order releases').first().waitFor({ timeout: 20000 })
await page.screenshot({ path: `${OUT}/mrp-top.png`, fullPage: true })
const alerts = await page.locator('[role=alert]').allInnerTexts()
// Click the first non-zero planned order release cell and the projected on hand in week 2.
const rel = page.locator('tr', { hasText: 'Planned order releases' }).last().locator('button').filter({ hasNotText: '·' }).first()
if (await rel.count()) { await rel.click(); console.log('release math:', (await page.locator('.bg-sky-50\\/60').innerText()).replace(/\n/g, ' | ')) }
await page.locator('tr', { hasText: 'Projected on hand' }).locator('button').nth(1).click()
console.log('POH math:', (await page.locator('.bg-sky-50\\/60').innerText()).replace(/\n/g, ' | '))
await page.locator('#mrp-record').screenshot({ path: `${OUT}/mrp-record.png` })
// Follow the first BOM link down a level.
const link = page.locator('#mrp-record li button').first()
if (await link.count()) { const t = await link.innerText(); await link.click(); console.log('opened child:', t.split('\n')[0]); await page.waitForTimeout(400); await page.locator('#mrp-record').screenshot({ path: `${OUT}/mrp-child.png` }) }
await page.getByLabel('Horizon').selectOption('8')
await page.waitForTimeout(300)
console.log(alerts.length ? 'ALERTS: ' + alerts.join('; ') : 'no alerts', '·', errors.length ? 'ERRORS: ' + errors.join('; ') : 'no errors')
await browser.close()
