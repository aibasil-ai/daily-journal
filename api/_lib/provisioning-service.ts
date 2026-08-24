import type { Firestore } from '@google-cloud/firestore'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import {
  ConnectionStore as FirestoreConnectionStore,
  hashSpreadsheetId,
  type ActiveSheetConnectionDocument,
  type ConnectionStore,
  type FirestoreAdapter,
  type ProvisioningAttemptDocument,
  type ProvisioningPhase,
  type UserDocument,
} from './connection-store.js'
import {
  clearAllSessionCookies,
  clearProvisioningCookie,
  clearSessionCookie,
  createProvisioningCookie as makeProvisioningCookie,
  createSessionCookie as makeSessionCookie,
  PROVISIONING_COOKIE_NAME,
  readCookie,
  SESSION_COOKIE_NAME,
} from './cookies.js'
import { jsonResponse } from './function-response.js'
import {
  GoogleConnectionError,
  GoogleDriveClient,
  GoogleUpstreamError,
  type GoogleSpreadsheetPage,
  type GoogleSpreadsheetReference,
} from './google-drive.js'
import {
  GoogleOAuthUpstreamError,
  InvalidRefreshTokenError,
  refreshGoogleCredentials,
  type GoogleCredentials,
} from './google-oauth.js'
import { GoogleSheetsClient } from './google-sheets.js'
import { RateLimitError, RATE_LIMIT_WINDOWS, type RateLimiter } from './rate-limit.js'
import { type ServerConfig } from './server-config.js'
import { decryptSession, encryptSession } from './session-crypto.js'
import { SessionStore, type SessionDocument } from './session-store.js'
import { SheetsJournalStore } from './sheets-journal-store.js'
import { decryptRefreshToken, encryptRefreshToken, type EncryptedToken } from './token-crypto.js'
import { isJournalError } from '../../shared/journal/errors.js'

const PROVISIONING_SESSION_TTL_MS = 20 * 60_000
const SELECTION_TTL_MS = 10 * 60_000
const CURSOR_TTL_MS = 10 * 60_000
const JOURNAL_SESSION_TTL_MS = 30 * 24 * 60 * 60_000
const CANDIDATE_LIMIT = 20
const CURSOR_IV_BYTES = 12
const CURSOR_AUTH_TAG_BYTES = 16
const BASE64URL = /^[A-Za-z0-9_-]+$/

export type ProvisioningStatus = {
  phase: ProvisioningPhase
  sheetName: string | null
  lastUpdatedAt: number | null
  connectionVersion: number | null
  canDeleteActiveSystemSheet: boolean
  errorCode: string | null
}

export type CandidateSheet = {
  selectionCode: string
  name: string
  modifiedTime: string
}

export type CandidateSheetPage = {
  items: CandidateSheet[]
  nextCursor: string | null
}

export type ProvisioningSessionContext = {
  session: SessionDocument
  attempt: ProvisioningAttemptDocument
}

export type JournalProvisioningContext = {
  session: SessionDocument
  user: UserDocument
  connection: ActiveSheetConnectionDocument
}

export type BrowserSession = Pick<SessionDocument, 'sessionId' | 'expiresAt' | 'kind' | 'userId'>

export type ProvisioningActionResult = {
  status: ProvisioningStatus
  journalSession?: BrowserSession
}

export type StartChangeResult = {
  status: ProvisioningStatus
  provisioningSession: BrowserSession
}

export type ProvisioningErrorCode =
  | 'unauthenticated'
  | 'invalid_request'
  | 'unsupported_media_type'
  | 'forbidden'
  | 'rate_limited'
  | 'invalid_selection'
  | 'invalid_sheet_url'
  | 'sheet_unavailable'
  | 'sheet_incompatible'
  | 'already_active'
  | 'connection_conflict'
  | 'provisioning_failed'
  | 'upstream_failure'

export type CookieToClear = 'journal' | 'provisioning' | 'all'

