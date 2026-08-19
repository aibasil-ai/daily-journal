import { describe, expect, test, vi } from 'vitest'
import { verifyGoogleIdToken } from './oidc'
import type { ServerConfig } from './server-config'

const fakeConfig: ServerConfig = {
  googleClientId: 'expected-client-id',
  googleClientSecret: 'client-secret',
  appOrigin: 'https://journal.example',
  sessionEncryptionKey: Buffer.alloc(32, 1),
  tokenEncryptionKey: Buffer.alloc(32, 2),
  tokenEncryptionKeyVersion: 'v1',
  firestoreProjectId: 'test-project',
  firestoreCredentials: { clientEmail: 'a@b.com', privateKey: 'pk' },
  legacyMigrationSecret: 'm'.repeat(32),
  cronSecret: 'c'.repeat(32),
}

describe('verifyGoogleIdToken', () => {
  test('驗證成功的 Google ID token', async () => {
    const verifyJwt = vi.fn(async () => ({
      payload: {
        sub: 'google-sub-123',
        email: 'person@example.com',
        name: 'Person Example',
        picture: 'https://example.com/avatar.png',
      },
      protectedHeader: { alg: 'RS256' },
    })) as any

    await expect(verifyGoogleIdToken('valid-token', fakeConfig, verifyJwt)).resolves.toEqual({
      sub: 'google-sub-123',
      email: 'person@example.com',
      name: 'Person Example',
      picture: 'https://example.com/avatar.png',
    })

    expect(verifyJwt).toHaveBeenCalledWith('valid-token', expect.anything(), {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: 'expected-client-id',
    })
  })

  test('拒絕驗證失敗或無效 audience', async () => {
    const verifyJwt = vi.fn(async () => {
      throw new Error('jwt audience invalid')
    }) as any

    await expect(verifyGoogleIdToken('bad-aud', fakeConfig, verifyJwt))
      .rejects.toThrow('Google 身分驗證失敗')
  })

  test('拒絕空白 sub', async () => {
    const verifyJwt = vi.fn(async () => ({
      payload: { sub: '' },
      protectedHeader: { alg: 'RS256' },
    })) as any

    await expect(verifyGoogleIdToken('token', fakeConfig, verifyJwt))
      .rejects.toThrow('Google 身分驗證失敗：缺少 sub 識別碼')
  })
})
