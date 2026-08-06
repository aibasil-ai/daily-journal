import { clearSessionCookie, readCookie } from './_lib/cookies.js'
import { appendSetCookie } from './_lib/function-response.js'
import { GoogleOAuthRequestError, refreshAccessToken } from './_lib/google-oauth.js'
import { getServerConfig } from './_lib/server-config.js'
import { decryptSession } from './_lib/session-crypto.js'

const gasExecutionEndpoint = 'https://script.googleapis.com/v1/scripts'

export async function GET(_request: Request): Promise<Response> {
  return methodNotAllowedResponse(_request)
}

export async function HEAD(_request: Request): Promise<Response> {
  return methodNotAllowedResponse(_request)
}

export async function PUT(_request: Request): Promise<Response> {
  return methodNotAllowedResponse(_request)
}

export async function PATCH(_request: Request): Promise<Response> {
  return methodNotAllowedResponse(_request)
}

export async function DELETE(_request: Request): Promise<Response> {
  return methodNotAllowedResponse(_request)
}

export async function OPTIONS(_request: Request): Promise<Response> {
  return methodNotAllowedResponse(_request)
}

export async function POST(request: Request): Promise<Response> {
  try {
    const config = getServerConfig()
    const encryptedSession = readCookie(request.headers.get('cookie'), 'session')
    const session = encryptedSession && decryptSession(encryptedSession, config.sessionEncryptionKey)
    if (!session) return unauthorizedResponse()

    let requestBody: unknown
    try {
      requestBody = await request.json()
    } catch {
      return new Response('無效的請求內容。', { status: 400 })
    }

    const accessToken = await refreshAccessToken(session.refreshToken, config)
    const gasResponse = await fetch(`${gasExecutionEndpoint}/${config.gasDeploymentId}:run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ function: 'executeAppRequest', parameters: [requestBody] }),
    })
    if (gasResponse.status === 401 || gasResponse.status === 403) return unauthorizedResponse()
    if (!gasResponse.ok) return badGatewayResponse()

    return Response.json(await gasResponse.json())
  } catch (error) {
    if (isGoogleAuthenticationFailure(error)) return unauthorizedResponse()

    return badGatewayResponse()
  }
}

function isGoogleAuthenticationFailure(error: unknown): error is GoogleOAuthRequestError {
  return error instanceof GoogleOAuthRequestError
    && error.status === 400
    && error.errorCode === 'invalid_grant'
}

function unauthorizedResponse(): Response {
  return appendSetCookie(new Response('工作階段已失效。', { status: 401 }), clearSessionCookie())
}

function badGatewayResponse(): Response {
  return new Response('上游服務暫時無法使用。', { status: 502 })
}

function methodNotAllowedResponse(_request: Request): Response {
  void _request
  return new Response(null, { status: 405, headers: { allow: 'POST' } })
}
