import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { decryptSession } from '../_lib/session-crypto.js'
import * as callback from './callback.js'
import * as logout from './logout.js'
import * as start from './start.js'
import * as session from '../session.js'

const encryptionKey = Buffer.alloc(32, 9)
const serverEnvironment = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  SESSION_ENCRYPTION_KEY: encryptionKey.toString('base64url'),
  GAS_DEPLOYMENT_ID: 'deployment-id',
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

describe('auth routes', () => {
  test('start route 建立 state Cookie 並重新導向至 Google 授權頁', async () => {
    const response = await start.GET(new Request('https://journal.example/api/auth/start'))
    const cookies = setCookies(response)
    const location = new URL(response.headers.get('location')!)

    expect(response.status).toBe(302)
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toMatch(/^oauth_state=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=600$/)
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(location.searchParams.get('state')).toBe(cookieValue(cookies[0], 'oauth_state'))
    expect(location.searchParams.get('redirect_uri')).toBe('https://journal.example/api/auth/callback')
  })

  test('callback 的 state 不符時回傳 400、清除 state 且不建立 session', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)

    const response = await callback.GET(new Request(
      'https://journal.example/api/auth/callback?code=authorization-code&state=wrong-state',
      { headers: { cookie: 'oauth_state=expected-state' } },
    ))
    const cookies = setCookies(response)

    expect(response.status).toBe(400)
    expect(cookies).toEqual(['oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('callback 成功時以相同 origin redirect URI 交換授權碼、加密 session 並清除 state', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-token-must-not-leave-server',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchImpl)

    const response = await callback.GET(new Request(
      'https://journal.example/api/auth/callback?code=authorization-code&state=expected-state',
      { headers: { cookie: 'oauth_state=expected-state' } },
    ))
    const cookies = setCookies(response)
    const encryptedSession = cookieValue(cookies.find((cookie) => cookie.startsWith('session='))!, 'session')

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://journal.example/')
    expect(new URL(response.headers.get('location')!).search).toBe('')
    expect(cookies).toHaveLength(2)
    expect(cookies).toContain('oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0')
    expect(decryptSession(encryptedSession, encryptionKey)).toMatchObject({ refreshToken: 'refresh-token' })
    expect(await response.text()).not.toContain('refresh-token')
    expect(fetchImpl).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({
      body: expect.stringContaining('redirect_uri=https%3A%2F%2Fjournal.example%2Fapi%2Fauth%2Fcallback'),
    }))
  })

  test.each([
    ['Google 拒絕授權', '?error=access_denied&error_description=upstream-detail&state=expected-state'],
    ['缺少授權碼', '?state=expected-state'],
  ])('callback 在 state 已驗證後%s時清除 state、建立可重新登入的安全 redirect 且不建立 session', async (_, query) => {
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)

    const response = await callback.GET(new Request(
      `https://journal.example/api/auth/callback${query}`,
      { headers: { cookie: 'oauth_state=expected-state' } },
    ))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://journal.example/?login_error=oauth_failed')
    expect(setCookies(response)).toEqual(['oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'])
    expect(await response.text()).not.toContain('upstream-detail')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test.each([
    ['Google 上游交換失敗', new Response(JSON.stringify({ error: 'upstream-detail' }), { status: 500 }), 'upstream-detail'],
    ['Google 成功回應缺少 refresh token', new Response(JSON.stringify({ access_token: 'access-token-must-not-leave-server' }), { status: 200 }), 'access-token-must-not-leave-server'],
  ])('callback 在 state 已驗證後%s時不建立 session，清除 state 並安全 redirect', async (_, upstreamResponse, sensitiveValue) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstreamResponse)
    vi.stubGlobal('fetch', fetchImpl)

    const response = await callback.GET(new Request(
      'https://journal.example/api/auth/callback?code=authorization-code&state=expected-state',
      { headers: { cookie: 'oauth_state=expected-state' } },
    ))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://journal.example/?login_error=oauth_failed')
    expect(setCookies(response)).toEqual(['oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'])
    expect(await response.text()).not.toContain(sensitiveValue)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('session route 對有效加密 Cookie 僅回報已驗證狀態', async () => {
    const startResponse = await start.GET(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(setCookies(startResponse)[0], 'oauth_state')
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-token-must-not-leave-server',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
    }), { status: 200 })))
    const callbackResponse = await callback.GET(new Request(
      `https://journal.example/api/auth/callback?code=authorization-code&state=${state}`,
      { headers: { cookie: `oauth_state=${state}` } },
    ))
    const sessionCookie = setCookies(callbackResponse).find((cookie) => cookie.startsWith('session='))!

    const response = await session.GET(new Request('https://journal.example/api/session', {
      headers: { cookie: sessionCookie },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ authenticated: true })
  })

  test('session route 對沒有 session Cookie 回報未驗證', async () => {
    const response = await session.GET(new Request('https://journal.example/api/session', {
      headers: undefined,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ authenticated: false })
  })

  test('session route 對遭篡改的 session Cookie 回報未驗證並清除 Cookie', async () => {
    const response = await session.GET(new Request('https://journal.example/api/session', {
      headers: { cookie: 'session=not.a.valid.session' },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ authenticated: false })
    expect(setCookies(response)).toEqual(['session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'])
  })

  test('logout route 回傳 204 並清除 session Cookie', async () => {
    const response = await logout.POST(new Request('https://journal.example/api/auth/logout', { method: 'POST' }))

    expect(response.status).toBe(204)
    expect(setCookies(response)).toEqual(['session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'])
    await expect(response.text()).resolves.toBe('')
  })
})

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  return headers.getSetCookie?.() ?? headers.get('set-cookie')?.split(', ') ?? []
}

function cookieValue(cookie: string, name: string): string {
  const match = cookie.match(new RegExp(`(?:^|;)\\s*${name}=([^;]+)`))
  if (!match) throw new Error(`找不到 ${name} Cookie`)

  return decodeURIComponent(match[1])
}
