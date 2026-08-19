import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { ServerConfig } from './server-config'

const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs')
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

let googleJwks: ReturnType<typeof createRemoteJWKSet> | undefined

function getGoogleJwks() {
  return (googleJwks ??= createRemoteJWKSet(GOOGLE_JWKS_URL))
}

export type GoogleUserIdentity = {
  sub: string
  email: string
  name: string
  picture: string
}

export async function verifyGoogleIdToken(
  idToken: string,
  config: ServerConfig,
  verifyJwtImpl?: typeof jwtVerify,
): Promise<GoogleUserIdentity> {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Google 身分驗證失敗：缺少 ID token。')
  }

  try {
    const verifier = verifyJwtImpl ?? jwtVerify
    const keySet = verifyJwtImpl
      ? (async () => ({} as unknown as Parameters<typeof jwtVerify>[1]))
      : getGoogleJwks()
    const { payload } = await verifier(idToken, keySet as Parameters<typeof jwtVerify>[1], {
      issuer: GOOGLE_ISSUERS,
      audience: config.googleClientId,
    })

    const sub = typeof payload.sub === 'string' ? payload.sub.trim() : ''
    const email = typeof payload.email === 'string' ? payload.email.trim() : ''
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    const picture = typeof payload.picture === 'string' ? payload.picture.trim() : ''

    if (!sub) {
      throw new Error('Google 身分驗證失敗：缺少 sub 識別碼。')
    }

    return { sub, email, name, picture }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Google 身分驗證失敗')) {
      throw error
    }
    throw new Error('Google 身分驗證失敗：ID token 簽章或欄位無效。')
  }
}
