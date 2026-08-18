import { clearSessionCookie, readCookie, SESSION_COOKIE_NAME } from './_lib/cookies.js'
import { jsonResponse, methodNotAllowed } from './_lib/function-response.js'
import {
  GoogleOAuthUpstreamError,
  InvalidRefreshTokenError,
  refreshAccessToken,
} from './_lib/google-oauth.js'
import { getServerConfig } from './_lib/server-config.js'
import { decryptSession } from './_lib/session-crypto.js'

const GAS_EXECUTION_API_URL = 'https://script.googleapis.com/v1/scripts/'

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  const requestBody = await readRequestBody(request)
  if (!requestBody) return jsonResponse({ error: 'invalid_request' }, 400)

  const config = getServerConfig()
  const encryptedSession = readCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME)
  const session = encryptedSession && decryptSession(encryptedSession, config.sessionEncryptionKey)
  if (!session) return unauthenticatedResponse()

  try {
    const accessToken = await refreshAccessToken(session.refreshToken, config)
    const gasResponse = await runAppsScript(requestBody, accessToken, config.gasDeploymentId)

    if (gasResponse.status === 401 || gasResponse.status === 403) return unauthenticatedResponse()
    if (!gasResponse.ok) return upstreamFailureResponse()

    const result = await readJson(gasResponse)
    if (result === undefined) return upstreamFailureResponse()
    return jsonResponse(result)
  } catch (error) {
    if (error instanceof InvalidRefreshTokenError) return unauthenticatedResponse()
    if (error instanceof GoogleOAuthUpstreamError) return upstreamFailureResponse()
    return upstreamFailureResponse()
  }
}

async function readRequestBody(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const value = await request.json() as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

async function runAppsScript(
  request: Record<string, unknown>,
  accessToken: string,
  deploymentId: string,
): Promise<Response> {
  try {
    return await fetch(`${GAS_EXECUTION_API_URL}${encodeURIComponent(deploymentId)}:run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        function: 'executeAppRequest',
        parameters: [request],
      }),
    })
  } catch {
    throw new GoogleOAuthUpstreamError()
  }
}

async function readJson(response: Response): Promise<unknown | undefined> {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

function unauthenticatedResponse(): Response {
  return jsonResponse({ error: 'unauthenticated' }, 401, [clearSessionCookie()])
}

function upstreamFailureResponse(): Response {
  return jsonResponse({ error: 'upstream_failure' }, 502)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
