import type { ServerConfig } from './server-config'

const authorizationEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth'
const tokenEndpoint = 'https://oauth2.googleapis.com/token'
const scopes = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/spreadsheets',
]

export class GoogleOAuthRequestError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super('Google access token 刷新失敗。')
    this.name = 'GoogleOAuthRequestError'
  }
}

export function buildAuthorizationUrl(origin: string, state: string, config: ServerConfig): URL {
  const url = new URL(authorizationEndpoint)
  url.search = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: callbackUri(origin),
    response_type: 'code',
    scope: scopes.join(' '),
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
  const response = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) throw new Error('Google 授權碼交換失敗。')

  const payload: unknown = await response.json()
  if (!hasRefreshToken(payload)) throw new Error('Google 未回傳 refresh token。')

  return { refreshToken: payload.refresh_token }
}

export async function refreshAccessToken(
  refreshToken: string,
  config: ServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    refresh_token: refreshToken,
  })
  const response = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const errorCode = response.status === 400 ? await readErrorCode(response) : undefined
    throw new GoogleOAuthRequestError(response.status, errorCode)
  }

  const payload: unknown = await response.json()
  if (!hasAccessToken(payload)) throw new Error('Google 未回傳 access token。')

  return payload.access_token
}

function callbackUri(origin: string): string {
  return new URL('/api/auth/callback', origin).toString()
}

function hasRefreshToken(payload: unknown): payload is { refresh_token: string } {
  return Boolean(
    payload
    && typeof payload === 'object'
    && 'refresh_token' in payload
    && typeof payload.refresh_token === 'string'
    && payload.refresh_token.length > 0,
  )
}

function hasAccessToken(payload: unknown): payload is { access_token: string } {
  return Boolean(
    payload
    && typeof payload === 'object'
    && 'access_token' in payload
    && typeof payload.access_token === 'string'
    && payload.access_token.length > 0,
  )
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  const payload: unknown = await response.json()
  return hasErrorCode(payload) ? payload.error : undefined
}

function hasErrorCode(payload: unknown): payload is { error: string } {
  return Boolean(
    payload
    && typeof payload === 'object'
    && 'error' in payload
    && typeof payload.error === 'string',
  )
}
