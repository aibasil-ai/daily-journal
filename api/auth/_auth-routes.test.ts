import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as callback } from './callback'
import { POST as logout } from './logout'
import { GET as session } from '../session'
import { GET as start } from './start'
import { createFakeFirestore } from '../_lib/test-firestore'
import * as firestoreModule from '../_lib/firestore'
import * as oidcModule from '../_lib/oidc'
import { ConnectionStore } from '../_lib/connection-store'
import { SessionStore } from '../_lib/session-store'
import { encryptSession } from '../_lib/session-crypto'

const sessionKey = Buffer.alloc(32, 1)
const tokenKey = Buffer.alloc(32, 2)

let fakeFirestore: ReturnType<typeof createFakeFirestore>

beforeEach(() => {
  fakeFirestore = createFakeFirestore()
  vi.spyOn(firestoreModule, 'getFirestoreClient').mockReturnValue(fakeFirestore)
  setEnvironment()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OAuth 與工作階段 routes', () => {
  test('開始授權時設定 state Cookie、建立 PKCE attempt 並轉址 Google', async () => {
    const response = await start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(response, 'daily_journal_oauth_state')

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(response.headers.get('Location')).toContain(`state=${state}`)
    expect(response.headers.get('Location')).toContain('code_challenge=')
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_oauth_state=')

    const attemptDoc = await fakeFirestore.collection('oauth_attempts').doc(state).get()
    expect(attemptDoc.exists).toBe(true)
  })

  test('state 不符時不建立 session 並清除 state Cookie', async () => {
    const response = await callback(new Request('https://journal.example/api/auth/callback?code=code&state=wrong', {
      headers: { Cookie: 'daily_journal_oauth_state=expected' },
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_oauth_state' })
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_oauth_state=;')
  })

  test('Google 授權取消時清除 state 並回到登入頁', async () => {
    const connStore = new ConnectionStore(fakeFirestore)
    await connStore.createOAuthAttempt({
      state: 'expected',
      codeVerifier: 'verifier',
      intent: 'sign-in',
      expiresAt: Date.now() + 60_000,
    })

    const response = await callback(new Request('https://journal.example/api/auth/callback?error=access_denied&state=expected', {
      headers: { Cookie: 'daily_journal_oauth_state=expected' },
    }))

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/?auth_error=oauth')
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_oauth_state=;')
    expect(response.headers.get('Set-Cookie')).not.toContain('daily_journal_session=')
  })

  test('首次登入有 refresh token 時建立 provisioning session 並轉址 /?setup=1', async () => {
    vi.spyOn(oidcModule, 'verifyGoogleIdToken').mockResolvedValue({
      sub: 'google-sub-1',
      email: 'new@example.com',
      name: 'New User',
      picture: 'https://example.com/pic.png',
    })

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'access-token',
      id_token: 'id-token',
      refresh_token: 'new-refresh-token',
    })))
    vi.stubGlobal('fetch', fetchMock)

    const startResponse = await start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')

    const response = await callback(new Request(`https://journal.example/api/auth/callback?code=auth-code&state=${state}`, {
      headers: { Cookie: `daily_journal_oauth_state=${state}` },
    }))

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/?setup=1')
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_provisioning=')
  })

  test('既有使用者登入時建立 journal session 並轉址 /', async () => {
    const connStore = new ConnectionStore(fakeFirestore)
    const user = await connStore.getOrCreateUser({
      googleSub: 'sub-active',
      email: 'active@example.com',
      name: 'Active User',
      picture: '',
    })
    await connStore.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-1',
      encryptedRefreshToken: { ciphertext: 'token', keyVersion: 'v1' },
    })

    vi.spyOn(oidcModule, 'verifyGoogleIdToken').mockResolvedValue({
      sub: 'sub-active',
      email: 'active@example.com',
      name: 'Active User',
      picture: '',
    })

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'access-token',
      id_token: 'id-token',
    })))
    vi.stubGlobal('fetch', fetchMock)

    const startResponse = await start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')

    const response = await callback(new Request(`https://journal.example/api/auth/callback?code=auth-code&state=${state}`, {
      headers: { Cookie: `daily_journal_oauth_state=${state}` },
    }))

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/')
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=')
  })

  test('session probe 回傳 authenticated, provisioning 或 signed-out', async () => {
    const sessionStore = new SessionStore(fakeFirestore)

    // 1. Authenticated session
    const jSession = await sessionStore.create({ userId: 'user-1', kind: 'journal', ttlMs: 60_000 })
    const jCookie = encryptSession({ sessionId: jSession.sessionId, expiresAt: jSession.expiresAt }, sessionKey)

    const jResp = await session(new Request('https://journal.example/api/session', {
      headers: { Cookie: `daily_journal_session=${jCookie}` },
    }))
    expect(await jResp.json()).toEqual({ state: 'authenticated' })

    // 2. Provisioning session
    const pSession = await sessionStore.create({ userId: 'user-1', kind: 'provisioning', ttlMs: 60_000 })
    const pCookie = encryptSession({ sessionId: pSession.sessionId, expiresAt: pSession.expiresAt }, sessionKey)

    const pResp = await session(new Request('https://journal.example/api/session', {
      headers: { Cookie: `daily_journal_provisioning=${pCookie}` },
    }))
    expect(await pResp.json()).toEqual({ state: 'provisioning' })

    // 3. Signed out
    const sResp = await session(new Request('https://journal.example/api/session'))
    expect(await sResp.json()).toEqual({ state: 'signed-out' })
  })

  test('登出清除工作階段 Cookie 並撤銷 session', async () => {
    const sessionStore = new SessionStore(fakeFirestore)
    const jSession = await sessionStore.create({ userId: 'user-1', kind: 'journal', ttlMs: 60_000 })
    const jCookie = encryptSession({ sessionId: jSession.sessionId, expiresAt: jSession.expiresAt }, sessionKey)

    const response = await logout(new Request('https://journal.example/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `daily_journal_session=${jCookie}` },
    }))

    expect(response.status).toBe(204)
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=;')
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_provisioning=;')

    expect(await sessionStore.resolveJournalSession(jSession.sessionId)).toBeUndefined()
  })
})

function setEnvironment(): void {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret')
  vi.stubEnv('APP_ORIGIN', 'https://journal.example')
  vi.stubEnv('SESSION_ENCRYPTION_KEY', sessionKey.toString('base64url'))
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', tokenKey.toString('base64url'))
  vi.stubEnv('TOKEN_ENCRYPTION_KEY_VERSION', 'v1')
  vi.stubEnv('FIRESTORE_PROJECT_ID', 'journal-production')
  vi.stubEnv('FIRESTORE_SERVICE_ACCOUNT_JSON', JSON.stringify({
    project_id: 'journal-production',
    client_email: 'a@b.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
  }))
  vi.stubEnv('LEGACY_MIGRATION_SECRET', 'm'.repeat(32))
  vi.stubEnv('CRON_SECRET', 'c'.repeat(32))
}

function cookieValue(response: Response, name: string): string {
  const cookieHeader = response.headers.get('Set-Cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${name}=([^;]*)`))
  if (!match) throw new Error(`找不到 ${name} Cookie。`)
  return decodeURIComponent(match[1])
}

