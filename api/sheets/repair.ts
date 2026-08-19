import { readCookie, SESSION_COOKIE_NAME } from '../_lib/cookies'
import { jsonResponse, methodNotAllowed } from '../_lib/function-response'
import { refreshGoogleCredentials } from '../_lib/google-oauth'
import { getServerConfig } from '../_lib/server-config'
import { decryptSession } from '../_lib/session-crypto'
import { decryptRefreshToken } from '../_lib/token-crypto'
import { getFirestoreClient } from '../_lib/firestore'
import { SessionStore } from '../_lib/session-store'
import { ConnectionStore } from '../_lib/connection-store'
import { RateLimiter } from '../_lib/rate-limit'
import { SheetsClient } from '../_lib/sheets-client'
import { SheetsJournalStore } from '../_lib/sheets-journal-store'

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  let config: ReturnType<typeof getServerConfig>
  try {
    config = getServerConfig()
  } catch {
    return jsonResponse({ error: 'server_configuration_error' }, 500)
  }

  const firestore = getFirestoreClient()
  const sessionStore = new SessionStore(firestore)
  const connectionStore = new ConnectionStore(firestore)
  const rateLimiter = new RateLimiter(firestore)

  const cookieHeader = request.headers.get('Cookie')
  const journalCookie = readCookie(cookieHeader, SESSION_COOKIE_NAME)
  if (!journalCookie) {
    return jsonResponse({ error: 'unauthenticated' }, 401)
  }

  const journalPayload = decryptSession(journalCookie, config.sessionEncryptionKey)
  if (!journalPayload) {
    return jsonResponse({ error: 'unauthenticated' }, 401)
  }

  const session = await sessionStore.resolveJournalSession(journalPayload.sessionId)
  if (!session) {
    return jsonResponse({ error: 'unauthenticated' }, 401)
  }

  const activeConnection = await connectionStore.findActiveConnection(session.userId)
  if (!activeConnection) {
    return jsonResponse({ error: 'needs_reconnect' }, 401)
  }

  try {
    await rateLimiter.consume({
      scope: 'sheet_repair',
      subject: session.userId,
      limit: 5,
      windowMs: 60_000,
    })
  } catch {
    return jsonResponse(
      { ok: false, error: { code: 'RATE_LIMITED', message: '請求過於頻繁，請稍後再試。' } },
      429,
    )
  }

  const rawRefreshToken = decryptRefreshToken(activeConnection.encryptedRefreshToken, config.tokenEncryptionKey)
  if (!rawRefreshToken) {
    return jsonResponse({ error: 'unauthenticated' }, 401)
  }

  let accessToken: string
  try {
    const creds = await refreshGoogleCredentials(rawRefreshToken, config)
    accessToken = creds.accessToken
  } catch {
    return jsonResponse({ error: 'upstream_failure' }, 502)
  }

  const sheetsClient = new SheetsClient()

  try {
    await SheetsJournalStore.ensureSchema(sheetsClient, activeConnection.spreadsheetId, accessToken)
    return jsonResponse({ ok: true })
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'REPAIR_FAILED',
          message: error instanceof Error ? error.message : '修復 Google Sheet 資料表結構失敗。',
        },
      },
      500,
    )
  }
}
