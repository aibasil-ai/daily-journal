import { createHash } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import {
  GOOGLE_OAUTH_SCOPES,
  GoogleOAuthUpstreamError,
  InvalidRefreshTokenError,
  buildAuthorizationUrl,
  createCodeVerifier,
  exchangeAuthorizationCode,
  refreshGoogleCredentials,
  refreshAccessToken,
} from './google-oauth'
import type { ServerConfig } from './server-config'

const config: ServerConfig = {
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  appOrigin: 'https://journal.example',
  sessionEncryptionKey: Buffer.alloc(32, 1),
  tokenEncryptionKey: Buffer.alloc(32, 2),
  tokenEncryptionKeyVersion: 'v1',
  firestoreProjectId: 'journal-production',
  firestoreCredentials: {
    clientEmail: 'journal-api@journal-production.iam.gserviceaccount.com',
    privateKey: 'private-key',
  },
  legacyMigrationSecret: 'm'.repeat(32),
  cronSecret: 'c'.repeat(32),
}

describe('Google OAuth helper', () => {
  test('以固定 APP_ORIGIN、PKCE S256 與精確 scopes 建立一般授權 URL', () => {
    const codeVerifier = 'v'.repeat(64)
    const url = buildAuthorizationUrl('csrf-state', codeVerifier, config)

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-id',
      redirect_uri: 'https://journal.example/api/auth/callback',
      response_type: 'code',
      access_type: 'offline',
      include_granted_scopes: 'true',
      state: 'csrf-state',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    })
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ])
    expect(url.searchParams.get('scope')).toBe(GOOGLE_OAUTH_SCOPES.join(' '))
    expect(url.searchParams.has('prompt')).toBe(false)
    expect(url.searchParams.get('scope')).not.toContain('script.projects')
  })

  test('只有明確重新授權才加入 consent prompt，且 verifier 符合 PKCE 長度與熵來源', () => {
    const firstVerifier = createCodeVerifier()
    const secondVerifier = createCodeVerifier()
    const url = buildAuthorizationUrl('csrf-state', firstVerifier, config, { reauthorize: true })

    expect(firstVerifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(firstVerifier.length).toBeGreaterThanOrEqual(43)
    expect(firstVerifier.length).toBeLessThanOrEqual(128)
    expect(secondVerifier).not.toBe(firstVerifier)
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  test('以固定 callback URI、PKCE verifier 交換授權碼並回傳短效與長效憑證', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id_token: 'id-token',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      scope: 'openid email profile https://www.googleapis.com/auth/spreadsheets',
    })))

    await expect(exchangeAuthorizationCode('authorization-code', 'pkce-verifier', config, fetchMock as typeof fetch))
      .resolves.toEqual({
        idToken: 'id-token',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/spreadsheets'],
      })

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
      redirect_uri: 'https://journal.example/api/auth/callback',
      grant_type: 'authorization_code',
      code_verifier: 'pkce-verifier',
    })
  })

  test('授權碼交換將缺少的 scope 保留為 absent，但明確空 scope 仍是覆寫值', async () => {
    const withoutRefreshToken = vi.fn(async () => new Response(JSON.stringify({
      id_token: 'id-token',
      access_token: 'short-lived',
    })))
    const explicitEmptyScope = vi.fn(async () => new Response(JSON.stringify({
      id_token: 'id-token',
      access_token: 'short-lived',
      scope: '',
    })))
    const missingIdToken = vi.fn(async () => new Response(JSON.stringify({ access_token: 'short-lived' })))

    await expect(exchangeAuthorizationCode('authorization-code', 'pkce-verifier', config, withoutRefreshToken as typeof fetch))
      .resolves.toEqual({
        idToken: 'id-token',
        accessToken: 'short-lived',
      })
    await expect(exchangeAuthorizationCode('authorization-code', 'pkce-verifier', config, explicitEmptyScope as typeof fetch))
      .resolves.toEqual({
        idToken: 'id-token',
        accessToken: 'short-lived',
        scopes: [],
      })
    await expect(exchangeAuthorizationCode('authorization-code', 'pkce-verifier', config, missingIdToken as typeof fetch))
      .rejects.toBeInstanceOf(GoogleOAuthUpstreamError)
  })

  test('更新 Google 憑證不記錄 token，並將失效 refresh token 分類為登入失效', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const credentialsFetch = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'server-access-token',
      refresh_token: 'rotated-refresh-token',
      scope: 'openid https://www.googleapis.com/auth/spreadsheets',
    })))
    const withoutScope = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'server-access-token',
    })))
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))

    await expect(refreshGoogleCredentials('refresh-token', config, credentialsFetch as typeof fetch))
      .resolves.toEqual({
        accessToken: 'server-access-token',
        refreshToken: 'rotated-refresh-token',
        scopes: ['openid', 'https://www.googleapis.com/auth/spreadsheets'],
      })
    await expect(refreshAccessToken('refresh-token', config, credentialsFetch as typeof fetch))
      .resolves.toBe('server-access-token')
    await expect(refreshGoogleCredentials('refresh-token', config, withoutScope as typeof fetch))
      .resolves.toEqual({ accessToken: 'server-access-token' })
    await expect(refreshGoogleCredentials('refresh-token', config, fetchMock as typeof fetch))
      .rejects.toBeInstanceOf(InvalidRefreshTokenError)
    const invalidClient = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }))
    await expect(refreshGoogleCredentials('refresh-token', config, invalidClient as typeof fetch))
      .rejects.toBeInstanceOf(GoogleOAuthUpstreamError)
    expect(consoleLog).not.toHaveBeenCalled()
  })
})
