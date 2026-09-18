/**
 * scraper/alert.ts — Telegram alerting for extranet sync failures.
 *
 * One alert per sync run, sent via the Bot API sendMessage endpoint.
 * If the alert itself cannot be delivered, sendAlert throws — the caller
 * exits with code 3 so a failed sync can never go unnoticed silently.
 */

export interface AlertInfo {
  ota: string
  reason: string
  url: string
}

export interface TelegramResult {
  ok: boolean
  status: number
  description?: string
}

export async function sendAlert(info: AlertInfo): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set')
  }

  const text =
    `[Mad Vervet PMS] Extranet sync FAILED — ` +
    `OTA: ${info.ota}, reason: ${info.reason}, url: ${info.url}, ` +
    `time: ${new Date().toISOString()}`

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })

  let body: { ok?: boolean; description?: string } = {}
  try {
    body = (await res.json()) as typeof body
  } catch {
    // non-JSON response — treat as failure below
  }

  const result: TelegramResult = {
    ok: res.ok && body.ok === true,
    status: res.status,
    description: body.description,
  }
  // Surfaced so verify scripts can assert the alert really reached Telegram.
  console.log(`telegram sendMessage: http=${result.status} ok=${result.ok}`)

  if (!result.ok) {
    throw new Error(
      `Telegram alert FAILED (http=${result.status}, description=${result.description ?? 'n/a'})`,
    )
  }
  return result
}
