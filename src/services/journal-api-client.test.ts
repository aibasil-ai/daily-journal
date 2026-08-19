import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  AuthenticationError,
  JournalApiClient,
  JournalApiClientError,
} from './journal-api-client'

afterEach(() => vi.unstubAllGlobals())

describe('JournalApiClient', () => {
  test('探測同網域 session 狀態', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      authenticated: true,
      state: 'authenticated',
      user: { name: 'Test User' },
      connection: { spreadsheetId: 's1', spreadsheetName: '我的日記' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await new JournalApiClient().restoreSession()
    expect(res.state).toBe('authenticated')
    expect(res.user?.name).toBe('Test User')
    expect(res.connection?.spreadsheetId).toBe('s1')
    expect(fetchMock).toHaveBeenCalledWith('/api/session', { credentials: 'same-origin' })
  })

  test('透過同網域 journal 送出記事請求（支援直接回傳格式）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new JournalApiClient().run<string[]>({ action: 'bootstrap' })).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith('/api/journal', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bootstrap' }),
    })
  })

  test('將 401 與 403 分類為登入失效', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))

    await expect(new JournalApiClient().run({ action: 'bootstrap' })).rejects.toBeInstanceOf(AuthenticationError)
  })

  test('非成功或非 JSON 回應提供可操作錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 502 })))

    await expect(new JournalApiClient().run({ action: 'bootstrap' })).rejects.toBeInstanceOf(JournalApiClientError)
  })

  test('取得候選試算表清單', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [{ id: 'sheet-1', name: '我的日記', modifiedTime: '2026-08-19' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const candidates = await new JournalApiClient().getCandidates()
    expect(candidates).toEqual([{ id: 'sheet-1', name: '我的日記', modifiedTime: '2026-08-19' }])
    expect(fetchMock).toHaveBeenCalledWith('/api/sheets/candidates', { credentials: 'same-origin' })
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

