import { createRemoteJWKSet, jwtVerify } from 'jose'

const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs')

export const GOOGLE_OIDC_ISSUERS = [
  'https://accounts.google.com',
  'accounts.google.com',
] as const

export type GoogleIdentity = {
  sub: string
  email: string
  name: string
  picture: string
}

export type VerifyJwt = (
  token: string,
  options: { issuer: string[]; audience: string },
) => Promise<unknown>

export type OidcVerificationDependencies = {
  verifyJwt?: VerifyJwt
  now?: () => number
}

export class GoogleIdentityVerificationError extends Error {
  constructor() {
    super('Google 身分驗證失敗')
    this.name = 'GoogleIdentityVerificationError'
  }
}

const googleJwks = createRemoteJWKSet(GOOGLE_JWKS_URL)

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  dependencies: OidcVerificationDependencies = {},
): Promise<GoogleIdentity> {
  try {
    if (!idToken || !clientId) throw new GoogleIdentityVerificationError()
    const payload = await (dependencies.verifyJwt ?? verifyWithGoogleJwks)(idToken, {
      issuer: [...GOOGLE_OIDC_ISSUERS],
      audience: clientId,
    })
    return identityFromPayload(payload, clientId, dependencies.now ?? Date.now)
  } catch {
    throw new GoogleIdentityVerificationError()
  }
}

async function verifyWithGoogleJwks(
  token: string,
  options: { issuer: string[]; audience: string },
): Promise<unknown> {
  const { payload } = await jwtVerify(token, googleJwks, {
    issuer: options.issuer,
    audience: options.audience,
    algorithms: ['RS256'],
  })
  return payload
}

function identityFromPayload(payload: unknown, clientId: string, now: () => number): GoogleIdentity {
  if (!isRecord(payload)
    || !GOOGLE_OIDC_ISSUERS.includes(payload.iss as typeof GOOGLE_OIDC_ISSUERS[number])
    || !hasAudience(payload.aud, clientId)
    || typeof payload.exp !== 'number'
    || !Number.isFinite(payload.exp)
    || payload.exp <= now() / 1_000
    || typeof payload.sub !== 'string'
    || !payload.sub.trim()) {
    throw new GoogleIdentityVerificationError()
  }

  return {
    sub: payload.sub.trim(),
    email: profileString(payload.email),
    name: profileString(payload.name),
    picture: profileString(payload.picture),
  }
}

function hasAudience(value: unknown, clientId: string): boolean {
  return value === clientId || (Array.isArray(value) && value.some((audience) => audience === clientId))
}

function profileString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
