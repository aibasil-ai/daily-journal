import type { Firestore } from '@google-cloud/firestore'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import {
  hashSpreadsheetId,
  type FirestoreAdapter,
  type FirestoreData,
  type FirestoreDocumentSnapshot,
  type FirestoreQuery,
} from './connection-store.js'
import {
  GoogleConnectionError,
  GoogleDriveClient,
  GoogleUpstreamError,
  type GoogleSpreadsheetReference,
} from './google-drive.js'
import {
  GoogleOAuthUpstreamError,
  InvalidRefreshTokenError,
  refreshGoogleCredentials,
  type GoogleCredentials,
} from './google-oauth.js'
import { GoogleSheetsClient } from './google-sheets.js'
import { RateLimiter } from './rate-limit.js'
import type { ServerConfig } from './server-config.js'
import { SessionStore } from './session-store.js'
import { SheetsJournalStore } from './sheets-journal-store.js'
import {
  decryptRefreshToken,
  encryptRefreshToken,
  type EncryptedToken,
} from './token-crypto.js'
import { JournalError } from '../../shared/journal/errors.js'

const MAX_CLEANUP_DOCUMENTS = 450
const MAX_LEGACY_MIGRATION_TRANSACTION_WRITES = 450

type FirestoreClient = Firestore | FirestoreAdapter

export type CleanupCounts = {
  oauthAttempts: number
  provisioningAttempts: number
  selectionCodes: number
  rateLimits: number
  sessions: number
}

export type InternalCleanupService = {
  cleanup(): Promise<CleanupCounts>
}

type InternalCleanupDependencies = {
  cleanupOAuthAttempts(now: number): Promise<number>
  cleanupProvisioningAttempts(now: number): Promise<number>
  cleanupSelectionCodes(now: number): Promise<number>
  cleanupRateLimits(now: number): Promise<number>
  cleanupSessions(now: number): Promise<number>
}

/** 僅供內部排程使用；成功回應只會包含清除數量。 */
export class ExpiredDataCleanupService implements InternalCleanupService {
  constructor(
    private readonly dependencies: InternalCleanupDependencies,
    private readonly clock: () => number = Date.now,
  ) {}

  async cleanup(): Promise<CleanupCounts> {
    const now = this.clock()
    const [
      oauthAttempts,
      provisioningAttempts,
      selectionCodes,
      rateLimits,
      sessions,
    ] = await Promise.all([
      this.dependencies.cleanupOAuthAttempts(now),
      this.dependencies.cleanupProvisioningAttempts(now),
      this.dependencies.cleanupSelectionCodes(now),
      this.dependencies.cleanupRateLimits(now),
      this.dependencies.cleanupSessions(now),
    ])

    return { oauthAttempts, provisioningAttempts, selectionCodes, rateLimits, sessions }
  }
}

/**
 * 清理短效 Firestore 文件的窄介面。刪除 provisioning 文件會一併移除其中的
 * 暫存加密 token，絕不將 token 搬移到其他位置。
 */
export class FirestoreExpiredDataCleanup {
  private readonly firestore: FirestoreAdapter

  constructor(firestore: FirestoreClient) {
    this.firestore = firestore as unknown as FirestoreAdapter
  }

  cleanupOAuthAttempts(now: number): Promise<number> {
    return deleteExpiredDocuments(this.firestore, 'oauth_attempts', now)
  }

  cleanupProvisioningAttempts(now: number): Promise<number> {
    return deleteExpiredDocuments(this.firestore, 'provisioning_attempts', now)
  }

  cleanupSelectionCodes(now: number): Promise<number> {
    return deleteExpiredDocuments(this.firestore, 'sheet_selection_tokens', now)
  }
}

export function createServerInternalCleanupService(
  firestore: FirestoreClient,
  clock: () => number = Date.now,
): InternalCleanupService {
  const shortLivedData = new FirestoreExpiredDataCleanup(firestore)
  const rateLimits = new RateLimiter(firestore)
  const sessions = new SessionStore(firestore)

  return new ExpiredDataCleanupService({
    cleanupOAuthAttempts: (now) => shortLivedData.cleanupOAuthAttempts(now),
    cleanupProvisioningAttempts: (now) => shortLivedData.cleanupProvisioningAttempts(now),
    cleanupSelectionCodes: (now) => shortLivedData.cleanupSelectionCodes(now),
    cleanupRateLimits: (now) => rateLimits.cleanupExpired(now),
    cleanupSessions: (now) => sessions.cleanupExpired(now),
  }, clock)
}

