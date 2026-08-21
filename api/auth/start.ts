import { randomBytes } from 'node:crypto'
import type { ConnectionStore } from '../_lib/connection-store.js'
import { ConnectionStore as FirestoreConnectionStore } from '../_lib/connection-store.js'
import { createOAuthStateCookie } from '../_lib/cookies.js'
import { getFirestoreClient } from '../_lib/firestore.js'
import { jsonResponse, methodNotAllowed, redirectResponse } from '../_lib/function-response.js'
import { buildAuthorizationUrl, createCodeVerifier } from '../_lib/google-oauth.js'
import { RATE_LIMIT_WINDOWS, RateLimitError, RateLimiter } from '../_lib/rate-limit.js'
import { getServerConfig, type ServerConfig } from '../_lib/server-config.js'

export const OAUTH_ATTEMPT_TTL_MS = 10 * 60_000

type RandomBytes = (size: number) => Buffer

export type StartHandlerDependencies = {
  config: ServerConfig
  connectionStore: Pick<ConnectionStore, 'createOAuthAttempt'>
  rateLimiter: Pick<RateLimiter, 'consume'>
  clock?: () => number
  randomBytes?: RandomBytes
}

export function createStartHandler(dependencies: StartHandlerDependencies): (request: Request) => Promise<Response> {
  const clock = dependencies.clock ?? Date.now
  const random = dependencies.randomBytes ?? secureRandomBytes

  return async (request: Request): Promise<Response> => {
    try {
      await dependencies.rateLimiter.consume({
        scope: 'oauth_login',
        subject: clientIp(request),
        ...RATE_LIMIT_WINDOWS.oauthLogin,
      }, clock())
    } catch (error) {
      if (error instanceof RateLimitError) return jsonResponse({ error: 'rate_limited' }, 429)
      return jsonResponse({ error: 'oauth_unavailable' }, 503)
    }

    const state = random(32).toString('base64url')
    const codeVerifier = createCodeVerifier(random)
    const intent = new URL(request.url).searchParams.get('reauthorize') === '1'
      ? 'reauthorize'
      : 'sign-in'

    try {
      await dependencies.connectionStore.createOAuthAttempt({
        state,
        codeVerifier,
        intent,
        expiresAt: clock() + OAUTH_ATTEMPT_TTL_MS,
      })
      const authorizationUrl = buildAuthorizationUrl(state, codeVerifier, dependencies.config, {
        reauthorize: intent === 'reauthorize',
      })
      return redirectResponse(authorizationUrl.toString(), [createOAuthStateCookie(state)])
    } catch {
      return jsonResponse({ error: 'oauth_unavailable' }, 503)
    }
  }
}

export async function GET(request: Request): Promise<Response> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  return createStartHandler({
    config,
    connectionStore: new FirestoreConnectionStore(firestore),
    rateLimiter: new RateLimiter(firestore),
  })(request)
}

export function POST(): Response {
  return methodNotAllowed('GET')
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown'
}

function secureRandomBytes(size: number): Buffer {
  return randomBytes(size)
}
