import { timingSafeEqual } from 'node:crypto'
import { clearOAuthStateCookie, createSessionCookie, readCookie } from '../_lib/cookies.js'
import { appendSetCookie, redirect } from '../_lib/function-response.js'
import { exchangeAuthorizationCode } from '../_lib/google-oauth.js'
import { getServerConfig } from '../_lib/server-config.js'
import { encryptSession } from '../_lib/session-crypto.js'

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  const expectedState = readCookie(request.headers.get('cookie'), 'oauth_state')

  if (!statesMatch(state, expectedState)) return stateFailureResponse()
  if (url.searchParams.has('error') || !url.searchParams.get('code')) return oauthFailureResponse(url.origin)

  try {
    const config = getServerConfig()
    const origin = new URL(request.url).origin
    const redirectUri = `${origin}/api/auth/callback`
    const { refreshToken } = await exchangeAuthorizationCode(url.searchParams.get('code')!, redirectUri, config)
    const encryptedSession = encryptSession({
      refreshToken,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1_000,
    }, config.sessionEncryptionKey)
    const response = appendSetCookie(redirect(`${origin}/`), createSessionCookie(encryptedSession))

    return appendSetCookie(response, clearOAuthStateCookie())
  } catch {
    return oauthFailureResponse(url.origin)
  }
}

function statesMatch(state: string | null, expectedState: string | undefined): boolean {
  if (!state || !expectedState) return false

  const actual = Buffer.from(state)
  const expected = Buffer.from(expectedState)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function stateFailureResponse(): Response {
  return appendSetCookie(new Response('授權未完成。', { status: 400 }), clearOAuthStateCookie())
}

function oauthFailureResponse(origin: string): Response {
  const location = new URL('/?login_error=oauth_failed', origin).toString()
  return appendSetCookie(redirect(location), clearOAuthStateCookie())
}
