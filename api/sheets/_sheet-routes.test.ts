import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as candidatesGet } from './candidates'
import { POST as selectPost } from './select'
import { POST as createPost } from './create'
import { POST as switchPost } from './switch'
import { POST as repairPost } from './repair'
import { createFakeFirestore } from '../_lib/test-firestore'
import * as firestoreModule from '../_lib/firestore'
import { SessionStore } from '../_lib/session-store'
import { ConnectionStore } from '../_lib/connection-store'
import { encryptSession } from '../_lib/session-crypto'
import { encryptRefreshToken } from '../_lib/token-crypto'

const sessionKey = Buffer.alloc(32, 5)
const tokenKey = Buffer.alloc(32, 6)
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

describe('Sheet management routes', () => {
  test('GET /api/sheets/candidates 列出候選試算表', async () => {
    const { sessionCookie } = await setupProvisioningUser()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'token' }))
      }
      if (url.includes('/drive/v3/files')) {
        return new Response(JSON.stringify({
          files: [
            { id: 'sheet-1', name: '我的日記', modifiedTime: '2026-08-19T00:00:00Z' },
          ],
        }))
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await candidatesGet(new Request('https://journal.example/api/sheets/candidates', {
      headers: { Cookie: `daily_journal_provisioning=${sessionCookie}` },
    }))

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.items).toEqual([{ id: 'sheet-1', name: '我的日記', modifiedTime: '2026-08-19T00:00:00Z' }])
  })

  test('POST /api/sheets/select 成功連結合法試算表並轉換為正式工作階段', async () => {
    const { sessionCookie } = await setupProvisioningUser()

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'token' }))
      }
      if (url.includes('/values:batchGet')) {
        return new Response(JSON.stringify({
          valueRanges: [
            { range: 'entries!A1:I1', values: [['id', 'entryDate', 'title', 'content', 'categoryId', 'tags', 'links', 'createdAt', 'updatedAt']] },
            { range: 'categories!A1:E1', values: [['id', 'name', 'isActive', 'createdAt', 'updatedAt']] },
            { range: 'settings!A1:B', values: [['key', 'value'], ['schemaVersion', '1']] },
          ],
        }))
      }
      return new Response(JSON.stringify({
        spreadsheetId: 'sheet-1',
        properties: { title: '我的日記' },
        sheets: [
          { properties: { sheetId: 0, title: 'entries' } },
          { properties: { sheetId: 1, title: 'categories' } },
          { properties: { sheetId: 2, title: 'settings' } },
        ],
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await selectPost(new Request('https://journal.example/api/sheets/select', {
      method: 'POST',
      headers: {
        Cookie: `daily_journal_provisioning=${sessionCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ spreadsheetId: 'sheet-1', spreadsheetName: '我的日記' }),
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=')
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_provisioning=;')
    const result = await response.json()
    expect(result.ok).toBe(true)
    expect(result.connection.spreadsheetId).toBe('sheet-1')
  })

  test('POST /api/sheets/select 結構不合時拒絕綁定', async () => {
    const { sessionCookie } = await setupProvisioningUser()

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'token' }))
      }
      return new Response(JSON.stringify({
        spreadsheetId: 'sheet-broken',
        properties: { title: '空表格' },
        sheets: [],
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await selectPost(new Request('https://journal.example/api/sheets/select', {
      method: 'POST',
      headers: {
        Cookie: `daily_journal_provisioning=${sessionCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ spreadsheetId: 'sheet-broken' }),
    }))

    expect(response.status).toBe(400)
    const result = await response.json()
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('SCHEMA_MISMATCH')
  })

  test('POST /api/sheets/create 建立並初始化新試算表', async () => {
    const { sessionCookie } = await setupProvisioningUser()

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'token' }))
      }
      if (url.includes('/values:batchGet')) {
        return new Response(JSON.stringify({ valueRanges: [] }))
      }
      if (url.includes('/spreadsheets') && !url.includes('values') && !url.includes(':batchUpdate')) {
        return new Response(JSON.stringify({
          spreadsheetId: 'new-sheet-id',
          properties: { title: '我的新日記' },
          sheets: [
            { properties: { sheetId: 0, title: 'entries' } },
            { properties: { sheetId: 1, title: 'categories' } },
            { properties: { sheetId: 2, title: 'settings' } },
          ],
        }))
      }
      return new Response(JSON.stringify({}))
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await createPost(new Request('https://journal.example/api/sheets/create', {
      method: 'POST',
      headers: {
        Cookie: `daily_journal_provisioning=${sessionCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '我的新日記' }),
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=')
    const result = await response.json()
    expect(result.ok).toBe(true)
    expect(result.connection.spreadsheetId).toBe('new-sheet-id')
  })

  test('POST /api/sheets/switch 切換至其他試算表並封存原連線', async () => {
    const { sessionCookie } = await setupJournalUser()

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'token' }))
      }
      if (url.includes('/values:batchGet')) {
        return new Response(JSON.stringify({
          valueRanges: [
            { range: 'entries!A1:I1', values: [['id', 'entryDate', 'title', 'content', 'categoryId', 'tags', 'links', 'createdAt', 'updatedAt']] },
            { range: 'categories!A1:E1', values: [['id', 'name', 'isActive', 'createdAt', 'updatedAt']] },
            { range: 'settings!A1:B', values: [['key', 'value'], ['schemaVersion', '1']] },
          ],
        }))
      }
      return new Response(JSON.stringify({
        spreadsheetId: 'target-sheet',
        properties: { title: '目標日記' },
        sheets: [
          { properties: { sheetId: 0, title: 'entries' } },
          { properties: { sheetId: 1, title: 'categories' } },
          { properties: { sheetId: 2, title: 'settings' } },
        ],
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await switchPost(new Request('https://journal.example/api/sheets/switch', {
      method: 'POST',
      headers: {
        Cookie: `daily_journal_session=${sessionCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetSpreadsheetId: 'target-sheet',
        targetSpreadsheetName: '目標日記',
        expectedOriginalVersion: 1,
      }),
    }))

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.ok).toBe(true)
    expect(result.connection.spreadsheetId).toBe('target-sheet')
  })

  test('POST /api/sheets/repair 修復現有試算表結構', async () => {
    const { sessionCookie } = await setupJournalUser()

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'token' }))
      }
      if (url.includes('/values:batchGet')) {
        return new Response(JSON.stringify({ valueRanges: [] }))
      }
      return new Response(JSON.stringify({
        spreadsheetId: 'sheet-123',
        properties: { title: '我的日記' },
        sheets: [
          { properties: { sheetId: 0, title: 'entries' } },
          { properties: { sheetId: 1, title: 'categories' } },
          { properties: { sheetId: 2, title: 'settings' } },
        ],
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await repairPost(new Request('https://journal.example/api/sheets/repair', {
      method: 'POST',
      headers: {
        Cookie: `daily_journal_session=${sessionCookie}`,
      },
    }))

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.ok).toBe(true)
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
    client_email: 'api@journal-production.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
  }))
  vi.stubEnv('LEGACY_MIGRATION_SECRET', 'm'.repeat(32))
  vi.stubEnv('CRON_SECRET', 'c'.repeat(32))
}

