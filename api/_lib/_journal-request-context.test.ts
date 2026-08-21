import { describe, expect, test, vi } from 'vitest'
import type {
  ActiveSheetConnectionDocument,
  UserDocument,
} from './connection-store.js'
import { InvalidRefreshTokenError, type GoogleCredentials } from './google-oauth.js'
import {
  JournalRequestContextAuthenticationError,
  JournalRequestContextConfigurationError,
  JournalRequestContextConflictError,
  createJournalRequestContextResolver,
} from './journal-request-context.js'
import type { ServerConfig } from './server-config.js'
import type { SessionDocument } from './session-store.js'
import { encryptSession } from './session-crypto.js'
import { decryptRefreshToken, encryptRefreshToken } from './token-crypto.js'

const config: ServerConfig = {
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  appOrigin: 'https://journal.example',
  sessionEncryptionKey: Buffer.alloc(32, 5),
  tokenEncryptionKey: Buffer.alloc(32, 6),
  tokenEncryptionKeyVersion: 'current-key',
  firestoreProjectId: 'journal-test',
  firestoreCredentials: {
    clientEmail: 'journal-api@journal-test.iam.gserviceaccount.com',
    privateKey: 'private-key',
  },
  legacyMigrationSecret: 'm'.repeat(32),
  cronSecret: 'c'.repeat(32),
}

describe('journal request context', () => {
  test('從不透明 journal Cookie 解析 session、使用者與其作用中連線，且只保留 request 記憶體 access token', async () => {
    const system = createSystem()

    const context = await system.resolver(journalRequest('session-alice'))

    expect(context).toMatchObject({
      session: { sessionId: 'session-alice', userId: 'alice' },
      user: { id: 'alice' },
      connection: { id: 'connection-alice', spreadsheetId: 'sheet-alice' },
      accessToken: 'access-alice',
    })
    expect(system.sessionStore.resolveJournalSession).toHaveBeenCalledWith('session-alice')
    expect(system.connections.getUserById).toHaveBeenCalledWith('alice')
    expect(system.connections.findActiveConnection).toHaveBeenCalledWith('alice')
    expect(system.refreshGoogleCredentials).toHaveBeenCalledWith(
      'refresh-alice',
      config,
    )
    expect(JSON.stringify(context)).not.toContain('refresh-alice')
  })

  test('拒絕與 session 使用者不相符的 active connection，不會採用另一個帳號的 Sheet', async () => {
    const system = createSystem()
    system.connections.findActiveConnection.mockResolvedValueOnce(system.bobConnection)

    await expect(system.resolver(journalRequest('session-alice')))
      .rejects.toBeInstanceOf(JournalRequestContextAuthenticationError)
    expect(system.refreshGoogleCredentials).not.toHaveBeenCalled()
  })

  test('refresh 回傳 replacement token 與明確 scopes 時，以 connectionVersion CAS 同交易更新作用中連線', async () => {
    const system = createSystem({
      refreshGoogleCredentials: async () => ({
        accessToken: 'access-alice',
        refreshToken: 'replacement-refresh-token',
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      }),
    })

    const context = await system.resolver(journalRequest('session-alice'))

    expect(context.accessToken).toBe('access-alice')
    expect(system.connections.updateActiveConnectionCredentialsIfCurrent).toHaveBeenCalledTimes(1)
    const [input] = system.connections.updateActiveConnectionCredentialsIfCurrent.mock.calls[0]
    expect(input).toMatchObject({
      userId: 'alice',
      connectionId: 'connection-alice',
      expectedConnectionVersion: 1,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    expect(input.encryptedRefreshToken).toMatchObject({ keyVersion: 'current-key' })
    expect(decryptRefreshToken(input.encryptedRefreshToken, config.tokenEncryptionKey))
      .toBe('replacement-refresh-token')
  })

  test('refresh 與重新授權交錯時，connectionVersion CAS 失敗會回可安全重試的衝突', async () => {
    const system = createSystem({
      refreshGoogleCredentials: async () => ({
        accessToken: 'access-alice',
        refreshToken: 'stale-replacement-token',
        scopes: [],
      }),
    })
    system.connections.updateActiveConnectionCredentialsIfCurrent.mockResolvedValueOnce(undefined)

    await expect(system.resolver(journalRequest('session-alice')))
      .rejects.toBeInstanceOf(JournalRequestContextConflictError)
    expect(system.connections.updateActiveConnectionCredentialsIfCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'connection-alice',
        expectedConnectionVersion: system.aliceConnection.connectionVersion,
        scopes: [],
      }),
    )
  })

  test('缺少 scope 且沒有 replacement token 時不會將既有授權 scope 寫成空陣列', async () => {
    const system = createSystem({
      refreshGoogleCredentials: async () => ({ accessToken: 'access-alice' }),
    })
    system.aliceConnection.scopes = ['https://www.googleapis.com/auth/spreadsheets']

    await expect(system.resolver(journalRequest('session-alice'))).resolves.toMatchObject({
      accessToken: 'access-alice',
    })

    expect(system.connections.updateActiveConnectionCredentialsIfCurrent).not.toHaveBeenCalled()
    expect(system.aliceConnection.scopes).toEqual(['https://www.googleapis.com/auth/spreadsheets'])
  })

  test('未知 token key version 回安全設定錯誤，且不更新連線或撤銷 session', async () => {
    const system = createSystem()
    system.aliceConnection.encryptedRefreshToken = {
      ciphertext: 'unavailable-ciphertext',
      keyVersion: 'retired-key',
    }

    try {
      await system.resolver(journalRequest('session-alice'))
      throw new Error('預期 resolver 拒絕未知 token key version。')
    } catch (error) {
      expect(error).toBeInstanceOf(JournalRequestContextConfigurationError)
      expect(JSON.stringify(error)).not.toContain('unavailable-ciphertext')
      expect(JSON.stringify(error)).not.toContain('sheet-alice')
    }
    expect(system.refreshGoogleCredentials).not.toHaveBeenCalled()
    expect(system.connections.updateActiveConnectionCredentialsIfCurrent).not.toHaveBeenCalled()
    expect(system.sessions.get('session-alice')).toMatchObject({ revokedAt: null })
    expect(system.aliceConnection).toMatchObject({
      status: 'active',
      encryptedRefreshToken: { ciphertext: 'unavailable-ciphertext', keyVersion: 'retired-key' },
    })
  })

  test('失效 refresh token 會附帶目前 session 與 connection 供 route 安全撤銷', async () => {
    const refreshGoogleCredentials = vi.fn(async () => {
      throw new InvalidRefreshTokenError()
    })
    const system = createSystem({ refreshGoogleCredentials })

    try {
      await system.resolver(journalRequest('session-alice'))
      throw new Error('預期 resolver 拒絕失效 refresh token。')
    } catch (error) {
      expect(error).toBeInstanceOf(JournalRequestContextAuthenticationError)
      expect(error).toMatchObject({
        sessionId: 'session-alice',
        connectionId: 'connection-alice',
      })
      if (error instanceof JournalRequestContextAuthenticationError) {
        expect(error.expectedEncryptedRefreshToken).toEqual(system.aliceConnection.encryptedRefreshToken)
        expect(JSON.stringify(error)).not.toContain(system.aliceConnection.encryptedRefreshToken.ciphertext)
      }
    }
    expect(system.connections.updateEncryptedTokenIfCurrent).not.toHaveBeenCalled()
  })
})

