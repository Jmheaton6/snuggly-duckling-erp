// Opens every sidebar screen as the manager at desktop and phone width, saves screenshots,
// and counts gold (primary) buttons visible at once. Read-only. Usage: node tests/redesign-check.mjs [url]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
process.loadEnvFile('.env.local')
const URL = process.argv[2] ?? 'http://localhost:4173/'
const OUT = 'tests/shots/redesign'; mkdirSync(OUT, { recursive: true })
const PAGES = ['/', '/ripple', '/pos', '/sales-orders', '/returns', '/inventory', '/items', '/moves', '/labels', '/purchasing', '/suppliers', '/replenishment', '/production', '/mrp', '/financials', '/reports', '/customers', '/settings', '/about']
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const errors = [], gold = {}
for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  await page.goto(URL)
  await page.screenshot({ path: `${OUT}/${label}-login.png` })
  await page.getByLabel('Email').fill('manager@snugglyduckling.example')
  await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForTimeout(2500)
  for (const p of PAGES) {
    await page.goto(URL + '#' + p)
    await page.waitForTimeout(1800)
    const name = p === '/' ? 'dashboard' : p.slice(1)
    await page.screenshot({ path: `${OUT}/${label}-${name}.png` })
    if (label === 'desktop') {
      gold[name] = await page.locator('button.bg-gold-500, a.bg-gold-500').evaluateAll((els) => els
        .filter((e) => e.getBoundingClientRect().width > 0 && !e.closest('aside') && getComputedStyle(e).visibility !== 'hidden')
        .map((e) => e.innerText.trim().replace(/\s+/g, ' ')))
    }
  }
  if (label === 'desktop') {
    // Focus rings: tab into the Settings form.
    await page.goto(URL + '#/settings'); await page.waitForTimeout(1500)
    await page.locator('main input').first().focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab')
    await page.screenshot({ path: `${OUT}/desktop-focus-input.png` })
    await page.locator('aside a').nth(2).focus()
    await page.screenshot({ path: `${OUT}/desktop-focus-nav.png`, clip: { x: 0, y: 0, width: 260, height: 320 } })
  }
  await page.close()
}
for (const [k, v] of Object.entries(gold)) if (v.length) console.log(`${k.padEnd(14)} ${v.length} gold: ${v.join(' | ')}`)
console.log(errors.length ? 'ERRORS: ' + errors.join('; ') : 'no page errors')
await browser.close()
