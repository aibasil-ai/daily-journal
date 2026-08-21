import { describe, expect, test } from 'vitest'
import { decryptRefreshToken, encryptRefreshToken } from './token-crypto.js'

const tokenKey = Buffer.alloc(32, 2)

describe('refresh token 加密', () => {
  test('以 AES-256-GCM 加密並只儲存密文與金鑰版本', () => {
    const encrypted = encryptRefreshToken('refresh-token', tokenKey, 'v1')

    expect(encrypted).toStrictEqual({
      ciphertext: expect.any(String),
      keyVersion: 'v1',
    })
    expect(JSON.stringify(encrypted)).not.toContain('refresh-token')
    expect(encrypted.ciphertext).not.toContain('refresh-token')
    expect(decryptRefreshToken(encrypted, new Map([['v1', tokenKey]]))).toBe('refresh-token')
  })

  test('依金鑰版本選擇解密金鑰，且支援目前單一金鑰', () => {
    const encrypted = encryptRefreshToken('refresh-token', tokenKey, 'v1')

    expect(decryptRefreshToken(encrypted, new Map([['v2', tokenKey]]))).toBeUndefined()
    expect(decryptRefreshToken(encrypted, tokenKey)).toBe('refresh-token')
  })

  test('拒絕空 token、錯誤金鑰長度與遭竄改的密文', () => {
    expect(() => encryptRefreshToken('', tokenKey, 'v1')).toThrow('無法加密空的 token。')
    expect(() => encryptRefreshToken('refresh-token', Buffer.alloc(31), 'v1'))
      .toThrow('TOKEN_ENCRYPTION_KEY 必須是 32-byte 金鑰。')

    const encrypted = encryptRefreshToken('refresh-token', tokenKey, 'v1')
    const [iv, authTag, ciphertext] = encrypted.ciphertext.split('.')
    const tampered = {
      ciphertext: `${iv}.${authTag}.${ciphertext}A`,
      keyVersion: 'v1',
    }

    expect(decryptRefreshToken(tampered, new Map([['v1', tokenKey]]))).toBeUndefined()
  })
})
