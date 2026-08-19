import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GET, POST } from './journal'
import { createFakeFirestore } from './_lib/test-firestore'
import * as firestoreModule from './_lib/firestore'
import { SessionStore } from './_lib/session-store'
import { ConnectionStore } from './_lib/connection-store'
import { encryptSession } from './_lib/session-crypto'
import { encryptRefreshToken } from './_lib/token-crypto'

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

describe('journal endpoint', () => {
  test('GET 回傳 405', () => {
    expect(GET().status).toBe(405)
  })

  test('缺少 session 時清除 Cookie 並回傳 401', async () => {
    const response = await POST(new Request('https://journal.example/api/journal', {
      method: 'POST',
      body: JSON.stringify({ action: 'bootstrap' }),
    }))

    expect(response.status).toBe(401)
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=;')
  })

  test('成功執行 bootstrap 讀取請求並回傳領域資料', async () => {
    const { sessionId, sessionCookie } = await setupUserWithConnection()

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'valid-access-token' }))
      }
      if (url.includes('/values:batchGet')) {
        if (decodeURIComponent(url).includes('A1:I1')) {
          return new Response(JSON.stringify({
            valueRanges: [
              { range: 'entries!A1:I1', values: [['id', 'entryDate', 'title', 'content', 'categoryId', 'tags', 'links', 'createdAt', 'updatedAt']] },
              { range: 'categories!A1:E1', values: [['id', 'name', 'isActive', 'createdAt', 'updatedAt']] },
              { range: 'settings!A1:B', values: [['key', 'value'], ['schemaVersion', '1']] },
            ],
          }))
        }
        return new Response(JSON.stringify({
          valueRanges: [
            {
              range: 'entries!A2:I',
              values: [
                ['e1', '2026-08-19', '標題一', '內容一', 'cat-1', '["工作"]', '[]', '2026-08-19T00:00:00Z', '2026-08-19T00:00:00Z'],
              ],
            },
            {
              range: 'categories!A2:E',
              values: [
                ['cat-1', '日常', 'true', '2026-08-19T00:00:00Z', '2026-08-19T00:00:00Z'],
              ],
            },
          ],
        }))
      }
      return new Response(JSON.stringify({
        spreadsheetId: 'sheet-123',
        properties: { title: '我的日記', timeZone: 'Asia/Taipei' },
        sheets: [
          { properties: { sheetId: 0, title: 'entries' } },
          { properties: { sheetId: 1, title: 'categories' } },
          { properties: { sheetId: 2, title: 'settings' } },
        ],
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(authenticatedRequest({ action: 'bootstrap' }, sessionCookie))

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({
      ok: true,
      data: {
        timezone: 'Asia/Taipei',
        categories: [expect.objectContaining({ id: 'cat-1', name: '日常' })],
        tagSuggestions: ['工作'],
      },
    })
  })

  test('寫入操作 saveEntry 會取得 write lease 並 flush 回寫 Google Sheets', async () => {
    const { sessionCookie } = await setupUserWithConnection()
    let updatedValues: unknown[] = []

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'valid-access-token' }))
      }
      if (url.includes('/values:batchUpdate')) {
        const body = JSON.parse(init?.body as string) as { data: unknown[] }
        updatedValues = body.data
        return new Response(JSON.stringify({}))
      }
      if (url.includes('/values:batchGet')) {
        if (decodeURIComponent(url).includes('A1:I1')) {
          return new Response(JSON.stringify({
            valueRanges: [
              { range: 'entries!A1:I1', values: [['id', 'entryDate', 'title', 'content', 'categoryId', 'tags', 'links', 'createdAt', 'updatedAt']] },
              { range: 'categories!A1:E1', values: [['id', 'name', 'isActive', 'createdAt', 'updatedAt']] },
              { range: 'settings!A1:B', values: [['key', 'value'], ['schemaVersion', '1']] },
            ],
          }))
        }
        return new Response(JSON.stringify({
          valueRanges: [
            { range: 'entries!A2:I', values: [] },
            { range: 'categories!A2:E', values: [['cat-1', '日常', 'true', '2026-08-19T00:00:00Z', '2026-08-19T00:00:00Z']] },
          ],
        }))
      }
      return new Response(JSON.stringify({
        spreadsheetId: 'sheet-123',
        properties: { title: '我的日記', timeZone: 'Asia/Taipei' },
        sheets: [
          { properties: { sheetId: 0, title: 'entries' } },
          { properties: { sheetId: 1, title: 'categories' } },
          { properties: { sheetId: 2, title: 'settings' } },
        ],
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(authenticatedRequest({
      action: 'saveEntry',
      entry: {
        entryDate: '2026-08-19',
        title: '新筆記',
        content: '新筆記內容',
        categoryId: 'cat-1',
        tags: ['測試'],
        links: [],
      },
    }, sessionCookie))

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({
      ok: true,
      data: expect.objectContaining({ title: '新筆記' }),
    })
    expect(updatedValues.length).toBeGreaterThan(0)
  })

  test('refresh token 失效時標記 needs_reconnect 並回傳 401', async () => {
    const { sessionCookie, userId } = await setupUserWithConnection()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(authenticatedRequest({ action: 'bootstrap' }, sessionCookie))

    expect(response.status).toBe(401)
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=;')

    const connStore = new ConnectionStore(fakeFirestore)
    const conn = await connStore.findActiveConnection(userId)
    expect(conn).toBeUndefined() // status is marked needs_reconnect, so no active connection found
  })

  test('Google Sheet 結構不符時回傳 SCHEMA_MISMATCH 錯誤', async () => {
    const { sessionCookie } = await setupUserWithConnection()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'valid-access-token' }))
      }
      // Return spreadsheet missing required sheets
      return new Response(JSON.stringify({
        spreadsheetId: 'sheet-123',
        properties: { title: '我的日記' },
        sheets: [],
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(authenticatedRequest({ action: 'bootstrap' }, sessionCookie))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({ code: 'SCHEMA_MISMATCH' }),
    })
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

async function setupUserWithConnection(): Promise<{ userId: string; sessionId: string; sessionCookie: string }> {
  const connStore = new ConnectionStore(fakeFirestore)
  const sessionStore = new SessionStore(fakeFirestore)

  const user = await connStore.getOrCreateUser({
    googleSub: 'google-sub-123',
    email: 'user@example.com',
    name: 'Test User',
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
    ttlMs: 1000 * 60 * 60,
  })

  const sessionCookie = encryptSession({ sessionId, expiresAt }, sessionKey)
  return { userId: user.id, sessionId, sessionCookie }
}

function authenticatedRequest(body: Record<string, unknown>, sessionCookie: string): Request {
  return new Request('https://journal.example/api/journal', {
    method: 'POST',
    headers: {
      Cookie: `daily_journal_session=${sessionCookie}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

