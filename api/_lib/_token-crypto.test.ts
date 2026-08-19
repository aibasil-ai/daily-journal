import { describe, expect, test } from 'vitest'
import { decryptRefreshToken, encryptRefreshToken } from './token-crypto'

const tokenKey = Buffer.alloc(32, 2)

describe('refresh token 加密', () => {
  test('以 AES-256-GCM 加密後可還原原始 refresh token', () => {
    const encrypted = encryptRefreshToken('refresh-token', tokenKey, 'v1')

    expect(encrypted).toMatchObject({ keyVersion: 'v1' })
    expect(JSON.stringify(encrypted)).not.toContain('refresh-token')
    expect(decryptRefreshToken(encrypted, new Map([['v1', tokenKey]]))).toBe('refresh-token')
  })

  test('金鑰版本不符時回傳 undefined', () => {
    const encrypted = encryptRefreshToken('refresh-token', tokenKey, 'v1')

    expect(decryptRefreshToken(encrypted, new Map([['v2', tokenKey]]))).toBeUndefined()
  })

  test('拒絕遭竄改的密文', () => {
    const encrypted = encryptRefreshToken('refresh-token', tokenKey, 'v1')
    const [iv, authTag, ciphertext] = encrypted.ciphertext.split('.')
    const tampered = {
      ciphertext: `${iv}.${authTag}.${ciphertext}x`,
      keyVersion: 'v1',
    }

    expect(decryptRefreshToken(tampered, new Map([['v1', tokenKey]]))).toBeUndefined()
  })
})
