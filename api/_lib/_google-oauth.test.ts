import { describe, expect, test, vi } from 'vitest'
import {
  InvalidRefreshTokenError,
  buildAuthorizationUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  refreshAccessToken,
  refreshGoogleCredentials,
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
  firestoreCredentials: { clientEmail: 'a@b.com', privateKey: 'pk' },
  legacyMigrationSecret: 'm'.repeat(32),
  cronSecret: 'c'.repeat(32),
}

describe('Google OAuth helper', () => {
  test('建立含 PKCE 參數且無 prompt=consent 的授權 URL', () => {
    const pkce = createPkcePair()
    const url = buildAuthorizationUrl({
      origin: 'https://journal.example/some-path',
      state: 'csrf-state',
      codeChallenge: pkce.challenge,
      config,
    })

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const params = Object.fromEntries(url.searchParams)
    expect(params).toMatchObject({
      client_id: 'client-id',
      redirect_uri: 'https://journal.example/api/auth/callback',
      response_type: 'code',
      access_type: 'offline',
      include_granted_scopes: 'true',
      state: 'csrf-state',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    })
    expect(params.prompt).toBeUndefined()
    expect(params.scope).toContain('spreadsheets')
    expect(params.scope).toContain('drive.metadata.readonly')
    expect(params.scope).toContain('drive.file')
    expect(params.scope).not.toContain('script.projects')
  })

  test('明確要求重新授權時加入 prompt=consent', () => {
    const url = buildAuthorizationUrl({
      origin: 'https://journal.example',
      state: 'csrf-state',
      codeChallenge: 'challenge',
      config,
      promptConsent: true,
    })
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  test('以授權碼與 code_verifier 交換 tokens', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'access-token',
      id_token: 'id-token',
      refresh_token: 'refresh-token',
    })))

    const result = await exchangeAuthorizationCode(
      'auth-code',
      'https://journal.example/api/auth/callback',
      'verifier-123',
      config,
      fetchMock as typeof fetch,
    )

    expect(result).toEqual({
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
    })
  })

  test('既有使用者未收到新 refresh token 時仍可成功換取 id_token 與 access_token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'access-token',
      id_token: 'id-token',
    })))

    const result = await exchangeAuthorizationCode(
      'auth-code',
      'https://journal.example/api/auth/callback',
      'verifier-123',
      config,
      fetchMock as typeof fetch,
    )

    expect(result).toEqual({
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: undefined,
    })
  })

  test('refreshGoogleCredentials 成功更新憑證', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'new-access',
      refresh_token: 'rotated-refresh',
    })))

    const creds = await refreshGoogleCredentials('old-refresh', config, fetchMock as typeof fetch)
    expect(creds).toEqual({
      accessToken: 'new-access',
      refreshToken: 'rotated-refresh',
    })
  })

  test('refresh token 失效時分類為 InvalidRefreshTokenError', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))

    await expect(refreshAccessToken('bad-refresh', config, fetchMock as typeof fetch))
      .rejects.toBeInstanceOf(InvalidRefreshTokenError)
  })
})
