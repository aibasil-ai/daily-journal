import { describe, expect, test } from 'vitest'
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  createOAuthStateCookie,
  createSessionCookie,
  readCookie,
} from './cookies'

describe('Cookie helpers', () => {
  test('工作階段 Cookie 使用安全屬性與 30 天效期', () => {
    expect(createSessionCookie('encrypted-value')).toBe(
      'daily_journal_session=encrypted-value; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000',
    )
  })

  test('OAuth state Cookie 使用安全屬性與 10 分鐘效期', () => {
    expect(createOAuthStateCookie('csrf-state')).toBe(
      'daily_journal_oauth_state=csrf-state; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600',
    )
  })

  test('清除 Cookie 時保留相同的安全屬性', () => {
    expect(clearSessionCookie()).toContain('HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0')
    expect(clearOAuthStateCookie()).toContain('HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0')
  })

  test('可安全解析單一 Cookie 值', () => {
    expect(readCookie('other=value; daily_journal_session=value%3Dwith%3Dequals', 'daily_journal_session'))
      .toBe('value=with=equals')
  })
})
