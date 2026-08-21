import { clearProvisioningCookie, clearSessionCookie, readCookie, PROVISIONING_COOKIE_NAME, SESSION_COOKIE_NAME } from './_lib/cookies.js'
import { getFirestoreClient } from './_lib/firestore.js'
import { jsonResponse, methodNotAllowed } from './_lib/function-response.js'
import { getServerConfig, type ServerConfig } from './_lib/server-config.js'
import { decryptSession } from './_lib/session-crypto.js'
import { SessionStore } from './_lib/session-store.js'

export type SessionHandlerDependencies = {
  config: ServerConfig
  sessionStore: Pick<SessionStore, 'resolveJournalSession' | 'resolveProvisioningSession'>
  decryptSession?: typeof decryptSession
}

export function createSessionHandler(
  dependencies: SessionHandlerDependencies,
): (request: Request) => Promise<Response> {
  const decrypt = dependencies.decryptSession ?? decryptSession

  return async (request: Request): Promise<Response> => {
    const header = request.headers.get('Cookie')
    const journalCookie = readCookie(header, SESSION_COOKIE_NAME)
    const provisioningCookie = readCookie(header, PROVISIONING_COOKIE_NAME)
    const journalPayload = journalCookie && decrypt(journalCookie, dependencies.config.sessionEncryptionKey)
    const provisioningPayload = provisioningCookie && decrypt(provisioningCookie, dependencies.config.sessionEncryptionKey)
    const journalSession = journalPayload
      ? await dependencies.sessionStore.resolveJournalSession(journalPayload.sessionId)
      : undefined
    const provisioningSession = provisioningPayload
      ? await dependencies.sessionStore.resolveProvisioningSession(provisioningPayload.sessionId)
      : undefined
    const cookies: string[] = []
    if (journalCookie && !journalSession) cookies.push(clearSessionCookie())
    if (provisioningCookie && !provisioningSession) cookies.push(clearProvisioningCookie())

    if (journalSession) return jsonResponse({ state: 'authenticated' }, 200, cookies)
    if (provisioningSession) return jsonResponse({ state: 'provisioning' }, 200, cookies)
    return jsonResponse({ state: 'signed-out' }, 200, cookies)
  }
}

export function POST(): Response {
  return methodNotAllowed('GET')
}

export async function GET(request: Request): Promise<Response> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  return createSessionHandler({
    config,
    sessionStore: new SessionStore(firestore),
  })(request)
}
