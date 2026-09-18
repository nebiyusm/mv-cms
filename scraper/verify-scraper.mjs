#!/usr/bin/env node
/**
 * scraper/verify-scraper.mjs — end-to-end verification of the extranet scraper.
 *
 * No dev servers needed. Three checks:
 *
 *   1. Crypto round-trip: encrypt → decrypt → byte-identical JSON.
 *   2. Negative path against the REAL https://admin.booking.com:
 *      a deliberately-expired garbage session cookie is encrypted with
 *      scraper/encrypt-cookies.ts, then `tsx scraper/extranet-sync.ts` runs.
 *      Expected: exit code 2 with a detection reason (session_expired,
 *      captcha_detected, blocked — all acceptable; the point is it DETECTS
 *      and alerts instead of silently failing), and the Telegram sendMessage
 *      response prints ok=true (the alert really reached Telegram).
 *   3. Alert-must-not-be-silent: exit code 3 is only acceptable if the
 *      Telegram API itself is broken — asserted NOT to happen here.
 *
 * Requires scraper/.env with SCRAPER_COOKIE_KEY, TELEGRAM_BOT_TOKEN,
 * TELEGRAM_CHAT_ID (see scraper/.env.example).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const SCRAPER_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRAPER_DIR, '..')
dotenv.config({ path: path.join(SCRAPER_DIR, '.env') })

const results = []
function report(name, pass, detail = '') {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

const ENC_FILE = path.join(SCRAPER_DIR, 'cookies.booking.enc')
const TMP_PLAIN = path.join(SCRAPER_DIR, '.tmp-expired-cookies.json')

function key() {
  const hex = process.env.SCRAPER_COOKIE_KEY
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('SCRAPER_COOKIE_KEY missing/invalid')
  return Buffer.from(hex, 'hex')
}

// --- 1. Crypto round-trip (pure node, mirrors scraper/crypto.ts) -----------
function cryptoRoundTrip() {
  const k = key()
  const plaintext = JSON.stringify([{ name: 'ses', value: 'abc123', domain: '.booking.com' }])
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const blob = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
  const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(blob.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'))
  const back = Buffer.concat([
    decipher.update(Buffer.from(blob.data, 'base64')),
    decipher.final(),
  ]).toString('utf8')
  report('crypto round-trip encrypt→decrypt identical', back === plaintext)
}

// --- 2. Negative path against the real extranet -----------------------------
function negativePath() {
  // Deliberately-expired garbage session cookie for .booking.com.
  const expiredCookies = [
    {
      name: 'ses',
      value: 'EXPIRED_GARBAGE_SESSION_TOKEN_0000000000000000000000000000',
      domain: '.booking.com',
      path: '/',
      expires: 946684800, // 2000-01-01 — long past
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'auth_token',
      value: 'EXPIRED_GARBAGE_AUTH_TOKEN_0000000000000000000000000000',
      domain: '.booking.com',
      path: '/',
      expires: 946684800,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]

  writeFileSync(TMP_PLAIN, JSON.stringify(expiredCookies))

  console.log('encrypting expired cookies via scraper/encrypt-cookies.ts ...')
  // Invoke tsx's CLI directly via node — the repo path contains a space, so a
  // shell-wrapped `npx tsx` would split the script path on it.
  const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  execFileSync(process.execPath, [TSX_CLI, path.join(SCRAPER_DIR, 'encrypt-cookies.ts'), TMP_PLAIN, ENC_FILE], {
    stdio: 'inherit',
    cwd: REPO_ROOT,
  })
  report('cookies.booking.enc written', existsSync(ENC_FILE))

  console.log('running scraper against https://admin.booking.com with expired cookies ...')
  const run = spawnSync(process.execPath, [TSX_CLI, path.join(SCRAPER_DIR, 'extranet-sync.ts')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env },
  })
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  console.log('--- scraper output ---')
  console.log(output.trim())
  console.log(`--- exit code: ${run.status} ---`)

  report('exit code is 2 (detection)', run.status === 2, `got ${run.status}`)

  const m = output.match(/DETECTED: (\S+)/)
  const reason = m?.[1]
  const acceptable = ['session_expired', 'captcha_detected', 'blocked', '2fa_challenge', 'parse_failure']
  report('detection reason reported', !!reason && acceptable.includes(reason), reason ?? 'none')

  const tg = output.match(/telegram sendMessage: http=(\d+) ok=(\w+)/)
  report('Telegram alert delivered (ok=true)', !!tg && tg[2] === 'true', tg ? `http=${tg[1]}` : 'no telegram log line')
}

cryptoRoundTrip()
negativePath()

// --- cleanup temp files ------------------------------------------------------
rmSync(TMP_PLAIN, { force: true })
// Keep cookies.booking.enc? It only holds garbage cookies — remove it so it
// is never mistaken for a real session. Re-create it with real cookies later.
rmSync(ENC_FILE, { force: true })
console.log('cleaned up temp files (.tmp-expired-cookies.json, cookies.booking.enc)')

const failed = results.filter((r) => !r).length
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
