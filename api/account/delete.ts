import { clearAllSessionCookies } from '../_lib/cookies.js'
import { getFirestoreClient } from '../_lib/firestore.js'
import { emptyResponse, methodNotAllowed } from '../_lib/function-response.js'
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

export type DeleteAccountHandlerDependencies = {
  config: Pick<ServerConfig, 'appOrigin'>
  service: Pick<ProvisioningService, 'requireJournalContext' | 'deleteAccount'>
  rateLimiter: ProvisioningRouteRateLimiter
}

export function createDeleteAccountHandler(
  dependencies: DeleteAccountHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const body = await readJsonMutation(request, dependencies.config.appOrigin)
      if (!isExactObject(body, ['deleteSystemCreatedSheet', 'confirmation'])
        || typeof body.deleteSystemCreatedSheet !== 'boolean'
        || typeof body.confirmation !== 'string'
        || body.confirmation !== '刪除我的帳號') {
        throw new ProvisioningServiceError('invalid_request', 400)
      }
      const context = await dependencies.service.requireJournalContext(request)
      await consumeProvisioningRateLimit(dependencies.rateLimiter, context.user.id)
      await dependencies.service.deleteAccount(context, {
        deleteSystemCreatedSheet: body.deleteSystemCreatedSheet,
        confirmation: body.confirmation,
      })
      return emptyResponse(204, clearAllSessionCookies())
    } catch (error) {
      return provisioningErrorResponse(error)
    }
  }
}

export const createDeleteHandler = createDeleteAccountHandler

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  return createDeleteAccountHandler({
    config,
    service: createServerProvisioningService(config, firestore),
    rateLimiter: new RateLimiter(firestore),
  })(request)
}
