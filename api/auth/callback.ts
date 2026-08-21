import { timingSafeEqual } from 'node:crypto'
import type { ConnectionStore } from '../_lib/connection-store.js'
import { ConnectionStore as FirestoreConnectionStore } from '../_lib/connection-store.js'
import {
  clearAllSessionCookies,
  clearOAuthStateCookie,
  clearProvisioningCookie,
  clearSessionCookie,
  createProvisioningCookie,
  createSessionCookie,
  OAUTH_STATE_COOKIE_NAME,
  PROVISIONING_COOKIE_NAME,
  readCookie,
  SESSION_COOKIE_NAME,
} from '../_lib/cookies.js'
import { getFirestoreClient } from '../_lib/firestore.js'
import { jsonResponse, methodNotAllowed, redirectResponse } from '../_lib/function-response.js'
import {
  exchangeAuthorizationCode,
  type GoogleAuthorizationCodeCredentials,
} from '../_lib/google-oauth.js'
import { type GoogleIdentity, verifyGoogleIdToken } from '../_lib/oidc.js'
import { getServerConfig, type ServerConfig } from '../_lib/server-config.js'
import { decryptSession, encryptSession } from '../_lib/session-crypto.js'
import { SessionStore } from '../_lib/session-store.js'
import { encryptRefreshToken } from '../_lib/token-crypto.js'

export const JOURNAL_SESSION_TTL_MS = 30 * 24 * 60 * 60_000
export const PROVISIONING_SESSION_TTL_MS = 20 * 60_000

type ExchangeAuthorizationCode = (
  code: string,
  codeVerifier: string,
  config: ServerConfig,
) => Promise<GoogleAuthorizationCodeCredentials>

type VerifyGoogleIdToken = (idToken: string, clientId: string) => Promise<GoogleIdentity>

export type CallbackHandlerDependencies = {
  config: ServerConfig
  connectionStore: Pick<
    ConnectionStore,
    | 'consumeOAuthAttempt'
    | 'getOrCreateUser'
    | 'findActiveConnection'
    | 'updateActiveConnectionCredentialsIfCurrent'
    | 'createProvisioningAttempt'
  >
  sessionStore: Pick<SessionStore, 'create' | 'revokeSession'>
  exchangeAuthorizationCode?: ExchangeAuthorizationCode
  verifyGoogleIdToken?: VerifyGoogleIdToken
  encryptRefreshToken?: typeof encryptRefreshToken
  encryptSession?: typeof encryptSession
  decryptSession?: typeof decryptSession
}

