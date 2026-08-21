import { clearProvisioningCookie } from '../_lib/cookies.js'
import { getFirestoreClient } from '../_lib/firestore.js'
import { jsonResponse, methodNotAllowed } from '../_lib/function-response.js'
import {
  consumeProvisioningRateLimit,
  createServerProvisioningService,
  isEmptyObject,
  provisioningErrorResponse,
  readJsonMutation,
  type ProvisioningActionResult,
  type ProvisioningRouteRateLimiter,
  type ProvisioningService,
} from '../_lib/provisioning-service.js'
import { RateLimiter } from '../_lib/rate-limit.js'
import { getServerConfig, type ServerConfig } from '../_lib/server-config.js'

export type ProvisioningCreateHandlerDependencies = {
  config: Pick<ServerConfig, 'appOrigin'>
  service: Pick<
    ProvisioningService,
    'requireProvisioningContext' | 'createSheet' | 'createSessionCookie'
  >
  rateLimiter: ProvisioningRouteRateLimiter
}

export function createProvisioningCreateHandler(
  dependencies: ProvisioningCreateHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const body = await readJsonMutation(request, dependencies.config.appOrigin)
      if (!isEmptyObject(body)) return jsonResponse({ error: 'invalid_request' }, 400)
      const context = await dependencies.service.requireProvisioningContext(request)
      await consumeProvisioningRateLimit(dependencies.rateLimiter, context.session.userId)
      return provisionedResponse(dependencies.service, await dependencies.service.createSheet(context))
    } catch (error) {
      return provisioningErrorResponse(error)
    }
  }
}

export const createCreateHandler = createProvisioningCreateHandler

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  return createProvisioningCreateHandler({
    config,
    service: createServerProvisioningService(config, firestore),
    rateLimiter: new RateLimiter(firestore),
  })(request)
}

export function provisionedResponse(
  service: Pick<ProvisioningService, 'createSessionCookie'>,
  result: ProvisioningActionResult,
): Response {
  const cookies = result.journalSession
    ? [clearProvisioningCookie(), service.createSessionCookie(result.journalSession)]
    : []
  return jsonResponse(result.status, 200, cookies)
}
