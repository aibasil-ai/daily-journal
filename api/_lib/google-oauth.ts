import type { ServerConfig } from './server-config'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ')

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super('Google refresh token 已失效。')
    this.name = 'InvalidRefreshTokenError'
  }
}

export class GoogleOAuthUpstreamError extends Error {
  constructor() {
    super('Google OAuth 服務暫時無法使用。')
    this.name = 'GoogleOAuthUpstreamError'
  }
}

export function buildAuthorizationUrl(origin: string, state: string, config: ServerConfig): URL {
  const url = new URL(GOOGLE_AUTHORIZATION_URL)
  url.search = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${new URL(origin).origin}/api/auth/callback`,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  }).toString()
  return url
}

export async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
  config: ServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ refreshToken: string }> {
  const body = new URLSearchParams({
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  const response = await requestToken(body, fetchImpl)
  const payload = await readTokenPayload(response)
  const refreshToken = payload.refresh_token
  if (!response.ok || typeof refreshToken !== 'string' || !refreshToken) {
    throw new GoogleOAuthUpstreamError()
  }
  return { refreshToken }
}

export async function refreshAccessToken(
  refreshToken: string,
  config: ServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const response = await requestToken(body, fetchImpl)
  const payload = await readTokenPayload(response)
  if (!response.ok) {
    if (payload.error === 'invalid_grant' || response.status === 401 || response.status === 403) {
      throw new InvalidRefreshTokenError()
    }
    throw new GoogleOAuthUpstreamError()
  }
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new GoogleOAuthUpstreamError()
  }
  return payload.access_token
}

async function requestToken(body: URLSearchParams, fetchImpl: typeof fetch): Promise<Response> {
  try {
    return await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch {
    throw new GoogleOAuthUpstreamError()
  }
}

async function readTokenPayload(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json() as unknown
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    // The caller maps malformed upstream responses to a safe error.
  }
  return {}
}