export type LegacyMigrationInput = {
  googleSub: string
  sheetUrl: string
}

export type LegacyMigrationUser = {
  id: string
  googleSub: string
}

export type LegacyMigrationAttempt = {
  id: string
  userId: string
  tempEncryptedRefreshToken: EncryptedToken
  tempScopes: string[]
  mode: 'initial'
  status: 'initial_choice' | 'candidate_selection'
  expiresAt: number
}

export type LegacyMigrationContext = {
  user: LegacyMigrationUser
  attempt: LegacyMigrationAttempt
}

export type LegacySheetClaimInput = {
  user: LegacyMigrationUser
  attempt: LegacyMigrationAttempt
  spreadsheetId: string
  spreadsheetName: string
  encryptedRefreshToken: EncryptedToken
  scopes: string[]
  createdByService: false
  now: number
}

/**
 * 遷移只需要這個受限資料庫介面。正式實作把檢查與 claim 放進同一交易，測試不需
 * 建立實際 Firestore。
 */
export type LegacyMigrationStore = {
  findMigratableContext(googleSub: string, now: number): Promise<LegacyMigrationContext | undefined>
  claimLegacySheet(input: LegacySheetClaimInput): Promise<void>
}

export type LegacyMigrationDrive = Pick<GoogleDriveClient, 'getOwnedSpreadsheet'>

/** 此介面不允許搬移或重寫資料列；驗證可進行 schema-only v1→v2 升級。 */
export type LegacyMigrationSheets = {
  validateExisting(accessToken: string, spreadsheetId: string): Promise<void>
}

export type RefreshLegacyGoogleCredentials = (
  refreshToken: string,
  config: ServerConfig,
) => Promise<GoogleCredentials>

export type LegacyMigrationDependencies = {
  config: ServerConfig
  store: LegacyMigrationStore
  drive: LegacyMigrationDrive
  sheets: LegacyMigrationSheets
  decryptRefreshToken?: typeof decryptRefreshToken
  encryptRefreshToken?: typeof encryptRefreshToken
  refreshGoogleCredentials?: RefreshLegacyGoogleCredentials
  clock?: () => number
}

export type LegacyMigrationErrorCode =
  | 'invalid_request'
  | 'migration_rejected'
  | 'migration_conflict'
  | 'migration_unavailable'

/** 所有 route 可公開的遷移錯誤都不含使用者、Sheet 或 token 資訊。 */
export class LegacyMigrationError extends Error {
  readonly status: number

