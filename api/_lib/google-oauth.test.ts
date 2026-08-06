import { describe, expect, test, vi } from 'vitest'
import type { ServerConfig } from './server-config.js'
import { buildAuthorizationUrl, exchangeAuthorizationCode } from './google-oauth.js'

const config: ServerConfig = {
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  sessionEncryptionKey: Buffer.alloc(32, 1),
  gasDeploymentId: 'deployment-id',
}

describe('Google OAuth helpers', () => {
  test('建立含有離線存取、既有 scope 與 CSRF state 的授權網址', () => {
    const url = buildAuthorizationUrl('https://journal.example', 'csrf-state', config)

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-id',
      redirect_uri: 'https://journal.example/api/auth/callback',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: 'csrf-state',
      scope: 'https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/spreadsheets',
    })
  })

  test('以表單格式交換授權碼並只取得 refresh token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-token-must-not-leave-server',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
    }), { status: 200 }))

    await expect(exchangeAuthorizationCode(
      'authorization-code',
      'https://journal.example/api/auth/callback',
      config,
      fetchImpl,
    )).resolves.toEqual({ refreshToken: 'refresh-token' })

    expect(fetchImpl).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=authorization-code&client_id=client-id&client_secret=client-secret&redirect_uri=https%3A%2F%2Fjournal.example%2Fapi%2Fauth%2Fcallback&grant_type=authorization_code',
    })
  })

  test('交換結果沒有 refresh token 時拒絕建立工作階段', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-token-must-not-leave-server',
      expires_in: 3600,
      token_type: 'Bearer',
    }), { status: 200 }))

    await expect(exchangeAuthorizationCode(
      'authorization-code',
      'https://journal.example/api/auth/callback',
      config,
      fetchImpl,
    )).rejects.toThrow()
  })
})
