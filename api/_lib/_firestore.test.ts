import { afterEach, describe, expect, test, vi } from 'vitest'

const { firestoreConstructor } = vi.hoisted(() => ({ firestoreConstructor: vi.fn() }))

vi.mock('@google-cloud/firestore', () => ({ Firestore: firestoreConstructor }))

import * as firestoreModule from './firestore'
import type { ServerConfig } from './server-config'

const fakeConfig: ServerConfig = {
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  appOrigin: 'https://journal.example',
  sessionEncryptionKey: Buffer.alloc(32, 1),
  tokenEncryptionKey: Buffer.alloc(32, 2),
  tokenEncryptionKeyVersion: 'v1',
  firestoreProjectId: 'test-project',
  firestoreCredentials: {
    clientEmail: 'service-account@test-project.iam.gserviceaccount.com',
    privateKey: '-----BEGIN PRIVATE KEY-----\nfake-key\n-----END PRIVATE KEY-----\n',
  },
  legacyMigrationSecret: 'm'.repeat(32),
  cronSecret: 'c'.repeat(32),
}

afterEach(() => {
  firestoreConstructor.mockClear()
  vi.unstubAllEnvs()
})

describe('Firestore client factory', () => {
  test('只以伺服器設定建立 Firestore client', () => {
    const client = firestoreModule.createFirestoreClient(fakeConfig)

    expect(client).toBeDefined()
    expect(firestoreConstructor).toHaveBeenCalledWith({
      projectId: 'test-project',
      credentials: {
        client_email: 'service-account@test-project.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nfake-key\n-----END PRIVATE KEY-----\n',
      },
    })
    expect(firestoreModule).not.toHaveProperty('firestoreCredentials')
  })

  test('getFirestoreClient 快取單一 server client', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('APP_ORIGIN', 'https://journal.example')
    vi.stubEnv('SESSION_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64url'))
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 2).toString('base64url'))
    vi.stubEnv('TOKEN_ENCRYPTION_KEY_VERSION', 'v1')
    vi.stubEnv('FIRESTORE_PROJECT_ID', 'test-project')
    vi.stubEnv('FIRESTORE_SERVICE_ACCOUNT_JSON', JSON.stringify({
      project_id: 'test-project',
      client_email: 'service-account@test-project.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nfake-key\n-----END PRIVATE KEY-----\n',
    }))
    vi.stubEnv('LEGACY_MIGRATION_SECRET', 'm'.repeat(32))
    vi.stubEnv('CRON_SECRET', 'c'.repeat(32))

    const client1 = firestoreModule.getFirestoreClient()
    const client2 = firestoreModule.getFirestoreClient()

    expect(client1).toBe(client2)
    expect(firestoreConstructor).toHaveBeenCalledTimes(1)
  })
})
