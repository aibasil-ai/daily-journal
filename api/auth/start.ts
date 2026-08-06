import { randomBytes } from 'node:crypto'
import { createOAuthStateCookie } from '../_lib/cookies.js'
import { appendSetCookie, redirect } from '../_lib/function-response.js'
import { buildAuthorizationUrl } from '../_lib/google-oauth.js'
import { getServerConfig } from '../_lib/server-config.js'

export async function GET(request: Request): Promise<Response> {
  const state = randomBytes(32).toString('base64url')
  const config = getServerConfig()
  const authorizationUrl = buildAuthorizationUrl(new URL(request.url).origin, state, config)

  return appendSetCookie(redirect(authorizationUrl.toString()), createOAuthStateCookie(state))
}
