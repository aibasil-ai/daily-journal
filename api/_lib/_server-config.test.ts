import { describe, expect, test } from 'vitest'
import { getServerConfig } from './server-config'

const sessionEncryptionKey = Buffer.alloc(32, 7).toString('base64url')
const completeEnvironment = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  SESSION_ENCRYPTION_KEY: sessionEncryptionKey,
  GAS_DEPLOYMENT_ID: 'AKfycbDeploymentId',
}

describe('getServerConfig', () => {
  test('讀取完整且有效的伺服器端設定', () => {
    expect(getServerConfig(completeEnvironment)).toMatchObject({
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
      gasDeploymentId: 'AKfycbDeploymentId',
      sessionEncryptionKey: Buffer.alloc(32, 7),
    })
  })

  test('缺少必要設定時拒絕啟動', () => {
    expect(() => getServerConfig({ ...completeEnvironment, GOOGLE_CLIENT_SECRET: '' })).toThrow('GOOGLE_CLIENT_SECRET')
  })

  test('拒絕不是 32 bytes 的 base64url 加密金鑰', () => {
    expect(() => getServerConfig({ ...completeEnvironment, SESSION_ENCRYPTION_KEY: 'not-a-32-byte-key' }))
      .toThrow('SESSION_ENCRYPTION_KEY')
  })
})
