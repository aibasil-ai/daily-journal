export type ServerConfig = {
  googleClientId: string
  googleClientSecret: string
  sessionEncryptionKey: Buffer
  gasDeploymentId: string
}

export function getServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const googleClientId = required(env, 'GOOGLE_CLIENT_ID')
  const googleClientSecret = required(env, 'GOOGLE_CLIENT_SECRET')
  const gasDeploymentId = required(env, 'GAS_DEPLOYMENT_ID')
  const encodedKey = required(env, 'SESSION_ENCRYPTION_KEY')

  if (!/^[A-Za-z0-9_-]+$/.test(encodedKey)) {
    throw new Error('SESSION_ENCRYPTION_KEY 必須是 32-byte base64url 值。')
  }

  const sessionEncryptionKey = Buffer.from(encodedKey, 'base64url')
  if (sessionEncryptionKey.length !== 32 || sessionEncryptionKey.toString('base64url') !== encodedKey) {
    throw new Error('SESSION_ENCRYPTION_KEY 必須是 32-byte base64url 值。')
  }

  return {
    googleClientId,
    googleClientSecret,
    sessionEncryptionKey,
    gasDeploymentId,
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`缺少伺服器端環境變數：${name}`)
  return value
}
