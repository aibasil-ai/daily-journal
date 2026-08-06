import { describe, expect, test } from 'vitest'
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  createOAuthStateCookie,
  createSessionCookie,
  readCookie,
} from './cookies.js'

describe('cookie helpers', () => {
  test('session Cookie 使用安全屬性並保存 30 天', () => {
    expect(createSessionCookie('encrypted-session')).toContain(
      'HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000',
    )
  })

  test('OAuth state Cookie 使用安全屬性並保存 10 分鐘', () => {
    expect(createOAuthStateCookie('oauth-state')).toContain(
      'HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600',
    )
  })

  test('清除 Cookie 時保留安全屬性與 path 並設為立即到期', () => {
    expect(clearSessionCookie()).toContain(
      'HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    )
    expect(clearOAuthStateCookie()).toContain(
      'HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    )
  })

  test('從 Cookie header 讀取指定的已編碼值', () => {
    expect(readCookie('theme=dark; session=encrypted%2Evalue', 'session')).toBe('encrypted.value')
    expect(readCookie(null, 'session')).toBeUndefined()
  })
})
