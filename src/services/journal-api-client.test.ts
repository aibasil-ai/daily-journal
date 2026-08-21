import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  AuthenticationError,
  JournalApiClient,
  JournalApiClientError,
  ProvisioningApiError,
} from './journal-api-client'
import { zhTW } from '../i18n/zh-TW'

afterEach(() => vi.unstubAllGlobals())

describe('JournalApiClient', () => {
  test('探測同網域 session 狀態', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ state: 'provisioning' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new JournalApiClient().restoreSession()).resolves.toBe('provisioning')
    expect(fetchMock).toHaveBeenCalledWith('/api/session', { credentials: 'same-origin' })
  })

  test('透過同網域 API 送出原生記事回應請求', async () => {
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

  test('將 proxy 的 401 與 403 分類為登入失效', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))

    await expect(new JournalApiClient().run({ action: 'bootstrap' })).rejects.toBeInstanceOf(AuthenticationError)
  })

  test('非成功或非 JSON 回應提供可操作錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 502 })))

    await expect(new JournalApiClient().run({ action: 'bootstrap' })).rejects.toBeInstanceOf(JournalApiClientError)
  })

  test('拒絕不是原生 ApiResponse 的記事回應', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ response: { result: { ok: true, data: [] } } })))

    await expect(new JournalApiClient().run({ action: 'bootstrap' })).rejects.toBeInstanceOf(JournalApiClientError)
  })

  test('保留原生 ApiResponse 的安全錯誤訊息', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: '請完成必要欄位。',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })))

    await expect(new JournalApiClient().run({ action: 'bootstrap' })).rejects.toThrow('請完成必要欄位。')
  })

  test('資料空間 API 只送出安全的設定輸入', async () => {
    const initialStatus = {
      phase: 'initial_choice',
      sheetName: null,
      lastUpdatedAt: null,
      connectionVersion: null,
      canDeleteActiveSystemSheet: false,
      errorCode: null,
    }
    const completedStatus = {
      ...initialStatus,
      phase: 'completed',
      sheetName: '我的每日記事',
      lastUpdatedAt: 1,
      connectionVersion: 1,
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(initialStatus))
      .mockResolvedValueOnce(jsonResponse({
        items: [{ selectionCode: 'choice-a', name: '我的每日記事', modifiedTime: '2026-08-20T00:00:00.000Z' }],
        nextCursor: null,
      }))
      .mockResolvedValueOnce(jsonResponse(completedStatus))
      .mockResolvedValueOnce(jsonResponse(completedStatus))
      .mockResolvedValueOnce(jsonResponse(completedStatus))
      .mockResolvedValueOnce(jsonResponse(completedStatus))
      .mockResolvedValueOnce(jsonResponse(initialStatus))
    vi.stubGlobal('fetch', fetchMock)
    const client = new JournalApiClient()
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/...'

    await expect(client.getProvisioningStatus()).resolves.toEqual(initialStatus)
    await expect(client.listCandidateSheets('每日')).resolves.toEqual({
      items: [{ selectionCode: 'choice-a', name: '我的每日記事', modifiedTime: '2026-08-20T00:00:00.000Z' }],
      nextCursor: null,
    })
    await expect(client.createSheet()).resolves.toEqual(completedStatus)
    await expect(client.selectCandidate('choice-a')).resolves.toEqual(completedStatus)
    await expect(client.submitSheetUrl(sheetUrl)).resolves.toEqual(completedStatus)
    await expect(client.confirmProvisioning()).resolves.toEqual(completedStatus)
    await expect(client.startSheetChange()).resolves.toEqual(initialStatus)

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/provisioning/status', { credentials: 'same-origin' })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/provisioning/sheets?q=%E6%AF%8F%E6%97%A5', { credentials: 'same-origin' })
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/provisioning/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/provisioning/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectionCode: 'choice-a' }),
      credentials: 'same-origin',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/provisioning/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sheetUrl }),
      credentials: 'same-origin',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/provisioning/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(7, '/api/provisioning/start-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
    })
  })

  test('資料空間 API 將 401 與 403 分類為登入失效', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })))

    await expect(new JournalApiClient().createSheet()).rejects.toBeInstanceOf(AuthenticationError)
  })

  test('資料空間 API 保留安全錯誤碼並轉換為集中繁中文案', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: 'sheet_incompatible',
    }, 422)))

    const request = new JournalApiClient().submitSheetUrl('https://docs.google.com/spreadsheets/d/example')

    await expect(request).rejects.toBeInstanceOf(ProvisioningApiError)
    await expect(request).rejects.toMatchObject({
      code: 'sheet_incompatible',
      message: zhTW.errors.provisioningCode.sheet_incompatible,
    })
  })

  test('帳號設定 API 以同網域 credential 送出中斷連線與刪除帳號請求', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new JournalApiClient()

    await expect(client.disconnect()).resolves.toBeUndefined()
    await expect(client.deleteAccount({
      deleteSystemCreatedSheet: true,
      confirmation: '刪除我的帳號',
    })).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/account/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deleteSystemCreatedSheet: true,
        confirmation: '刪除我的帳號',
      }),
      credentials: 'same-origin',
    })
  })

  test('帳號設定 API 只顯示安全錯誤訊息', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: 'connection_conflict',
    }, 409)))

    await expect(new JournalApiClient().disconnect()).rejects.toThrow('資料連線已在其他分頁變更')
  })

  test('帳號設定 API 將 401 與 403 分類為登入失效', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))

    await expect(new JournalApiClient().deleteAccount({
      deleteSystemCreatedSheet: false,
      confirmation: '刪除我的帳號',
    })).rejects.toBeInstanceOf(AuthenticationError)
  })

  test('登出等待伺服器端 204 回應後才視為成功', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new JournalApiClient().signOut()).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
    })
  })

  test('登出未取得 204 或網路失敗時回傳集中且可重試的安全錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))

    await expect(new JournalApiClient().signOut()).rejects.toThrow(zhTW.errors.signOut)
  })
})

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
