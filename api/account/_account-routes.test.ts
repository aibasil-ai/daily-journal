import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { POST as deletePost } from './delete'
import { createFakeFirestore } from '../_lib/test-firestore'
import * as firestoreModule from '../_lib/firestore'
import { SessionStore } from '../_lib/session-store'
import { ConnectionStore, hashSpreadsheetId } from '../_lib/connection-store'
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

describe('Account routes', () => {
  test('缺少 confirmation 時拒絕刪除', async () => {
    const { sessionCookie } = await setupJournalUser()
    const response = await deletePost(new Request('https://journal.example/api/account/delete', {
      method: 'POST',
      headers: {
        Cookie: `daily_journal_session=${sessionCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'NO' }),
    }))

    expect(response.status).toBe(400)
  })

  test('確認 DELETE 後刪除本站帳號資料並清除 Cookies', async () => {
    const { userId, sessionCookie } = await setupJournalUser()

    const response = await deletePost(new Request('https://journal.example/api/account/delete', {
      method: 'POST',
      headers: {
        Cookie: `daily_journal_session=${sessionCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('Set-Cookie')).toContain('daily_journal_session=;')

    const connStore = new ConnectionStore(fakeFirestore)
    const conn = await connStore.findActiveConnection(userId)
    expect(conn).toBeUndefined()

    const claimDoc = await fakeFirestore.collection('sheet_claims').doc(hashSpreadsheetId('sheet-123')).get()
    expect(claimDoc.exists).toBe(false)
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
