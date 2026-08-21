import { createHash, randomBytes } from 'node:crypto'
import type { ServerConfig } from './server-config.js'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_CALLBACK_PATH = '/api/auth/callback'

export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.file',
] as const

export type GoogleAuthorizationCodeCredentials = {
  idToken: string
  accessToken: string
  refreshToken?: string
  /** Google 僅在明確回傳 scope 時才可覆寫既有授權範圍。 */
  scopes?: string[]
}

export type GoogleCredentials = {
  accessToken: string
  /** 缺少 scope 代表上游未宣告授權範圍變更。 */
  scopes?: string[]
  refreshToken?: string
}

type RandomBytes = (size: number) => Buffer

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

export function createCodeVerifier(randomBytesImpl: RandomBytes = secureRandomBytes): string {
  // 64 個隨機位元組會產生符合 RFC 7636 的 86 字元 base64url verifier。
  return randomBytesImpl(64).toString('base64url')
}

export function buildAuthorizationUrl(
  state: string,
  codeVerifier: string,
  config: ServerConfig,
  options: { reauthorize?: boolean } = {},
): URL {
  const url = new URL(GOOGLE_AUTHORIZATION_URL)
  const parameters = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: getGoogleCallbackUrl(config),
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    state,
    code_challenge: createCodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
  })
  if (options.reauthorize) parameters.set('prompt', 'consent')
  url.search = parameters.toString()
  return url
}

export async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  config: ServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleAuthorizationCodeCredentials> {
  const body = new URLSearchParams({
    code,
    code_verifier: codeVerifier,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: getGoogleCallbackUrl(config),
    grant_type: 'authorization_code',
  })
  const response = await requestToken(body, fetchImpl)
  const payload = await readTokenPayload(response)
  const idToken = requiredString(payload.id_token)
  const accessToken = requiredString(payload.access_token)

  if (!response.ok || !idToken || !accessToken) throw new GoogleOAuthUpstreamError()

  const refreshToken = optionalString(payload.refresh_token)
  const scopes = parseScopes(payload.scope)
  return {
    idToken,
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(scopes === undefined ? {} : { scopes }),
  }
}

export async function refreshGoogleCredentials(
  storedRefreshToken: string,
  config: ServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleCredentials> {
  const body = new URLSearchParams({
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    refresh_token: storedRefreshToken,
    grant_type: 'refresh_token',
  })
  const response = await requestToken(body, fetchImpl)
  const payload = await readTokenPayload(response)
  if (!response.ok) {
    console.error(`[GoogleOAuth refresh token error ${response.status}]`, payload)
    if (payload.error === 'invalid_grant') {
      throw new InvalidRefreshTokenError()
    }
    throw new GoogleOAuthUpstreamError()
  }

  const accessToken = requiredString(payload.access_token)
  if (!accessToken) throw new GoogleOAuthUpstreamError()
  const refreshToken = optionalString(payload.refresh_token)
  const scopes = parseScopes(payload.scope)
  return {
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(scopes === undefined ? {} : { scopes }),
  }
}

// Task 6 仍匯入原本只回傳 access token 的 helper，保留相容且不記錄 token。
export async function refreshAccessToken(
  refreshToken: string,
  config: ServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  return (await refreshGoogleCredentials(refreshToken, config, fetchImpl)).accessToken
}

export function getGoogleCallbackUrl(config: Pick<ServerConfig, 'appOrigin'>): string {
  return `${config.appOrigin}${GOOGLE_CALLBACK_PATH}`
}

function createCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url')
}

async function requestToken(body: URLSearchParams, fetchImpl: typeof fetch): Promise<Response> {
  try {
    return await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch (error) {
    console.error('[GoogleOAuth token request error]', error)
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
    // 上游回應解析失敗時，一律轉為相同的安全 OAuth 錯誤。
  }
  return {}
}

function requiredString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value)
}

function parseScopes(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new GoogleOAuthUpstreamError()
  return [...new Set(value.split(/\s+/).filter(Boolean))]
}

function secureRandomBytes(size: number): Buffer {
  return randomBytes(size)
}
