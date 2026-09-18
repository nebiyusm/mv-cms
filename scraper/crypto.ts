/**
 * scraper/crypto.ts — AES-256-GCM encryption for extranet session cookies.
 *
 * Key comes from env SCRAPER_COOKIE_KEY: 64-char hex string (= 32 bytes).
 * On-disk format is JSON with base64 fields: { iv, tag, data }.
 *
 * Generate a key with: `openssl rand -hex 32` or
 *   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export interface EncryptedBlob {
  iv: string
  tag: string
  data: string
}

export function loadKey(): Buffer {
  const hex = process.env.SCRAPER_COOKIE_KEY
  if (!hex) {
    throw new Error('SCRAPER_COOKIE_KEY is not set (expected 64-char hex, i.e. 32 bytes)')
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('SCRAPER_COOKIE_KEY must be exactly 64 hex characters (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

export function encrypt(plaintext: string, key: Buffer = loadKey()): EncryptedBlob {
  const iv = randomBytes(12) // 96-bit IV, the recommended size for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

export function decrypt(blob: EncryptedBlob, key: Buffer = loadKey()): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(blob.data, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