export function createCallbackHandler(
  dependencies: CallbackHandlerDependencies,
): (request: Request) => Promise<Response> {
  const exchange = dependencies.exchangeAuthorizationCode ?? exchangeAuthorizationCode
  const verifyIdentity = dependencies.verifyGoogleIdToken ?? verifyGoogleIdToken
  const sealRefreshToken = dependencies.encryptRefreshToken ?? encryptRefreshToken
  const sealSession = dependencies.encryptSession ?? encryptSession
  const decrypt = dependencies.decryptSession ?? decryptSession

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const cookieHeader = request.headers.get('Cookie')
    const expectedState = readCookie(cookieHeader, OAUTH_STATE_COOKIE_NAME)
    const receivedState = url.searchParams.get('state')
    if (!receivedState || !statesMatch(expectedState, receivedState)) {
      return invalidOAuthStateFailure()
    }

    let attempt: Awaited<ReturnType<ConnectionStore['consumeOAuthAttempt']>>
    try {
      attempt = await dependencies.connectionStore.consumeOAuthAttempt(receivedState)
    } catch {
      return invalidOAuthStateFailure()
    }
    if (!attempt) return invalidOAuthStateFailure()

    const sessionIds = browserSessionIds(cookieHeader, decrypt, dependencies.config.sessionEncryptionKey)
    let sessionsRevoked = false
    const revokeBrowserSessions = async (): Promise<Response | undefined> => {
      if (sessionsRevoked) return undefined
      try {
        for (const sessionId of sessionIds) {
          await dependencies.sessionStore.revokeSession(sessionId)
        }
        sessionsRevoked = true
        return undefined
      } catch {
        return oauthUnavailableFailure()
      }
    }
    const authenticatedFailure = async (location: string = '/?auth_error=oauth'): Promise<Response> => {
      const revocationFailure = await revokeBrowserSessions()
      return revocationFailure ?? redirectResponse(location, clearAuthenticationCookies())
    }

    const code = url.searchParams.get('code')
    if (url.searchParams.has('error') || !code) return authenticatedFailure()

    try {
      const credentials = await exchange(code, attempt.codeVerifier, dependencies.config)
      const identity = await verifyIdentity(credentials.idToken, dependencies.config.googleClientId)
      const revocationFailure = await revokeBrowserSessions()
      if (revocationFailure) return revocationFailure
      const user = await dependencies.connectionStore.getOrCreateUser({
        googleSub: identity.sub,
        email: identity.email,
        name: identity.name,
        picture: identity.picture,
      })
      const connection = await dependencies.connectionStore.findActiveConnection(user.id)

      if (connection) {
        if (credentials.refreshToken || credentials.scopes !== undefined) {
          const updated = await dependencies.connectionStore.updateActiveConnectionCredentialsIfCurrent({
            userId: user.id,
            connectionId: connection.id,
            expectedConnectionVersion: connection.connectionVersion,
            ...(credentials.refreshToken === undefined
              ? {}
              : {
                encryptedRefreshToken: sealRefreshToken(
                  credentials.refreshToken,
                  dependencies.config.tokenEncryptionKey,
                  dependencies.config.tokenEncryptionKeyVersion,
                ),
              }),
            ...(credentials.scopes === undefined ? {} : { scopes: credentials.scopes }),
          })
          if (!updated) throw new Error('連線憑證已變更。')
        }
        const session = await dependencies.sessionStore.create({
          userId: user.id,
          kind: 'journal',
          ttlMs: JOURNAL_SESSION_TTL_MS,
        })
        return redirectResponse('/', [
          createSessionCookie(sealSession(session, dependencies.config.sessionEncryptionKey)),
          clearProvisioningCookie(),
          clearOAuthStateCookie(),
        ])
      }

      if (!credentials.refreshToken) {
        return attempt.intent === 'sign-in'
          ? authenticatedFailure('/api/auth/start?reauthorize=1')
          : authenticatedFailure()
      }

      const provisioningAttempt = await dependencies.connectionStore.createProvisioningAttempt({
        userId: user.id,
        mode: 'initial',
        tempEncryptedRefreshToken: sealRefreshToken(
          credentials.refreshToken,
          dependencies.config.tokenEncryptionKey,
          dependencies.config.tokenEncryptionKeyVersion,
        ),
        ...(credentials.scopes === undefined ? {} : { tempScopes: credentials.scopes }),
        ttlMs: PROVISIONING_SESSION_TTL_MS,
      })
      const session = await dependencies.sessionStore.create({
        userId: user.id,
        kind: 'provisioning',
        provisioningAttemptId: provisioningAttempt.id,
        ttlMs: PROVISIONING_SESSION_TTL_MS,
      })
      return redirectResponse('/?setup=1', [
        clearSessionCookie(),
        createProvisioningCookie(sealSession(session, dependencies.config.sessionEncryptionKey)),
        clearOAuthStateCookie(),
      ])
    } catch {
      return authenticatedFailure()
    }
  }
}

export async function GET(request: Request): Promise<Response> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  return createCallbackHandler({
    config,
    connectionStore: new FirestoreConnectionStore(firestore),
    sessionStore: new SessionStore(firestore),
  })(request)
}

export function POST(): Response {
  return methodNotAllowed('GET')
}

function statesMatch(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false
  const expectedBytes = Buffer.from(expected, 'utf8')
  const receivedBytes = Buffer.from(received, 'utf8')
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}

function invalidOAuthStateFailure(): Response {
  return jsonResponse({ error: 'invalid_oauth_state' }, 400, [clearOAuthStateCookie()])
}

function clearAuthenticationCookies(): string[] {
  return [clearOAuthStateCookie(), ...clearAllSessionCookies()]
}

function oauthUnavailableFailure(): Response {
  return jsonResponse({ error: 'oauth_unavailable' }, 503, [clearOAuthStateCookie()])
}

function browserSessionIds(
  cookieHeader: string | null,
  decrypt: typeof decryptSession,
  sessionEncryptionKey: Buffer,
): string[] {
  const sessionIds = new Set<string>()
  for (const cookieName of [SESSION_COOKIE_NAME, PROVISIONING_COOKIE_NAME]) {
    const value = readCookie(cookieHeader, cookieName)
    const session = value && decrypt(value, sessionEncryptionKey)
    if (session) sessionIds.add(session.sessionId)
  }
  return [...sessionIds]
}
