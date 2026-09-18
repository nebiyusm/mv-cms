#!/usr/bin/env node
/**
 * server/make-icons.mjs — generate the PWA icons for the kiosk app.
 *
 * Renders the brand mark (primary blue rounded square + white "MV") in
 * headless Chromium and screenshots it at 512x512 and 192x192 into
 * public/icons/. Re-run whenever the brand color changes.
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const html = (size) => `<!doctype html><html><body style="margin:0">
<div style="
  width:${size}px;height:${size}px;background:#2563EB;border-radius:${Math.round(size * 0.22)}px;
  display:flex;align-items:center;justify-content:center;
  color:#fff;font:700 ${Math.round(size * 0.42)}px Inter,system-ui,sans-serif;
  letter-spacing:-0.02em;">MV</div>
</body></html>`

await mkdir('public/icons', { recursive: true })
const browser = await chromium.launch()
for (const size of [512, 192]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(html(size))
  await page.screenshot({ path: `public/icons/icon-${size}.png` })
  await page.close()
  console.log(`wrote public/icons/icon-${size}.png`)
}
await browser.close()
