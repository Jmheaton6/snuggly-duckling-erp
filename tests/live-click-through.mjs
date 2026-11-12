// Clicks through the deployed site as a manager and a customer, saving screenshots
// and failing on any page error. Usage: node tests/live-click-through.mjs [url]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
process.loadEnvFile('.env.local')
const URL = process.argv[2] ?? 'https://jmheaton6.github.io/snuggly-duckling-erp/'
const OUT = 'tests/shots'; mkdirSync(OUT, { recursive: true })
// Reuse an already-downloaded browser if PW_CHROMIUM points at one (avoids a 100 MB download).
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const problems = []

async function session(email, pages) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => problems.push(`${email} page error: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && problems.push(`${email} console: ${m.text().slice(0, 200)}`))
  await page.goto(URL)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  for (const [hash, name, after] of pages) {
    await page.goto(URL + '#' + hash)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1200)
    if (after) await after(page)
    const err = await page.locator('[role=alert]').first().textContent().catch(() => null)
    if (err) problems.push(`${name}: ${err}`)
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
    console.log('shot', name)
  }
  await ctx.close()
}

await session('leah@snugglyduckling.example', [
  ['/', 'dashboard'],
  ['/inventory', 'inventory'],
  ['/items', 'items-drawer', async (p) => { await p.getByText('Movie Night Box').first().click(); await p.waitForTimeout(1500) }],
  ['/suppliers', 'suppliers'],
  ['/customers', 'customers'],
  ['/settings', 'settings'],
  ['/about', 'about'],
  ['/pos', 'pos'],
  ['/sales-orders', 'sales-orders'],
  ['/moves', 'moves'],
  ['/labels', 'labels'],
  ['/mrp', 'placeholder-mrp'],
])
await session('emma.larsen@example.com', [['/', 'customer-shop']])
await browser.close()
console.log(problems.length ? `\nPROBLEMS:\n${problems.join('\n')}` : '\nno errors')
