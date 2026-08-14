import { afterEach, describe, expect, test, vi } from 'vitest'
import { GoogleOAuth } from './google-oauth'

afterEach(() => {
  window.google = undefined
  vi.restoreAllMocks()
})

describe('GoogleOAuth', () => {
  test('只在記憶體快取權杖', async () => {
    let callback: ((response: { access_token?: string; expires_in?: number }) => void) | undefined
    const requestAccessToken = vi.fn(() => callback?.({ access_token: 'token', expires_in: 3600 }))
    const initTokenClient = vi.fn((config: { callback: typeof callback }) => {
      callback = config.callback
      return { callback: config.callback, requestAccessToken }
    })
    window.google = {
      accounts: { oauth2: { initTokenClient } },
    } as never
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const oauth = new GoogleOAuth({ googleClientId: 'client-id' })

    await expect(oauth.getAccessToken('consent')).resolves.toBe('token')
    await expect(oauth.getAccessToken()).resolves.toBe('token')

    expect(initTokenClient).toHaveBeenCalledTimes(1)
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: 'consent' })
    expect(setItem).not.toHaveBeenCalled()
  })
})
