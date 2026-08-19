import { describe, expect, test } from 'vitest'
import { getServerConfig } from './server-config'

const sessionEncryptionKey = Buffer.alloc(32, 1).toString('base64url')
const tokenEncryptionKey = Buffer.alloc(32, 2).toString('base64url')
const firestoreServiceAccount = JSON.stringify({
  project_id: 'journal-production',
  client_email: 'journal-api@journal-production.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
})

const completeEnvironment = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  APP_ORIGIN: 'https://journal.example',
  SESSION_ENCRYPTION_KEY: sessionEncryptionKey,
  TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
  TOKEN_ENCRYPTION_KEY_VERSION: 'v1',
  FIRESTORE_PROJECT_ID: 'journal-production',
  FIRESTORE_SERVICE_ACCOUNT_JSON: firestoreServiceAccount,
  LEGACY_MIGRATION_SECRET: 'm'.repeat(32),
  CRON_SECRET: 'c'.repeat(32),
}

describe('getServerConfig', () => {
  test('讀取完整且有效的伺服器端設定', () => {
    expect(getServerConfig(completeEnvironment)).toMatchObject({
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
      appOrigin: 'https://journal.example',
      sessionEncryptionKey: Buffer.alloc(32, 1),
      tokenEncryptionKey: Buffer.alloc(32, 2),
      tokenEncryptionKeyVersion: 'v1',
      firestoreProjectId: 'journal-production',
      firestoreCredentials: {
        clientEmail: 'journal-api@journal-production.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
      },
      legacyMigrationSecret: 'm'.repeat(32),
      cronSecret: 'c'.repeat(32),
    })
  })

  test('缺少必要設定時拒絕啟動', () => {
    expect(() => getServerConfig({ ...completeEnvironment, GOOGLE_CLIENT_SECRET: '' })).toThrow('GOOGLE_CLIENT_SECRET')
  })

  test('拒絕不是 32 bytes 的 base64url 加密金鑰', () => {
    expect(() => getServerConfig({ ...completeEnvironment, SESSION_ENCRYPTION_KEY: 'not-a-32-byte-key' }))
      .toThrow('SESSION_ENCRYPTION_KEY')
    expect(() => getServerConfig({ ...completeEnvironment, TOKEN_ENCRYPTION_KEY: 'short' }))
      .toThrow('TOKEN_ENCRYPTION_KEY')
  })

  test('拒絕無效的 Firestore 服務帳號 JSON', () => {
    expect(() => getServerConfig({ ...completeEnvironment, FIRESTORE_SERVICE_ACCOUNT_JSON: '{not-json' }))
      .toThrow()
  })

  test('拒絕與 FIRESTORE_PROJECT_ID 不符的服務帳號', () => {
    const mismatch = JSON.stringify({ project_id: 'other-project', client_email: 'a@b.com', private_key: 'k' })
    expect(() => getServerConfig({ ...completeEnvironment, FIRESTORE_SERVICE_ACCOUNT_JSON: mismatch }))
      .toThrow()
  })

  test('拒絕非 HTTPS 的 APP_ORIGIN', () => {
    expect(() => getServerConfig({ ...completeEnvironment, APP_ORIGIN: 'http://localhost:3000' }))
      .toThrow('APP_ORIGIN')
  })

  test('拒絕帶有路徑的 APP_ORIGIN', () => {
    expect(() => getServerConfig({ ...completeEnvironment, APP_ORIGIN: 'https://journal.example/path' }))
      .toThrow('APP_ORIGIN')
  })

  test('拒絕無效的 TOKEN_ENCRYPTION_KEY_VERSION', () => {
    expect(() => getServerConfig({ ...completeEnvironment, TOKEN_ENCRYPTION_KEY_VERSION: '' }))
      .toThrow('TOKEN_ENCRYPTION_KEY_VERSION')
    expect(() => getServerConfig({ ...completeEnvironment, TOKEN_ENCRYPTION_KEY_VERSION: 'has space' }))
      .toThrow('TOKEN_ENCRYPTION_KEY_VERSION')
  })

  test('拒絕過短的管理密鑰', () => {
    expect(() => getServerConfig({ ...completeEnvironment, LEGACY_MIGRATION_SECRET: 'short' }))
      .toThrow('LEGACY_MIGRATION_SECRET')
    expect(() => getServerConfig({ ...completeEnvironment, CRON_SECRET: 'short' }))
      .toThrow('CRON_SECRET')
  })
})

