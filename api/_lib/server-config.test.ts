import { describe, expect, test } from 'vitest'
import { getServerConfig } from './server-config.js'

const encryptionKey = Buffer.alloc(32, 1).toString('base64url')

const completeEnv = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  SESSION_ENCRYPTION_KEY: encryptionKey,
  GAS_DEPLOYMENT_ID: 'AKfycbDeploymentId',
}

describe('getServerConfig', () => {
  test('完整環境變數會轉為僅供伺服器使用的設定', () => {
    expect(getServerConfig(completeEnv)).toMatchObject({
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
      sessionEncryptionKey: Buffer.alloc(32, 1),
      gasDeploymentId: 'AKfycbDeploymentId',
    })
  })

  test.each(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_ENCRYPTION_KEY', 'GAS_DEPLOYMENT_ID'])(
    '缺少 %s 時拒絕建立設定',
    (missingName) => {
      const env = { ...completeEnv, [missingName]: undefined }

      expect(() => getServerConfig(env)).toThrow()
    },
  )

  test.each([
    Buffer.alloc(31, 1).toString('base64url'),
    'not-a-base64url-key!',
  ])('拒絕不是 32-byte base64url 的加密金鑰', (invalidKey) => {
    expect(() => getServerConfig({ ...completeEnv, SESSION_ENCRYPTION_KEY: invalidKey })).toThrow()
  })
})
