import { getFirestoreClient } from '../_lib/firestore.js'
import { jsonResponse, methodNotAllowed } from '../_lib/function-response.js'
import {
  consumeProvisioningRateLimit,
  createServerProvisioningService,
  provisioningErrorResponse,
  ProvisioningServiceError,
  type ProvisioningRouteRateLimiter,
  type ProvisioningService,
} from '../_lib/provisioning-service.js'
import { RateLimiter } from '../_lib/rate-limit.js'
import { getServerConfig, type ServerConfig } from '../_lib/server-config.js'

export type ProvisioningSheetsHandlerDependencies = {
  config: Pick<ServerConfig, 'appOrigin'>
  service: Pick<ProvisioningService, 'requireProvisioningContext' | 'listCandidateSheets'>
  rateLimiter: ProvisioningRouteRateLimiter
}

export function createProvisioningSheetsHandler(
  dependencies: ProvisioningSheetsHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const input = candidateInput(request)
      const context = await dependencies.service.requireProvisioningContext(request)
      await consumeProvisioningRateLimit(dependencies.rateLimiter, context.session.userId)
      return jsonResponse(await dependencies.service.listCandidateSheets(context, input))
    } catch (error) {
      return provisioningErrorResponse(error)
    }
  }
}

export const createSheetsHandler = createProvisioningSheetsHandler

export function POST(): Response {
  return methodNotAllowed('GET')
}

export async function GET(request: Request): Promise<Response> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  return createProvisioningSheetsHandler({
    config,
    service: createServerProvisioningService(config, firestore),
    rateLimiter: new RateLimiter(firestore),
  })(request)
}

function candidateInput(request: Request): { query: string; cursor: string | null } {
  const parameters = new URL(request.url).searchParams
  const shortQuery = parameters.get('q')
  const query = parameters.get('query')
  if ((shortQuery !== null && query !== null && shortQuery !== query) || (shortQuery === null && query === null)) {
    throw new ProvisioningServiceError('invalid_request', 400)
  }
  const normalizedQuery = query ?? shortQuery!
  if (normalizedQuery.trim().length < 2 || normalizedQuery.trim().length > 200) {
    throw new ProvisioningServiceError('invalid_request', 400)
  }
  const cursor = parameters.get('cursor')
  if (cursor === '') throw new ProvisioningServiceError('invalid_request', 400)
  return { query: normalizedQuery, cursor }
}
