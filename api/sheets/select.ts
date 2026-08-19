import {
  clearProvisioningCookie,
  createSessionCookie,
  PROVISIONING_COOKIE_NAME,
  readCookie,
  SESSION_COOKIE_NAME,
} from '../_lib/cookies'
import { jsonResponse, methodNotAllowed } from '../_lib/function-response'
import { refreshGoogleCredentials } from '../_lib/google-oauth'
import { getServerConfig } from '../_lib/server-config'
import { decryptSession, encryptSession } from '../_lib/session-crypto'
import { decryptRefreshToken } from '../_lib/token-crypto'
import { getFirestoreClient } from '../_lib/firestore'
import { SessionStore } from '../_lib/session-store'
import { ConnectionStore } from '../_lib/connection-store'
import { RateLimiter } from '../_lib/rate-limit'
import { SheetsClient } from '../_lib/sheets-client'
import { SheetsJournalStore } from '../_lib/sheets-journal-store'
import { JournalError } from '../../shared/journal/errors'
import type { EncryptedToken } from '../_lib/token-crypto'

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    spreadsheetId?: string
    spreadsheetName?: string
  } | null

  const spreadsheetId = body?.spreadsheetId?.trim()
  if (!spreadsheetId) {
    return jsonResponse({ error: 'invalid_request', message: '請提供 spreadsheetId' }, 400)
  }

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
  const provCookie = readCookie(cookieHeader, PROVISIONING_COOKIE_NAME)

  let userId: string | undefined
  let encryptedToken: EncryptedToken | undefined
  let provSessionId: string | undefined

  if (provCookie) {
    const provPayload = decryptSession(provCookie, config.sessionEncryptionKey)
    if (provPayload) {
      const provSession = await sessionStore.resolveProvisioningSession(provPayload.sessionId)
      if (provSession && provSession.provisioningAttemptId) {
        const attempt = await connectionStore.getProvisioningAttempt(provSession.provisioningAttemptId)
        if (attempt?.tempEncryptedRefreshToken) {
          userId = provSession.userId
          encryptedToken = attempt.tempEncryptedRefreshToken
          provSessionId = provSession.sessionId
        }
      }
    }
  }

  if (!userId && journalCookie) {
    const journalPayload = decryptSession(journalCookie, config.sessionEncryptionKey)
    if (journalPayload) {
      const journalSession = await sessionStore.resolveJournalSession(journalPayload.sessionId)
      if (journalSession) {
        const conn = await connectionStore.findActiveConnection(journalSession.userId)
        if (conn?.encryptedRefreshToken) {
          userId = journalSession.userId
          encryptedToken = conn.encryptedRefreshToken
        }
      }
    }
  }

  if (!userId || !encryptedToken) {
    return jsonResponse({ error: 'unauthenticated' }, 401)
  }

  try {
    await rateLimiter.consume({
      scope: 'sheet_select',
      subject: userId,
      limit: 10,
      windowMs: 60_000,
    })
  } catch {
    return jsonResponse(
      { ok: false, error: { code: 'RATE_LIMITED', message: '請求過於頻繁，請稍後再試。' } },
      429,
    )
  }

  const rawRefreshToken = decryptRefreshToken(encryptedToken, config.tokenEncryptionKey)
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
    await SheetsJournalStore.verifySchema(sheetsClient, spreadsheetId, accessToken)
  } catch (error) {
    if (error instanceof JournalError) {
      return jsonResponse(
        { ok: false, error: { code: 'SCHEMA_MISMATCH', message: error.message } },
        400,
      )
    }
    return jsonResponse(
      { ok: false, error: { code: 'SCHEMA_MISMATCH', message: '此試算表缺少日記工作表或欄位不符。' } },
      400,
    )
  }

  let connection
  try {
    connection = await connectionStore.activateConnection({
      userId,
      spreadsheetId,
      spreadsheetName: body?.spreadsheetName?.trim() || '每日記事',
      encryptedRefreshToken: encryptedToken,
    })
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'CLAIMED_BY_ANOTHER_USER',
          message: error instanceof Error ? error.message : '此資料表已被其他帳號連結。',
        },
      },
      409,
    )
  }

  if (provSessionId) {
    await sessionStore.revokeSession(provSessionId)
  }

  const { sessionId, expiresAt } = await sessionStore.create({
    userId,
    kind: 'journal',
    ttlMs: SESSION_TTL_MS,
  })

  const sessionCookie = encryptSession({ sessionId, expiresAt }, config.sessionEncryptionKey)

  return jsonResponse(
    {
      ok: true,
      connection: {
        spreadsheetId: connection.spreadsheetId,
        spreadsheetName: connection.spreadsheetName,
      },
    },
    200,
    [createSessionCookie(sessionCookie), clearProvisioningCookie()],
  )
}
