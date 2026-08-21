import {
  ConnectionStore as FirestoreConnectionStore,
  type ActiveSheetConnectionDocument,
  type ConnectionStore,
  type UserDocument,
} from './connection-store.js'
import {
  PROVISIONING_COOKIE_NAME,
  readCookie,
  SESSION_COOKIE_NAME,
} from './cookies.js'
import { getFirestoreClient } from './firestore.js'
import {
  InvalidRefreshTokenError,
  refreshGoogleCredentials,
  type GoogleCredentials,
} from './google-oauth.js'
import { getServerConfig, type ServerConfig } from './server-config.js'
import { decryptSession } from './session-crypto.js'
import { SessionStore, type SessionDocument } from './session-store.js'
import {
  decryptRefreshToken,
  encryptRefreshToken,
  type EncryptedToken,
} from './token-crypto.js'

export type RefreshGoogleCredentials = (
  refreshToken: string,
  config: ServerConfig,
  fetchImpl?: typeof fetch,
) => Promise<GoogleCredentials>

export type JournalRequestContext = {
  session: SessionDocument
  user: UserDocument
  connection: ActiveSheetConnectionDocument
  accessToken: string
}

export type JournalRequestContextDependencies = {
  config: ServerConfig
  sessionStore: Pick<SessionStore, 'resolveJournalSession' | 'resolveProvisioningSession'>
  connections: Pick<
    ConnectionStore,
    | 'getUserById'
    | 'findActiveConnection'
    | 'updateEncryptedTokenIfCurrent'
  > & Partial<Pick<ConnectionStore, 'updateActiveConnectionCredentialsIfCurrent'>>
  decryptSession?: typeof decryptSession
  decryptRefreshToken?: typeof decryptRefreshToken
  encryptRefreshToken?: typeof encryptRefreshToken
  refreshGoogleCredentials?: RefreshGoogleCredentials
}

/**
 * 表示本站 session 或其對應的 Google 連線已無法安全使用；route 可據此撤銷伺服器端狀態。
 */
export class JournalRequestContextAuthenticationError extends Error {
  readonly sessionId?: string
  readonly connectionId?: string
  readonly expectedEncryptedRefreshToken?: EncryptedToken

