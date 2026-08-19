import { clearAllSessionCookies, readCookie, SESSION_COOKIE_NAME } from '../_lib/cookies'
import { jsonResponse, methodNotAllowed } from '../_lib/function-response'
import { getServerConfig } from '../_lib/server-config'
import { decryptSession } from '../_lib/session-crypto'
import { getFirestoreClient } from '../_lib/firestore'
import { SessionStore } from '../_lib/session-store'
import { ConnectionStore } from '../_lib/connection-store'

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { confirmation?: string } | null
  if (body?.confirmation !== 'DELETE') {
    return jsonResponse({ error: 'invalid_request', message: '請確認刪除操作（confirmation 必須為 "DELETE"）' }, 400)
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

  await connectionStore.deleteAccountData(session.userId)

  return jsonResponse({ ok: true }, 200, clearAllSessionCookies())
}
