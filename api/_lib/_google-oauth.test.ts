import { describe, expect, test, vi } from 'vitest'
import {
  GoogleOAuthUpstreamError,
  InvalidRefreshTokenError,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from './google-oauth'
import type { ServerConfig } from './server-config'

const config: ServerConfig = {
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  sessionEncryptionKey: Buffer.alloc(32, 1),
  gasDeploymentId: 'AKfycbDeploymentId',
}

describe('Google OAuth helper', () => {
  test('建立含必要參數的授權 URL', () => {
    const url = buildAuthorizationUrl('https://journal.example/some-path', 'csrf-state', config)

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-id',
      redirect_uri: 'https://journal.example/api/auth/callback',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: 'csrf-state',
    })
  })

  test('以表單資料交換授權碼', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ refresh_token: 'refresh-token' })))

    await expect(exchangeAuthorizationCode('authorization-code', 'https://journal.example/api/auth/callback', config, fetchMock as typeof fetch))
      .resolves.toEqual({ refreshToken: 'refresh-token' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    )
    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(Object.fromEntries(new URLSearchParams(options.body as string))).toMatchObject({
      code: 'authorization-code',
      client_id: 'client-id',
      client_secret: 'client-secret',
      grant_type: 'authorization_code',
    })
  })

  test('授權碼交換未取得 refresh token 時拒絕', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'short-lived' })))

    await expect(exchangeAuthorizationCode('authorization-code', 'https://journal.example/api/auth/callback', config, fetchMock as typeof fetch))
      .rejects.toBeInstanceOf(GoogleOAuthUpstreamError)
  })

  test('refresh token 失效或遭拒絕時分類為登入失效', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))

    await expect(refreshAccessToken('refresh-token', config, fetchMock as typeof fetch))
      .rejects.toBeInstanceOf(InvalidRefreshTokenError)
  })
})