  constructor(readonly code: LegacyMigrationErrorCode) {
    super(code)
    this.name = 'LegacyMigrationError'
    this.status = legacyMigrationStatus(code)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Firestore transaction 偵測到重複或競態時使用，不把底層資料庫細節傳給 route。 */
export class LegacyMigrationClaimConflictError extends Error {
  constructor() {
    super('Legacy Sheet claim conflict.')
    this.name = 'LegacyMigrationClaimConflictError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * 將已登入但尚未完成初始設定的帳號，一次性綁定既有個人版 Sheet。
 * 此流程只做 Google Drive 與 Sheets 驗證；只允許 schema-only 升級，不會複製、清空或重寫資料列。
 */
export async function runLegacyMigration(
  input: LegacyMigrationInput,
  dependencies: LegacyMigrationDependencies,
): Promise<void> {
  const parsed = parseLegacyMigrationInput(input)
  if (!parsed) throw new LegacyMigrationError('invalid_request')

  const now = (dependencies.clock ?? Date.now)()
  const context = await dependencies.store.findMigratableContext(parsed.googleSub, now)
  if (!context || !matchesMigrationContext(context, parsed.googleSub, now)) {
    throw new LegacyMigrationError('migration_rejected')
  }

  const encryptedAttemptToken = cloneEncryptedToken(context.attempt.tempEncryptedRefreshToken)
  if (encryptedAttemptToken.keyVersion !== dependencies.config.tokenEncryptionKeyVersion) {
    // 未知金鑰版本無法安全解密；不得標記失敗或清除原始暫存資料。
    throw new LegacyMigrationError('migration_unavailable')
  }

  const decryptToken = dependencies.decryptRefreshToken ?? decryptRefreshToken
  const refreshToken = decryptToken(
    encryptedAttemptToken,
    new Map([[dependencies.config.tokenEncryptionKeyVersion, dependencies.config.tokenEncryptionKey]]),
  )
  if (!refreshToken) throw new LegacyMigrationError('migration_rejected')

  const refresh = dependencies.refreshGoogleCredentials ?? refreshGoogleCredentials
  let credentials: GoogleCredentials
  try {
    credentials = await refresh(refreshToken, dependencies.config)
  } catch (error) {
    if (error instanceof InvalidRefreshTokenError) throw new LegacyMigrationError('migration_rejected')
    throw new LegacyMigrationError('migration_unavailable')
  }
  if (!isNonEmptyString(credentials.accessToken) || !areOptionalScopesValid(credentials.scopes)) {
    throw new LegacyMigrationError('migration_unavailable')
  }

  let spreadsheet: GoogleSpreadsheetReference
  try {
    spreadsheet = await dependencies.drive.getOwnedSpreadsheet(credentials.accessToken, parsed.spreadsheetId)
  } catch (error) {
    if (error instanceof GoogleConnectionError) throw new LegacyMigrationError('migration_rejected')
    if (error instanceof GoogleUpstreamError || error instanceof GoogleOAuthUpstreamError) {
      throw new LegacyMigrationError('migration_unavailable')
    }
    throw new LegacyMigrationError('migration_unavailable')
  }
  if (spreadsheet.id !== parsed.spreadsheetId || !isNonEmptyString(spreadsheet.name)) {
    throw new LegacyMigrationError('migration_rejected')
  }

  try {
    await dependencies.sheets.validateExisting(credentials.accessToken, parsed.spreadsheetId)
  } catch (error) {
    if (error instanceof JournalError || error instanceof GoogleConnectionError) {
      throw new LegacyMigrationError('migration_rejected')
    }
    throw new LegacyMigrationError('migration_unavailable')
  }

  const encryptToken = dependencies.encryptRefreshToken ?? encryptRefreshToken
  const rotatedRefreshToken = nonEmptyOptionalString(credentials.refreshToken)
  const encryptedRefreshToken = rotatedRefreshToken
    ? encryptToken(
      rotatedRefreshToken,
      dependencies.config.tokenEncryptionKey,
      dependencies.config.tokenEncryptionKeyVersion,
    )
    : encryptedAttemptToken
  const scopes = credentials.scopes === undefined ? [...context.attempt.tempScopes] : [...credentials.scopes]

  try {
    await dependencies.store.claimLegacySheet({
      user: context.user,
      attempt: context.attempt,
      spreadsheetId: parsed.spreadsheetId,
      spreadsheetName: spreadsheet.name.trim(),
      encryptedRefreshToken,
      scopes,
      createdByService: false,
      now,
    })
  } catch (error) {
    if (error instanceof LegacyMigrationError) throw error
    if (error instanceof LegacyMigrationClaimConflictError) {
      throw new LegacyMigrationError('migration_conflict')
    }
    throw new LegacyMigrationError('migration_unavailable')
  }
}

/** 只接受完整 docs.google.com Sheet 網址，不接受原始 spreadsheet ID。 */
export function parseLegacyMigrationInput(value: unknown): (LegacyMigrationInput & { spreadsheetId: string }) | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['googleSub', 'sheetUrl'])
    || !isGoogleSub(value.googleSub) || typeof value.sheetUrl !== 'string') {
    return undefined
  }
  const spreadsheetId = parseLegacySheetUrl(value.sheetUrl)
  if (!spreadsheetId) return undefined
  return { googleSub: value.googleSub, sheetUrl: value.sheetUrl, spreadsheetId }
}

export function parseLegacySheetUrl(value: string): string | undefined {
  if (!value || value !== value.trim()) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.origin !== 'https://docs.google.com'
      || url.username || url.password) {
      return undefined
    }
    const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/(?:edit|view|copy|preview)\/?)?$/)
    return match?.[1]
  } catch {
    return undefined
  }
}

export function hasExpectedBearerSecret(request: Request, secret: string): boolean {
  const header = request.headers.get('Authorization')
  const prefix = 'Bearer '
  if (!header?.startsWith(prefix)) return false
  return secretsEqual(header.slice(prefix.length), secret)
}

/** 正式 Firestore 的遷移 facade；唯一性檢查與寫入都在同一 transaction 內。 */
export class FirestoreLegacyMigrationStore implements LegacyMigrationStore {
  private readonly firestore: FirestoreAdapter

