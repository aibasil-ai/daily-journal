import { describe, expect, test, vi } from 'vitest'
import {
  GOOGLE_OIDC_ISSUERS,
  GoogleIdentityVerificationError,
  verifyGoogleIdToken,
} from './oidc.js'

describe('Google OIDC 驗證', () => {
  test('透過可注入 JWT verifier 驗證 Google claims，且只回傳允許的 profile 欄位', async () => {
    const verifyJwt = vi.fn(async () => ({
      iss: 'https://accounts.google.com',
      aud: ['another-client', 'client-id'],
      exp: 1_001,
      sub: 'google-sub-1',
      email: 'user@example.com',
      name: '使用者',
      picture: 'https://example.com/avatar.png',
      access_token: 'must-not-leak',
    }))

    await expect(verifyGoogleIdToken('id-token', 'client-id', {
      verifyJwt,
      now: () => 1_000_000,
    })).resolves.toEqual({
      sub: 'google-sub-1',
      email: 'user@example.com',
      name: '使用者',
      picture: 'https://example.com/avatar.png',
    })
    expect(verifyJwt).toHaveBeenCalledWith('id-token', expect.objectContaining({
      issuer: GOOGLE_OIDC_ISSUERS,
      audience: 'client-id',
    }))
  })

  test('拒絕未驗證、錯誤 issuer/audience、過期或空白 sub 的 ID token，且只給安全錯誤', async () => {
    const validPayload = {
      iss: 'https://accounts.google.com',
      aud: 'client-id',
      exp: 1_001,
      sub: 'google-sub-1',
      email: 'user@example.com',
      name: '使用者',
      picture: 'https://example.com/avatar.png',
    }
    const invalidPayloads = [
      { ...validPayload, iss: 'https://attacker.example' },
      { ...validPayload, aud: 'another-client' },
      { ...validPayload, exp: 1_000 },
      { ...validPayload, sub: '   ' },
    ]

    for (const payload of invalidPayloads) {
      await expect(verifyGoogleIdToken('id-token', 'client-id', {
        verifyJwt: async () => payload,
        now: () => 1_000_000,
      })).rejects.toMatchObject({
        name: 'GoogleIdentityVerificationError',
        message: 'Google 身分驗證失敗',
      })
    }

    await expect(verifyGoogleIdToken('id-token', 'client-id', {
      verifyJwt: async () => {
        throw new Error('bad signature')
      },
      now: () => 1_000_000,
    })).rejects.toBeInstanceOf(GoogleIdentityVerificationError)
  })
})
