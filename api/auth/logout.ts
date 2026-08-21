import { clearAllSessionCookies, readCookie, PROVISIONING_COOKIE_NAME, SESSION_COOKIE_NAME } from '../_lib/cookies.js'
import { getFirestoreClient } from '../_lib/firestore.js'
import { emptyResponse, methodNotAllowed } from '../_lib/function-response.js'
import { getServerConfig, type ServerConfig } from '../_lib/server-config.js'
import { decryptSession } from '../_lib/session-crypto.js'
import { SessionStore } from '../_lib/session-store.js'

export type LogoutHandlerDependencies = {
  config: ServerConfig
  sessionStore: Pick<SessionStore, 'revokeSession'>
  decryptSession?: typeof decryptSession
}

export function createLogoutHandler(
  dependencies: LogoutHandlerDependencies,
): (request: Request) => Promise<Response> {
  const decrypt = dependencies.decryptSession ?? decryptSession

  return async (request: Request): Promise<Response> => {
    const header = request.headers.get('Cookie')
    const sessionIds = new Set([SESSION_COOKIE_NAME, PROVISIONING_COOKIE_NAME].flatMap((name) => {
      const value = readCookie(header, name)
      const session = value && decrypt(value, dependencies.config.sessionEncryptionKey)
      return session ? [session.sessionId] : []
    }))

    try {
      for (const sessionId of sessionIds) {
        await dependencies.sessionStore.revokeSession(sessionId)
      }
    } catch {
      return emptyResponse(503)
    }
    return emptyResponse(204, clearAllSessionCookies())
  }
}

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  return createLogoutHandler({
    config,
    sessionStore: new SessionStore(firestore),
  })(request)
}
