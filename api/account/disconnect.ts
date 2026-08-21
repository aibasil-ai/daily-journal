import { clearAllSessionCookies } from '../_lib/cookies.js'
import { getFirestoreClient } from '../_lib/firestore.js'
import { emptyResponse, jsonResponse, methodNotAllowed } from '../_lib/function-response.js'
import {
  consumeProvisioningRateLimit,
  createServerProvisioningService,
  isEmptyObject,
  provisioningErrorResponse,
  readJsonMutation,
  type ProvisioningRouteRateLimiter,
  type ProvisioningService,
} from '../_lib/provisioning-service.js'
import { RateLimiter } from '../_lib/rate-limit.js'
import { getServerConfig, type ServerConfig } from '../_lib/server-config.js'

export type DisconnectHandlerDependencies = {
  config: Pick<ServerConfig, 'appOrigin'>
  service: Pick<ProvisioningService, 'requireJournalContext' | 'disconnect'>
  rateLimiter: ProvisioningRouteRateLimiter
}

export function createDisconnectHandler(
  dependencies: DisconnectHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const body = await readJsonMutation(request, dependencies.config.appOrigin)
      if (!isEmptyObject(body)) return jsonResponse({ error: 'invalid_request' }, 400)
      const context = await dependencies.service.requireJournalContext(request)
      await consumeProvisioningRateLimit(dependencies.rateLimiter, context.user.id)
      await dependencies.service.disconnect(context)
      return emptyResponse(204, clearAllSessionCookies())
    } catch (error) {
      return provisioningErrorResponse(error)
    }
  }
}

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  return createDisconnectHandler({
    config,
    service: createServerProvisioningService(config, firestore),
    rateLimiter: new RateLimiter(firestore),
  })(request)
}
