import {
  clearAllSessionCookies,
  clearSessionCookie,
  clearProvisioningCookie,
  PROVISIONING_COOKIE_NAME,
  readCookie,
  SESSION_COOKIE_NAME,
} from './_lib/cookies'
import { jsonResponse, methodNotAllowed } from './_lib/function-response'
import { getFirestoreClient } from './_lib/firestore'
import { SessionStore } from './_lib/session-store'
import { getServerConfig } from './_lib/server-config'
import { decryptSession } from './_lib/session-crypto'

export function POST(): Response {
  return methodNotAllowed('GET')
}

export async function GET(request: Request): Promise<Response> {
  const cookieHeader = request.headers.get('Cookie')
  const journalEncrypted = readCookie(cookieHeader, SESSION_COOKIE_NAME)
  const provisioningEncrypted = readCookie(cookieHeader, PROVISIONING_COOKIE_NAME)

  if (!journalEncrypted && !provisioningEncrypted) {
    return jsonResponse({ state: 'signed-out' })
  }

  const config = getServerConfig()
  const firestore = getFirestoreClient()
  const sessionStore = new SessionStore(firestore)

  if (journalEncrypted) {
    const payload = decryptSession(journalEncrypted, config.sessionEncryptionKey)
    if (payload?.sessionId) {
      const session = await sessionStore.resolveJournalSession(payload.sessionId)
      if (session) {
        return jsonResponse({ state: 'authenticated' })
      }
    }
    return jsonResponse({ state: 'signed-out' }, 200, [clearSessionCookie()])
  }

  if (provisioningEncrypted) {
    const payload = decryptSession(provisioningEncrypted, config.sessionEncryptionKey)
    if (payload?.sessionId) {
      const session = await sessionStore.resolveProvisioningSession(payload.sessionId)
      if (session) {
        return jsonResponse({ state: 'provisioning' })
      }
    }
    return jsonResponse({ state: 'signed-out' }, 200, [clearProvisioningCookie()])
  }

  return jsonResponse({ state: 'signed-out' }, 200, clearAllSessionCookies())
}
