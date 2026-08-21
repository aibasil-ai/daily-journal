import { describe, expect, test, vi } from 'vitest'
import {
  ConnectionStore,
  type FirestoreAdapter,
  type FirestoreCollectionReference,
  type FirestoreData,
  type FirestoreDocumentReference,
  type FirestoreDocumentSnapshot,
  type FirestoreQuery,
  type FirestoreQueryDocumentSnapshot,
  type FirestoreQuerySnapshot,
  type FirestoreTransaction,
  type FirestoreWhereOperator,
  type FirestoreWriteBatch,
} from '../_lib/connection-store.js'
import { PROVISIONING_COOKIE_NAME, SESSION_COOKIE_NAME } from '../_lib/cookies.js'
import { decryptSession, encryptSession } from '../_lib/session-crypto.js'
import { SessionStore } from '../_lib/session-store.js'
import type { ServerConfig } from '../_lib/server-config.js'
import { decryptRefreshToken, encryptRefreshToken } from '../_lib/token-crypto.js'
import type { GoogleAuthorizationCodeCredentials } from '../_lib/google-oauth.js'
import { POST as callbackPost, createCallbackHandler } from './callback.js'
import { GET as logoutGet, createLogoutHandler } from './logout.js'
import { POST as startPost, createStartHandler } from './start.js'
import { POST as sessionPost, createSessionHandler } from '../session.js'
import { RateLimiter } from '../_lib/rate-limit.js'

const config: ServerConfig = {
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  appOrigin: 'https://journal.example',
  sessionEncryptionKey: Buffer.alloc(32, 9),
  tokenEncryptionKey: Buffer.alloc(32, 8),
  tokenEncryptionKeyVersion: 'v1',
  firestoreProjectId: 'journal-production',
  firestoreCredentials: {
    clientEmail: 'journal-api@journal-production.iam.gserviceaccount.com',
    privateKey: 'private-key',
  },
  legacyMigrationSecret: 'm'.repeat(32),
  cronSecret: 'c'.repeat(32),
}

const profile = {
  sub: 'google-sub-1',
  email: 'user@example.com',
  name: '測試使用者',
  picture: 'https://example.com/avatar.png',
}