  constructor(firestore: FirestoreClient, private readonly clock: () => number = Date.now) {
    this.firestore = firestore as unknown as FirestoreAdapter
  }

  async findMigratableContext(
    googleSub: string,
    now: number,
  ): Promise<LegacyMigrationContext | undefined> {
    const userSnapshot = await this.firestore.collection('users').where('googleSub', '==', googleSub).get()
    const users = userSnapshot.docs.flatMap((document) => {
      const user = legacyUserFromSnapshot(document)
      return user?.googleSub === googleSub ? [user] : []
    })
    if (users.length !== 1) return undefined

    const user = users[0]
    const attemptsSnapshot = await this.firestore
      .collection('provisioning_attempts')
      .where('userId', '==', user.id)
      .get()
    const attempts = attemptsSnapshot.docs.flatMap((document) => {
      const attempt = legacyAttemptFromSnapshot(document)
      return attempt && attempt.userId === user.id && isMigratableAttempt(attempt) && attempt.expiresAt > now
        ? [attempt]
        : []
    })
    return attempts.length === 1 ? { user, attempt: attempts[0] } : undefined
  }

  async claimLegacySheet(input: LegacySheetClaimInput): Promise<void> {
    if (!matchesMigrationContext({ user: input.user, attempt: input.attempt }, input.user.googleSub, input.now)
      || !isIdentifier(input.spreadsheetId) || !isNonEmptyString(input.spreadsheetName)
      || !isEncryptedToken(input.encryptedRefreshToken) || !areScopesValid(input.scopes)
      || input.createdByService !== false
      || !Number.isFinite(input.now)) {
      throw new LegacyMigrationClaimConflictError()
    }

    const userRef = this.firestore.collection('users').doc(input.user.id)
    const attemptRef = this.firestore.collection('provisioning_attempts').doc(input.attempt.id)
    const claimRef = this.firestore.collection('sheet_claims').doc(hashSpreadsheetId(input.spreadsheetId))
    const connectionsQuery = this.firestore.collection('sheet_connections').where('userId', '==', input.user.id)
    const sessionsQuery = this.firestore.collection('sessions').where('userId', '==', input.user.id)
    const targetConnectionsQuery = this.firestore
      .collection('sheet_connections')
      .where('spreadsheetId', '==', input.spreadsheetId)
    const connectionId = randomUUID()

    await this.firestore.runTransaction(async (transaction) => {
      const [
        userSnapshot,
        attemptSnapshot,
        claimSnapshot,
        connectionsSnapshot,
        sessionsSnapshot,
        targetConnectionsSnapshot,
      ] = await Promise.all([
        transaction.get(userRef),
        transaction.get(attemptRef),
        transaction.get(claimRef),
        transaction.get(connectionsQuery),
        transaction.get(sessionsQuery),
        transaction.get(targetConnectionsQuery),
      ])
      const transactionNow = this.clock()
      const user = legacyUserFromSnapshot(userSnapshot)
      const attempt = legacyAttemptFromSnapshot(attemptSnapshot)
      if (!user || user.id !== input.user.id || user.googleSub !== input.user.googleSub
        || !attempt || !matchesMigrationContext({ user, attempt }, input.user.googleSub, transactionNow)
        || !encryptedTokensEqual(attempt.tempEncryptedRefreshToken, input.attempt.tempEncryptedRefreshToken)
        || claimSnapshot.exists) {
        throw new LegacyMigrationClaimConflictError()
      }

      const connections = connectionsSnapshot.docs.map((document) => {
        const connection = legacyConnectionFromSnapshot(document)
        if (!connection || connection.userId !== input.user.id) throw new LegacyMigrationClaimConflictError()
        return connection
      })
      if (connections.some((connection) => connection.status === 'active'
        || connection.spreadsheetId === input.spreadsheetId
        || connection.connectionVersion === Number.MAX_SAFE_INTEGER)) {
        throw new LegacyMigrationClaimConflictError()
      }
      if (!targetConnectionsSnapshot.empty) throw new LegacyMigrationClaimConflictError()

      const provisioningSessionRefs = sessionsSnapshot.docs.flatMap((document) => {
        const session = legacySessionFromSnapshot(document)
        if (!session || session.userId !== input.user.id) {
          throw new LegacyMigrationClaimConflictError()
        }
        return session.kind === 'provisioning' && session.revokedAt === null ? [document.ref] : []
      })
      if (3 + provisioningSessionRefs.length > MAX_LEGACY_MIGRATION_TRANSACTION_WRITES) {
        throw new LegacyMigrationClaimConflictError()
      }

      const connectionVersion = Math.max(0, ...connections.map((connection) => connection.connectionVersion)) + 1
      if (!Number.isSafeInteger(connectionVersion)) throw new LegacyMigrationClaimConflictError()
      transaction.set(claimRef, {
        spreadsheetHash: hashSpreadsheetId(input.spreadsheetId),
        userId: input.user.id,
        createdAt: transactionNow,
      })
      transaction.set(this.firestore.collection('sheet_connections').doc(connectionId), {
        id: connectionId,
        userId: input.user.id,
        spreadsheetId: input.spreadsheetId,
        spreadsheetName: input.spreadsheetName,
        encryptedRefreshToken: cloneEncryptedToken(input.encryptedRefreshToken),
        scopes: [...input.scopes],
        status: 'active',
        connectionVersion,
        createdByService: input.createdByService,
        createdAt: transactionNow,
        updatedAt: transactionNow,
      })
      transaction.update(attemptRef, {
        status: 'completed',
        tempEncryptedRefreshToken: null,
        tempScopes: [],
        selectedSpreadsheetId: input.spreadsheetId,
        selectedSpreadsheetName: input.spreadsheetName,
        createdByService: false,
        errorCode: null,
        errorMessage: null,
        updatedAt: transactionNow,
      })
      for (const ref of provisioningSessionRefs) {
        transaction.update(ref, { revokedAt: transactionNow })
      }
    })
  }
}

