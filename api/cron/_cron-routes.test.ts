import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as cleanupGet, POST as cleanupPost } from './cleanup'
import { createFakeFirestore } from '../_lib/test-firestore'
import * as firestoreModule from '../_lib/firestore'
import { ConnectionStore } from '../_lib/connection-store'

const sessionKey = Buffer.alloc(32, 5)
const tokenKey = Buffer.alloc(32, 6)
const cronSecret = 'c'.repeat(32)
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

describe('Cron cleanup route', () => {
  test('secret 不符時拒絕存取回傳 403', async () => {
    const response = await cleanupGet(new Request('https://journal.example/api/cron/cleanup', {
      headers: { Authorization: 'Bearer wrong-secret' },
    }))

    expect(response.status).toBe(403)
  })

  test('成功清理過期工作階段與過期 attempts', async () => {
    const connStore = new ConnectionStore(fakeFirestore)

    // Create an expired session
    await fakeFirestore.collection('sessions').doc('expired-s1').set({
      sessionId: 'expired-s1',
      userId: 'u1',
      kind: 'journal',
      expiresAt: Date.now() - 10_000,
      createdAt: Date.now() - 20_000,
      lastUsedAt: Date.now() - 20_000,
      revokedAt: null,
    })

    // Create an expired oauth attempt
    await connStore.createOAuthAttempt({
      state: 'expired-state',
      codeVerifier: 'verifier',
      intent: 'sign-in',
      expiresAt: Date.now() - 5_000,
    })

    const response = await cleanupPost(new Request('https://journal.example/api/cron/cleanup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    }))

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.ok).toBe(true)
    expect(result.cleaned.sessions).toBe(1)
    expect(result.cleaned.attempts).toBe(1)

    const sessionDoc = await fakeFirestore.collection('sessions').doc('expired-s1').get()
    expect(sessionDoc.exists).toBe(false)
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
  vi.stubEnv('CRON_SECRET', cronSecret)
}
