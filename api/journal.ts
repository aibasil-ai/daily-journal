import { randomUUID } from 'node:crypto'
import { clearSessionCookie, readCookie, SESSION_COOKIE_NAME } from './_lib/cookies'
import { jsonResponse, methodNotAllowed } from './_lib/function-response'
import {
  GoogleOAuthUpstreamError,
  InvalidRefreshTokenError,
  refreshGoogleCredentials,
} from './_lib/google-oauth'
import { getServerConfig } from './_lib/server-config'
import { decryptSession } from './_lib/session-crypto'
import { decryptRefreshToken, encryptRefreshToken } from './_lib/token-crypto'
import { getFirestoreClient } from './_lib/firestore'
import { SessionStore } from './_lib/session-store'
import { ConnectionStore } from './_lib/connection-store'
import { RateLimiter } from './_lib/rate-limit'
import { SheetsClient } from './_lib/sheets-client'
import { SheetsJournalStore } from './_lib/sheets-journal-store'
import { executeJournalRequest, isJournalMutation, toApiError } from '../shared/journal/dispatcher'
import { JournalService } from '../shared/journal/service'
import { JournalError } from '../shared/journal/errors'

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  const requestBody = await readRequestBody(request)
  if (!requestBody) return jsonResponse({ error: 'invalid_request' }, 400)

  let config: ReturnType<typeof getServerConfig>
  try {
    config = getServerConfig()
  } catch {
    return jsonResponse({ error: 'server_configuration_error' }, 500)
  }

  const encryptedSession = readCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME)
  const sessionPayload = encryptedSession && decryptSession(encryptedSession, config.sessionEncryptionKey)
  if (!sessionPayload) return unauthenticatedResponse()

  const firestore = getFirestoreClient()
  const sessionStore = new SessionStore(firestore)
  const connectionStore = new ConnectionStore(firestore)
  const rateLimiter = new RateLimiter(firestore)

  const session = await sessionStore.resolveJournalSession(sessionPayload.sessionId)
  if (!session) return unauthenticatedResponse()

  const activeConnection = await connectionStore.findActiveConnection(session.userId)
  if (!activeConnection) {
    return jsonResponse({ error: 'needs_reconnect' }, 401, [clearSessionCookie()])
  }

  if (activeConnection.status === 'needs_reconnect') {
    return jsonResponse({ error: 'needs_reconnect' }, 401)
  }

  const refreshToken = decryptRefreshToken(activeConnection.encryptedRefreshToken, config.tokenEncryptionKey)
  if (!refreshToken) {
    return jsonResponse({ error: 'needs_reconnect' }, 401)
  }

  let accessToken: string
  try {
    const credentials = await refreshGoogleCredentials(refreshToken, config)
    accessToken = credentials.accessToken
    if (credentials.refreshToken) {
      const newEncryptedToken = encryptRefreshToken(
        credentials.refreshToken,
        config.tokenEncryptionKey,
        config.tokenEncryptionKeyVersion,
      )
      await connectionStore.updateEncryptedToken(activeConnection.id, newEncryptedToken)
    }
  } catch (error) {
    if (error instanceof InvalidRefreshTokenError) {
      await connectionStore.markConnectionNeedsReconnect(activeConnection.id)
      return unauthenticatedResponse()
    }
    if (error instanceof GoogleOAuthUpstreamError) {
      return jsonResponse({ error: 'upstream_failure' }, 502)
    }
    return jsonResponse({ error: 'upstream_failure' }, 502)
  }

  const isMutation = isJournalMutation(requestBody)

  if (isMutation) {
    try {
      await rateLimiter.consume({
        scope: 'journal_mutation',
        subject: session.userId,
        limit: 60,
        windowMs: 60_000,
      })
    } catch {
      return jsonResponse(
        { ok: false, error: { code: 'RATE_LIMITED', message: '請求過於頻繁，請稍後再試。' } },
        429,
      )
    }
  }

  const sheetsClient = new SheetsClient()

  try {
    if (isMutation) {
      return await connectionStore.withSheetWriteLease(activeConnection.id, async () => {
        const store = await SheetsJournalStore.load(sheetsClient, activeConnection.spreadsheetId, accessToken)
        const service = new JournalService(store, () => new Date().toISOString(), () => randomUUID())
        const result = executeJournalRequest(requestBody, service)
        if (result.ok) {
          await store.flush(sheetsClient, activeConnection.spreadsheetId, accessToken)
        }
        return jsonResponse(result)
      })
    }

    const store = await SheetsJournalStore.load(sheetsClient, activeConnection.spreadsheetId, accessToken)
    const service = new JournalService(store, () => new Date().toISOString(), () => randomUUID())
    const result = executeJournalRequest(requestBody, service)
    return jsonResponse(result)
  } catch (error) {
    if (error instanceof JournalError) {
      return jsonResponse({ ok: false, error: toApiError(error) })
    }
    if (error instanceof Error && error.message.includes('Lease locked')) {
      return jsonResponse(
        { ok: false, error: { code: 'LOCK_TIMEOUT', message: '目前有其他寫入作業進行中，請稍後再試。' } },
        409,
      )
    }
    return jsonResponse({ ok: false, error: { code: 'INTERNAL_ERROR', message: '處理記事時發生錯誤。' } }, 500)
  }
}

async function readRequestBody(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const value = await request.json() as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function unauthenticatedResponse(): Response {
  return jsonResponse({ error: 'unauthenticated' }, 401, [clearSessionCookie()])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