export function createServerLegacyMigrationDependencies(
  config: ServerConfig,
  firestore: FirestoreClient,
): LegacyMigrationDependencies {
  const sheetsClient = new GoogleSheetsClient()
  return {
    config,
    store: new FirestoreLegacyMigrationStore(firestore),
    drive: new GoogleDriveClient(),
    sheets: {
      async validateExisting(accessToken: string, spreadsheetId: string): Promise<void> {
        // load 會完整驗證 schema 與資料列；必要時只原子升級 schema，不重寫資料列。
        await SheetsJournalStore.load({ client: sheetsClient, accessToken, spreadsheetId })
      },
    },
  }
}

async function deleteExpiredDocuments(
  firestore: FirestoreAdapter,
  collectionName: string,
  now: number,
): Promise<number> {
  const snapshot = await limitCleanupQuery(
    firestore.collection(collectionName).where('expiresAt', '<=', now),
  ).get()
  const documents = snapshot.docs.slice(0, MAX_CLEANUP_DOCUMENTS)
  if (!documents.length) return 0

  return firestore.runTransaction(async (transaction) => {
    const currentDocuments = await Promise.all(documents.map(async ({ ref }) => ({
      ref,
      snapshot: await transaction.get(ref),
    })))
    let deleted = 0
    for (const { ref, snapshot: current } of currentDocuments) {
      if (!hasExpiredAtOrBefore(current, now)) continue
      transaction.delete(ref)
      deleted += 1
    }
    return deleted
  })
}

function limitCleanupQuery(query: FirestoreQuery): FirestoreQuery {
  const limitedQuery = query as FirestoreQuery & {
    limit?: (maximum: number) => FirestoreQuery
  }
  return limitedQuery.limit?.(MAX_CLEANUP_DOCUMENTS) ?? query
}

function hasExpiredAtOrBefore(snapshot: FirestoreDocumentSnapshot, now: number): boolean {
  const expiresAt = snapshot.data()?.expiresAt
  return typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt <= now
}

function matchesMigrationContext(
  context: LegacyMigrationContext,
  googleSub: string,
  now: number,
): boolean {
  return context.user.googleSub === googleSub
    && isIdentifier(context.user.id)
    && isMigratableAttempt(context.attempt)
    && context.attempt.userId === context.user.id
    && context.attempt.expiresAt > now
}

function isMigratableAttempt(value: LegacyMigrationAttempt): boolean {
  return isIdentifier(value.id)
    && isIdentifier(value.userId)
    && value.mode === 'initial'
    && (value.status === 'initial_choice' || value.status === 'candidate_selection')
    && isEncryptedToken(value.tempEncryptedRefreshToken)
    && areScopesValid(value.tempScopes)
    && Number.isFinite(value.expiresAt)
}

