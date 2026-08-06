import { randomBytes } from 'node:crypto'
import { createOAuthStateCookie } from '../_lib/cookies'
import { appendSetCookie, redirect } from '../_lib/function-response'
import { buildAuthorizationUrl } from '../_lib/google-oauth'
import { getServerConfig } from '../_lib/server-config'

export async function GET(request: Request): Promise<Response> {
  const state = randomBytes(32).toString('base64url')
  const config = getServerConfig()
  const authorizationUrl = buildAuthorizationUrl(new URL(request.url).origin, state, config)

  return appendSetCookie(redirect(authorizationUrl.toString()), createOAuthStateCookie(state))
}
