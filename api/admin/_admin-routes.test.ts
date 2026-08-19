import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { POST as migratePost } from './migrate-legacy'
import { createFakeFirestore } from '../_lib/test-firestore'
import * as firestoreModule from '../_lib/firestore'
import { ConnectionStore } from '../_lib/connection-store'

const sessionKey = Buffer.alloc(32, 5)
const tokenKey = Buffer.alloc(32, 6)
const legacySecret = 'm'.repeat(32)
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

describe('Admin migrate-legacy route', () => {
  test('secret 不符時拒絕存取回傳 403', async () => {
    const response = await migratePost(new Request('https://journal.example/api/admin/migrate-legacy', {
      method: 'POST',
      headers: { 'X-Admin-Secret': 'wrong-secret' },
      body: JSON.stringify({ googleSub: 'sub-1', spreadsheetId: 'sheet-1' }),
    }))

    expect(response.status).toBe(403)
  })

  test('使用者不存在時回傳 404', async () => {
    const response = await migratePost(new Request('https://journal.example/api/admin/migrate-legacy', {
      method: 'POST',
      headers: { 'X-Admin-Secret': legacySecret },
      body: JSON.stringify({ googleSub: 'non-existent-sub', spreadsheetId: 'sheet-1' }),
    }))

    expect(response.status).toBe(404)
  })

  test('成功為既有使用者建立舊 Sheet 綁定連線', async () => {
    const connStore = new ConnectionStore(fakeFirestore)
    const user = await connStore.getOrCreateUser({
      googleSub: 'legacy-sub-1',
      email: 'legacy@example.com',
      name: 'Legacy User',
      picture: '',
    })

    const response = await migratePost(new Request('https://journal.example/api/admin/migrate-legacy', {
      method: 'POST',
      headers: { 'X-Admin-Secret': legacySecret },
      body: JSON.stringify({
        googleSub: 'legacy-sub-1',
        spreadsheetId: 'legacy-sheet-123',
        spreadsheetName: '舊版日記',
      }),
    }))

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.ok).toBe(true)
    expect(result.connection).toEqual({
      userId: user.id,
      spreadsheetId: 'legacy-sheet-123',
      spreadsheetName: '舊版日記',
    })

    const activeConn = await connStore.findActiveConnection(user.id)
    expect(activeConn?.spreadsheetId).toBe('legacy-sheet-123')
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
  vi.stubEnv('LEGACY_MIGRATION_SECRET', legacySecret)
  vi.stubEnv('CRON_SECRET', 'c'.repeat(32))
}
