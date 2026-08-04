import { afterEach, describe, expect, test, vi } from 'vitest'
import type { RuntimeConfig } from '../config/runtime-config'
import { GoogleOAuth } from './google-oauth'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GoogleOAuth', () => {
  test('以指定 scope 取得權杖並只快取於記憶體', async () => {
    let callback: ((response: google.accounts.oauth2.TokenResponse) => void) | undefined
    const requestAccessToken = vi.fn(() => callback?.({ access_token: 'access-token', expires_in: 3600 }))
    const initTokenClient = vi.fn((config: google.accounts.oauth2.TokenClientConfig) => {
      callback = config.callback
      return { requestAccessToken }
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient } } })
    const oauth = new GoogleOAuth(config)

    await expect(oauth.getAccessToken()).resolves.toBe('access-token')
    await expect(oauth.getAccessToken()).resolves.toBe('access-token')

    expect(initTokenClient).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'client-id',
      scope: 'https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/spreadsheets',
    }))
    expect(requestAccessToken).toHaveBeenCalledTimes(1)
    expect(setItem).not.toHaveBeenCalled()
  })

  test('過期後重新要求權杖，且可要求同意畫面', async () => {
    vi.useFakeTimers()
    let callback: ((response: google.accounts.oauth2.TokenResponse) => void) | undefined
    const requestAccessToken = vi.fn(() => callback?.({ access_token: `token-${requestAccessToken.mock.calls.length}`, expires_in: 1 }))
    const initTokenClient = vi.fn((config: google.accounts.oauth2.TokenClientConfig) => {
      callback = config.callback
      return { requestAccessToken }
    })
    vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient } } })
    const oauth = new GoogleOAuth(config)

    await expect(oauth.getAccessToken()).resolves.toBe('token-1')
    vi.advanceTimersByTime(1_000)
    await expect(oauth.getAccessToken('consent')).resolves.toBe('token-2')

    expect(requestAccessToken).toHaveBeenNthCalledWith(2, { prompt: 'consent' })
  })

  test('Google 回傳錯誤時不保留權杖並顯示固定繁中訊息', async () => {
    let callback: ((response: google.accounts.oauth2.TokenResponse) => void) | undefined
    vi.stubGlobal('google', {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((config: google.accounts.oauth2.TokenClientConfig) => {
            callback = config.callback
            return { requestAccessToken: () => callback?.({ error: 'access_denied' }) }
          }),
        },
      },
    })

    await expect(new GoogleOAuth(config).getAccessToken()).rejects.toThrow('Google 登入或授權未完成。')
  })
})

const config: RuntimeConfig = { googleClientId: 'client-id', gasScriptId: 'script-id' }