  constructor(
    sessionId?: string,
    connectionId?: string,
    expectedEncryptedRefreshToken?: EncryptedToken,
  ) {
    super('日記請求內容無法安全使用。')
    this.name = 'JournalRequestContextAuthenticationError'
    this.sessionId = sessionId
    this.connectionId = connectionId
    this.expectedEncryptedRefreshToken = expectedEncryptedRefreshToken
    Object.defineProperties(this, {
      sessionId: { enumerable: false },
      connectionId: { enumerable: false },
      expectedEncryptedRefreshToken: { enumerable: false },
    })
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** 表示請求期間的連線 token 已被另一個安全流程更新。 */
export class JournalRequestContextConflictError extends Error {
  constructor() {
    super('日記連線狀態已變更，請重新整理後再試。')
    this.name = 'JournalRequestContextConflictError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** 表示 token 金鑰版本與目前伺服器設定不相容，不能安全改變任何持久化狀態。 */
export class JournalRequestContextConfigurationError extends Error {
  constructor() {
    super('日記伺服器憑證設定無法安全使用。')
    this.name = 'JournalRequestContextConfigurationError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** 表示瀏覽器仍在完成設定流程，不能以設定 session 存取日記。 */
export class JournalRequestContextProvisioningRequiredError extends Error {
  constructor() {
    super('必須先完成資料表設定。')
    this.name = 'JournalRequestContextProvisioningRequiredError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function createJournalRequestContextResolver(
  dependencies: JournalRequestContextDependencies,
): (request: Request) => Promise<JournalRequestContext> {
  const decryptCookie = dependencies.decryptSession ?? decryptSession
  const decryptToken = dependencies.decryptRefreshToken ?? decryptRefreshToken
  const encryptToken = dependencies.encryptRefreshToken ?? encryptRefreshToken
  const refresh: RefreshGoogleCredentials = dependencies.refreshGoogleCredentials ?? refreshGoogleCredentials

  return async (request: Request): Promise<JournalRequestContext> => {
    const encryptedSession = readCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME)
    const cookieSession = encryptedSession && decryptCookie(
      encryptedSession,
      dependencies.config.sessionEncryptionKey,
    )
    const provisioningSession = async (): Promise<boolean> => {
      const encryptedProvisioning = readCookie(
        request.headers.get('Cookie'),
        PROVISIONING_COOKIE_NAME,
      )
      const cookieProvisioning = encryptedProvisioning && decryptCookie(
        encryptedProvisioning,
        dependencies.config.sessionEncryptionKey,
      )
      if (!cookieProvisioning) return false
      return Boolean(await dependencies.sessionStore.resolveProvisioningSession(cookieProvisioning.sessionId))
    }
    if (!cookieSession) {
      if (await provisioningSession()) throw new JournalRequestContextProvisioningRequiredError()
      throw new JournalRequestContextAuthenticationError()
    }

    const session = await dependencies.sessionStore.resolveJournalSession(cookieSession.sessionId)
    if (!session) {
      if (await provisioningSession()) throw new JournalRequestContextProvisioningRequiredError()
      throw new JournalRequestContextAuthenticationError(cookieSession.sessionId)
    }

    const user = await dependencies.connections.getUserById(session.userId)
    if (!user || user.id !== session.userId) {
      throw new JournalRequestContextAuthenticationError(session.sessionId)
    }

    const connection = await dependencies.connections.findActiveConnection(user.id)
    if (!connection || connection.userId !== user.id || connection.status !== 'active') {
      throw new JournalRequestContextAuthenticationError(session.sessionId)
    }

    const expectedEncryptedRefreshToken: EncryptedToken = {
      ciphertext: connection.encryptedRefreshToken.ciphertext,
      keyVersion: connection.encryptedRefreshToken.keyVersion,
    }
    if (expectedEncryptedRefreshToken.keyVersion !== dependencies.config.tokenEncryptionKeyVersion) {
      throw new JournalRequestContextConfigurationError()
    }
    const refreshToken = decryptToken(
      expectedEncryptedRefreshToken,
      new Map([[dependencies.config.tokenEncryptionKeyVersion, dependencies.config.tokenEncryptionKey]]),
    )
    if (!refreshToken) {
      throw new JournalRequestContextAuthenticationError(session.sessionId, connection.id)
    }

    let credentials: GoogleCredentials
    try {
      credentials = await refresh(refreshToken, dependencies.config)
    } catch (error) {
      if (error instanceof InvalidRefreshTokenError) {
        throw new JournalRequestContextAuthenticationError(
          session.sessionId,
          connection.id,
          expectedEncryptedRefreshToken,
        )
      }
      throw error
    }

    const replacement = nonEmptyString(credentials.refreshToken)
    const scopesChanged = credentials.scopes !== undefined && !areScopesEqual(connection.scopes, credentials.scopes)
    let resolvedConnection = connection
    if (replacement || scopesChanged) {
      if (dependencies.connections.updateActiveConnectionCredentialsIfCurrent) {
        const updated = await dependencies.connections.updateActiveConnectionCredentialsIfCurrent({
          userId: user.id,
          connectionId: connection.id,
          expectedConnectionVersion: connection.connectionVersion,
          ...(replacement === undefined
            ? {}
            : {
              encryptedRefreshToken: encryptToken(
                replacement,
                dependencies.config.tokenEncryptionKey,
                dependencies.config.tokenEncryptionKeyVersion,
              ),
            }),
          ...(credentials.scopes === undefined ? {} : { scopes: credentials.scopes }),
        })
        if (!updated) throw new JournalRequestContextConflictError()
        resolvedConnection = updated
      } else if (replacement) {
        // 舊測試替身僅支援 token CAS；正式 ConnectionStore 一律使用上方版本 CAS。
        const updated = await dependencies.connections.updateEncryptedTokenIfCurrent(
          connection.id,
          expectedEncryptedRefreshToken,
          encryptToken(
            replacement,
            dependencies.config.tokenEncryptionKey,
            dependencies.config.tokenEncryptionKeyVersion,
          ),
        )
        if (!updated) throw new JournalRequestContextConflictError()
      }
    }

    return { session, user, connection: resolvedConnection, accessToken: credentials.accessToken }
  }
}

/** 使用正式 Firestore 與伺服器設定解析單次 journal 請求。 */
export async function requireJournalRequestContext(request: Request): Promise<JournalRequestContext> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  return createJournalRequestContextResolver({
    config,
    sessionStore: new SessionStore(firestore),
    connections: new FirestoreConnectionStore(firestore),
  })(request)
}

function areScopesEqual(current: string[], next: string[]): boolean {
  if (current.length !== next.length) return false
  const currentSet = new Set(current)
  return next.every((scope) => currentSet.has(scope))
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
