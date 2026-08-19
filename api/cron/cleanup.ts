import { timingSafeEqual } from 'node:crypto'
import { jsonResponse } from '../_lib/function-response'
import { getServerConfig } from '../_lib/server-config'
import { getFirestoreClient } from '../_lib/firestore'
import { SessionStore } from '../_lib/session-store'
import { ConnectionStore } from '../_lib/connection-store'
import { RateLimiter } from '../_lib/rate-limit'

export async function GET(request: Request): Promise<Response> {
  return handleCleanup(request)
}

export async function POST(request: Request): Promise<Response> {
  return handleCleanup(request)
}

async function handleCleanup(request: Request): Promise<Response> {
  let config: ReturnType<typeof getServerConfig>
  try {
    config = getServerConfig()
  } catch {
    return jsonResponse({ error: 'server_configuration_error' }, 500)
  }

  const authHeader = request.headers.get('Authorization')
  const bearerSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  const cronHeader = request.headers.get('CRON_SECRET')
  const url = new URL(request.url)
  const querySecret = url.searchParams.get('secret')

  const providedSecret = bearerSecret || cronHeader || querySecret || ''

  if (!isSecretValid(providedSecret, config.cronSecret)) {
    return jsonResponse({ error: 'forbidden' }, 403)
  }

  const firestore = getFirestoreClient()
  const sessionStore = new SessionStore(firestore)
  const connectionStore = new ConnectionStore(firestore)
  const rateLimiter = new RateLimiter(firestore)

  const now = Date.now()
  const sessions = await sessionStore.cleanupExpired(now)
  const { attempts, leases } = await connectionStore.cleanupExpired(now)
  const rateLimits = await rateLimiter.cleanupExpired(now)

  return jsonResponse({
    ok: true,
    cleaned: {
      sessions,
      attempts,
      leases,
      rateLimits,
    },
  })
}

function isSecretValid(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))
}
