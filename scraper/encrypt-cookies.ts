/**
 * scraper/encrypt-cookies.ts — CLI: encrypt a plain cookies JSON file into
 * scraper/cookies.booking.enc using AES-256-GCM (see scraper/crypto.ts).
 *
 * Usage:
 *   npx tsx scraper/encrypt-cookies.ts <input.json> [output.enc]
 *
 * Input may be either:
 *   - a Playwright storage-state file ({ cookies: [...], origins: [...] }), or
 *   - a bare array of Playwright cookie objects.
 * The cookie array is extracted and stored encrypted; origins are dropped
 * (extranet sync is cookie-based only, no localStorage restore).
 *
 * Requires SCRAPER_COOKIE_KEY in the environment (or scraper/.env).
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { encrypt, loadKey } from './crypto.js'

const SCRAPER_DIR = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(SCRAPER_DIR, '.env') })

interface StorageState {
  cookies?: unknown[]
  origins?: unknown[]
}

async function main() {
  const [input, output = path.join(SCRAPER_DIR, 'cookies.booking.enc')] = process.argv.slice(2)
  if (!input) {
    console.error('Usage: tsx scraper/encrypt-cookies.ts <input.json> [output.enc]')
    process.exit(1)
  }

  const raw = JSON.parse(await readFile(input, 'utf8')) as StorageState | unknown[]
  const cookies = Array.isArray(raw) ? raw : raw.cookies
  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error(`No cookies found in ${input} (expected storage-state or cookie array)`)
  }

  const key = loadKey()
  const blob = encrypt(JSON.stringify(cookies), key)
  await writeFile(output, JSON.stringify(blob, null, 2))
  console.log(`Encrypted ${cookies.length} cookies -> ${output}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
