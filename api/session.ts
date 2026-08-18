import { clearSessionCookie, readCookie, SESSION_COOKIE_NAME } from './_lib/cookies'
import { jsonResponse, methodNotAllowed } from './_lib/function-response'
import { getServerConfig } from './_lib/server-config'
import { decryptSession } from './_lib/session-crypto'

export function POST(): Response {
  return methodNotAllowed('GET')
}

export function GET(request: Request): Response {
  const encryptedSession = readCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME)
  if (!encryptedSession) return jsonResponse({ authenticated: false })

  const config = getServerConfig()
  const session = decryptSession(encryptedSession, config.sessionEncryptionKey)
  if (!session) return jsonResponse({ authenticated: false }, 200, [clearSessionCookie()])

  return jsonResponse({ authenticated: true })
}
