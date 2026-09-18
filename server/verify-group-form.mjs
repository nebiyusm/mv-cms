#!/usr/bin/env node
/**
 * server/verify-group-form.mjs — UI verification of the /new-booking page.
 *
 * Prereqs: `npm run dev` on http://localhost:5173 and the API server on :3001.
 *
 * 1. Opens /new-booking, keeps the default dates, clicks "Check availability".
 * 2. Fills two guest names and selects the first two enabled beds.
 * 3. Submits, expects the confirmation panel listing both guests,
 *    then screenshots artifacts/group-form.png.
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/new-booking'

const results = []
function check(name, ok, detail = '') {
  results.push([name, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

await mkdir('artifacts', { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'New Booking' }).waitFor()
  check('u1: /new-booking renders the form header', true)

  await page.getByRole('button', { name: 'Check availability' }).click()
  await page.getByRole('button', { name: 'Create booking' }).waitFor()
  const bedCountText = await page.locator('text=/beds available/').first().textContent()
  check('u2: availability loaded, rooming list visible', true, bedCountText?.trim())

  // Row 1: fill name + first enabled bed
  const nameInputs = page.locator('tbody input[type="text"]')
  const bedSelects = page.locator('tbody select')
  await nameInputs.nth(0).fill('UI TEST GUEST ONE')
  const firstBed = await bedSelects.nth(0).evaluate((el) => {
    const opt = [...el.options].find((o) => o.value && !o.disabled)
    el.value = opt.value
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return opt.value
  })
  check('u3: row 1 name + bed set', Boolean(firstBed))

  // Add row 2
  await page.getByRole('button', { name: 'Add guest' }).click()
  await nameInputs.nth(1).fill('UI TEST GUEST TWO')
  const secondBed = await bedSelects.nth(1).evaluate((el) => {
    const opt = [...el.options].find((o) => o.value && !o.disabled)
    el.value = opt.value
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return opt.value
  })
  check('u4: row 2 name + bed set (distinct from row 1)', Boolean(secondBed) && secondBed !== firstBed)

  const submitBtn = page.getByRole('button', { name: 'Create booking' })
  check('u5: submit enabled once form is valid', await submitBtn.isEnabled())

  await submitBtn.click()
  await page.getByRole('heading', { name: 'Booking confirmed' }).waitFor({ timeout: 15000 })
  const confirmedText = await page.locator('main').textContent()
  check(
    'u6: confirmation panel lists both guests',
    confirmedText.includes('UI TEST GUEST ONE') && confirmedText.includes('UI TEST GUEST TWO'),
  )
  check(
    'u7: confirmation has a link back to the calendar',
    await page.getByRole('link', { name: /Back to calendar/ }).isVisible(),
  )

  await page.screenshot({ path: 'artifacts/group-form.png', fullPage: true })
  console.log('screenshot: artifacts/group-form.png')
} catch (err) {
  check('ui flow completed without errors', false, String(err).split('\n')[0])
  await page.screenshot({ path: 'artifacts/group-form.png', fullPage: true }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
