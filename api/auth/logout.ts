import { clearAllSessionCookies, readCookie, SESSION_COOKIE_NAME, PROVISIONING_COOKIE_NAME } from '../_lib/cookies'
import { emptyResponse, methodNotAllowed } from '../_lib/function-response'
import { getFirestoreClient } from '../_lib/firestore'
import { SessionStore } from '../_lib/session-store'
import { getServerConfig } from '../_lib/server-config'
import { decryptSession } from '../_lib/session-crypto'

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  const cookieHeader = request.headers.get('Cookie')
  const journalCookie = readCookie(cookieHeader, SESSION_COOKIE_NAME)
  const provisioningCookie = readCookie(cookieHeader, PROVISIONING_COOKIE_NAME)

  try {
    const config = getServerConfig()
    const firestore = getFirestoreClient()
    const sessionStore = new SessionStore(firestore)

    if (journalCookie) {
      const payload = decryptSession(journalCookie, config.sessionEncryptionKey)
      if (payload?.sessionId) {
        await sessionStore.revokeSession(payload.sessionId)
      }
    }
    if (provisioningCookie) {
      const payload = decryptSession(provisioningCookie, config.sessionEncryptionKey)
      if (payload?.sessionId) {
        await sessionStore.revokeSession(payload.sessionId)
      }
    }
  } catch {
    // Ignore errors on logout
  }

  return emptyResponse(204, clearAllSessionCookies())
}
