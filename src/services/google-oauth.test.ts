// @vitest-environment jsdom

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

  test('無提示權杖需要互動時改以同意畫面完成登入', async () => {
    let callback: ((response: google.accounts.oauth2.TokenResponse) => void) | undefined
    const requestAccessToken = vi.fn(() => {
      callback?.(requestAccessToken.mock.calls.length === 1
        ? { error: 'interaction_required' }
        : { access_token: 'access-token', expires_in: 3600 })
    })
    const initTokenClient = vi.fn((config: google.accounts.oauth2.TokenClientConfig) => {
      callback = config.callback
      return { requestAccessToken }
    })
    vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient } } })
    const oauth = new GoogleOAuth(config)

    await expect(oauth.signIn()).resolves.toBeUndefined()

    expect(requestAccessToken).toHaveBeenNthCalledWith(1, { prompt: '' })
    expect(requestAccessToken).toHaveBeenNthCalledWith(2, { prompt: 'consent' })
  })

  test.each([
    {
      scenario: 'callback 回傳 access_denied',
      requestCount: 1,
      install: (recordRequest: (prompt: string | undefined) => void) => {
        vi.stubGlobal('google', {
          accounts: {
            oauth2: {
              initTokenClient: vi.fn((tokenConfig: google.accounts.oauth2.TokenClientConfig) => ({
                requestAccessToken: (overrideConfig: { prompt?: string } | undefined) => {
                  recordRequest(overrideConfig?.prompt)
                  tokenConfig.callback({ error: 'access_denied' })
                },
              })),
            },
          },
        })
      },
    },
    {
      scenario: 'GIS SDK 不存在',
      requestCount: 0,
      install: () => {},
    },
    {
      scenario: 'error_callback',
      requestCount: 1,
      install: (recordRequest: (prompt: string | undefined) => void) => {
        vi.stubGlobal('google', {
          accounts: {
            oauth2: {
              initTokenClient: vi.fn((tokenConfig: google.accounts.oauth2.TokenClientConfig) => ({
                requestAccessToken: (overrideConfig: { prompt?: string } | undefined) => {
                  recordRequest(overrideConfig?.prompt)
                  tokenConfig.error_callback?.()
                },
              })),
            },
          },
        })
      },
    },
    {
      scenario: 'requestAccessToken 同步例外',
      requestCount: 1,
      install: (recordRequest: (prompt: string | undefined) => void) => {
        vi.stubGlobal('google', {
          accounts: {
            oauth2: {
              initTokenClient: vi.fn(() => ({
                requestAccessToken: (overrideConfig: { prompt?: string } | undefined) => {
                  recordRequest(overrideConfig?.prompt)
                  throw new Error('request failed')
                },
              })),
            },
          },
        })
      },
    },
    {
      scenario: 'callback 回傳空權杖',
      requestCount: 1,
      install: (recordRequest: (prompt: string | undefined) => void) => {
        vi.stubGlobal('google', {
          accounts: {
            oauth2: {
              initTokenClient: vi.fn((tokenConfig: google.accounts.oauth2.TokenClientConfig) => ({
                requestAccessToken: (overrideConfig: { prompt?: string } | undefined) => {
                  recordRequest(overrideConfig?.prompt)
                  tokenConfig.callback({ access_token: '', expires_in: 3600 })
                },
              })),
            },
          },
        })
      },
    },
  ])('signIn() 在 $scenario 時不提出第二次 consent 請求', async ({ install, requestCount }) => {
    const requestedPrompts: (string | undefined)[] = []
    install((prompt) => requestedPrompts.push(prompt))

    await expect(new GoogleOAuth(config).signIn()).rejects.toBeInstanceOf(Error)

    expect(requestedPrompts).toHaveLength(requestCount)
    expect(requestedPrompts).not.toContain('consent')
  })

  test('過期後以無提示方式重新要求權杖', async () => {
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
    await expect(oauth.getAccessToken()).resolves.toBe('token-2')

    expect(requestAccessToken).toHaveBeenNthCalledWith(2, { prompt: '' })
  })

  test('清除權杖後不重用舊權杖', async () => {
    let callback: ((response: google.accounts.oauth2.TokenResponse) => void) | undefined
    const requestAccessToken = vi.fn(() => callback?.({ access_token: `token-${requestAccessToken.mock.calls.length}`, expires_in: 3600 }))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    vi.stubGlobal('google', {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((tokenConfig: google.accounts.oauth2.TokenClientConfig) => {
            callback = tokenConfig.callback
            return { requestAccessToken }
          }),
        },
      },
    })
    const oauth = new GoogleOAuth(config)

    await expect(oauth.getAccessToken()).resolves.toBe('token-1')
    oauth.clearAccessToken()
    await expect(oauth.getAccessToken()).resolves.toBe('token-2')

    expect(requestAccessToken).toHaveBeenCalledTimes(2)
    expect(setItem).not.toHaveBeenCalled()
  })

  test('登出使等待中的 GIS 成功 callback 失效，後續請求重新初始化 client', async () => {
    const tokenConfigs: google.accounts.oauth2.TokenClientConfig[] = []
    const requestAccessToken = vi.fn()
    const initTokenClient = vi.fn((tokenConfig: google.accounts.oauth2.TokenClientConfig) => {
      tokenConfigs.push(tokenConfig)
      return { requestAccessToken }
    })
    vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient } } })
    const oauth = new GoogleOAuth(config)

    const staleRequest = oauth.getAccessToken()
    oauth.clearAccessToken()
    tokenConfigs[0].callback({ access_token: 'stale-token', expires_in: 3600 })

    await expect(staleRequest).rejects.toBeInstanceOf(Error)

    const currentRequest = oauth.getAccessToken()
    expect(initTokenClient).toHaveBeenCalledTimes(2)
    tokenConfigs[1].callback({ access_token: 'new-token', expires_in: 3600 })

    await expect(currentRequest).resolves.toBe('new-token')
    expect(requestAccessToken).toHaveBeenCalledTimes(2)
  })

  test('過期 GIS error_callback 不會清除後來登入取得的權杖', async () => {
    const tokenConfigs: google.accounts.oauth2.TokenClientConfig[] = []
    const initTokenClient = vi.fn((tokenConfig: google.accounts.oauth2.TokenClientConfig) => {
      tokenConfigs.push(tokenConfig)
      return { requestAccessToken: vi.fn() }
    })
    vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient } } })
    const oauth = new GoogleOAuth(config)

    const staleRequest = oauth.getAccessToken()
    oauth.clearAccessToken()
    const currentRequest = oauth.getAccessToken()
    tokenConfigs[1].callback({ access_token: 'new-token', expires_in: 3600 })
    await expect(currentRequest).resolves.toBe('new-token')

    tokenConfigs[0].error_callback?.()

    await expect(staleRequest).rejects.toBeInstanceOf(Error)
    const cachedToken = oauth.getAccessToken()
    expect(initTokenClient).toHaveBeenCalledTimes(2)
    await expect(cachedToken).resolves.toBe('new-token')
  })

  test.each([
    ['interaction_required', (tokenConfig: google.accounts.oauth2.TokenClientConfig) => tokenConfig.callback({ error: 'interaction_required' })],
    ['其他 callback error', (tokenConfig: google.accounts.oauth2.TokenClientConfig) => tokenConfig.callback({ error: 'access_denied' })],
    ['error_callback', (tokenConfig: google.accounts.oauth2.TokenClientConfig) => tokenConfig.error_callback?.()],
    ['requestAccessToken 同步例外', () => { throw new Error('request failed') }],
  ])('%s 失敗後不重用過期前取得的權杖', async (_, failRequest) => {
    vi.useFakeTimers()
    const startTime = new Date('2026-08-05T00:00:00.000Z')
    vi.setSystemTime(startTime)
    let attempt = 0
    const initTokenClient = vi.fn((tokenConfig: google.accounts.oauth2.TokenClientConfig) => {
      attempt += 1
      return {
        requestAccessToken: () => {
          if (attempt === 1) tokenConfig.callback({ access_token: 'token-1', expires_in: 1 })
          else if (attempt === 2) failRequest(tokenConfig)
          else tokenConfig.callback({ access_token: 'token-2', expires_in: 3600 })
        },
      }
    })
    vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient } } })
    const oauth = new GoogleOAuth(config)

    await expect(oauth.getAccessToken()).resolves.toBe('token-1')
    vi.advanceTimersByTime(1_000)
    await expect(oauth.getAccessToken()).rejects.toBeInstanceOf(Error)
    vi.setSystemTime(new Date(startTime.getTime() + 999))
    await expect(oauth.getAccessToken()).resolves.toBe('token-2')

    expect(initTokenClient).toHaveBeenCalledTimes(3)
  })

  test('initTokenClient 同步例外後不重用過期前取得的權杖', async () => {
    vi.useFakeTimers()
    const startTime = new Date('2026-08-05T00:00:00.000Z')
    vi.setSystemTime(startTime)
    let attempt = 0
    const initTokenClient = vi.fn((tokenConfig: google.accounts.oauth2.TokenClientConfig) => {
      attempt += 1
      if (attempt === 2) throw new Error('initialization failed')
      return {
        requestAccessToken: () => tokenConfig.callback({
          access_token: attempt === 1 ? 'token-1' : 'token-2',
          expires_in: attempt === 1 ? 1 : 3600,
        }),
      }
    })
    vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient } } })
    const oauth = new GoogleOAuth(config)

    await expect(oauth.getAccessToken()).resolves.toBe('token-1')
    vi.advanceTimersByTime(1_000)
    await expect(oauth.getAccessToken()).rejects.toThrow('initialization failed')
    vi.setSystemTime(new Date(startTime.getTime() + 999))
    await expect(oauth.getAccessToken()).resolves.toBe('token-2')

    expect(initTokenClient).toHaveBeenCalledTimes(3)
  })

  test('GIS SDK 不存在後不重用過期前取得的權杖', async () => {
    vi.useFakeTimers()
    const startTime = new Date('2026-08-05T00:00:00.000Z')
    vi.setSystemTime(startTime)
    const firstInitTokenClient = vi.fn((tokenConfig: google.accounts.oauth2.TokenClientConfig) => ({
      requestAccessToken: () => tokenConfig.callback({ access_token: 'token-1', expires_in: 1 }),
    }))
    vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient: firstInitTokenClient } } })
    const oauth = new GoogleOAuth(config)

    await expect(oauth.getAccessToken()).resolves.toBe('token-1')
    vi.advanceTimersByTime(1_000)
    vi.stubGlobal('google', undefined)
    await expect(oauth.getAccessToken()).rejects.toThrow(
      'Google 登入服務尚未載入。請確認網路連線後重新整理頁面，再重新登入。',
    )
    const nextInitTokenClient = vi.fn((tokenConfig: google.accounts.oauth2.TokenClientConfig) => ({
      requestAccessToken: () => tokenConfig.callback({ access_token: 'token-2', expires_in: 3600 }),
    }))
    vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient: nextInitTokenClient } } })
    vi.setSystemTime(new Date(startTime.getTime() + 999))
    await expect(oauth.getAccessToken()).resolves.toBe('token-2')

    expect(firstInitTokenClient).toHaveBeenCalledTimes(1)
    expect(nextInitTokenClient).toHaveBeenCalledTimes(1)
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

  test('GIS SDK 未載入時提供可操作的固定繁中訊息', async () => {
    await expect(new GoogleOAuth(config).getAccessToken()).rejects.toThrow(
      'Google 登入服務尚未載入。請確認網路連線後重新整理頁面，再重新登入。',
    )
  })

  test('GIS SDK 缺少 initTokenClient 時提供可操作的固定繁中訊息', async () => {
    vi.stubGlobal('google', { accounts: { oauth2: {} } })

    await expect(new GoogleOAuth(config).getAccessToken()).rejects.toThrow(
      'Google 登入服務尚未載入。請確認網路連線後重新整理頁面，再重新登入。',
    )
  })
})

const config: RuntimeConfig = { googleClientId: 'client-id', gasDeploymentId: 'deployment-id' }
