import { clearSessionCookie } from '../_lib/cookies.js'
import { emptyResponse, methodNotAllowed } from '../_lib/function-response.js'

export function GET(): Response {
  return methodNotAllowed('POST')
}

export function POST(): Response {
  return emptyResponse(204, [clearSessionCookie()])
}
