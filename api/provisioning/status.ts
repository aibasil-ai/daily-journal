import { getFirestoreClient } from '../_lib/firestore.js'
import { jsonResponse, methodNotAllowed } from '../_lib/function-response.js'
import {
  createServerProvisioningService,
  provisioningErrorResponse,
  type ProvisioningService,
} from '../_lib/provisioning-service.js'
import { getServerConfig } from '../_lib/server-config.js'

export type ProvisioningStatusHandlerDependencies = {
  service: Pick<ProvisioningService, 'getStatus'>
}

export function createProvisioningStatusHandler(
  dependencies: ProvisioningStatusHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const result = await dependencies.service.getStatus(request)
      return jsonResponse(result.status, 200, result.cookies)
    } catch (error) {
      return provisioningErrorResponse(error)
    }
  }
}

export const createStatusHandler = createProvisioningStatusHandler

export function POST(): Response {
  return methodNotAllowed('GET')
}

export async function GET(request: Request): Promise<Response> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  return createProvisioningStatusHandler({
    service: createServerProvisioningService(config, firestore),
  })(request)
}
