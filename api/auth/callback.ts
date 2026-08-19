import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  clearAllSessionCookies,
  clearOAuthStateCookie,
  createOAuthStateCookie,
  createProvisioningCookie,
  createSessionCookie,
  OAUTH_STATE_COOKIE_NAME,
  readCookie,
} from '../_lib/cookies'
import { jsonResponse, redirectResponse } from '../_lib/function-response'
import { getFirestoreClient } from '../_lib/firestore'
import { ConnectionStore } from '../_lib/connection-store'
import { SessionStore } from '../_lib/session-store'
import { buildAuthorizationUrl, createPkcePair, exchangeAuthorizationCode } from '../_lib/google-oauth'
import { verifyGoogleIdToken } from '../_lib/oidc'
import { getServerConfig } from '../_lib/server-config'
import { encryptSession } from '../_lib/session-crypto'
import { encryptRefreshToken } from '../_lib/token-crypto'

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
const PROVISIONING_TTL_MS = 1000 * 60 * 20

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const expectedState = readCookie(request.headers.get('Cookie'), OAUTH_STATE_COOKIE_NAME)
  const receivedState = url.searchParams.get('state')

  if (!statesMatch(expectedState, receivedState) || !receivedState) {
    return jsonResponse({ error: 'invalid_oauth_state' }, 400, [clearOAuthStateCookie()])
  }

  const config = getServerConfig()
  const firestore = getFirestoreClient()
  const connectionStore = new ConnectionStore(firestore)
  const sessionStore = new SessionStore(firestore)

  const attempt = await connectionStore.consumeOAuthAttempt(receivedState)
  if (!attempt) {
    return jsonResponse({ error: 'invalid_oauth_state' }, 400, [clearOAuthStateCookie()])
  }

  const code = url.searchParams.get('code')
  if (url.searchParams.has('error') || !code) {
    return redirectResponse('/?auth_error=oauth', [clearOAuthStateCookie()])
  }

  try {
    const tokenResult = await exchangeAuthorizationCode(
      code,
      `${config.appOrigin}/api/auth/callback`,
      attempt.codeVerifier,
      config,
    )

    const identity = await verifyGoogleIdToken(tokenResult.idToken, config)
    const user = await connectionStore.getOrCreateUser({
      googleSub: identity.sub,
      email: identity.email,
      name: identity.name,
      picture: identity.picture,
    })
    const activeConnection = await connectionStore.findActiveConnection(user.id)

    const encryptedToken = tokenResult.refreshToken
      ? encryptRefreshToken(tokenResult.refreshToken, config.tokenEncryptionKey, config.tokenEncryptionKeyVersion)
      : activeConnection?.encryptedRefreshToken

    if (activeConnection) {
      if (tokenResult.refreshToken) {
        await connectionStore.updateEncryptedToken(activeConnection.id, encryptedToken!)
      }
      const { sessionId, expiresAt } = await sessionStore.create({
        userId: user.id,
        kind: 'journal',
        ttlMs: SESSION_TTL_MS,
      })
      const encryptedCookie = encryptSession({ sessionId, expiresAt }, config.sessionEncryptionKey)
      return redirectResponse('/', [
        createSessionCookie(encryptedCookie),
        clearOAuthStateCookie(),
      ])
    }

    if (!encryptedToken) {
      if (attempt.intent !== 'reauthorize') {
        const nextState = randomBytes(32).toString('base64url')
        const nextPkce = createPkcePair()
        await connectionStore.createOAuthAttempt({
          state: nextState,
          codeVerifier: nextPkce.verifier,
          intent: 'reauthorize',
          expiresAt: Date.now() + 10 * 60_000,
        })
        const retryUrl = buildAuthorizationUrl({
          origin: config.appOrigin,
          state: nextState,
          codeChallenge: nextPkce.challenge,
          config,
          promptConsent: true,
        })
        return redirectResponse(retryUrl.toString(), [createOAuthStateCookie(nextState)])
      }

      return redirectResponse('/?auth_error=oauth', [clearOAuthStateCookie(), ...clearAllSessionCookies()])
    }

    const provisioningAttempt = await connectionStore.createProvisioningAttempt({
      userId: user.id,
      mode: 'initial',
      tempEncryptedRefreshToken: encryptedToken,
      ttlMs: PROVISIONING_TTL_MS,
    })

    const { sessionId, expiresAt } = await sessionStore.create({
      userId: user.id,
      kind: 'provisioning',
      provisioningAttemptId: provisioningAttempt.id,
      ttlMs: PROVISIONING_TTL_MS,
    })

    const encryptedCookie = encryptSession({ sessionId, expiresAt }, config.sessionEncryptionKey)
    return redirectResponse('/?setup=1', [
      createProvisioningCookie(encryptedCookie),
      clearOAuthStateCookie(),
    ])
  } catch {
    return redirectResponse('/?auth_error=oauth', [clearOAuthStateCookie(), ...clearAllSessionCookies()])
  }
}

function statesMatch(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false

  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}
