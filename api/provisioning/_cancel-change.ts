import { clearProvisioningCookie } from '../_lib/cookies.js'
import { getFirestoreClient } from '../_lib/firestore.js'
import { emptyResponse, methodNotAllowed } from '../_lib/function-response.js'
import {
  createServerProvisioningService,
  isEmptyObject,
  provisioningErrorResponse,
  ProvisioningServiceError,
  readJsonMutation,
  type ProvisioningService,
} from '../_lib/provisioning-service.js'
import { getServerConfig, type ServerConfig } from '../_lib/server-config.js'

export type CancelChangeHandlerDependencies = {
  config: Pick<ServerConfig, 'appOrigin'>
  service: Pick<ProvisioningService, 'requireProvisioningContext' | 'cancelChange'>
}

export function createCancelChangeHandler(
  dependencies: CancelChangeHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const body = await readJsonMutation(request, dependencies.config.appOrigin)
      if (!isEmptyObject(body)) throw new ProvisioningServiceError('invalid_request', 400)
      const context = await dependencies.service.requireProvisioningContext(request)
      await dependencies.service.cancelChange(context)
      return emptyResponse(204, [clearProvisioningCookie()])
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
  return createCancelChangeHandler({
    config,
    service: createServerProvisioningService(config, firestore),
  })(request)
}
