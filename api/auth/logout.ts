import { clearSessionCookie } from '../_lib/cookies'
import { emptyResponse, methodNotAllowed } from '../_lib/function-response'

export function GET(): Response {
  return methodNotAllowed('POST')
}

export function POST(): Response {
  return emptyResponse(204, [clearSessionCookie()])
}
