import { afterEach, describe, expect, test, vi } from 'vitest'
import { GET as callback } from './callback'
import { POST as logout } from './logout'
import { GET as session } from '../session'
import { GET as start } from './start'
import { decryptSession } from '../_lib/session-crypto'

const sessionKey = Buffer.alloc(32, 9)
const encodedSessionKey = sessionKey.toString('base64url')

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('OAuth 與工作階段 routes', () => {
  test('開始授權時設定 state Cookie 並轉址 Google', async () => {
    setEnvironment()

    const response = await start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(response, 'daily_journal_oauth_state')

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(response.headers.get('Location')).toContain(`state=${state}`)
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_oauth_state=')
  })

  test('state 不符時不建立 session 並清除 state Cookie', async () => {
    setEnvironment()

    const response = await callback(new Request('https://journal.example/api/auth/callback?code=code&state=wrong', {
      headers: { Cookie: 'daily_journal_oauth_state=expected' },
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_oauth_state' })
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_oauth_state=;')
  })

  test('Google 授權取消時清除 state 並回到登入頁', async () => {
    setEnvironment()

    const response = await callback(new Request('https://journal.example/api/auth/callback?error=access_denied&state=expected', {
      headers: { Cookie: 'daily_journal_oauth_state=expected' },
    }))

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/?auth_error=oauth')
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_oauth_state=;')
    expect(response.headers.get('Set-Cookie')).not.toContain('daily_journal_session=')
  })

  test('授權碼交換成功後建立加密 session 並回到首頁', async () => {
    setEnvironment()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ refresh_token: 'refresh-token' })))
    vi.stubGlobal('fetch', fetchMock)
    const startResponse = await start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')

    const response = await callback(new Request(`https://journal.example/api/auth/callback?code=code&state=${state}`, {
      headers: { Cookie: `daily_journal_oauth_state=${state}` },
    }))
    const encryptedSession = cookieValue(response, 'daily_journal_session')

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/')
    expect(decryptSession(encryptedSession, sessionKey)).toMatchObject({ refreshToken: 'refresh-token' })
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_oauth_state=;')
  })

  test('session probe 對有效與無效 Cookie 回傳登入狀態', async () => {
    setEnvironment()
    const encryptedSession = cookieValue(
      await callbackWithRefreshToken(),
      'daily_journal_session',
    )

    await expect(session(new Request('https://journal.example/api/session', {
      headers: { Cookie: `daily_journal_session=${encryptedSession}` },
    })).json()).resolves.toEqual({ authenticated: true })

    const invalidResponse = session(new Request('https://journal.example/api/session', {
      headers: { Cookie: 'daily_journal_session=invalid' },
    }))
    await expect(invalidResponse.json()).resolves.toEqual({ authenticated: false })
    expect(invalidResponse.headers.get('Set-Cookie')).toContain('daily_journal_session=;')
  })

  test('session probe 對缺少 Cookie 回傳未登入狀態', async () => {
    setEnvironment()

    await expect(session(new Request('https://journal.example/api/session')).json())
      .resolves.toEqual({ authenticated: false })
  })

  test('登出清除工作階段 Cookie', async () => {
    const response = logout()

    expect(response.status).toBe(204)
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=;')
  })
})

function setEnvironment(): void {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret')
  vi.stubEnv('SESSION_ENCRYPTION_KEY', encodedSessionKey)
  vi.stubEnv('GAS_DEPLOYMENT_ID', 'AKfycbDeploymentId')
}

async function callbackWithRefreshToken(): Promise<Response> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ refresh_token: 'refresh-token' })))
  vi.stubGlobal('fetch', fetchMock)
  const startResponse = await start(new Request('https://journal.example/api/auth/start'))
  const state = cookieValue(startResponse, 'daily_journal_oauth_state')
  return callback(new Request(`https://journal.example/api/auth/callback?code=code&state=${state}`, {
    headers: { Cookie: `daily_journal_oauth_state=${state}` },
  }))
}

function cookieValue(response: Response, name: string): string {
  const cookieHeader = response.headers.get('Set-Cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${name}=([^;]*)`))
  if (!match) throw new Error(`找不到 ${name} Cookie。`)
  return decodeURIComponent(match[1])
}