function createSystem(options: {
  refreshGoogleCredentials?: (refreshToken: string) => Promise<GoogleCredentials>
  useDefaultRefreshHelper?: boolean
} = {}) {
  const now = Date.now()
  const alice = user('alice')
  const bob = user('bob')
  const aliceConnection = connection(alice.id, 'sheet-alice', 'refresh-alice')
  const bobConnection = connection(bob.id, 'sheet-bob', 'refresh-bob')
  const sessions = new Map<string, SessionDocument>([
    ['session-alice', session('session-alice', alice.id, now)],
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
    resolveProvisioningSession: vi.fn(async () => undefined),
  }
  const connections = {
    getUserById: vi.fn(async (userId: string) => users.get(userId)),
    findActiveConnection: vi.fn(async (userId: string) => activeConnections.get(userId)),
    updateEncryptedToken: vi.fn(async () => undefined),
    updateEncryptedTokenIfCurrent: vi.fn(async () => true),
    updateActiveConnectionCredentialsIfCurrent: vi.fn(async () => aliceConnection),
  }
  const refreshGoogleCredentials = options.refreshGoogleCredentials
    ?? vi.fn(async () => ({ accessToken: 'access-alice', scopes: [] }))
  const resolver = createJournalRequestContextResolver({
    config,
    sessionStore,
    connections,
    ...(!options.useDefaultRefreshHelper ? { refreshGoogleCredentials } : {}),
  })

  return {
    resolver,
    sessionStore,
    connections,
    sessions,
    refreshGoogleCredentials,
    bobConnection,
    aliceConnection,
  }
}

function journalRequest(sessionId: string): Request {
  const encryptedSession = encryptSession({
    sessionId,
    expiresAt: Date.now() + 60_000,
  }, config.sessionEncryptionKey)
  return new Request('https://journal.example/api/journal', {
    headers: { Cookie: `daily_journal_session=${encryptedSession}` },
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

function session(sessionId: string, userId: string, now: number): SessionDocument {
  return {
    sessionId,
    userId,
    kind: 'journal',
    expiresAt: now + 60_000,
    createdAt: now,
    lastUsedAt: now,
    revokedAt: null,
    provisioningAttemptId: null,
  }
}
