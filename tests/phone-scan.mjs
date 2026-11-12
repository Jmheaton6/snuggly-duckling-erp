// Simulates a customer's phone: iPhone-size screen, and a "camera" that shows a printed
// label (Chrome fake capture). Signs in as a customer, taps Scan a product, and checks the
// item lands in the order. Usage: PW_CHROMIUM=... node tests/phone-scan.mjs [url]
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.loadEnvFile('.env.local')
const URL = process.argv[2] ?? 'http://localhost:4173/'
const OUT = 'tests/shots'; mkdirSync(OUT, { recursive: true })
const exe = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}

// 1) Draw the Cola label (UPC 850010001067) and save it as a 640×480 JPEG "camera frame".
const jsb = readFileSync('node_modules/jsbarcode/dist/JsBarcode.all.min.js', 'utf8')
const drawer = await chromium.launch(exe)
const pg = await drawer.newPage({ viewport: { width: 640, height: 480 } })
await pg.setContent(`<body style="margin:0;background:#f4f1ea;display:flex;align-items:center;justify-content:center;height:480px">
  <div style="background:#fff;padding:18px 28px;border:1px solid #ccc;font-family:Helvetica;text-align:center">
  <b>Cola 12 oz Can</b><br><svg id="b"></svg></div><script>${jsb}</script>
  <script>JsBarcode('#b','850010001067',{format:'UPC',height:110,width:3,fontSize:18,margin:0})</script></body>`)
const jpeg = await pg.screenshot({ type: 'jpeg', quality: 92 })
await drawer.close()
// Chrome's fake camera plays an MJPEG file: JPEG frames back to back.
const mjpeg = join(tmpdir(), 'cola-label.mjpeg')
writeFileSync(mjpeg, Buffer.concat(Array(30).fill(jpeg)))

// 2) A phone with that camera.
const browser = await chromium.launch({ ...exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${mjpeg}`] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
await ctx.grantPermissions(['camera'], { origin: new globalThis.URL(URL).origin })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(URL)
await page.getByLabel('Email').fill('emma.larsen@example.com')
await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.getByRole('button', { name: 'Scan a product' }).waitFor({ timeout: 15000 })
await page.screenshot({ path: `${OUT}/phone-shop.png` })
await page.getByRole('button', { name: 'Scan a product' }).click()
const added = page.getByText(/Added Cola 12 oz Can/)
await added.waitFor({ timeout: 20000 })
await page.screenshot({ path: `${OUT}/phone-scanning.png` })
console.log('camera read the label → "Added Cola 12 oz Can"')
await page.getByRole('button', { name: 'Done' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/phone-after-scan.png` })
const bar = await page.getByRole('button', { name: /Review order/ }).textContent()
console.log('order bar:', bar)
await browser.close()
if (errors.length) { console.log('page errors:', errors); process.exit(1) }