describe('OAuth 與本站工作階段 routes', () => {
  test('開始授權以 IP 套用速率限制、保存短效一次性 OAuth attempt，且固定 callback origin', async () => {
    const system = createSystem()
    const start = createStartHandler({
      config,
      connectionStore: system.connectionStore,
      rateLimiter: system.rateLimiter,
      clock: system.clock,
    })

    const response = await start(new Request('https://preview.attacker.example/api/auth/start', {
      headers: { 'X-Forwarded-For': '203.0.113.10, 10.0.0.1' },
    }))
    const state = cookieValue(response, 'daily_journal_oauth_state')
    const authorizationUrl = new URL(response.headers.get('Location') ?? '')
    const attempt = system.firestore.document('oauth_attempts', state)

    expect(response.status).toBe(302)
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('https://journal.example/api/auth/callback')
    expect(authorizationUrl.searchParams.get('prompt')).toBeNull()
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Lax; Path=/')
    expect(response.headers.get('Set-Cookie')).not.toContain('daily_journal_session=')
    expect(attempt).toMatchObject({
      state,
      intent: 'sign-in',
      expiresAt: system.clock() + 10 * 60_000,
      consumedAt: null,
    })
    expect(attempt?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(JSON.stringify(attempt)).not.toContain('refresh-token')
  })

  test('重新授權明確記錄 intent 並才加入 consent prompt，超過每 IP 十次後拒絕', async () => {
    const system = createSystem()
    const start = createStartHandler({
      config,
      connectionStore: system.connectionStore,
      rateLimiter: system.rateLimiter,
      clock: system.clock,
    })

    const first = await start(new Request('https://journal.example/api/auth/start?reauthorize=1', {
      headers: { 'X-Forwarded-For': '203.0.113.11' },
    }))
    const state = cookieValue(first, 'daily_journal_oauth_state')
    expect(new URL(first.headers.get('Location') ?? '').searchParams.get('prompt')).toBe('consent')
    expect(system.firestore.document('oauth_attempts', state)).toMatchObject({ intent: 'reauthorize' })

    for (let index = 0; index < 9; index += 1) {
      await expect(start(new Request('https://journal.example/api/auth/start', {
        headers: { 'X-Forwarded-For': '203.0.113.11' },
      }))).resolves.toMatchObject({ status: 302 })
    }
    const limited = await start(new Request('https://journal.example/api/auth/start', {
      headers: { 'X-Forwarded-For': '203.0.113.11' },
    }))

    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toEqual({ error: 'rate_limited' })
    expect(limited.headers.get('Set-Cookie')).toBeNull()
  })

  test('偽造 state 不會撤銷或清除既有登入 Cookie', async () => {
    const system = createSystem()
    const browserSessions = await createBrowserSessions(system)
    const revokeSession = vi.spyOn(system.sessionStore, 'revokeSession')
    const handlers = createHandlers(system)
    const startResponse = await handlers.start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')

    const response = await handlers.callback(callbackRequest('wrong-state', 'code', state, browserSessions.cookies))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_oauth_state' })
    expect(handlers.exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(system.firestore.document('oauth_attempts', state)).toMatchObject({ consumedAt: null })
    expect(revokeSession).not.toHaveBeenCalled()
    expect(await system.sessionStore.resolveJournalSession(browserSessions.journal.sessionId)).toBeDefined()
    expect(await system.sessionStore.resolveProvisioningSession(browserSessions.provisioning.sessionId)).toBeDefined()
    expectOnlyOAuthStateCookieCleared(response)
  })

  test('Google 授權取消在 state 驗證後撤銷既有工作階段', async () => {
    const system = createSystem()
    const browserSessions = await createBrowserSessions(system)
    const revokeSession = vi.spyOn(system.sessionStore, 'revokeSession')
    const handlers = createHandlers(system)
    const startResponse = await handlers.start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')

    const response = await handlers.callback(new Request(
      `https://journal.example/api/auth/callback?error=access_denied&state=${state}`,
      { headers: { Cookie: [`daily_journal_oauth_state=${state}`, ...browserSessions.cookies].join('; ') } },
    ))

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/?auth_error=oauth')
    expect(handlers.exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(system.firestore.document('oauth_attempts', state)?.consumedAt).toEqual(expect.any(Number))
    expect(revokeSession).toHaveBeenCalledWith(browserSessions.journal.sessionId)
    expect(revokeSession).toHaveBeenCalledWith(browserSessions.provisioning.sessionId)
    expect(await system.sessionStore.resolveJournalSession(browserSessions.journal.sessionId)).toBeUndefined()
    expect(await system.sessionStore.resolveProvisioningSession(browserSessions.provisioning.sessionId)).toBeUndefined()
    expectClearedAuthenticationCookies(response)
  })

  test('已驗證 state 的 OAuth 交換失敗會撤銷既有工作階段', async () => {
    const system = createSystem()
    const browserSessions = await createBrowserSessions(system)
    const handlers = createHandlers(system)
    const revokeSession = vi.spyOn(system.sessionStore, 'revokeSession')
    handlers.exchangeAuthorizationCode.mockRejectedValueOnce(new Error('OAuth 交換失敗'))
    const startResponse = await handlers.start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')

    const response = await handlers.callback(callbackRequest(state, 'authorization-code', state, browserSessions.cookies))

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/?auth_error=oauth')
    expect(handlers.verifyGoogleIdToken).not.toHaveBeenCalled()
    expect(revokeSession).toHaveBeenCalledWith(browserSessions.journal.sessionId)
    expect(revokeSession).toHaveBeenCalledWith(browserSessions.provisioning.sessionId)
    expect(await system.sessionStore.resolveJournalSession(browserSessions.journal.sessionId)).toBeUndefined()
    expect(await system.sessionStore.resolveProvisioningSession(browserSessions.provisioning.sessionId)).toBeUndefined()
    expectClearedAuthenticationCookies(response)
  })

  test('已驗證 state 的 OIDC 驗證失敗會撤銷既有工作階段', async () => {
    const system = createSystem()
    const browserSessions = await createBrowserSessions(system)
    const handlers = createHandlers(system)
    const revokeSession = vi.spyOn(system.sessionStore, 'revokeSession')
    handlers.verifyGoogleIdToken.mockRejectedValueOnce(new Error('OIDC 驗證失敗'))
    const startResponse = await handlers.start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')

    const response = await handlers.callback(callbackRequest(state, 'authorization-code', state, browserSessions.cookies))

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/?auth_error=oauth')
    expect(handlers.exchangeAuthorizationCode).toHaveBeenCalled()
    expect(revokeSession).toHaveBeenCalledWith(browserSessions.journal.sessionId)
    expect(revokeSession).toHaveBeenCalledWith(browserSessions.provisioning.sessionId)
    expect(await system.sessionStore.resolveJournalSession(browserSessions.journal.sessionId)).toBeUndefined()
    expect(await system.sessionStore.resolveProvisioningSession(browserSessions.provisioning.sessionId)).toBeUndefined()
    expectClearedAuthenticationCookies(response)
  })

  test('首次登入有 refresh token 時建立加密 provisioning attempt 與二十分鐘設定工作階段', async () => {
    const system = createSystem()
    const handlers = createHandlers(system)
    const startResponse = await handlers.start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')
    const attempt = system.firestore.document('oauth_attempts', state)

    const response = await handlers.callback(callbackRequest(state, 'authorization-code', state))
    const provisioningCookie = cookieValue(response, PROVISIONING_COOKIE_NAME)
    const provisioningPayload = decryptSession(provisioningCookie, config.sessionEncryptionKey)

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/?setup=1')
    expect(handlers.exchangeAuthorizationCode).toHaveBeenCalledWith(
      'authorization-code',
      attempt?.codeVerifier,
      config,
    )
    expect(handlers.verifyGoogleIdToken).toHaveBeenCalledWith('id-token', config.googleClientId)
    expect(provisioningPayload).toBeDefined()
    const provisioningSession = await system.sessionStore.resolveProvisioningSession(
      provisioningPayload?.sessionId ?? '',
    )
    const provisioningAttempt = await system.connectionStore.getProvisioningAttempt(
      provisioningSession?.provisioningAttemptId ?? '',
    )
    expect(provisioningSession).toMatchObject({ userId: expect.any(String), kind: 'provisioning' })
    expect(provisioningAttempt).toMatchObject({
      mode: 'initial',
      status: 'initial_choice',
      expiresAt: system.clock() + 20 * 60_000,
    })
    expect(decryptRefreshToken(
      provisioningAttempt?.tempEncryptedRefreshToken ?? { ciphertext: '', keyVersion: 'v1' },
      config.tokenEncryptionKey,
    )).toBe('refresh-token')
    expect(JSON.stringify(system.firestore.documentsIn('provisioning_attempts'))).not.toContain('refresh-token')
    expect(JSON.stringify(system.firestore.documentsIn('provisioning_attempts'))).not.toContain('access-token')
    expect(response.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_oauth_state=;')

    const revokeSession = vi.spyOn(system.sessionStore, 'revokeSession')
    const replay = await handlers.callback(callbackRequest(state, 'authorization-code', state, [
      `${PROVISIONING_COOKIE_NAME}=${provisioningCookie}`,
    ]))
    expect(replay.status).toBe(400)
    expect(handlers.exchangeAuthorizationCode).toHaveBeenCalledTimes(1)
    expect(revokeSession).not.toHaveBeenCalled()
    expect(await system.sessionStore.resolveProvisioningSession(provisioningPayload?.sessionId ?? '')).toBeDefined()
    expectOnlyOAuthStateCookieCleared(replay)
  })

  test('過期 state 不會撤銷或清除既有工作階段', async () => {
    const system = createSystem()
    const browserSessions = await createBrowserSessions(system)
    const revokeSession = vi.spyOn(system.sessionStore, 'revokeSession')
    const handlers = createHandlers(system)
    const startResponse = await handlers.start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')
    const attempt = system.firestore.document('oauth_attempts', state)
    if (!attempt || typeof attempt.expiresAt !== 'number') throw new Error('找不到 OAuth attempt。')
    system.setNow(attempt.expiresAt)

    const response = await handlers.callback(callbackRequest(state, 'authorization-code', state, browserSessions.cookies))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_oauth_state' })
    expect(handlers.exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(revokeSession).not.toHaveBeenCalled()
    expect(await system.sessionStore.resolveJournalSession(browserSessions.journal.sessionId)).toBeDefined()
    expect(await system.sessionStore.resolveProvisioningSession(browserSessions.provisioning.sessionId)).toBeDefined()
    expectOnlyOAuthStateCookieCleared(response)
  })

  test('成功切換帳號會在建立新工作階段前撤銷舊工作階段', async () => {
    const system = createSystem()
    const browserSessions = await createBrowserSessions(system)
    const revokeSession = vi.spyOn(system.sessionStore, 'revokeSession')
    const createSession = vi.spyOn(system.sessionStore, 'create')
    const handlers = createHandlers(system)
    const startResponse = await handlers.start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')

    const response = await handlers.callback(callbackRequest(state, 'authorization-code', state, browserSessions.cookies))
    const payload = decryptSession(cookieValue(response, PROVISIONING_COOKIE_NAME), config.sessionEncryptionKey)
    const newSession = await system.sessionStore.resolveProvisioningSession(payload?.sessionId ?? '')
    const createCallOrder = createSession.mock.invocationCallOrder[0]

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/?setup=1')
    expect(revokeSession).toHaveBeenCalledTimes(2)
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(createCallOrder).toBeDefined()
    expect(Math.max(...revokeSession.mock.invocationCallOrder)).toBeLessThan(createCallOrder ?? Infinity)
    expect(await system.sessionStore.resolveJournalSession(browserSessions.journal.sessionId)).toBeUndefined()
    expect(await system.sessionStore.resolveProvisioningSession(browserSessions.provisioning.sessionId)).toBeUndefined()
    expect(newSession).toBeDefined()
    expect(newSession?.userId).not.toBe(browserSessions.journal.session.userId)
  })

  test('既有作用中連線以新的加密 refresh token 更新並建立 journal session', async () => {
    const system = createSystem()
    const existing = await createActiveConnection(system, 'previous-refresh-token')
    const handlers = createHandlers(system, {
      idToken: 'id-token',
      accessToken: 'access-token',
      refreshToken: 'new-refresh-token',
      scopes: ['openid', 'email'],
    })
    const startResponse = await handlers.start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')

    const response = await handlers.callback(callbackRequest(state, 'authorization-code', state))
    const payload = decryptSession(cookieValue(response, SESSION_COOKIE_NAME), config.sessionEncryptionKey)
    const current = await system.connectionStore.findActiveConnection(existing.id)

    expect(response.headers.get('Location')).toBe('/')
    expect(await system.sessionStore.resolveJournalSession(payload?.sessionId ?? '')).toMatchObject({
      userId: existing.id,
      kind: 'journal',
    })
    expect(decryptRefreshToken(current?.encryptedRefreshToken ?? { ciphertext: '', keyVersion: 'v1' }, config.tokenEncryptionKey))
      .toBe('new-refresh-token')
    expect(current).toMatchObject({
      scopes: ['openid', 'email'],
      connectionVersion: 2,
    })
    expect(response.headers.get('Set-Cookie')).toContain(`${PROVISIONING_COOKIE_NAME}=;`)
    expect(`${response.headers.get('Location')} ${response.headers.get('Set-Cookie')}`).not.toContain('access-token')
    expect(`${response.headers.get('Location')} ${response.headers.get('Set-Cookie')}`).not.toContain('new-refresh-token')
  })

  test('既有作用中連線未收到新 refresh token 時保留既有密文仍可登入', async () => {
    const system = createSystem()
    const existing = await createActiveConnection(system, 'previous-refresh-token')
    const handlers = createHandlers(system, {
      idToken: 'id-token',
      accessToken: 'access-token',
      scopes: ['openid'],
    })
    const startResponse = await handlers.start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')

    const response = await handlers.callback(callbackRequest(state, 'authorization-code', state))
    const current = await system.connectionStore.findActiveConnection(existing.id)

    expect(response.headers.get('Location')).toBe('/')
    expect(decryptRefreshToken(current?.encryptedRefreshToken ?? { ciphertext: '', keyVersion: 'v1' }, config.tokenEncryptionKey))
      .toBe('previous-refresh-token')
    expect(current).toMatchObject({ scopes: ['openid'], connectionVersion: 2 })
  })

  test('既有作用中連線收到缺少 scope 的 OAuth 回應時保留原 scopes 與版本', async () => {
    const system = createSystem()
    const existing = await createActiveConnection(system, 'previous-refresh-token', ['granted-scope'])
    const handlers = createHandlers(system, {
      idToken: 'id-token',
      accessToken: 'access-token',
    })
    const startResponse = await handlers.start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')

    const response = await handlers.callback(callbackRequest(state, 'authorization-code', state))
    const current = await system.connectionStore.findActiveConnection(existing.id)

    expect(response.headers.get('Location')).toBe('/')
    expect(current).toMatchObject({
      scopes: ['granted-scope'],
      connectionVersion: 1,
    })
    expect(decryptRefreshToken(current?.encryptedRefreshToken ?? { ciphertext: '', keyVersion: 'v1' }, config.tokenEncryptionKey))
      .toBe('previous-refresh-token')
  })

  test('callback 更新憑證後，已開始的換表確認回安全衝突且不覆寫新憑證', async () => {
    const system = createSystem()
    const user = await createActiveConnection(system, 'previous-refresh-token', ['old-scope'])
    const active = await system.connectionStore.findActiveConnection(user.id)
    if (!active) throw new Error('預期存在作用中的連線。')
    const change = await system.connectionStore.createProvisioningAttempt({
      userId: user.id,
      mode: 'change',
      originalConnectionVersion: active.connectionVersion,
      tempEncryptedRefreshToken: encryptRefreshToken(
        'change-refresh-token',
        config.tokenEncryptionKey,
        config.tokenEncryptionKeyVersion,
      ),
      tempScopes: ['change-scope'],
      ttlMs: 60_000,
    })
    await system.connectionStore.claimProvisioningAttemptAction({
      attemptId: change.id,
      userId: user.id,
      nextStatus: 'verifying',
    })
    await system.connectionStore.updateClaimedProvisioningAttempt({
      attemptId: change.id,
      userId: user.id,
      expectedStatus: 'verifying',
      status: 'ready_to_confirm',
      selectedSpreadsheetId: 'sheet-change-target',
      selectedSpreadsheetName: '換表目標',
      createdByService: false,
    })
    const handlers = createHandlers(system, {
      idToken: 'id-token',
      accessToken: 'access-token',
      refreshToken: 'callback-refresh-token',
      scopes: ['callback-scope'],
    })
    const startResponse = await handlers.start(new Request('https://journal.example/api/auth/start'))
    const state = cookieValue(startResponse, 'daily_journal_oauth_state')

    const response = await handlers.callback(callbackRequest(state, 'authorization-code', state))
    const updated = await system.connectionStore.findActiveConnection(user.id)

    expect(response.status).toBe(302)
    expect(`${response.headers.get('Location')} ${response.headers.get('Set-Cookie')}`)
      .not.toContain('callback-refresh-token')
    expect(`${response.headers.get('Location')} ${response.headers.get('Set-Cookie')}`)
      .not.toContain('sheet-change-target')
    expect(updated).toMatchObject({
      spreadsheetId: active.spreadsheetId,
      connectionVersion: active.connectionVersion + 1,
      scopes: ['callback-scope'],
    })
    expect(decryptRefreshToken(
      updated?.encryptedRefreshToken ?? { ciphertext: '', keyVersion: 'v1' },
      config.tokenEncryptionKey,
    )).toBe('callback-refresh-token')
    await expect(system.connectionStore.completeProvisioningAttempt({
      attemptId: change.id,
      userId: user.id,
      expectedStatus: 'ready_to_confirm',
      expectedSpreadsheetId: 'sheet-change-target',
      expectedSpreadsheetName: '換表目標',
      expectedOriginalConnectionVersion: active.connectionVersion,
      journalSessionTtlMs: 60_000,
    })).rejects.toThrow('連線版本不符，請重新整理後再試。')
    expect(await system.connectionStore.findActiveConnection(user.id)).toMatchObject({
      spreadsheetId: active.spreadsheetId,
      connectionVersion: active.connectionVersion + 1,
      scopes: ['callback-scope'],
    })
  })

  test('無作用中連線且缺 refresh token 時，sign-in 僅導向一次重新授權，reauthorize 仍缺 token 時失敗', async () => {
    const system = createSystem()
    const handlers = createHandlers(system, {
      idToken: 'id-token',
      accessToken: 'access-token',
      scopes: ['openid'],
    })
    const firstStart = await handlers.start(new Request('https://journal.example/api/auth/start'))
    const firstState = cookieValue(firstStart, 'daily_journal_oauth_state')

    const firstCallback = await handlers.callback(callbackRequest(firstState, 'authorization-code', firstState))
    expect(firstCallback.status).toBe(302)
    expect(firstCallback.headers.get('Location')).toBe('/api/auth/start?reauthorize=1')
    expectClearedAuthenticationCookies(firstCallback)

    const reauthorizeStart = await handlers.start(new Request('https://journal.example/api/auth/start?reauthorize=1'))
    const reauthorizeState = cookieValue(reauthorizeStart, 'daily_journal_oauth_state')
    const reauthorizeCallback = await handlers.callback(
      callbackRequest(reauthorizeState, 'authorization-code', reauthorizeState),
    )

    expect(reauthorizeCallback.status).toBe(302)
    expect(reauthorizeCallback.headers.get('Location')).toBe('/?auth_error=oauth')
    expectClearedAuthenticationCookies(reauthorizeCallback)
    expect(system.firestore.documentsIn('provisioning_attempts')).toHaveLength(0)
  })

  test('/api/session 只解析不透明 Cookie 與伺服器端 session，回傳三種安全狀態', async () => {
    const system = createSystem()
    const session = createSessionHandler({ config, sessionStore: system.sessionStore })
    const journal = await system.sessionStore.create({ userId: 'user-journal', kind: 'journal', ttlMs: 60_000 })
    const provisioning = await system.sessionStore.create({
      userId: 'user-provisioning',
      kind: 'provisioning',
      provisioningAttemptId: 'attempt-1',
      ttlMs: 60_000,
    })

    const authenticated = await session(sessionRequest(SESSION_COOKIE_NAME, journal.sessionId, journal.expiresAt))
    const provisioningResponse = await session(
      sessionRequest(PROVISIONING_COOKIE_NAME, provisioning.sessionId, provisioning.expiresAt),
    )
    const signedOut = await session(new Request('https://journal.example/api/session'))

    const authenticatedBody = await authenticated.json()
    expect(authenticatedBody).toEqual({ state: 'authenticated' })
    await expect(provisioningResponse.json()).resolves.toEqual({ state: 'provisioning' })
    await expect(signedOut.json()).resolves.toEqual({ state: 'signed-out' })
    expect(JSON.stringify(authenticatedBody)).not.toContain('refresh-token')
  })

  test('/api/session 對已撤銷或到期的伺服器 session 清除相應 Cookie', async () => {
    const system = createSystem()
    const session = createSessionHandler({ config, sessionStore: system.sessionStore })
    const revoked = await system.sessionStore.create({ userId: 'user-revoked', kind: 'journal', ttlMs: 60_000 })
    await system.sessionStore.revokeSession(revoked.sessionId)
    const expired = await system.sessionStore.create({ userId: 'user-expired', kind: 'provisioning', provisioningAttemptId: 'attempt-2', ttlMs: 1 })
    system.setNow(expired.expiresAt)

    const revokedResponse = await session(sessionRequest(SESSION_COOKIE_NAME, revoked.sessionId, revoked.expiresAt))
    const expiredResponse = await session(
      sessionRequest(PROVISIONING_COOKIE_NAME, expired.sessionId, expired.expiresAt),
    )

    await expect(revokedResponse.json()).resolves.toEqual({ state: 'signed-out' })
    await expect(expiredResponse.json()).resolves.toEqual({ state: 'signed-out' })
    expect(revokedResponse.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(expiredResponse.headers.get('Set-Cookie')).toContain(`${PROVISIONING_COOKIE_NAME}=;`)
  })

  test('登出撤銷目前兩種伺服器 session 並清除兩種 Cookie', async () => {
    const system = createSystem()
    const logout = createLogoutHandler({ config, sessionStore: system.sessionStore })
    const journal = await system.sessionStore.create({ userId: 'user-1', kind: 'journal', ttlMs: 60_000 })
    const provisioning = await system.sessionStore.create({
      userId: 'user-1',
      kind: 'provisioning',
      provisioningAttemptId: 'attempt-3',
      ttlMs: 60_000,
    })

    const response = await logout(new Request('https://journal.example/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: [
          cookiePair(SESSION_COOKIE_NAME, journal.sessionId, journal.expiresAt),
          cookiePair(PROVISIONING_COOKIE_NAME, provisioning.sessionId, provisioning.expiresAt),
        ].join('; '),
      },
    }))

    expect(response.status).toBe(204)
    expect(await system.sessionStore.resolveJournalSession(journal.sessionId)).toBeUndefined()
    expect(await system.sessionStore.resolveProvisioningSession(provisioning.sessionId)).toBeUndefined()
    expect(response.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(response.headers.get('Set-Cookie')).toContain(`${PROVISIONING_COOKIE_NAME}=;`)
  })

  test('登出撤銷任一工作階段失敗時回 503 並保留 Cookie', async () => {
    const journal = { sessionId: 'journal-session', expiresAt: Date.now() + 60_000 }
    const provisioning = { sessionId: 'provisioning-session', expiresAt: Date.now() + 60_000 }
    const revokeSession = vi.fn(async (sessionId: string) => {
      if (sessionId === provisioning.sessionId) throw new Error('Firestore 無法使用')
    })
    const logout = createLogoutHandler({ config, sessionStore: { revokeSession } })

    const response = await logout(new Request('https://journal.example/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: [
          cookiePair(SESSION_COOKIE_NAME, journal.sessionId, journal.expiresAt),
          cookiePair(PROVISIONING_COOKIE_NAME, provisioning.sessionId, provisioning.expiresAt),
        ].join('; '),
      },
    }))

    expect(response.status).toBe(503)
    expect(revokeSession).toHaveBeenNthCalledWith(1, journal.sessionId)
    expect(revokeSession).toHaveBeenNthCalledWith(2, provisioning.sessionId)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  test('各 route 保留未支援方法的 guard', () => {
    expect(startPost().status).toBe(405)
    expect(startPost().headers.get('Allow')).toBe('GET')
    expect(callbackPost().status).toBe(405)
    expect(callbackPost().headers.get('Allow')).toBe('GET')
    expect(sessionPost().status).toBe(405)
    expect(sessionPost().headers.get('Allow')).toBe('GET')
    expect(logoutGet().status).toBe(405)
    expect(logoutGet().headers.get('Allow')).toBe('POST')
  })
})

function createHandlers(
  system: ReturnType<typeof createSystem>,
  credentials: GoogleAuthorizationCodeCredentials = {
    idToken: 'id-token',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    scopes: ['openid', 'email', 'profile'],
  },
) {
  const exchangeAuthorizationCode = vi.fn(async () => credentials)
  const verifyGoogleIdToken = vi.fn(async () => profile)

  return {
    start: createStartHandler({
      config,
      connectionStore: system.connectionStore,
      rateLimiter: system.rateLimiter,
      clock: system.clock,
    }),
    callback: createCallbackHandler({
      config,
      connectionStore: system.connectionStore,
      sessionStore: system.sessionStore,
      exchangeAuthorizationCode,
      verifyGoogleIdToken,
    }),
    exchangeAuthorizationCode,
    verifyGoogleIdToken,
  }
}

function createSystem() {
  let now = Date.now()
  const firestore = new FakeFirestore()
  const clock = () => now
  return {
    firestore,
    clock,
    connectionStore: new ConnectionStore(firestore, clock),
    sessionStore: new SessionStore(firestore, clock),
    rateLimiter: new RateLimiter(firestore),
    setNow(value: number): void {
      now = value
    },
  }
}

async function createActiveConnection(
  system: ReturnType<typeof createSystem>,
  refreshToken: string,
  scopes: string[] = [],
) {
  const user = await system.connectionStore.getOrCreateUser({
    googleSub: profile.sub,
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
  })
  await system.connectionStore.activateConnection({
    userId: user.id,
    spreadsheetId: 'sheet-1',
    encryptedRefreshToken: encryptRefreshToken(
      refreshToken,
      config.tokenEncryptionKey,
      config.tokenEncryptionKeyVersion,
    ),
    scopes,
  })
  return user
}

async function createBrowserSessions(system: ReturnType<typeof createSystem>) {
  const journal = await system.sessionStore.create({
    userId: 'previous-user',
    kind: 'journal',
    ttlMs: 60 * 60_000,
  })
  const provisioning = await system.sessionStore.create({
    userId: 'previous-user',
    kind: 'provisioning',
    provisioningAttemptId: 'previous-attempt',
    ttlMs: 60 * 60_000,
  })
  return {
    journal,
    provisioning,
    cookies: [
      cookiePair(SESSION_COOKIE_NAME, journal.sessionId, journal.expiresAt),
      cookiePair(PROVISIONING_COOKIE_NAME, provisioning.sessionId, provisioning.expiresAt),
    ],
  }
}

function callbackRequest(state: string, code: string, cookieState: string, sessionCookies: string[] = []): Request {
  return new Request(`https://journal.example/api/auth/callback?code=${code}&state=${state}`, {
    headers: { Cookie: [`daily_journal_oauth_state=${cookieState}`, ...sessionCookies].join('; ') },
  })
}

function sessionRequest(name: string, sessionId: string, expiresAt: number): Request {
  return new Request('https://journal.example/api/session', {
    headers: { Cookie: cookiePair(name, sessionId, expiresAt) },
  })
}

function cookiePair(name: string, sessionId: string, expiresAt: number): string {
  return `${name}=${encryptSession({ sessionId, expiresAt }, config.sessionEncryptionKey)}`
}

function cookieValue(response: Response, name: string): string {
  const cookieHeader = response.headers.get('Set-Cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${name}=([^;]*)`))
  if (!match) throw new Error(`找不到 ${name} Cookie。`)
  return decodeURIComponent(match[1])
}

function expectClearedAuthenticationCookies(response: Response): void {
  const header = response.headers.get('Set-Cookie') ?? ''
  expect(header).toContain('daily_journal_oauth_state=;')
  expect(header).toContain(`${SESSION_COOKIE_NAME}=;`)
  expect(header).toContain(`${PROVISIONING_COOKIE_NAME}=;`)
}

function expectOnlyOAuthStateCookieCleared(response: Response): void {
  const header = response.headers.get('Set-Cookie') ?? ''
  expect(header).toContain('daily_journal_oauth_state=;')
  expect(header).not.toContain(`${SESSION_COOKIE_NAME}=;`)
  expect(header).not.toContain(`${PROVISIONING_COOKIE_NAME}=;`)
}

class FakeFirestore implements FirestoreAdapter {
  private readonly documents = new Map<string, Map<string, FirestoreData>>()
  private transactionActive = false

  collection(name: string): FirestoreCollectionReference {
    return new FakeCollectionReference(this, name, [])
  }

  batch(): FirestoreWriteBatch {
    return new FakeWriteBatch(this)
  }

  async runTransaction<T>(callback: (transaction: FirestoreTransaction) => Promise<T>): Promise<T> {
    if (this.transactionActive) throw new Error('FakeFirestore 不支援巢狀交易。')
    const transaction = new FakeTransaction(this)
    this.transactionActive = true
    try {
      const result = await callback(transaction)
      transaction.commit()
      return result
    } finally {
      this.transactionActive = false
    }
  }

  directDocument(collection: string, id: string, ref: FirestoreDocumentReference): FirestoreDocumentSnapshot {
    this.assertNoDirectReadInTransaction()
    return this.documentSnapshot(collection, id, ref)
  }

  documentSnapshot(collection: string, id: string, ref: FirestoreDocumentReference): FirestoreDocumentSnapshot {
    return new FakeDocumentSnapshot(this.documents.get(collection)?.get(id), ref)
  }

  directQuery(
    collection: string,
    filters: ReadonlyArray<{ field: string; op: FirestoreWhereOperator; value: unknown }>,
  ): FirestoreQuerySnapshot {
    this.assertNoDirectReadInTransaction()
    return this.querySnapshot(collection, filters)
  }

  querySnapshot(
    collection: string,
    filters: ReadonlyArray<{ field: string; op: FirestoreWhereOperator; value: unknown }>,
  ): FirestoreQuerySnapshot {
    const docs = [...(this.documents.get(collection) ?? new Map<string, FirestoreData>())]
      .filter(([, data]) => filters.every((filter) => matches(data[filter.field], filter)))
      .map(([id, data]) => new FakeQueryDocumentSnapshot(
        data,
        new FakeDocumentReference(this, collection, id),
      ))
    return new FakeQuerySnapshot(docs)
  }

  setDocument(collection: string, id: string, data: FirestoreData): void {
    const docs = this.documents.get(collection) ?? new Map<string, FirestoreData>()
    docs.set(id, clone(data))
    this.documents.set(collection, docs)
  }

  updateDocument(collection: string, id: string, data: FirestoreData): void {
    const current = this.documents.get(collection)?.get(id)
    if (!current) throw new Error(`找不到文件：${collection}/${id}`)
    Object.assign(current, clone(data))
  }

  deleteDocument(collection: string, id: string): void {
    this.documents.get(collection)?.delete(id)
  }

  document(collection: string, id: string): FirestoreData | undefined {
    const data = this.documents.get(collection)?.get(id)
    return data === undefined ? undefined : clone(data)
  }

  documentsIn(collection: string): FirestoreData[] {
    return [...(this.documents.get(collection)?.values() ?? [])].map((data) => clone(data))
  }

  private assertNoDirectReadInTransaction(): void {
    if (this.transactionActive) {
      throw new Error('交易中必須使用 transaction.get 讀取所有必要文件。')
    }
  }
}

class FakeDocumentReference implements FirestoreDocumentReference {
  constructor(
    private readonly firestore: FakeFirestore,
    readonly collection: string,
    readonly id: string,
  ) {}

  async get(): Promise<FirestoreDocumentSnapshot> {
    return this.firestore.directDocument(this.collection, this.id, this)
  }

  async set(data: FirestoreData): Promise<void> {
    this.firestore.setDocument(this.collection, this.id, data)
  }

  async update(data: FirestoreData): Promise<void> {
    this.firestore.updateDocument(this.collection, this.id, data)
  }

  async delete(): Promise<void> {
    this.firestore.deleteDocument(this.collection, this.id)
  }
}

class FakeDocumentSnapshot implements FirestoreDocumentSnapshot {
  constructor(
    private readonly value: FirestoreData | undefined,
    readonly ref: FirestoreDocumentReference,
  ) {}

  get exists(): boolean {
    return this.value !== undefined
  }

  data(): FirestoreData | undefined {
    return this.value === undefined ? undefined : clone(this.value)
  }
}

class FakeQueryDocumentSnapshot extends FakeDocumentSnapshot implements FirestoreQueryDocumentSnapshot {}

class FakeQuerySnapshot implements FirestoreQuerySnapshot {
  constructor(readonly docs: readonly FirestoreQueryDocumentSnapshot[]) {}

  get empty(): boolean {
    return this.docs.length === 0
  }

  get size(): number {
    return this.docs.length
  }
}

class FakeCollectionReference implements FirestoreCollectionReference {
  constructor(
    private readonly firestore: FakeFirestore,
    readonly name: string,
    readonly filters: ReadonlyArray<{ field: string; op: FirestoreWhereOperator; value: unknown }>,
  ) {}

  doc(id: string): FirestoreDocumentReference {
    return new FakeDocumentReference(this.firestore, this.name, id)
  }

  where(field: string, op: FirestoreWhereOperator, value: unknown): FirestoreQuery {
    return new FakeCollectionReference(this.firestore, this.name, [...this.filters, { field, op, value }])
  }

  async get(): Promise<FirestoreQuerySnapshot> {
    return this.firestore.directQuery(this.name, this.filters)
  }
}

class FakeTransaction implements FirestoreTransaction {
  private readonly operations: Array<() => void> = []
  private wrote = false

  constructor(private readonly firestore: FakeFirestore) {}

  get(reference: FirestoreDocumentReference): Promise<FirestoreDocumentSnapshot>
  get(query: FirestoreQuery): Promise<FirestoreQuerySnapshot>
  async get(
    target: FirestoreDocumentReference | FirestoreQuery,
  ): Promise<FirestoreDocumentSnapshot | FirestoreQuerySnapshot> {
    if (this.wrote) throw new Error('交易寫入後不得再讀取。')
    if (target instanceof FakeDocumentReference) {
      return this.firestore.documentSnapshot(target.collection, target.id, target)
    }
    if (target instanceof FakeCollectionReference) {
      return this.firestore.querySnapshot(target.name, target.filters)
    }
    throw new Error('不支援的 fake transaction 讀取目標。')
  }

  set(reference: FirestoreDocumentReference, data: FirestoreData): this {
    this.wrote = true
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.setDocument(target.collection, target.id, data))
    return this
  }

  update(reference: FirestoreDocumentReference, data: FirestoreData): this {
    this.wrote = true
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.updateDocument(target.collection, target.id, data))
    return this
  }

  delete(reference: FirestoreDocumentReference): this {
    this.wrote = true
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.deleteDocument(target.collection, target.id))
    return this
  }

  commit(): void {
    for (const operation of this.operations) operation()
  }
}

class FakeWriteBatch implements FirestoreWriteBatch {
  private readonly operations: Array<() => void> = []

  constructor(private readonly firestore: FakeFirestore) {}

  update(reference: FirestoreDocumentReference, data: FirestoreData): this {
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.updateDocument(target.collection, target.id, data))
    return this
  }

  delete(reference: FirestoreDocumentReference): this {
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.deleteDocument(target.collection, target.id))
    return this
  }

  async commit(): Promise<void> {
    for (const operation of this.operations) operation()
  }
}

function matches(value: unknown, filter: { op: FirestoreWhereOperator; value: unknown }): boolean {
  if (filter.op === '==') return value === filter.value
  return typeof value === 'number' && typeof filter.value === 'number' && value <= filter.value
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
