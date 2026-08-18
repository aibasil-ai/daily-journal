import { timingSafeEqual } from 'node:crypto'
import { clearOAuthStateCookie, createSessionCookie, OAUTH_STATE_COOKIE_NAME, readCookie } from '../_lib/cookies.js'
import { jsonResponse, redirectResponse } from '../_lib/function-response.js'
import { exchangeAuthorizationCode } from '../_lib/google-oauth.js'
import { getServerConfig } from '../_lib/server-config.js'
import { encryptSession } from '../_lib/session-crypto.js'

const SESSION_MAX_AGE_MILLISECONDS = 1000 * 60 * 60 * 24 * 30

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const expectedState = readCookie(request.headers.get('Cookie'), OAUTH_STATE_COOKIE_NAME)
  const receivedState = url.searchParams.get('state')

  if (!statesMatch(expectedState, receivedState)) {
    return jsonResponse({ error: 'invalid_oauth_state' }, 400, [clearOAuthStateCookie()])
  }

  const code = url.searchParams.get('code')
  if (url.searchParams.has('error') || !code) {
    return redirectResponse('/?auth_error=oauth', [clearOAuthStateCookie()])
  }

  const config = getServerConfig()
  try {
    const { refreshToken } = await exchangeAuthorizationCode(code, `${url.origin}/api/auth/callback`, config)
    const session = encryptSession({
      refreshToken,
      expiresAt: Date.now() + SESSION_MAX_AGE_MILLISECONDS,
    }, config.sessionEncryptionKey)

    return redirectResponse('/', [createSessionCookie(session), clearOAuthStateCookie()])
  } catch {
    return redirectResponse('/?auth_error=oauth', [clearOAuthStateCookie()])
  }
}

function statesMatch(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false

  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}
