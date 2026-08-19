import { createHash, randomBytes } from 'node:crypto'
import type { ServerConfig } from './server-config'

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.file',
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

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function buildAuthorizationUrl(input: {
  origin: string
  state: string
  codeChallenge: string
  config: ServerConfig
  promptConsent?: boolean
}): URL {
  const url = new URL(GOOGLE_AUTHORIZATION_URL)
  const params: Record<string, string> = {
    client_id: input.config.googleClientId,
    redirect_uri: `${input.config.appOrigin}/api/auth/callback`,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    include_granted_scopes: 'true',
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  }

  if (input.promptConsent) {
    params.prompt = 'consent'
  }

  url.search = new URLSearchParams(params).toString()
  return url
}

export async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  config: ServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ refreshToken?: string; idToken: string; accessToken: string }> {
  const body = new URLSearchParams({
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  })

  const response = await requestToken(body, fetchImpl)
  const payload = await readTokenPayload(response)
  if (!response.ok) {
    throw new GoogleOAuthUpstreamError()
  }

  const idToken = typeof payload.id_token === 'string' ? payload.id_token : ''
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : ''
  const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined

  if (!idToken || !accessToken) {
    throw new GoogleOAuthUpstreamError()
  }

  return { refreshToken, idToken, accessToken }
}

export async function refreshGoogleCredentials(
  refreshToken: string,
  config: ServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; refreshToken?: string }> {
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

  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : ''
  const newRefreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined

  if (!accessToken) {
    throw new GoogleOAuthUpstreamError()
  }

  return { accessToken, refreshToken: newRefreshToken }
}

export async function refreshAccessToken(
  refreshToken: string,
  config: ServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const creds = await refreshGoogleCredentials(refreshToken, config, fetchImpl)
  return creds.accessToken
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
    const value = (await response.json()) as unknown
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    // Malformed
  }
  return {}
}