async function setupProvisioningUser(): Promise<{ userId: string; sessionCookie: string }> {
  const connStore = new ConnectionStore(fakeFirestore)
  const sessionStore = new SessionStore(fakeFirestore)

  const user = await connStore.getOrCreateUser({
    googleSub: 'prov-sub-123',
    email: 'prov@example.com',
    name: 'Prov User',
    picture: '',
  })

  const encryptedRefreshToken = encryptRefreshToken('valid-refresh-token', tokenKey, 'v1')
  const attempt = await connStore.createProvisioningAttempt({
    userId: user.id,
    mode: 'initial',
    tempEncryptedRefreshToken: encryptedRefreshToken,
    ttlMs: 60_000,
  })

  const { sessionId, expiresAt } = await sessionStore.create({
    userId: user.id,
    kind: 'provisioning',
    provisioningAttemptId: attempt.id,
    ttlMs: 60_000,
  })

  const sessionCookie = encryptSession({ sessionId, expiresAt }, sessionKey)
  return { userId: user.id, sessionCookie }
}

async function setupJournalUser(): Promise<{ userId: string; sessionCookie: string }> {
  const connStore = new ConnectionStore(fakeFirestore)
  const sessionStore = new SessionStore(fakeFirestore)

  const user = await connStore.getOrCreateUser({
    googleSub: 'journal-sub-123',
    email: 'user@example.com',
    name: 'User',
    picture: '',
  })

  const encryptedRefreshToken = encryptRefreshToken('valid-refresh-token', tokenKey, 'v1')
  await connStore.activateConnection({
    userId: user.id,
    spreadsheetId: 'sheet-123',
    encryptedRefreshToken,
  })

  const { sessionId, expiresAt } = await sessionStore.create({
    userId: user.id,
    kind: 'journal',
    ttlMs: 60_000,
  })

  const sessionCookie = encryptSession({ sessionId, expiresAt }, sessionKey)
  return { userId: user.id, sessionCookie }
}
