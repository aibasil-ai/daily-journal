export type ServerConfig = {
  googleClientId: string
  googleClientSecret: string
  sessionEncryptionKey: Buffer
  gasDeploymentId: string
}

export function getServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const sessionEncryptionKey = decodeSessionEncryptionKey(requireEnvironmentValue(env, 'SESSION_ENCRYPTION_KEY'))

  return {
    googleClientId: requireEnvironmentValue(env, 'GOOGLE_CLIENT_ID'),
    googleClientSecret: requireEnvironmentValue(env, 'GOOGLE_CLIENT_SECRET'),
    sessionEncryptionKey,
    gasDeploymentId: requireEnvironmentValue(env, 'GAS_DEPLOYMENT_ID'),
  }
}

function requireEnvironmentValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()

  if (!value) throw new Error('缺少必要的伺服器設定。')

  return value
}

function decodeSessionEncryptionKey(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('工作階段加密金鑰無效。')

  const key = Buffer.from(value, 'base64url')

  if (key.length !== 32 || key.toString('base64url') !== value) {
    throw new Error('工作階段加密金鑰無效。')
  }

  return key
}
