import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  ActiveSheetConnectionDocument,
  UserDocument,
} from './_lib/connection-store.js'
import {
  GoogleConnectionError,
  GoogleUpstreamError,
} from './_lib/google-drive.js'
import { InvalidRefreshTokenError, type GoogleCredentials } from './_lib/google-oauth.js'
import { RateLimitError } from './_lib/rate-limit.js'
import {
  createJournalRequestContextResolver,
} from './_lib/journal-request-context.js'
import type { ServerConfig } from './_lib/server-config.js'
import type { SessionDocument } from './_lib/session-store.js'
import { encryptSession } from './_lib/session-crypto.js'
import { encryptRefreshToken } from './_lib/token-crypto.js'
import { JournalError } from '../shared/journal/errors.js'
import type { ApiResponse } from '../shared/journal/types.js'
import { GET, createJournalHandler } from './journal.js'

const config: ServerConfig = {
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  appOrigin: 'https://journal.example',
  sessionEncryptionKey: Buffer.alloc(32, 9),
  tokenEncryptionKey: Buffer.alloc(32, 8),
  tokenEncryptionKeyVersion: 'current-key',
  firestoreProjectId: 'journal-test',
  firestoreCredentials: {
    clientEmail: 'journal-api@journal-test.iam.gserviceaccount.com',
    privateKey: 'private-key',
  },
  legacyMigrationSecret: 'm'.repeat(32),
  cronSecret: 'c'.repeat(32),
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('/api/journal', () => {
  test('只接受 JSON object，並拒絕前端提供的帳號、Sheet 或 token 識別欄位', async () => {
    const system = createSystem()

    for (const body of [
      null,
      ['not-an-object'],
      { action: 'bootstrap', userId: 'bob' },
      { action: 'bootstrap', user_id: 'bob' },
      { action: 'bootstrap', user: 'bob' },
      { action: 'bootstrap', googleSub: 'google-bob' },
      { action: 'bootstrap', googleUserId: 'google-bob' },
      { action: 'bootstrap', google_user_id: 'google-bob' },
      { action: 'bootstrap', google: 'google-bob' },
      { action: 'bootstrap', spreadsheetId: 'sheet-bob' },
      { action: 'bootstrap', sheetId: 'sheet-bob' },
      { action: 'bootstrap', sheet_id: 'sheet-bob' },
      { action: 'bootstrap', sheet: 'sheet-bob' },
      { action: 'bootstrap', ownerId: 'bob' },
      { action: 'bootstrap', owner_id: 'bob' },
      { action: 'bootstrap', email: 'bob@example.com' },
      { action: 'bootstrap', sub: 'google-bob' },
      { action: 'bootstrap', connection: 'connection-bob' },
      { action: 'bootstrap', connection_id: 'connection-bob' },
      { action: 'bootstrap', session: 'session-bob' },
      { action: 'bootstrap', session_id: 'session-bob' },
      { action: 'bootstrap', token: 'attacker-token' },
      { action: 'bootstrap', access_token: 'attacker-token' },
      { action: 'bootstrap', refreshToken: 'attacker-refresh-token' },
      { action: 'bootstrap', filter: { spreadsheet_id: 'sheet-bob' } },
    ]) {
      const response = await system.handler(journalRequest('session-alice', body))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'invalid_request' })
    }

    expect(system.sessionStore.resolveJournalSession).not.toHaveBeenCalled()
    expect(system.journalStoreFactory).not.toHaveBeenCalled()

    const validResponse = await system.handler(journalRequest('session-alice', {
      action: 'saveEntry',
      entry: {
        id: 'entry-1',
        entryDate: '2026-08-20',
        title: '合法記事',
        content: '內容',
        categoryId: 'category-1',
        tags: ['工作'],
        links: [{ label: '參考', url: 'https://example.com' }],
      },
    }))
    expect(validResponse.status).toBe(200)
  })

  test('資料來源一律由目前 session 的作用中連線決定，且不呼叫 GAS', async () => {
    const system = createSystem()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const attackerResponse = await system.handler(journalRequest('session-alice', {
      action: 'bootstrap',
      spreadsheetId: 'sheet-bob',
    }))
    const aliceResponse = await system.handler(journalRequest('session-alice', { action: 'bootstrap' }))
    const bobResponse = await system.handler(journalRequest('session-bob', { action: 'bootstrap' }))

    expect(attackerResponse.status).toBe(400)
    await expect(aliceResponse.json()).resolves.toEqual({ ok: true, data: { owner: 'alice' } })
    await expect(bobResponse.json()).resolves.toEqual({ ok: true, data: { owner: 'bob' } })
    expect(system.aliceStore.execute).toHaveBeenCalledTimes(1)
    expect(system.bobStore.execute).toHaveBeenCalledTimes(1)
    expect(system.journalStoreFactory.mock.calls.map(([context]) => context.connection.spreadsheetId))
      .toEqual(['sheet-alice', 'sheet-bob'])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(`${fetchMock.mock.calls}`).not.toContain('script.googleapis.com')
  })

  test('refresh token 失效且 token 仍是目前版本時，撤銷本站 session、標記連線並清除兩種 session Cookie', async () => {
    const refreshGoogleCredentials = vi.fn(async () => {
      throw new InvalidRefreshTokenError()
    })
    const system = createSystem({ refreshGoogleCredentials })

    const response = await system.handler(journalRequest('session-alice', { action: 'bootstrap' }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(system.sessionStore.revokeSession).toHaveBeenCalledWith('session-alice')
    expect(system.connections.markConnectionNeedsReconnectIfCurrent).toHaveBeenCalledWith(
      'connection-alice',
      system.aliceConnection.encryptedRefreshToken,
    )
    expect(system.connections.markConnectionNeedsReconnect).not.toHaveBeenCalled()
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=;')
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_provisioning=;')
    expect(system.journalStoreFactory).not.toHaveBeenCalled()
  })

  test('refresh 失效與重新授權交錯時，不會清除新 token 或撤銷 session', async () => {
    const refreshGoogleCredentials = vi.fn(async () => {
      throw new InvalidRefreshTokenError()
    })
    const system = createSystem({ refreshGoogleCredentials })
    system.connections.markConnectionNeedsReconnectIfCurrent.mockResolvedValueOnce(false)

    const response = await system.handler(journalRequest('session-alice', { action: 'bootstrap' }))

    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload).toMatchObject({
      ok: false,
      code: 'CONFLICT',
      message: expect.stringContaining('重新整理'),
    })
    expect(JSON.stringify(payload)).not.toContain('sheet-alice')
    expect(JSON.stringify(payload)).not.toContain('refresh-alice')
    expect(system.connections.markConnectionNeedsReconnectIfCurrent).toHaveBeenCalledWith(
      'connection-alice',
      system.aliceConnection.encryptedRefreshToken,
    )
    expect(system.sessionStore.revokeSession).not.toHaveBeenCalled()
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  test('refresh replacement token 的條件寫入失敗時回衝突且保留 session', async () => {
    const system = createSystem({
      refreshGoogleCredentials: async () => ({
        accessToken: 'server-access-token',
        refreshToken: 'stale-replacement-token',
        scopes: [],
      }),
    })
    system.connections.updateEncryptedTokenIfCurrent.mockResolvedValueOnce(false)

    const response = await system.handler(journalRequest('session-alice', { action: 'bootstrap' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'CONFLICT',
      message: expect.stringContaining('重新整理'),
    })
    expect(system.sessionStore.revokeSession).not.toHaveBeenCalled()
    expect(system.connections.markConnectionNeedsReconnectIfCurrent).not.toHaveBeenCalled()
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  test('Google 401/403 類型的連線錯誤也會使目前連線失效', async () => {
    const system = createSystem()
    system.aliceStore.execute.mockRejectedValueOnce(new GoogleConnectionError())

    const response = await system.handler(journalRequest('session-alice', { action: 'bootstrap' }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(system.sessionStore.revokeSession).toHaveBeenCalledWith('session-alice')
    expect(system.connections.markConnectionNeedsReconnect).toHaveBeenCalledWith('connection-alice')
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=;')
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_provisioning=;')
  })

  test('讀取不取得 lease，寫入則在 lease 內載入、執行與 flush store', async () => {
    const system = createSystem()
    system.aliceStore.execute.mockResolvedValueOnce({ ok: true, data: { owner: 'alice' } })

    const readResponse = await system.handler(journalRequest('session-alice', { action: 'bootstrap' }))

    const calls: string[] = []
    system.connections.withSheetWriteLease.mockImplementationOnce(async (_connectionId, execute) => {
      calls.push('lease-acquired')
      const result = await execute()
      calls.push('lease-released')
      return result
    })
    system.journalStoreFactory.mockImplementationOnce(async () => {
      calls.push('store-loaded')
      return system.aliceStore
    })
    system.aliceStore.execute.mockImplementationOnce(async () => {
      calls.push('store-executed-and-flushed')
      return { ok: true, data: { id: 'category-alice' } }
    })
    const writeResponse = await system.handler(journalRequest('session-alice', {
      action: 'saveCategory',
      category: { name: '工作' },
    }))

    expect(readResponse.status).toBe(200)
    await expect(readResponse.json()).resolves.toEqual({ ok: true, data: { owner: 'alice' } })
    expect(writeResponse.status).toBe(200)
    await expect(writeResponse.json()).resolves.toEqual({ ok: true, data: { id: 'category-alice' } })
    expect(system.connections.withSheetWriteLease).toHaveBeenCalledTimes(1)
    expect(system.connections.withSheetWriteLease).toHaveBeenCalledWith(
      'connection-alice',
      expect.any(Function),
    )
    expect(calls).toEqual([
      'lease-acquired',
      'store-loaded',
      'store-executed-and-flushed',
      'lease-released',
    ])
  })

  test('schema、lease 與 journal 輸入錯誤回傳安全的 4xx/409 ApiResponse', async () => {
    const system = createSystem()
    system.journalStoreFactory.mockRejectedValueOnce(new JournalError('DATA_ERROR', '資料表 schema 不支援。'))

    const schemaResponse = await system.handler(journalRequest('session-alice', { action: 'bootstrap' }))
    expect(schemaResponse.status).toBe(422)
    await expect(schemaResponse.json()).resolves.toEqual({
      ok: false,
      code: 'DATA_ERROR',
      message: '資料表 schema 不支援。',
    })

    system.aliceStore.execute.mockResolvedValueOnce({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: '請輸入分類名稱。',
    })
    const inputResponse = await system.handler(journalRequest('session-alice', {
      action: 'saveCategory',
      category: { name: '' },
    }))
    expect(inputResponse.status).toBe(400)
    await expect(inputResponse.json()).resolves.toEqual({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: '請輸入分類名稱。',
    })

    system.connections.withSheetWriteLease.mockRejectedValueOnce(
      new Error('目前有另一項操作正在儲存至 Google Sheet，請稍後再試。'),
    )
    const factoryCallsBeforeLeaseFailure = system.journalStoreFactory.mock.calls.length
    const leaseResponse = await system.handler(journalRequest('session-alice', {
      action: 'saveCategory',
      category: { name: '生活' },
    }))
    expect(leaseResponse.status).toBe(409)
    await expect(leaseResponse.json()).resolves.toMatchObject({ ok: false, code: 'CONFLICT' })
    expect(system.journalStoreFactory.mock.calls).toHaveLength(factoryCallsBeforeLeaseFailure)

    system.connections.withSheetWriteLease.mockRejectedValueOnce(
      new Error('資料表寫入 lease 已遺失。'),
    )
    const unknownWriteResponse = await system.handler(journalRequest('session-alice', {
      action: 'saveCategory',
      category: { name: '健康' },
    }))
    expect(unknownWriteResponse.status).toBe(409)
    await expect(unknownWriteResponse.json()).resolves.toEqual({
      ok: false,
      code: 'CONFLICT',
      message: '資料表寫入結果可能未知，請先重新載入確認後再繼續。',
    })
    expect(unknownWriteResponse.headers.get('Set-Cookie')).toBeNull()
    expect(system.sessionStore.revokeSession).not.toHaveBeenCalled()
    expect(system.journalStoreFactory.mock.calls).toHaveLength(factoryCallsBeforeLeaseFailure)
  })

  test('Google 429、5xx 或網路上游錯誤回 502 且保留有效 session', async () => {
    const system = createSystem()
    system.aliceStore.execute.mockRejectedValueOnce(new GoogleUpstreamError())

    const response = await system.handler(journalRequest('session-alice', { action: 'bootstrap' }))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'upstream_failure' })
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(system.sessionStore.revokeSession).not.toHaveBeenCalled()
    expect(system.connections.markConnectionNeedsReconnect).not.toHaveBeenCalled()
  })

  test('mutation 必須使用 JSON media type，且帶 Origin 時只接受 APP_ORIGIN', async () => {
    const system = createSystem()
    const body = { action: 'saveCategory', category: { name: '工作' } }

    const unsupportedMediaType = await system.handler(journalRequest('session-alice', body, {
      contentType: 'text/plain',
    }))
    expect(unsupportedMediaType.status).toBe(415)
    await expect(unsupportedMediaType.json()).resolves.toEqual({ error: 'unsupported_media_type' })
    expect(system.sessionStore.resolveJournalSession).not.toHaveBeenCalled()

    const missingMediaType = await system.handler(journalRequest('session-alice', body, {
      contentType: null,
    }))
    expect(missingMediaType.status).toBe(415)
    await expect(missingMediaType.json()).resolves.toEqual({ error: 'unsupported_media_type' })

    const crossOrigin = await system.handler(journalRequest('session-alice', body, {
      origin: 'https://attacker.example',
    }))
    expect(crossOrigin.status).toBe(403)
    await expect(crossOrigin.json()).resolves.toEqual({ error: 'forbidden' })
    expect(system.connections.withSheetWriteLease).not.toHaveBeenCalled()
    expect(system.journalStoreFactory).not.toHaveBeenCalled()

    const allowedOrigin = await system.handler(journalRequest('session-alice', body, {
      contentType: 'application/json; charset=utf-8',
      origin: config.appOrigin,
    }))
    expect(allowedOrigin.status).toBe(200)
  })

  test('mutation 依使用者套用 journalWrites 限流，達限時不載入 store 或取得 lease', async () => {
    const system = createSystem()
    system.rateLimiter.consume.mockRejectedValueOnce(new RateLimitError())

    const response = await system.handler(journalRequest('session-alice', {
      action: 'saveCategory',
      category: { name: '工作' },
    }))

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' })
    expect(system.rateLimiter.consume).toHaveBeenCalledWith({
      scope: 'journal_write',
      subject: 'alice',
      limit: 60,
      windowMs: 60_000,
    })
    expect(system.connections.withSheetWriteLease).not.toHaveBeenCalled()
    expect(system.journalStoreFactory).not.toHaveBeenCalled()
  })

  test('只有有效 provisioning session 時回 provisioning_required，且不清除其 cookie 或撤銷 server session', async () => {
    const system = createSystem()

    const response = await system.handler(provisioningRequest('provisioning-alice', {
      action: 'bootstrap',
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'provisioning_required' })
    expect(system.sessionStore.resolveProvisioningSession).toHaveBeenCalledWith('provisioning-alice')
    expect(system.sessionStore.revokeSession).not.toHaveBeenCalled()
    expect(system.journalStoreFactory).not.toHaveBeenCalled()
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  test('無效 journal session 仍回 401 並清除兩種 session cookie', async () => {
    const system = createSystem()

    const response = await system.handler(journalRequest('missing-session', { action: 'bootstrap' }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=;')
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_provisioning=;')
  })

  test('GET 維持 POST-only guard', () => {
    expect(GET().status).toBe(405)
    expect(GET().headers.get('Allow')).toBe('POST')
  })
})

type FakeJournalStore = {
  execute: ReturnType<typeof vi.fn<(request: unknown) => Promise<ApiResponse<unknown>>>>
}

function createSystem(options: {
  refreshGoogleCredentials?: (refreshToken: string) => Promise<GoogleCredentials>
} = {}) {
  const now = Date.now()
  const alice = user('alice')
  const bob = user('bob')
  const aliceConnection = connection(alice.id, 'sheet-alice', 'refresh-alice')
  const bobConnection = connection(bob.id, 'sheet-bob', 'refresh-bob')
  const sessions = new Map<string, SessionDocument>([
    ['session-alice', session('session-alice', alice.id, now)],
    ['session-bob', session('session-bob', bob.id, now)],
  ])
  const provisioningSessions = new Map<string, SessionDocument>([
    ['provisioning-alice', session('provisioning-alice', alice.id, now, 'provisioning')],
  ])
  const users = new Map<string, UserDocument>([
    [alice.id, alice],
    [bob.id, bob],
  ])
  const activeConnections = new Map<string, ActiveSheetConnectionDocument>([
    [alice.id, aliceConnection],
    [bob.id, bobConnection],
  ])
  const sessionStore = {
    resolveJournalSession: vi.fn(async (sessionId: string) => sessions.get(sessionId)),
    resolveProvisioningSession: vi.fn(async (sessionId: string) => provisioningSessions.get(sessionId)),
    revokeSession: vi.fn(async (_sessionId: string) => undefined),
  }
  const withSheetWriteLease = vi.fn(async <T>(
    _connectionId: string,
    execute: () => T | Promise<T>,
  ): Promise<T> => await execute())
  const connections = {
    getUserById: vi.fn(async (userId: string) => users.get(userId)),
    findActiveConnection: vi.fn(async (userId: string) => activeConnections.get(userId)),
    updateEncryptedToken: vi.fn(async () => undefined),
    updateEncryptedTokenIfCurrent: vi.fn(async () => true),
    markConnectionNeedsReconnect: vi.fn(async () => undefined),
    markConnectionNeedsReconnectIfCurrent: vi.fn(async () => true),
    withSheetWriteLease,
  }
  const rateLimiter = {
    consume: vi.fn(async () => undefined),
  }
  const refreshGoogleCredentials = options.refreshGoogleCredentials
    ?? vi.fn(async () => ({ accessToken: 'server-access-token', scopes: [] }))
  const aliceStore: FakeJournalStore = {
    execute: vi.fn(async () => ({ ok: true, data: { owner: 'alice' } })),
  }
  const bobStore: FakeJournalStore = {
    execute: vi.fn(async () => ({ ok: true, data: { owner: 'bob' } })),
  }
  const journalStoreFactory = vi.fn(async (context: { connection: ActiveSheetConnectionDocument }) => {
    const store = context.connection.spreadsheetId === 'sheet-alice' ? aliceStore : bobStore
    return store
  })
  const requireJournalRequestContext = createJournalRequestContextResolver({
    config,
    sessionStore,
    connections,
    refreshGoogleCredentials,
  })
  const handler = createJournalHandler({
    config,
    requireJournalRequestContext,
    sessionStore,
    connections,
    rateLimiter,
    createJournalStore: journalStoreFactory,
  })

  return {
    handler,
    sessionStore,
    connections,
    rateLimiter,
    aliceStore,
    bobStore,
    journalStoreFactory,
    aliceConnection,
  }
}

function journalRequest(
  sessionId: string,
  body: unknown,
  options: { contentType?: string | null; origin?: string } = {},
): Request {
  const encryptedSession = encryptSession({
    sessionId,
    expiresAt: Date.now() + 60_000,
  }, config.sessionEncryptionKey)
  const headers: Record<string, string> = {
    Cookie: `daily_journal_session=${encryptedSession}`,
  }
  if (options.contentType !== null) headers['Content-Type'] = options.contentType ?? 'application/json'
  if (options.origin) headers.Origin = options.origin
  return new Request('https://journal.example/api/journal', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function provisioningRequest(sessionId: string, body: unknown): Request {
  const encryptedSession = encryptSession({
    sessionId,
    expiresAt: Date.now() + 60_000,
  }, config.sessionEncryptionKey)
  return new Request('https://journal.example/api/journal', {
    method: 'POST',
    headers: {
      Cookie: `daily_journal_provisioning=${encryptedSession}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function user(id: string): UserDocument {
  return {
    id,
    googleSub: `google-${id}`,
    email: `${id}@example.com`,
    name: id,
    picture: '',
    createdAt: 1,
    updatedAt: 1,
  }
}

function connection(
  userId: string,
  spreadsheetId: string,
  refreshToken: string,
): ActiveSheetConnectionDocument {
  return {
    id: `connection-${userId}`,
    userId,
    spreadsheetId,
    spreadsheetName: `${userId} journal`,
    encryptedRefreshToken: encryptRefreshToken(refreshToken, config.tokenEncryptionKey, config.tokenEncryptionKeyVersion),
    scopes: [],
    status: 'active',
    connectionVersion: 1,
    createdByService: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

function session(
  sessionId: string,
  userId: string,
  now: number,
  kind: SessionDocument['kind'] = 'journal',
): SessionDocument {
  return {
    sessionId,
    userId,
    kind,
    expiresAt: now + 60_000,
    createdAt: now,
    lastUsedAt: now,
    revokedAt: null,
    provisioningAttemptId: kind === 'provisioning' ? 'attempt-alice' : null,
  }
}
