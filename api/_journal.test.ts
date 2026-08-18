import { afterEach, describe, expect, test, vi } from 'vitest'
import { GET, POST } from './journal'
import { encryptSession } from './_lib/session-crypto'

const sessionKey = Buffer.alloc(32, 5)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('journal proxy', () => {
  test('使用伺服器端 access token 呼叫固定 GAS 函式', async () => {
    setEnvironment()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'server-access-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ response: { result: { ok: true, data: [] } } })))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(authenticatedRequest({ action: 'bootstrap' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ response: { result: { ok: true, data: [] } } })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://script.googleapis.com/v1/scripts/AKfycbDeploymentId:run',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer server-access-token' }),
        body: JSON.stringify({ function: 'executeAppRequest', parameters: [{ action: 'bootstrap' }] }),
      }),
    )
  })

  test('前端資料無法覆寫固定的 GAS 函式名稱', async () => {
    setEnvironment()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'server-access-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ response: { result: { ok: true, data: [] } } })))
    vi.stubGlobal('fetch', fetchMock)

    await POST(authenticatedRequest({ action: 'bootstrap', function: 'untrustedFunction' }))

    const [, options] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(JSON.parse(options.body as string)).toEqual({
      function: 'executeAppRequest',
      parameters: [{ action: 'bootstrap', function: 'untrustedFunction' }],
    })
  })

  test('GET 不被允許，缺少 session 時清除 Cookie 並回傳 401', async () => {
    expect(GET().status).toBe(405)
    setEnvironment()

    const response = await POST(new Request('https://journal.example/api/journal', {
      method: 'POST',
      body: JSON.stringify({ action: 'bootstrap' }),
    }))

    expect(response.status).toBe(401)
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=;')
  })

  test('refresh token 失效時清除 session', async () => {
    setEnvironment()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))

    const response = await POST(authenticatedRequest({ action: 'bootstrap' }))

    expect(response.status).toBe(401)
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=;')
  })

  test('GAS 回傳 403 時清除 session', async () => {
    setEnvironment()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'server-access-token' })))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(authenticatedRequest({ action: 'bootstrap' }))

    expect(response.status).toBe(401)
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=;')
  })

  test('上游錯誤回傳 502 並保留有效 session', async () => {
    setEnvironment()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))

    const response = await POST(authenticatedRequest({ action: 'bootstrap' }))

    expect(response.status).toBe(502)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })
})

function setEnvironment(): void {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret')
  vi.stubEnv('SESSION_ENCRYPTION_KEY', sessionKey.toString('base64url'))
  vi.stubEnv('GAS_DEPLOYMENT_ID', 'AKfycbDeploymentId')
}

function authenticatedRequest(body: Record<string, unknown>): Request {
  const session = encryptSession({
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 60_000,
  }, sessionKey)
  return new Request('https://journal.example/api/journal', {
    method: 'POST',
    headers: {
      Cookie: `daily_journal_session=${session}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
