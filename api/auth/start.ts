import { randomBytes } from 'node:crypto'
import { createOAuthStateCookie } from '../_lib/cookies'
import { redirectResponse } from '../_lib/function-response'
import { buildAuthorizationUrl } from '../_lib/google-oauth'
import { getServerConfig } from '../_lib/server-config'

export async function GET(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin
  const state = randomBytes(32).toString('base64url')
  const authorizationUrl = buildAuthorizationUrl(origin, state, getServerConfig())

  return redirectResponse(authorizationUrl.toString(), [createOAuthStateCookie(state)])
}