function legacyUserFromSnapshot(snapshot: FirestoreDocumentSnapshot): LegacyMigrationUser | undefined {
  const data = snapshot.data()
  if (!isRecord(data) || !isIdentifier(data.id) || !isGoogleSub(data.googleSub)) return undefined
  return { id: data.id, googleSub: data.googleSub }
}

function legacyAttemptFromSnapshot(snapshot: FirestoreDocumentSnapshot): LegacyMigrationAttempt | undefined {
  const data = snapshot.data()
  const tempScopes = data?.tempScopes === undefined ? [] : data?.tempScopes
  if (!isRecord(data) || !isIdentifier(data.id) || !isIdentifier(data.userId)
    || data.mode !== 'initial' || !isMigratableStatus(data.status)
    || !isEncryptedToken(data.tempEncryptedRefreshToken) || !areScopesValid(tempScopes)
    || !isFiniteTimestamp(data.expiresAt)) {
    return undefined
  }
  return {
    id: data.id,
    userId: data.userId,
    tempEncryptedRefreshToken: cloneEncryptedToken(data.tempEncryptedRefreshToken),
    tempScopes: [...tempScopes],
    mode: 'initial',
    status: data.status,
    expiresAt: data.expiresAt,
  }
}

function legacyConnectionFromSnapshot(snapshot: FirestoreDocumentSnapshot): {
  userId: string
  spreadsheetId: string
  status: string
  connectionVersion: number
} | undefined {
  const data = snapshot.data()
  if (!isRecord(data) || !isIdentifier(data.userId) || !isIdentifier(data.spreadsheetId)
    || !isConnectionStatus(data.status) || !isConnectionVersion(data.connectionVersion)) {
    return undefined
  }
  return {
    userId: data.userId,
    spreadsheetId: data.spreadsheetId,
    status: data.status,
    connectionVersion: data.connectionVersion,
  }
}

function legacySessionFromSnapshot(snapshot: FirestoreDocumentSnapshot): {
  userId: string
  kind: 'journal' | 'provisioning'
  revokedAt: number | null
} | undefined {
  const data = snapshot.data()
  if (!isRecord(data) || !isIdentifier(data.sessionId) || !isIdentifier(data.userId)
    || (data.kind !== 'journal' && data.kind !== 'provisioning')
    || !isFiniteTimestamp(data.expiresAt) || !isFiniteTimestamp(data.createdAt)
    || !isFiniteTimestamp(data.lastUsedAt)
    || !(data.revokedAt === null || isFiniteTimestamp(data.revokedAt))
    || !(data.provisioningAttemptId === null || isIdentifier(data.provisioningAttemptId))) {
    return undefined
  }
  if ((data.kind === 'journal' && data.provisioningAttemptId !== null)
    || (data.kind === 'provisioning' && data.provisioningAttemptId === null)) {
    return undefined
  }
  return { userId: data.userId, kind: data.kind, revokedAt: data.revokedAt }
}

function legacyMigrationStatus(code: LegacyMigrationErrorCode): number {
  if (code === 'invalid_request') return 400
  if (code === 'migration_conflict') return 409
  if (code === 'migration_rejected') return 422
  return 503
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isGoogleSub(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255
    && value === value.trim() && /^[A-Za-z0-9_-]+$/.test(value)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)
}

function isMigratableStatus(value: unknown): value is LegacyMigrationAttempt['status'] {
  return value === 'initial_choice' || value === 'candidate_selection'
}

function isConnectionStatus(value: unknown): value is string {
  return value === 'active' || value === 'archived' || value === 'needs_reconnect'
}

function isConnectionVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isEncryptedToken(value: unknown): value is EncryptedToken {
  return isRecord(value) && isNonEmptyString(value.ciphertext) && isIdentifier(value.keyVersion)
}

function cloneEncryptedToken(value: EncryptedToken): EncryptedToken {
  return { ciphertext: value.ciphertext, keyVersion: value.keyVersion }
}

function encryptedTokensEqual(left: EncryptedToken, right: EncryptedToken): boolean {
  return left.ciphertext === right.ciphertext && left.keyVersion === right.keyVersion
}

function areScopesValid(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((scope) => typeof scope === 'string')
}

function areOptionalScopesValid(value: unknown): value is string[] | undefined {
  return value === undefined || areScopesValid(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function nonEmptyOptionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined
}

function isRecord(value: unknown): value is FirestoreData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function secretsEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer)
}
