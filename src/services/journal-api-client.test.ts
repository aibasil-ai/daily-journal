import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  AuthenticationError,
  JournalApiClient,
  JournalApiClientError,
} from './journal-api-client'

afterEach(() => vi.unstubAllGlobals())

describe('JournalApiClient', () => {
  test('探測同網域 session 狀態', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ authenticated: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new JournalApiClient().restoreSession()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/session', { credentials: 'same-origin' })
  })

  test('透過同網域 proxy 送出記事請求', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ response: { result: { ok: true, data: [] } } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new JournalApiClient().run<string[]>({ action: 'bootstrap' })).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith('/api/journal', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bootstrap' }),
    })
  })

  test('將 proxy 的 401 與 403 分類為登入失效', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))

    await expect(new JournalApiClient().run({ action: 'bootstrap' })).rejects.toBeInstanceOf(AuthenticationError)
  })

  test('非成功或非 JSON 回應提供可操作錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 502 })))

    await expect(new JournalApiClient().run({ action: 'bootstrap' })).rejects.toBeInstanceOf(JournalApiClientError)
  })

  test('登出使用 keepalive POST 清除伺服器端 session', () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    new JournalApiClient().signOut()

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
    })
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}
