import { afterEach, describe, expect, test, vi } from 'vitest'
import { AuthenticationError, ExecutionClient } from './execution-client'

afterEach(() => vi.unstubAllGlobals())

describe('ExecutionClient', () => {
  test('以 Bearer 權杖呼叫 executeAppRequest', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ response: { result: { ok: true, data: [] } } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new ExecutionClient(
      { gasDeploymentId: 'script-id' },
      { getAccessToken: vi.fn().mockResolvedValue('token') },
    )

    await expect(client.run<string[]>({ action: 'bootstrap' })).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://script.googleapis.com/v1/scripts/script-id:run',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }),
    )
  })

  test('將 401 與 403 轉為登入錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    const client = new ExecutionClient(
      { gasDeploymentId: 'script-id' },
      { getAccessToken: vi.fn().mockResolvedValue('token') },
    )

    await expect(client.run({ action: 'bootstrap' })).rejects.toBeInstanceOf(AuthenticationError)
  })
})
