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
  // 受信任的代理標頭優先順序（依部署環境）
  // 注意：這些標頭必須由「受信任的反向代理」設定，不可由客戶端直接傳送

  // 1. Vercel 專用標頭（最可信，由 Vercel Edge Network 設定）
  const vercelIP = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
  if (vercelIP) return vercelIP

  // 2. Cloudflare 專用標頭（由 Cloudflare 設定）
  const cfIP = request.headers.get('cf-connecting-ip')?.trim()
  if (cfIP) return cfIP

  // 3. 標準代理標頭（需確保反向代理正確配置：移除客戶端傳送的同名標頭）
  // 常見雲端平台：AWS ALB (x-forwarded-for), Google Cloud (x-forwarded-for), Azure (x-forwarded-for)
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded

  // 4. Nginx/Apache 常用標頭
  const realIP = request.headers.get('x-real-ip')?.trim()
  if (realIP) return realIP

  // 5. 最後回退
  return 'unknown'
}

function secureRandomBytes(size: number): Buffer {
  return randomBytes(size)
}
