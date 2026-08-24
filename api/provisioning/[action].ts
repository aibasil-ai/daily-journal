import { jsonResponse, methodNotAllowed } from '../_lib/function-response.js'
import * as cancelChangeRoute from './_cancel-change.js'
import * as confirmRoute from './_confirm.js'
import * as createRoute from './_create.js'
import * as selectRoute from './_select.js'
import * as sheetsRoute from './_sheets.js'
import * as startChangeRoute from './_start-change.js'
import * as statusRoute from './_status.js'
import * as urlRoute from './_url.js'

export type ProvisioningActionHandler = (request: Request) => Response | Promise<Response>

export type ProvisioningActionRouteModule = {
  GET?: ProvisioningActionHandler
  POST?: ProvisioningActionHandler
}

export type ProvisioningActionRouteTable = Record<string, ProvisioningActionRouteModule>

export const provisioningActionRoutes: ProvisioningActionRouteTable = {
  'cancel-change': cancelChangeRoute,
  confirm: confirmRoute,
  create: createRoute,
  select: selectRoute,
  sheets: sheetsRoute,
  'start-change': startChangeRoute,
  status: statusRoute,
  url: urlRoute,
}

export function createProvisioningActionHandler(
  routeTable: ProvisioningActionRouteTable,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const action = extractProvisioningAction(new URL(request.url).pathname)
    const route = action === null ? undefined : routeTable[action]
    if (!route) {
      return jsonResponse({ error: 'not_found' }, 404)
    }
    const handler = request.method === 'GET' ? route.GET : request.method === 'POST' ? route.POST : undefined
    if (!handler) {
      const allowed = ['GET', 'POST'].filter((method) => typeof route[method as 'GET' | 'POST'] === 'function')
      return methodNotAllowed(allowed.join(', '))
    }
    return handler(request)
  }
}

const handleProvisioningAction = createProvisioningActionHandler(provisioningActionRoutes)

export async function GET(request: Request): Promise<Response> {
  return handleProvisioningAction(request)
}

export async function POST(request: Request): Promise<Response> {
  return handleProvisioningAction(request)
}

function extractProvisioningAction(pathname: string): string | null {
  const segments = pathname.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    return null
  }
  const last = segments[segments.length - 1]
  try {
    return decodeURIComponent(last)
  } catch {
    return null
  }
}
