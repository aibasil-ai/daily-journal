// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { AuthenticationError, JournalApiClient, JournalApiClientError } from './journal-api-client'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('JournalApiClient', () => {
  test('依工作階段回應恢復登入狀態', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ authenticated: true }))
      .mockResolvedValueOnce(Response.json({ authenticated: false }))
    vi.stubGlobal('fetch', fetch)
    const client = new JournalApiClient()

    await expect(client.restoreSession()).resolves.toBe(true)
    await expect(client.restoreSession()).resolves.toBe(false)

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/session', { credentials: 'same-origin' })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/session', { credentials: 'same-origin' })
  })

  test('以同網域工作階段呼叫記事 API', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({
      response: { result: { ok: true, data: { timezone: 'Asia/Taipei' } } },
    }))
    vi.stubGlobal('fetch', fetch)

    await expect(new JournalApiClient().run({ action: 'bootstrap' })).resolves.toEqual({ timezone: 'Asia/Taipei' })

    expect(fetch).toHaveBeenCalledWith('/api/journal', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bootstrap' }),
    })
  })

  test.each([401, 403])('記事 API 回傳 HTTP %i 時表示登入已失效', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })))

    await expect(new JournalApiClient().run({ action: 'bootstrap' })).rejects.toBeInstanceOf(AuthenticationError)
  })

  test.each([
    ['網路失敗', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['上游錯誤', () => Promise.resolve(new Response('upstream error', { status: 502 }))],
    ['非 JSON 回應', () => Promise.resolve(new Response('<html>bad gateway</html>'))],
  ])('記事 API %s 時提供可重試錯誤', async (_, response) => {
    vi.stubGlobal('fetch', vi.fn(response))

    await expect(new JournalApiClient().run({ action: 'bootstrap' })).rejects.toEqual(new JournalApiClientError())
  })

  test('登入按鈕導向伺服器 OAuth 起點', () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })

    new JournalApiClient().beginSignIn()

    expect(assign).toHaveBeenCalledWith('/api/auth/start')
  })

  test('登出以 keepalive 清除伺服器工作階段', () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    new JournalApiClient().signOut()

    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
    })
  })
})