/** 僅包含可安全回傳給瀏覽器的錯誤碼與 HTTP 狀態。 */
export class ProvisioningServiceError extends Error {
  constructor(
    readonly code: ProvisioningErrorCode,
    readonly status: number,
    readonly clearCookie?: CookieToClear,
  ) {
    super(code)
    this.name = 'ProvisioningServiceError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export type ProvisioningConnectionStore = Pick<
  ConnectionStore,
  | 'getUserById'
  | 'findActiveConnection'
  | 'createProvisioningAttempt'
  | 'getProvisioningAttempt'
  | 'updateProvisioningAttempt'
  | 'claimProvisioningAttemptAction'
  | 'updateClaimedProvisioningAttempt'
  | 'persistProvisioningCredentials'
  | 'failProvisioningAttempt'
  | 'completeProvisioningAttempt'
  | 'createSheetSelectionToken'
  | 'consumeSheetSelectionToken'
  | 'markConnectionNeedsReconnectIfActive'
  | 'deleteAccountData'
>

export type ProvisioningSessionStore = Pick<
  SessionStore,
  | 'create'
  | 'resolveJournalSession'
  | 'resolveProvisioningSession'
  | 'revokeSession'
  | 'revokeUserSessions'
>

export type ProvisioningDriveClient = Pick<
  GoogleDriveClient,
  'listOwnedSpreadsheets' | 'getOwnedSpreadsheet' | 'deleteSystemCreatedSpreadsheet'
>

/** 將 SheetsJournalStore 的靜態 API 收斂為設定流程所需的最小介面。 */
export type ProvisioningSheetsFacade = {
  create(accessToken: string, title: string): Promise<{ spreadsheetId: string }>
  initialize(accessToken: string, spreadsheetId: string): Promise<void>
  validateExisting(accessToken: string, spreadsheetId: string): Promise<void>
}

/**
 * ConnectionStore 的啟用交易仍是唯一性最終保護；此 facade 在寫入 Sheet 前先拒絕已屬於其他帳號的 claim。
 */
export type ProvisioningClaimVerifier = {
  assertTargetAvailable(userId: string, spreadsheetId: string): Promise<void>
}

export type RefreshGoogleCredentials = (
  refreshToken: string,
  config: ServerConfig,
) => Promise<GoogleCredentials>

export type ProvisioningServiceDependencies = {
  config: ServerConfig
  connections: ProvisioningConnectionStore
  sessions: ProvisioningSessionStore
  drive: ProvisioningDriveClient
  sheets: ProvisioningSheetsFacade
  claimVerifier?: ProvisioningClaimVerifier
  decryptRefreshToken?: typeof decryptRefreshToken
  encryptRefreshToken?: typeof encryptRefreshToken
  refreshGoogleCredentials?: RefreshGoogleCredentials
  encryptSession?: typeof encryptSession
  decryptSession?: typeof decryptSession
  clock?: () => number
}

type CandidateInput = {
  query: string
  cursor: string | null
}

type CursorPayload = {
  attemptId: string
  userId: string
  query: string
  pageToken: string | null
  expiresAt: number
}

type RefreshedCredentials = {
  accessToken: string
  encryptedRefreshToken: EncryptedToken
  scopes: string[]
}

type VerifiedTarget = {
  attempt: ProvisioningAttemptDocument
  spreadsheetId: string
  spreadsheetName: string
}

type ProvisioningCredentials = {
  attempt: ProvisioningAttemptDocument
  credentials: RefreshedCredentials
}

/**
 * 僅供 API routes 使用的資料空間設定服務。它不產生任何含 Sheet ID 或 Google token 的前端資料。
 */
export class ProvisioningService {
  private readonly decryptToken: typeof decryptRefreshToken
  private readonly encryptToken: typeof encryptRefreshToken
  private readonly refreshCredentials: RefreshGoogleCredentials
  private readonly sealSession: typeof encryptSession
  private readonly decryptCookie: typeof decryptSession
  private readonly now: () => number

  constructor(private readonly dependencies: ProvisioningServiceDependencies) {
    this.decryptToken = dependencies.decryptRefreshToken ?? decryptRefreshToken
    this.encryptToken = dependencies.encryptRefreshToken ?? encryptRefreshToken
    this.refreshCredentials = dependencies.refreshGoogleCredentials ?? refreshGoogleCredentials
    this.sealSession = dependencies.encryptSession ?? encryptSession
    this.decryptCookie = dependencies.decryptSession ?? decryptSession
    this.now = dependencies.clock ?? Date.now
  }

  async requireProvisioningContext(request: Request): Promise<ProvisioningSessionContext> {
    const payload = this.readSessionCookie(request, PROVISIONING_COOKIE_NAME, 'provisioning')
    const session = await this.dependencies.sessions.resolveProvisioningSession(payload.sessionId)
    if (!session || session.kind !== 'provisioning' || !session.provisioningAttemptId) {
      throw new ProvisioningServiceError('unauthenticated', 401, 'provisioning')
    }

    const attempt = await this.dependencies.connections.getProvisioningAttempt(session.provisioningAttemptId)
    if (!attempt || attempt.userId !== session.userId || attempt.expiresAt <= this.now()) {
      throw new ProvisioningServiceError('unauthenticated', 401, 'provisioning')
    }
    return { session, attempt }
  }

  async requireJournalContext(request: Request): Promise<JournalProvisioningContext> {
    const payload = this.readSessionCookie(request, SESSION_COOKIE_NAME, 'journal')
    const session = await this.dependencies.sessions.resolveJournalSession(payload.sessionId)
    if (!session || session.kind !== 'journal' || session.provisioningAttemptId !== null) {
      throw new ProvisioningServiceError('unauthenticated', 401, 'journal')
    }

    const user = await this.dependencies.connections.getUserById(session.userId)
    if (!user || user.id !== session.userId) {
      throw new ProvisioningServiceError('unauthenticated', 401, 'journal')
    }
    const connection = await this.dependencies.connections.findActiveConnection(user.id)
    if (!connection || connection.userId !== user.id || connection.status !== 'active') {
      throw new ProvisioningServiceError('unauthenticated', 401, 'journal')
    }
    return { session, user, connection }
  }

  async getStatus(request: Request): Promise<{ status: ProvisioningStatus; cookies: string[] }> {
    const cookieHeader = request.headers.get('Cookie')
    const provisioningCookie = readCookie(cookieHeader, PROVISIONING_COOKIE_NAME)
    if (provisioningCookie) {
      try {
        const context = await this.requireProvisioningContext(request)
        return { status: await this.statusForAttempt(context), cookies: [] }
      } catch (error) {
        if (!(error instanceof ProvisioningServiceError) || error.code !== 'unauthenticated') throw error
        const journal = await this.tryJournalContext(request)
        if (journal) {
          return { status: this.statusForConnection(journal.connection), cookies: [clearProvisioningCookie()] }
        }
        if (readCookie(cookieHeader, SESSION_COOKIE_NAME)) {
          throw new ProvisioningServiceError('unauthenticated', 401, 'all')
        }
        throw error
      }
    }

    const journalCookie = readCookie(cookieHeader, SESSION_COOKIE_NAME)
    if (!journalCookie) throw new ProvisioningServiceError('unauthenticated', 401)
    const context = await this.requireJournalContext(request)
    return { status: this.statusForConnection(context.connection), cookies: [] }
  }

  async startChange(context: JournalProvisioningContext): Promise<StartChangeResult> {
    const attempt = await this.dependencies.connections.createProvisioningAttempt({
      userId: context.user.id,
      mode: 'change',
      originalConnectionVersion: context.connection.connectionVersion,
      tempEncryptedRefreshToken: cloneEncryptedToken(context.connection.encryptedRefreshToken),
      tempScopes: [...context.connection.scopes],
      ttlMs: PROVISIONING_SESSION_TTL_MS,
    })
    const created = await this.dependencies.sessions.create({
      userId: context.user.id,
      kind: 'provisioning',
      provisioningAttemptId: attempt.id,
      ttlMs: PROVISIONING_SESSION_TTL_MS,
    })
    return {
      status: this.statusForAttemptWithConnection(attempt, context.connection),
      provisioningSession: browserSession(created.session),
    }
  }

  async cancelChange(context: ProvisioningSessionContext): Promise<void> {
    if (context.attempt.mode !== 'change') {
      throw new ProvisioningServiceError('invalid_request', 400)
    }
    await this.dependencies.sessions.revokeSession(context.session.sessionId)
  }

  async listCandidateSheets(
    context: ProvisioningSessionContext,
    input: CandidateInput,
  ): Promise<CandidateSheetPage> {
    this.assertClaimableAttempt(context.attempt)
    const query = normalizeCandidateQuery(input.query)
    const cursor = this.resolveCursor(input.cursor, context, query)
    const { attempt, credentials } = await this.getProvisioningCredentials(context.attempt)

    let page: GoogleSpreadsheetPage
    try {
      page = await this.dependencies.drive.listOwnedSpreadsheets(credentials.accessToken, cursor?.pageToken ?? undefined)
    } catch (error) {
      throw safeDriveError(error)
    }

    const items = page.items
      .filter((item) => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .slice(0, CANDIDATE_LIMIT)
    const candidateItems: CandidateSheet[] = []
    for (const item of items) {
      const selectionCode = await this.dependencies.connections.createSheetSelectionToken({
        provisioningAttemptId: attempt.id,
        spreadsheetId: item.id,
        spreadsheetName: item.name,
        modifiedTime: item.modifiedTime,
        ttlMs: SELECTION_TTL_MS,
      })
      candidateItems.push({ selectionCode, name: item.name, modifiedTime: item.modifiedTime })
    }
    const selectedAttempt = await this.updateAttempt(attempt.id, {
      status: 'candidate_selection',
      errorCode: null,
      errorMessage: null,
    })
    if (!selectedAttempt) throw new ProvisioningServiceError('connection_conflict', 409)

    return {
      items: candidateItems,
      nextCursor: page.nextPageToken
        ? this.sealCursor({
          attemptId: selectedAttempt.id,
          userId: context.session.userId,
          query,
          pageToken: page.nextPageToken,
          expiresAt: Math.min(selectedAttempt.expiresAt, this.now() + CURSOR_TTL_MS),
        })
        : null,
    }
  }

  async createSheet(context: ProvisioningSessionContext): Promise<ProvisioningActionResult> {
    const claimed = await this.claimTargetAction(context, 'creating', true)

    try {
      const { attempt, credentials } = await this.getProvisioningCredentials(claimed)
      const created = await this.dependencies.sheets.create(credentials.accessToken, '每日記事')
      if (!isIdentifier(created.spreadsheetId)) throw new Error('invalid created spreadsheet')
      const creating = await this.dependencies.connections.updateClaimedProvisioningAttempt({
        attemptId: attempt.id,
        userId: attempt.userId,
        expectedStatus: 'creating',
        selectedSpreadsheetId: created.spreadsheetId,
        selectedSpreadsheetName: '每日記事',
        createdByService: true,
        errorCode: null,
        errorMessage: null,
      })
      if (!creating) throw new ProvisioningServiceError('unauthenticated', 401, 'provisioning')
      await this.assertTargetAvailable(creating.userId, created.spreadsheetId)
      await this.dependencies.sheets.initialize(credentials.accessToken, created.spreadsheetId)
      return await this.finishVerifiedTarget({
        attempt: creating,
        spreadsheetId: created.spreadsheetId,
        spreadsheetName: '每日記事',
      }, true)
    } catch (error) {
      console.error('[ProvisioningService.createSheet error]', error)
      if (error instanceof ProvisioningServiceError && error.code === 'upstream_failure') throw error
      await this.markAttemptFailed(claimed, 'provisioning_failed')
      if (error instanceof ProvisioningServiceError && error.code === 'provisioning_failed') throw error
      throw new ProvisioningServiceError('provisioning_failed', 422)
    }
  }

  async selectCandidate(
    context: ProvisioningSessionContext,
    selectionCode: string,
  ): Promise<ProvisioningActionResult> {
    if (!isIdentifier(selectionCode)) throw new ProvisioningServiceError('invalid_selection', 400)
    const selected = await this.dependencies.connections.consumeSheetSelectionToken(selectionCode, {
      provisioningAttemptId: context.attempt.id,
      userId: context.session.userId,
    })
    if (!selected) throw new ProvisioningServiceError('invalid_selection', 400)
    const claimed = await this.claimTargetAction(context, 'verifying')
    return this.verifyAndFinishTarget({ ...context, attempt: claimed }, selected.spreadsheetId)
  }

  async submitSheetUrl(
    context: ProvisioningSessionContext,
    value: string,
  ): Promise<ProvisioningActionResult> {
    const spreadsheetId = parseGoogleSpreadsheetUrl(value)
    if (!spreadsheetId) throw new ProvisioningServiceError('invalid_sheet_url', 400)
    const claimed = await this.claimTargetAction(context, 'verifying')
    return this.verifyAndFinishTarget({ ...context, attempt: claimed }, spreadsheetId)
  }

  async confirmChange(context: ProvisioningSessionContext): Promise<ProvisioningActionResult> {
    const attempt = await this.dependencies.connections.getProvisioningAttempt(context.attempt.id)
    if (!attempt || attempt.userId !== context.session.userId) {
      throw new ProvisioningServiceError('unauthenticated', 401, 'provisioning')
    }
    if (attempt.mode !== 'change' || attempt.status !== 'ready_to_confirm'
      || !attempt.selectedSpreadsheetId || !attempt.selectedSpreadsheetName
      || !attempt.tempEncryptedRefreshToken || attempt.originalConnectionVersion === null) {
      throw new ProvisioningServiceError('invalid_request', 400)
    }

    try {
      const spreadsheetId = attempt.selectedSpreadsheetId
      const spreadsheetName = attempt.selectedSpreadsheetName
      const originalConnectionVersion = attempt.originalConnectionVersion
      const { attempt: refreshedAttempt, credentials } = await this.getProvisioningCredentials(attempt, true)
      if (refreshedAttempt.selectedSpreadsheetId !== spreadsheetId
        || refreshedAttempt.selectedSpreadsheetName !== spreadsheetName
        || refreshedAttempt.originalConnectionVersion !== originalConnectionVersion) {
        throw new ProvisioningServiceError('connection_conflict', 409)
      }

      let spreadsheet: GoogleSpreadsheetReference
      try {
        spreadsheet = await this.dependencies.drive.getOwnedSpreadsheet(credentials.accessToken, spreadsheetId)
      } catch (error) {
        throw safeDriveError(error)
      }
      if (spreadsheet.id !== spreadsheetId) throw new ProvisioningServiceError('sheet_unavailable', 422)
      await this.assertTargetAvailable(refreshedAttempt.userId, spreadsheetId)
      await this.validateExistingSheet(credentials.accessToken, spreadsheetId)

      const completed = await this.dependencies.connections.completeProvisioningAttempt({
        attemptId: refreshedAttempt.id,
        userId: refreshedAttempt.userId,
        expectedStatus: 'ready_to_confirm',
        expectedSpreadsheetId: spreadsheetId,
        expectedSpreadsheetName: spreadsheetName,
        expectedOriginalConnectionVersion: originalConnectionVersion,
        journalSessionTtlMs: JOURNAL_SESSION_TTL_MS,
      })
      return {
        status: this.statusForConnection(completed.connection),
        journalSession: browserSession(completed.journalSession),
      }
    } catch (error) {
      if (error instanceof ProvisioningServiceError) throw error
      throw new ProvisioningServiceError('connection_conflict', 409)
    }
  }

  async disconnect(context: JournalProvisioningContext): Promise<void> {
    const disconnected = await this.dependencies.connections.markConnectionNeedsReconnectIfActive({
      userId: context.user.id,
      connectionId: context.connection.id,
      expectedConnectionVersion: context.connection.connectionVersion,
    })
    if (!disconnected) throw new ProvisioningServiceError('connection_conflict', 409)
    await this.dependencies.sessions.revokeUserSessions(context.user.id)
  }

  async deleteAccount(
    context: JournalProvisioningContext,
    input: { deleteSystemCreatedSheet: boolean; confirmation: string },
  ): Promise<void> {
    if (typeof input.deleteSystemCreatedSheet !== 'boolean' || input.confirmation !== '刪除我的帳號') {
      throw new ProvisioningServiceError('invalid_request', 400)
    }
    const connection = await this.dependencies.connections.findActiveConnection(context.user.id)
    if (!connection) throw new ProvisioningServiceError('unauthenticated', 401, 'journal')

    if (input.deleteSystemCreatedSheet && connection.createdByService) {
      const credentials = await this.getConnectionCredentials(
        connection.encryptedRefreshToken,
        connection.scopes,
      )
      try {
        await this.dependencies.drive.deleteSystemCreatedSpreadsheet(credentials.accessToken, {
          spreadsheetId: connection.spreadsheetId,
          createdByService: true,
        })
      } catch (error) {
        throw safeDriveError(error)
      }
    }
    await this.dependencies.connections.deleteAccountData(context.user.id)
  }

  createSessionCookie(session: Pick<SessionDocument, 'sessionId' | 'expiresAt'>): string {
    return makeSessionCookie(this.sealSession(session, this.dependencies.config.sessionEncryptionKey))
  }

  createProvisioningCookie(session: Pick<SessionDocument, 'sessionId' | 'expiresAt'>): string {
    return makeProvisioningCookie(this.sealSession(session, this.dependencies.config.sessionEncryptionKey))
  }

  private async verifyAndFinishTarget(
    context: ProvisioningSessionContext,
    spreadsheetId: string,
  ): Promise<ProvisioningActionResult> {
    let target: VerifiedTarget
    try {
      target = await this.verifyTarget(context, spreadsheetId)
    } catch (error) {
      if (error instanceof ProvisioningServiceError && isRecoverableTargetError(error.code)) {
        await this.recordRecoverableError(context.attempt, error.code, 'candidate_selection')
      }
      throw error
    }
    return this.finishVerifiedTarget(target, false)
  }

  private async verifyTarget(
    context: ProvisioningSessionContext,
    spreadsheetId: string,
  ): Promise<VerifiedTarget> {
    const { attempt, credentials } = await this.getProvisioningCredentials(context.attempt)
    let spreadsheet: GoogleSpreadsheetReference
    try {
      spreadsheet = await this.dependencies.drive.getOwnedSpreadsheet(credentials.accessToken, spreadsheetId)
    } catch (error) {
      throw safeDriveError(error)
    }

    const active = await this.dependencies.connections.findActiveConnection(attempt.userId)
    if (attempt.mode === 'initial' && active) {
      throw new ProvisioningServiceError('connection_conflict', 409)
    }
    if (attempt.mode === 'change') {
      if (!active) throw new ProvisioningServiceError('connection_conflict', 409)
      if (active.spreadsheetId === spreadsheet.id) {
        throw new ProvisioningServiceError('already_active', 409)
      }
    }

    await this.assertTargetAvailable(attempt.userId, spreadsheet.id)
    try {
      await this.dependencies.sheets.initialize(credentials.accessToken, spreadsheet.id)
    } catch (error) {
      if (error instanceof GoogleConnectionError) {
        throw new ProvisioningServiceError('sheet_unavailable', 422)
      }
      if (error instanceof GoogleUpstreamError) throw new ProvisioningServiceError('upstream_failure', 502)
      if (isJournalError(error)) throw new ProvisioningServiceError('sheet_incompatible', 422)
      throw new ProvisioningServiceError('sheet_incompatible', 422)
    }

    return {
      attempt,
      spreadsheetId: spreadsheet.id,
      spreadsheetName: spreadsheet.name,
    }
  }

  private async finishVerifiedTarget(
    target: VerifiedTarget,
    createdByService: boolean,
  ): Promise<ProvisioningActionResult> {
    const expectedStatus = target.attempt.status
    if (expectedStatus !== 'creating' && expectedStatus !== 'verifying') {
      throw new ProvisioningServiceError('connection_conflict', 409)
    }

    if (target.attempt.mode === 'change') {
      const attempt = await this.dependencies.connections.updateClaimedProvisioningAttempt({
        attemptId: target.attempt.id,
        userId: target.attempt.userId,
        expectedStatus,
        status: 'ready_to_confirm',
        selectedSpreadsheetId: target.spreadsheetId,
        selectedSpreadsheetName: target.spreadsheetName,
        createdByService,
        errorCode: null,
        errorMessage: null,
      })
      if (!attempt) throw new ProvisioningServiceError('connection_conflict', 409)
      return { status: await this.statusForAttempt(attempt) }
    }

    try {
      const verifiedAttempt = await this.dependencies.connections.updateClaimedProvisioningAttempt({
        attemptId: target.attempt.id,
        userId: target.attempt.userId,
        expectedStatus,
        selectedSpreadsheetId: target.spreadsheetId,
        selectedSpreadsheetName: target.spreadsheetName,
        createdByService,
        errorCode: null,
        errorMessage: null,
      })
      if (!verifiedAttempt) throw new ProvisioningServiceError('connection_conflict', 409)
      const completed = await this.dependencies.connections.completeProvisioningAttempt({
        attemptId: verifiedAttempt.id,
        userId: verifiedAttempt.userId,
        expectedStatus,
        expectedSpreadsheetId: target.spreadsheetId,
        expectedSpreadsheetName: target.spreadsheetName,
        expectedOriginalConnectionVersion: null,
        journalSessionTtlMs: JOURNAL_SESSION_TTL_MS,
      })
      return {
        status: this.statusForConnection(completed.connection),
        journalSession: browserSession(completed.journalSession),
      }
    } catch (error) {
      if (error instanceof ProvisioningServiceError) throw error
      await this.markAttemptFailed(target.attempt, 'connection_conflict')
      throw new ProvisioningServiceError('connection_conflict', 409)
    }
  }

  private async validateExistingSheet(accessToken: string, spreadsheetId: string): Promise<void> {
    try {
      await this.dependencies.sheets.validateExisting(accessToken, spreadsheetId)
    } catch (error) {
      if (error instanceof GoogleConnectionError) {
        throw new ProvisioningServiceError('sheet_unavailable', 422)
      }
      if (error instanceof GoogleUpstreamError) throw new ProvisioningServiceError('upstream_failure', 502)
      if (isJournalError(error)) throw new ProvisioningServiceError('sheet_incompatible', 422)
      throw new ProvisioningServiceError('sheet_incompatible', 422)
    }
  }

  private async getProvisioningCredentials(
    attempt: ProvisioningAttemptDocument,
    preserveAttemptOnFailure: boolean = false,
  ): Promise<ProvisioningCredentials> {
    if (!attempt.tempEncryptedRefreshToken) {
      if (!preserveAttemptOnFailure) await this.markAttemptFailed(attempt, 'provisioning_failed')
      throw new ProvisioningServiceError('provisioning_failed', 422)
    }
    const expectedTempEncryptedRefreshToken = cloneEncryptedToken(attempt.tempEncryptedRefreshToken)
    try {
      const credentials = await this.getConnectionCredentials(
        expectedTempEncryptedRefreshToken,
        attempt.tempScopes,
      )
      const expectedStatus = attempt.status
      if (expectedStatus === 'completed' || expectedStatus === 'failed') {
        throw new ProvisioningServiceError('connection_conflict', 409)
      }
      const updated = await this.dependencies.connections.persistProvisioningCredentials({
        attemptId: attempt.id,
        userId: attempt.userId,
        expectedStatus,
        expectedTempEncryptedRefreshToken,
        tempEncryptedRefreshToken: credentials.encryptedRefreshToken,
        tempScopes: credentials.scopes,
      })
      if (!updated) throw new ProvisioningServiceError('connection_conflict', 409)
      return { attempt: updated, credentials }
    } catch (error) {
      if (error instanceof ProvisioningServiceError
        && (error.code === 'upstream_failure' || error.code === 'connection_conflict')) {
        throw error
      }
      if (!preserveAttemptOnFailure) await this.markAttemptFailed(attempt, 'provisioning_failed')
      if (error instanceof ProvisioningServiceError) throw error
      throw new ProvisioningServiceError('provisioning_failed', 422)
    }
  }

  private async getConnectionCredentials(
    encryptedRefreshToken: EncryptedToken,
    currentScopes: string[] = [],
  ): Promise<RefreshedCredentials> {
    if (encryptedRefreshToken.keyVersion !== this.dependencies.config.tokenEncryptionKeyVersion) {
      // 此部署只設定目前金鑰，不能猜測或捏造已退役金鑰來解密。
      throw new ProvisioningServiceError('upstream_failure', 502)
    }
    const refreshToken = this.decryptToken(
      encryptedRefreshToken,
      new Map([[this.dependencies.config.tokenEncryptionKeyVersion, this.dependencies.config.tokenEncryptionKey]]),
    )
    if (!refreshToken) throw new ProvisioningServiceError('provisioning_failed', 422)

    let credentials: GoogleCredentials
    try {
      credentials = await this.refreshCredentials(refreshToken, this.dependencies.config)
    } catch (error) {
      if (error instanceof InvalidRefreshTokenError) {
        throw new ProvisioningServiceError('provisioning_failed', 422)
      }
      if (error instanceof GoogleOAuthUpstreamError) {
        throw new ProvisioningServiceError('upstream_failure', 502)
      }
      throw new ProvisioningServiceError('upstream_failure', 502)
    }
    if (!credentials.accessToken) throw new ProvisioningServiceError('upstream_failure', 502)
    return {
      accessToken: credentials.accessToken,
      encryptedRefreshToken: credentials.refreshToken
        ? this.encryptToken(
          credentials.refreshToken,
          this.dependencies.config.tokenEncryptionKey,
          this.dependencies.config.tokenEncryptionKeyVersion,
        )
        : cloneEncryptedToken(encryptedRefreshToken),
      scopes: credentials.scopes === undefined ? [...currentScopes] : [...credentials.scopes],
    }
  }

  private async statusForAttempt(context: ProvisioningSessionContext): Promise<ProvisioningStatus>
  private async statusForAttempt(attempt: ProvisioningAttemptDocument): Promise<ProvisioningStatus>
  private async statusForAttempt(
    value: ProvisioningSessionContext | ProvisioningAttemptDocument,
  ): Promise<ProvisioningStatus> {
    const attempt = 'attempt' in value ? value.attempt : value
    const active = attempt.mode === 'change'
      ? await this.dependencies.connections.findActiveConnection(attempt.userId)
      : undefined
    return this.statusForAttemptWithConnection(attempt, active)
  }

  private statusForAttemptWithConnection(
    attempt: ProvisioningAttemptDocument,
    active: ActiveSheetConnectionDocument | undefined,
  ): ProvisioningStatus {
    return {
      phase: attempt.status,
      sheetName: attempt.selectedSpreadsheetName ?? active?.spreadsheetName ?? null,
      lastUpdatedAt: attempt.updatedAt,
      connectionVersion: active?.connectionVersion ?? attempt.originalConnectionVersion,
      canDeleteActiveSystemSheet: active?.createdByService === true,
      errorCode: attempt.errorCode,
    }
  }

  private statusForConnection(connection: ActiveSheetConnectionDocument): ProvisioningStatus {
    return {
      phase: 'completed',
      sheetName: connection.spreadsheetName,
      lastUpdatedAt: connection.updatedAt,
      connectionVersion: connection.connectionVersion,
      canDeleteActiveSystemSheet: connection.createdByService,
      errorCode: null,
    }
  }

  private async assertTargetAvailable(userId: string, spreadsheetId: string): Promise<void> {
    if (!this.dependencies.claimVerifier) return
    try {
      await this.dependencies.claimVerifier.assertTargetAvailable(userId, spreadsheetId)
    } catch (error) {
      if (error instanceof ProvisioningServiceError) throw error
      throw new ProvisioningServiceError('sheet_unavailable', 409)
    }
  }

  private assertClaimableAttempt(attempt: ProvisioningAttemptDocument): void {
    if (attempt.expiresAt <= this.now() || (attempt.status !== 'initial_choice'
      && attempt.status !== 'candidate_selection')) {
      throw new ProvisioningServiceError('unauthenticated', 401, 'provisioning')
    }
  }

  private async claimTargetAction(
    context: ProvisioningSessionContext,
    nextStatus: 'creating' | 'verifying',
    createdByService: boolean = false,
  ): Promise<ProvisioningAttemptDocument> {
    this.assertClaimableAttempt(context.attempt)
    const claimed = await this.dependencies.connections.claimProvisioningAttemptAction({
      attemptId: context.attempt.id,
      userId: context.session.userId,
      nextStatus,
      createdByService,
    })
    if (!claimed) throw new ProvisioningServiceError('connection_conflict', 409)
    return claimed
  }

  private async updateAttempt(
    attemptId: string,
    update: Partial<Pick<
      ProvisioningAttemptDocument,
      | 'status'
      | 'selectedSpreadsheetId'
      | 'selectedSpreadsheetName'
      | 'createdByService'
      | 'errorCode'
      | 'errorMessage'
    >>,
  ): Promise<ProvisioningAttemptDocument | undefined> {
    return this.dependencies.connections.updateProvisioningAttempt(attemptId, update)
  }

  private async markAttemptFailed(attempt: ProvisioningAttemptDocument, errorCode: string): Promise<void> {
    if (attempt.status === 'completed' || attempt.status === 'failed') return
    try {
      await this.dependencies.connections.failProvisioningAttempt({
        attemptId: attempt.id,
        userId: attempt.userId,
        expectedStatuses: [attempt.status],
        errorCode,
      })
    } catch {
      // The caller still receives a safe failure; no partial activation is attempted after this point.
    }
  }

  private async recordRecoverableError(
    attempt: ProvisioningAttemptDocument,
    errorCode: string,
    status: 'candidate_selection',
  ): Promise<void> {
    try {
      if (attempt.status !== 'verifying') return
      await this.dependencies.connections.updateClaimedProvisioningAttempt({
        attemptId: attempt.id,
        userId: attempt.userId,
        expectedStatus: 'verifying',
        status,
        errorCode,
        errorMessage: null,
      })
    } catch {
      // A diagnostic update must not replace the original safe action failure.
    }
  }

  private readSessionCookie(
    request: Request,
    cookieName: typeof SESSION_COOKIE_NAME | typeof PROVISIONING_COOKIE_NAME,
    clearCookie: CookieToClear,
  ): { sessionId: string; expiresAt: number } {
    const encrypted = readCookie(request.headers.get('Cookie'), cookieName)
    const payload = encrypted && this.decryptCookie(encrypted, this.dependencies.config.sessionEncryptionKey)
    if (!payload) throw new ProvisioningServiceError('unauthenticated', 401, clearCookie)
    return payload
  }

  private async tryJournalContext(request: Request): Promise<JournalProvisioningContext | undefined> {
    if (!readCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME)) return undefined
    try {
      return await this.requireJournalContext(request)
    } catch (error) {
      if (error instanceof ProvisioningServiceError && error.code === 'unauthenticated') return undefined
      throw error
    }
  }

  private resolveCursor(
    cursor: string | null,
    context: ProvisioningSessionContext,
    query: string,
  ): CursorPayload | undefined {
    if (cursor === null) return undefined
    const parsed = this.openCursor(cursor)
    if (!parsed || parsed.expiresAt <= this.now() || parsed.attemptId !== context.attempt.id
      || parsed.userId !== context.session.userId || parsed.query !== query) {
      throw new ProvisioningServiceError('invalid_request', 400)
    }
    return parsed
  }

  private sealCursor(payload: CursorPayload): string {
    const key = cursorKey(this.dependencies.config.sessionEncryptionKey)
    const iv = randomBytes(CURSOR_IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
  }

  private openCursor(value: string): CursorPayload | undefined {
    if (typeof value !== 'string') return undefined
    const parts = value.split('.')
    if (parts.length !== 3 || parts.some((part) => !BASE64URL.test(part))) return undefined
    const decoded = parts.map((part) => Buffer.from(part, 'base64url'))
    const [iv, authTag, ciphertext] = decoded as [Buffer, Buffer, Buffer]
    if (iv.length !== CURSOR_IV_BYTES || authTag.length !== CURSOR_AUTH_TAG_BYTES || !ciphertext.length) {
      return undefined
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', cursorKey(this.dependencies.config.sessionEncryptionKey), iv)
      decipher.setAuthTag(authTag)
      const payload = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as unknown
      return isCursorPayload(payload) ? payload : undefined
    } catch {
      return undefined
    }
  }
}

/** 正式 route 以 config 與 Firestore 組裝服務；測試可直接注入窄介面 facade。 */
export function createServerProvisioningService(
  config: ServerConfig,
  firestore: Firestore | FirestoreAdapter,
): ProvisioningService {
  const sheetsClient = new GoogleSheetsClient()
  return new ProvisioningService({
    config,
    connections: new FirestoreConnectionStore(firestore),
    sessions: new SessionStore(firestore),
    drive: new GoogleDriveClient(),
    sheets: {
      async create(accessToken: string, title: string): Promise<{ spreadsheetId: string }> {
        const created = await sheetsClient.createSpreadsheet(accessToken, title)
        return { spreadsheetId: created.spreadsheetId }
      },
      initialize(accessToken: string, spreadsheetId: string): Promise<void> {
        return SheetsJournalStore.initialize({ client: sheetsClient, accessToken, spreadsheetId })
      },
      async validateExisting(accessToken: string, spreadsheetId: string): Promise<void> {
        await SheetsJournalStore.load({ client: sheetsClient, accessToken, spreadsheetId })
      },
    },
    claimVerifier: createFirestoreClaimVerifier(firestore),
  })
}

export type ProvisioningRouteRateLimiter = Pick<RateLimiter, 'consume'>

export async function consumeProvisioningRateLimit(
  rateLimiter: ProvisioningRouteRateLimiter,
  userId: string,
): Promise<void> {
  await rateLimiter.consume({
    scope: 'provisioning',
    subject: userId,
    ...RATE_LIMIT_WINDOWS.provisioning,
  })
}

export async function readJsonMutation(
  request: Request,
  appOrigin: string,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new ProvisioningServiceError('unsupported_media_type', 415)
  const origin = request.headers.get('Origin')
  if (origin !== null && origin !== appOrigin) throw new ProvisioningServiceError('forbidden', 403)
  try {
    const body = await request.json() as unknown
    if (!isRecord(body)) throw new Error('invalid body')
    return body
  } catch {
    throw new ProvisioningServiceError('invalid_request', 400)
  }
}

export function isEmptyObject(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0
}

export function isExactObject(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

export function provisioningErrorResponse(error: unknown): Response {
  if (error instanceof RateLimitError) return jsonResponse({ error: 'rate_limited' }, 429)
  if (error instanceof ProvisioningServiceError) {
    const cookies = error.clearCookie === 'all'
      ? clearAllSessionCookies()
      : error.clearCookie === 'journal'
        ? [clearSessionCookie()]
        : error.clearCookie === 'provisioning'
          ? [clearProvisioningCookie()]
          : []
    return jsonResponse({ error: error.code }, error.status, cookies)
  }
  return jsonResponse({ error: 'upstream_failure' }, 502)
}

function createFirestoreClaimVerifier(
  firestore: Firestore | FirestoreAdapter,
): ProvisioningClaimVerifier {
  const adapter = firestore as unknown as FirestoreAdapter
  return {
    async assertTargetAvailable(userId: string, spreadsheetId: string): Promise<void> {
      try {
        const snapshot = await adapter.collection('sheet_claims').doc(hashSpreadsheetId(spreadsheetId)).get()
        if (!snapshot.exists) return
        const data = snapshot.data()
        if (!isRecord(data) || data.userId !== userId) {
          throw new ProvisioningServiceError('sheet_unavailable', 409)
        }
      } catch (error) {
        if (error instanceof ProvisioningServiceError) throw error
        throw new ProvisioningServiceError('upstream_failure', 502)
      }
    },
  }
}

function browserSession(session: SessionDocument): BrowserSession {
  return {
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    kind: session.kind,
    userId: session.userId,
  }
}

function cloneEncryptedToken(value: EncryptedToken): EncryptedToken {
  return { ciphertext: value.ciphertext, keyVersion: value.keyVersion }
}

function normalizeCandidateQuery(value: string): string {
  const normalized = value.trim()
  if (normalized.length < 2 || normalized.length > 200) {
    throw new ProvisioningServiceError('invalid_request', 400)
  }
  return normalized
}

function parseGoogleSpreadsheetUrl(value: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.origin !== 'https://docs.google.com'
      || url.username || url.password || url.port) {
      return undefined
    }
    const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)
    return match?.[1]
  } catch {
    return undefined
  }
}

function safeDriveError(error: unknown): ProvisioningServiceError {
  if (error instanceof GoogleConnectionError) return new ProvisioningServiceError('sheet_unavailable', 422)
  if (error instanceof GoogleUpstreamError || error instanceof GoogleOAuthUpstreamError) {
    return new ProvisioningServiceError('upstream_failure', 502)
  }
  return new ProvisioningServiceError('upstream_failure', 502)
}

function isRecoverableTargetError(code: ProvisioningErrorCode): boolean {
  return code === 'invalid_selection' || code === 'invalid_sheet_url' || code === 'sheet_unavailable'
    || code === 'sheet_incompatible' || code === 'already_active' || code === 'connection_conflict'
}

function cursorKey(sessionKey: Buffer): Buffer {
  return createHash('sha256')
    .update('daily-journal/provisioning-cursor/v1\u0000', 'utf8')
    .update(sessionKey)
    .digest()
}

function isCursorPayload(value: unknown): value is CursorPayload {
  return isRecord(value)
    && isIdentifier(value.attemptId)
    && typeof value.userId === 'string'
    && Boolean(value.userId)
    && typeof value.query === 'string'
    && (value.pageToken === null || typeof value.pageToken === 'string')
    && typeof value.expiresAt === 'number'
    && Number.isFinite(value.expiresAt)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
