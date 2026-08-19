import { randomBytes } from 'node:crypto'
import { createOAuthStateCookie } from '../_lib/cookies'
import { jsonResponse, redirectResponse } from '../_lib/function-response'
import { getFirestoreClient } from '../_lib/firestore'
import { ConnectionStore } from '../_lib/connection-store'
import { RateLimiter, RateLimitError } from '../_lib/rate-limit'
import { buildAuthorizationUrl, createPkcePair } from '../_lib/google-oauth'
import { getServerConfig } from '../_lib/server-config'

export async function GET(request: Request): Promise<Response> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  const rateLimiter = new RateLimiter(firestore)
  const connectionStore = new ConnectionStore(firestore)

  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1'
  try {
    await rateLimiter.consume({ scope: 'auth_start', subject: clientIp, limit: 10, windowMs: 15 * 60_000 })
  } catch (error) {
    if (error instanceof RateLimitError) {
      return jsonResponse({ error: 'rate_limited', message: error.message }, 429)
    }
    throw error
  }

  const url = new URL(request.url)
  const reauthorize = url.searchParams.get('prompt') === 'consent' || url.searchParams.get('reauthorize') === 'true'

  const state = randomBytes(32).toString('base64url')
  const pkce = createPkcePair()

  await connectionStore.createOAuthAttempt({
    state,
    codeVerifier: pkce.verifier,
    intent: reauthorize ? 'reauthorize' : 'sign-in',
    expiresAt: Date.now() + 10 * 60_000,
  })

  const authorizationUrl = buildAuthorizationUrl({
    origin: config.appOrigin,
    state,
    codeChallenge: pkce.challenge,
    config,
    promptConsent: reauthorize,
  })

  return redirectResponse(authorizationUrl.toString(), [createOAuthStateCookie(state)])
}
