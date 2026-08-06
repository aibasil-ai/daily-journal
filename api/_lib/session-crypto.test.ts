import { describe, expect, test } from 'vitest'
import { decryptSession, encryptSession } from './session-crypto'

const key = Buffer.alloc(32, 7)
const expiresAt = 2_000_000_000_000

describe('session crypto', () => {
  test('加密後可還原 refresh token 與到期時間', () => {
    const value = encryptSession({ refreshToken: 'refresh-token', expiresAt }, key)

    expect(decryptSession(value, key, expiresAt - 1)).toEqual({
      refreshToken: 'refresh-token',
      expiresAt,
    })
  })

  test('驗證標籤被篡改時回傳 undefined 且不拋出內容', () => {
    const [iv, tag, ciphertext] = encryptSession({ refreshToken: 'refresh-token', expiresAt }, key).split('.')
    const tamperedTag = `${tag[0] === 'A' ? 'B' : 'A'}${tag.slice(1)}`

    expect(() => decryptSession(`${iv}.${tamperedTag}.${ciphertext}`, key, expiresAt - 1)).not.toThrow()
    expect(decryptSession(`${iv}.${tamperedTag}.${ciphertext}`, key, expiresAt - 1)).toBeUndefined()
  })

  test('已到期的工作階段回傳 undefined', () => {
    const value = encryptSession({ refreshToken: 'refresh-token', expiresAt }, key)

    expect(decryptSession(value, key, expiresAt + 1)).toBeUndefined()
  })

  test('加密時不將工作階段以外欄位寫入 payload', () => {
    const value = encryptSession({
      refreshToken: 'refresh-token',
      expiresAt,
      accessToken: 'must-not-be-stored',
    } as Parameters<typeof encryptSession>[0], key)

    expect(decryptSession(value, key, expiresAt - 1)).toEqual({
      refreshToken: 'refresh-token',
      expiresAt,
    })
  })

  test('格式錯誤的加密值回傳 undefined 且不拋出內容', () => {
    expect(() => decryptSession('not.a.valid.session.value', key, expiresAt - 1)).not.toThrow()
    expect(decryptSession('not.a.valid.session.value', key, expiresAt - 1)).toBeUndefined()
  })
})
