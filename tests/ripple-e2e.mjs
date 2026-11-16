// Ripple view on the live database: open it (Following live), then from another session ring a
// gift-box sale, receive a PO and place a sales order, and check each ripple appears.
// WRITES DATA: run `node tests/reset-demo.mjs` afterwards. Usage: node tests/ripple-e2e.mjs [url]
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync } from 'node:fs'
process.loadEnvFile('.env.local')
const URL = process.argv[2] ?? 'http://localhost:4173/'
const OUT = 'tests/shots'; mkdirSync(OUT, { recursive: true })
const api = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
await api.auth.signInWithPassword({ email: 'joe@snugglyduckling.example', password: process.env.DEMO_PASSWORD })
const call = async (fn, args) => { const { data, error } = await api.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data }
const id = async (sku) => (await api.from('items').select('id').eq('sku', sku).single()).data.id

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(URL)
await page.getByLabel('Email').fill('manager@snugglyduckling.example')
await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.getByText('Dashboard').first().waitFor()
await page.goto(URL + '#/ripple')
await page.getByText('Following live').waitFor()
await page.waitForTimeout(3000)   // let Realtime subscribe
const section = async (n) => (await page.locator('section', { hasText: n }).first().innerText()).replace(/\n/g, ' | ').slice(0, 420)

// 1. A gift-box sale from "another register".
const box = await id('SD-4001')
const sale = await call('post_sale', { p_location_id: 1, p_lines: [{ item_id: box, qty: 1 }] })
await page.getByRole('heading', { name: new RegExp(`Sale S-${sale}`) }).waitFor({ timeout: 15000 })
console.log(`· live: S-${sale} appeared on its own`)
console.log('  steps:', (await page.locator('h2 + div').first().innerText()).replace(/\n/g, ' '))
console.log('  ledger:', await section('Stock ledger'))
console.log('  books:', await section('Books (journal)'))
await page.screenshot({ path: `${OUT}/ripple-sale.png`, fullPage: true })

// 2. A PO sent and received: average cost moves, a bill appears.
const almonds = await id('SD-2001')
const po = await call('create_purchase_order', { p_supplier_id: 1, p_location_id: 3, p_lines: [{ item_id: almonds, qty: 25, unit_cost: 5.1 }] })
await call('receive_purchase_order', { p_po_id: po })
await page.getByRole('heading', { name: /PO receipt/ }).waitFor({ timeout: 15000 })
console.log(`· live: receipt for PO-${po} appeared`)
console.log('  ledger:', await section('Stock ledger'))
console.log('  ripples:', await section('Ripples'))
await page.screenshot({ path: `${OUT}/ripple-receipt.png`, fullPage: true })

// 3. A sales order: no stock, no money, but demand.
const so = await call('create_sales_order', { p_customer_id: 1, p_location_id: 1, p_requested_date: new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10), p_lines: [{ item_id: box, qty: 30 }] })
await page.getByRole('heading', { name: /Sales order placed/ }).waitFor({ timeout: 15000 })
console.log(`· live: SO-${so} appeared`)
console.log('  stock:', await section('Stock ledger'))
console.log('  ripples:', await section('Ripples'))
await page.screenshot({ path: `${OUT}/ripple-so.png`, fullPage: true })

// 4. Pick an older transaction from the list: following stops.
await page.locator('ul li button').nth(3).click()
console.log('· picked an older one; follow =', await page.getByText('Follow live', { exact: true }).count() ? 'off' : 'on')
const alerts = (await page.locator('[role=alert]').allInnerTexts()).filter(Boolean)
console.log(alerts.length ? 'ALERTS: ' + alerts.join('; ') : 'no alerts', '·', errors.length ? 'ERRORS: ' + errors.join('; ') : 'no errors')
await browser.close()
