import { getFirestoreClient } from '../_lib/firestore.js'
import { methodNotAllowed } from '../_lib/function-response.js'
import {
  consumeProvisioningRateLimit,
  createServerProvisioningService,
  isExactObject,
  provisioningErrorResponse,
  ProvisioningServiceError,
  readJsonMutation,
  type ProvisioningRouteRateLimiter,
  type ProvisioningService,
} from '../_lib/provisioning-service.js'
import { RateLimiter } from '../_lib/rate-limit.js'
import { getServerConfig, type ServerConfig } from '../_lib/server-config.js'
import { provisionedResponse } from './_create.js'

export type ProvisioningUrlHandlerDependencies = {
  config: Pick<ServerConfig, 'appOrigin'>
  service: Pick<
    ProvisioningService,
    'requireProvisioningContext' | 'submitSheetUrl' | 'createSessionCookie'
  >
  rateLimiter: ProvisioningRouteRateLimiter
}

export function createProvisioningUrlHandler(
  dependencies: ProvisioningUrlHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const body = await readJsonMutation(request, dependencies.config.appOrigin)
      if (!isExactObject(body, ['url']) || typeof body.url !== 'string') {
        throw new ProvisioningServiceError('invalid_request', 400)
      }
      const context = await dependencies.service.requireProvisioningContext(request)
      await consumeProvisioningRateLimit(dependencies.rateLimiter, context.session.userId)
      const result = await dependencies.service.submitSheetUrl(context, body.url)
      return provisionedResponse(dependencies.service, result)
    } catch (error) {
      return provisioningErrorResponse(error)
    }
  }
}

export const createUrlHandler = createProvisioningUrlHandler

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  return createProvisioningUrlHandler({
    config,
    service: createServerProvisioningService(config, firestore),
    rateLimiter: new RateLimiter(firestore),
  })(request)
}
