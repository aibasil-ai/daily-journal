import { clearSessionCookie, readCookie } from './_lib/cookies'
import { appendSetCookie } from './_lib/function-response'
import { getServerConfig } from './_lib/server-config'
import { decryptSession } from './_lib/session-crypto'

export async function GET(request: Request): Promise<Response> {
  const value = readCookie(request.headers.get('cookie'), 'session')
  if (!value) return Response.json({ authenticated: false })

  const config = getServerConfig()
  if (decryptSession(value, config.sessionEncryptionKey)) return Response.json({ authenticated: true })

  return appendSetCookie(Response.json({ authenticated: false }), clearSessionCookie())
}
