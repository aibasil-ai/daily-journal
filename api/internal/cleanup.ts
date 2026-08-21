import { getFirestoreClient } from '../_lib/firestore.js'
import { jsonResponse, methodNotAllowed } from '../_lib/function-response.js'
import {
  createServerInternalCleanupService,
  hasExpectedBearerSecret,
  type InternalCleanupService,
} from '../_lib/legacy-migration.js'
import { getServerConfig, type ServerConfig } from '../_lib/server-config.js'

export type CleanupHandlerDependencies = {
  config: Pick<ServerConfig, 'cronSecret'>
  cleanup: InternalCleanupService
}

/** Vercel Cron 的內部清理端點，不接受瀏覽器 session 作為授權。 */
export function createCleanupHandler(
  dependencies: CleanupHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (!hasExpectedBearerSecret(request, dependencies.config.cronSecret)) {
      return jsonResponse({ error: 'unauthorized' }, 401)
    }
    try {
      const counts = await dependencies.cleanup.cleanup()
      return jsonResponse({
        oauthAttempts: counts.oauthAttempts,
        provisioningAttempts: counts.provisioningAttempts,
        selectionCodes: counts.selectionCodes,
        rateLimits: counts.rateLimits,
        sessions: counts.sessions,
      })
    } catch {
      return jsonResponse({ error: 'cleanup_unavailable' }, 503)
    }
  }
}

export async function GET(request: Request): Promise<Response> {
  const config = getServerConfig()
  if (!hasExpectedBearerSecret(request, config.cronSecret)) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }
  return createCleanupHandler({
    config,
    cleanup: createServerInternalCleanupService(getFirestoreClient()),
  })(request)
}

export function POST(): Response {
  return methodNotAllowed('GET')
}
