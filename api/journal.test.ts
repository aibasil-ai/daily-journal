import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { encryptSession } from './_lib/session-crypto.js'
import * as journal from './journal.js'

const encryptionKey = Buffer.alloc(32, 3)
const serverEnvironment = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  SESSION_ENCRYPTION_KEY: encryptionKey.toString('base64url'),
  GAS_DEPLOYMENT_ID: 'AKfycbDeploymentId',
}
let originalEnvironment: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnvironment = { ...process.env }
  Object.assign(process.env, serverEnvironment)
})

afterEach(() => {
  process.env = originalEnvironment
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('journal route', () => {
  test('POST 只以伺服器端 access token 呼叫固定的 executeAppRequest', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'server-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ response: { result: { ok: true, data: { ready: true } } } }))
    vi.stubGlobal('fetch', fetchImpl)
    const requestBody = { action: 'bootstrap', function: 'attacker-specified-function' }

    const response = await journal.POST(postRequest(requestBody, validSessionCookie()))
    const responseBody = await response.text()

    expect(response.status).toBe(200)
    expect(JSON.parse(responseBody)).toEqual({ response: { result: { ok: true, data: { ready: true } } } })
    expect(responseBody).not.toContain('server-access-token')
    expect(responseBody).not.toContain('refresh-token')
    expect(response.headers.get('authorization')).toBeNull()
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://oauth2.googleapis.com/token', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&client_id=client-id&client_secret=client-secret&refresh_token=refresh-token',
    }))
    expect(fetchImpl).toHaveBeenNthCalledWith(2,
      'https://script.googleapis.com/v1/scripts/AKfycbDeploymentId:run',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer server-access-token' }),
        body: JSON.stringify({ function: 'executeAppRequest', parameters: [requestBody] }),
      }),
    )
  })

  test.each([
    ['GET', journal.GET],
    ['HEAD', journal.HEAD],
    ['PUT', journal.PUT],
    ['PATCH', journal.PATCH],
    ['DELETE', journal.DELETE],
    ['OPTIONS', journal.OPTIONS],
  ])('%s 不呼叫上游並回傳 405 與 Allow: POST', async (method, handler) => {
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)

    const response = await handler(new Request('https://journal.example/api/journal', { method }))

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test.each([
    ['缺少 session Cookie', undefined],
    ['無效 session Cookie', 'session=invalid.session.value'],
  ])('POST 對%s回傳 401 並清除 session', async (_, cookie) => {
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)

    const response = await journal.POST(postRequest({ action: 'bootstrap' }, cookie))

    expect(response.status).toBe(401)
    expect(setCookies(response)).toEqual(['session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('POST 缺少 session 時優先回傳 401，即使 body 無法解析', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)
    const request = new Request('https://journal.example/api/journal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })

    const response = await journal.POST(request)

    expect(response.status).toBe(401)
    expect(setCookies(response)).toEqual(['session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('POST 對無法解析的 JSON 回傳 400，且保留有效 session', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)
    const request = new Request('https://journal.example/api/journal', {
      method: 'POST',
      headers: { cookie: validSessionCookie(), 'content-type': 'application/json' },
      body: '{',
    })

    const response = await journal.POST(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test.each([
    401,
    403,
  ] as const)('POST 在 GAS 回傳 %i 時清除 session 並回傳 401', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>()
    fetchImpl
      .mockResolvedValueOnce(jsonResponse({ access_token: 'server-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'forbidden' } }, status))
    vi.stubGlobal('fetch', fetchImpl)

    const response = await journal.POST(postRequest({ action: 'bootstrap' }, validSessionCookie()))
    const responseBody = await response.text()

    expect(response.status).toBe(401)
    expect(setCookies(response)).toEqual(['session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'])
    expect(responseBody).not.toContain('server-access-token')
    expect(responseBody).not.toContain('refresh-token')
  })

  test('POST 將 Google refresh 的 400 invalid_grant 視為驗證失敗，且不洩漏上游細節', async () => {
    const upstreamDetail = 'refresh token revoked by Google'
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      error: 'invalid_grant',
      error_description: upstreamDetail,
    }, 400))
    vi.stubGlobal('fetch', fetchImpl)

    const response = await journal.POST(postRequest({ action: 'bootstrap' }, validSessionCookie()))
    const responseBody = await response.text()

    expect(response.status).toBe(401)
    expect(setCookies(response)).toEqual(['session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'])
    expect(responseBody).not.toContain('invalid_grant')
    expect(responseBody).not.toContain(upstreamDetail)
    expect(responseBody).not.toContain('refresh-token')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['Google refresh 401', 'token', 'unauthorized'],
    ['Google refresh 403', 'token', 'forbidden'],
    ['Google refresh other 400', 'token', 'client'],
    ['Google refresh 5xx', 'token', 'server'],
    ['GAS 5xx', 'gas', 'server'],
    ['Google refresh network error', 'token', 'network'],
    ['GAS network error', 'gas', 'network'],
  ] as const)('POST 在%s時回傳 502 並保留有效 session', async (_, source, failure) => {
    const fetchImpl = vi.fn<typeof fetch>()
    if (source === 'token') {
      if (failure === 'unauthorized') {
        fetchImpl.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 401))
      } else if (failure === 'forbidden') {
        fetchImpl.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 403))
      } else if (failure === 'client') {
        fetchImpl.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client' }, 400))
      } else if (failure === 'server') {
        fetchImpl.mockResolvedValueOnce(jsonResponse({ error: 'server_error' }, 500))
      } else {
        fetchImpl.mockRejectedValueOnce(new Error('network failure'))
      }
    } else {
      fetchImpl.mockResolvedValueOnce(jsonResponse({ access_token: 'server-access-token' }))
      if (failure === 'server') {
        fetchImpl.mockResolvedValueOnce(jsonResponse({ error: { message: 'server_error' } }, 500))
      } else {
        fetchImpl.mockRejectedValueOnce(new Error('network failure'))
      }
    }
    vi.stubGlobal('fetch', fetchImpl)

    const response = await journal.POST(postRequest({ action: 'bootstrap' }, validSessionCookie()))
    const responseBody = await response.text()

    expect(response.status).toBe(502)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(responseBody).not.toContain('server-access-token')
    expect(responseBody).not.toContain('refresh-token')
  })

  test.each([
    ['Google token 回傳非 JSON', [new Response('not-json', { status: 200 })]],
    ['GAS 回傳非 JSON', [jsonResponse({ access_token: 'server-access-token' }), new Response('not-json', { status: 200 })]],
  ])('POST 在%s時回傳 502 並保留有效 session', async (_, responses) => {
    const fetchImpl = vi.fn<typeof fetch>()
    responses.forEach((response) => fetchImpl.mockResolvedValueOnce(response))
    vi.stubGlobal('fetch', fetchImpl)

    const response = await journal.POST(postRequest({ action: 'bootstrap' }, validSessionCookie()))
    const responseBody = await response.text()

    expect(response.status).toBe(502)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(responseBody).not.toContain('server-access-token')
    expect(responseBody).not.toContain('refresh-token')
  })
})

function postRequest(body: unknown, cookie: string | undefined): Request {
  return new Request('https://journal.example/api/journal', {
    method: 'POST',
    headers: {
      ...(cookie ? { cookie } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function validSessionCookie(): string {
  const session = encryptSession({
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 60_000,
  }, encryptionKey)

  return `session=${encodeURIComponent(session)}`
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  return headers.getSetCookie?.() ?? headers.get('set-cookie')?.split(', ') ?? []
}
