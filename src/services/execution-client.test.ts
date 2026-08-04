import { afterEach, describe, expect, test, vi } from 'vitest'
import type { RuntimeConfig } from '../config/runtime-config'
import { AuthenticationError, ExecutionClient } from './execution-client'

afterEach(() => vi.unstubAllGlobals())

describe('ExecutionClient', () => {
  test('以 Bearer 權杖呼叫 executeAppRequest', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ response: { result: { ok: true, data: [] } } })))
    vi.stubGlobal('fetch', fetch)

    await expect(new ExecutionClient(config, { getAccessToken: vi.fn().mockResolvedValue('token') }).run({ action: 'bootstrap' })).resolves.toEqual([])

    expect(fetch).toHaveBeenCalledWith(
      'https://script.googleapis.com/v1/scripts/script-id:run',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
        body: JSON.stringify({ function: 'executeAppRequest', parameters: [{ action: 'bootstrap' }] }),
      }),
    )
  })

  test.each([401, 403])('HTTP %i 時轉為 AuthenticationError', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })))

    await expect(new ExecutionClient(config, { getAccessToken: vi.fn().mockResolvedValue('token') }).run({ action: 'bootstrap' }))
      .rejects.toEqual(new AuthenticationError('登入已過期或沒有 GAS 使用權限，請重新登入。'))
  })

  test('GAS 回傳失敗 ApiResponse 時保留後端繁中訊息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      response: { result: { ok: false, code: 'REQUEST_ERROR', message: '請輸入分類名稱。' } },
    }))))

    await expect(new ExecutionClient(config, { getAccessToken: vi.fn().mockResolvedValue('token') }).run({ action: 'bootstrap' }))
      .rejects.toThrow('請輸入分類名稱。')
  })

  test('Execution API 頂層錯誤時保留其繁中訊息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: '尚未啟用 Apps Script API。' } }))))

    await expect(new ExecutionClient(config, { getAccessToken: vi.fn().mockResolvedValue('token') }).run({ action: 'bootstrap' }))
      .rejects.toThrow('尚未啟用 Apps Script API。')
  })
})

const config: RuntimeConfig = { googleClientId: 'client-id', gasScriptId: 'script-id' }
