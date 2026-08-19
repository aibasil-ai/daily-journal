export type FirestoreCredentials = {
  clientEmail: string
  privateKey: string
}

export type ServerConfig = {
  googleClientId: string
  googleClientSecret: string
  appOrigin: string
  sessionEncryptionKey: Buffer
  tokenEncryptionKey: Buffer
  tokenEncryptionKeyVersion: string
  firestoreProjectId: string
  firestoreCredentials: FirestoreCredentials
  legacyMigrationSecret: string
  cronSecret: string
}

export function getServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const googleClientId = required(env, 'GOOGLE_CLIENT_ID')
  const googleClientSecret = required(env, 'GOOGLE_CLIENT_SECRET')
  const appOrigin = validateAppOrigin(required(env, 'APP_ORIGIN'))
  const sessionEncryptionKey = parseEncryptionKey(required(env, 'SESSION_ENCRYPTION_KEY'), 'SESSION_ENCRYPTION_KEY')
  const tokenEncryptionKey = parseEncryptionKey(required(env, 'TOKEN_ENCRYPTION_KEY'), 'TOKEN_ENCRYPTION_KEY')
  const tokenEncryptionKeyVersion = validateKeyVersion(required(env, 'TOKEN_ENCRYPTION_KEY_VERSION'))
  const firestoreProjectId = required(env, 'FIRESTORE_PROJECT_ID')
  const firestoreCredentials = parseFirestoreCredentials(required(env, 'FIRESTORE_SERVICE_ACCOUNT_JSON'), firestoreProjectId)
  const legacyMigrationSecret = validateSecret(required(env, 'LEGACY_MIGRATION_SECRET'), 'LEGACY_MIGRATION_SECRET')
  const cronSecret = validateSecret(required(env, 'CRON_SECRET'), 'CRON_SECRET')

  return {
    googleClientId,
    googleClientSecret,
    appOrigin,
    sessionEncryptionKey,
    tokenEncryptionKey,
    tokenEncryptionKeyVersion,
    firestoreProjectId,
    firestoreCredentials,
    legacyMigrationSecret,
    cronSecret,
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`缺少伺服器端環境變數：${name}`)
  return value
}

function parseEncryptionKey(encodedKey: string, name: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(encodedKey)) {
    throw new Error(`${name} 必須是 32-byte base64url 值。`)
  }

  const key = Buffer.from(encodedKey, 'base64url')
  if (key.length !== 32 || key.toString('base64url') !== encodedKey) {
    throw new Error(`${name} 必須是 32-byte base64url 值。`)
  }
  return key
}

function validateKeyVersion(version: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(version)) {
    throw new Error('TOKEN_ENCRYPTION_KEY_VERSION 必須是非空的 ASCII 識別碼。')
  }
  return version
}

function validateAppOrigin(origin: string): string {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:' || url.origin !== origin) {
      throw new Error('APP_ORIGIN 必須是沒有路徑、查詢字串或片段的 HTTPS 來源。')
    }
    return url.origin
  } catch {
    throw new Error('APP_ORIGIN 必須是沒有路徑、查詢字串或片段的 HTTPS 來源。')
  }
}

function parseFirestoreCredentials(jsonString: string, expectedProjectId: string): FirestoreCredentials {
  try {
    const parsed = JSON.parse(jsonString) as Record<string, unknown>
    const projectId = typeof parsed.project_id === 'string' ? parsed.project_id.trim() : ''
    const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : ''
    const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key : ''

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('FIRESTORE_SERVICE_ACCOUNT_JSON 必須包含 project_id, client_email 與 private_key。')
    }
    if (projectId !== expectedProjectId) {
      throw new Error('FIRESTORE_SERVICE_ACCOUNT_JSON 中的 project_id 與 FIRESTORE_PROJECT_ID 不符。')
    }
    return { clientEmail, privateKey }
  } catch (error) {
    if (error instanceof Error && error.message.includes('FIRESTORE_SERVICE_ACCOUNT_JSON')) {
      throw error
    }
    throw new Error('FIRESTORE_SERVICE_ACCOUNT_JSON 必須是有效的 JSON 字串。')
  }
}

function validateSecret(secret: string, name: string): string {
  if (secret.length < 32) {
    throw new Error(`${name} 必須至少 32 個字元。`)
  }
  return secret
}

