import type { Firestore } from '@google-cloud/firestore'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { SessionDocument } from './session-store.js'
import type { EncryptedToken } from './token-crypto.js'

export type FirestoreData = Record<string, unknown>
export type FirestoreWhereOperator = '==' | '<='

export type FirestoreDocumentReference = {
  readonly id: string
  get(): Promise<FirestoreDocumentSnapshot>
  set(data: FirestoreData): Promise<void>
  update(data: FirestoreData): Promise<void>
  delete(): Promise<void>
}

export type FirestoreDocumentSnapshot = {
  readonly exists: boolean
  data(): FirestoreData | undefined
}

export type FirestoreQueryDocumentSnapshot = FirestoreDocumentSnapshot & {
  readonly ref: FirestoreDocumentReference
}

export type FirestoreQuerySnapshot = {
  readonly empty: boolean
  readonly size: number
  readonly docs: readonly FirestoreQueryDocumentSnapshot[]
}

export type FirestoreQuery = {
  where(field: string, op: FirestoreWhereOperator, value: unknown): FirestoreQuery
  get(): Promise<FirestoreQuerySnapshot>
}

export type FirestoreCollectionReference = FirestoreQuery & {
  doc(id: string): FirestoreDocumentReference
}

export type FirestoreTransaction = {
  get(reference: FirestoreDocumentReference): Promise<FirestoreDocumentSnapshot>
  get(query: FirestoreQuery): Promise<FirestoreQuerySnapshot>
  set(reference: FirestoreDocumentReference, data: FirestoreData): FirestoreTransaction
  update(reference: FirestoreDocumentReference, data: FirestoreData): FirestoreTransaction
  delete(reference: FirestoreDocumentReference): FirestoreTransaction
}

export type FirestoreWriteBatch = {
  update(reference: FirestoreDocumentReference, data: FirestoreData): FirestoreWriteBatch
  delete(reference: FirestoreDocumentReference): FirestoreWriteBatch
  commit(): Promise<void>
}

export type FirestoreAdapter = {
  collection(name: string): FirestoreCollectionReference
  batch(): FirestoreWriteBatch
  runTransaction<T>(callback: (transaction: FirestoreTransaction) => Promise<T>): Promise<T>
}

export type ConnectionStatus = 'active' | 'archived' | 'needs_reconnect'

export type UserDocument = {
  id: string
  googleSub: string
  email: string
  name: string
  picture: string
  createdAt: number
  updatedAt: number
}

export type SheetConnectionDocument = {
  id: string
  userId: string
  spreadsheetId: string
  spreadsheetName: string
  encryptedRefreshToken: EncryptedToken | null
  scopes: string[]
  status: ConnectionStatus
  connectionVersion: number
  createdByService: boolean
  createdAt: number
  updatedAt: number
}

export type ActiveSheetConnectionDocument = SheetConnectionDocument & {
  status: 'active'
  encryptedRefreshToken: EncryptedToken
}

export type SheetClaimDocument = {
  spreadsheetHash: string
  userId: string
  createdAt: number
}

export type OAuthAttempt = {
  state: string
  codeVerifier: string
  intent: 'sign-in' | 'reauthorize'
  expiresAt: number
  consumedAt: number | null
}

export type ProvisioningPhase =
  | 'initial_choice'
  | 'candidate_selection'
  | 'creating'
  | 'verifying'
  | 'ready_to_confirm'
  | 'completed'
  | 'failed'

export type ProvisioningAttemptDocument = {
  id: string
  userId: string
  mode: 'initial' | 'change'
  originalConnectionVersion: number | null
  tempEncryptedRefreshToken: EncryptedToken | null
  tempScopes: string[]
  selectedSpreadsheetId: string | null
  selectedSpreadsheetName: string | null
  createdByService: boolean
  status: ProvisioningPhase
  expiresAt: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: number
  updatedAt: number
}

export type ProvisioningAttemptUpdate = Pick<
  ProvisioningAttemptDocument,
  | 'status'
  | 'tempEncryptedRefreshToken'
  | 'tempScopes'
  | 'selectedSpreadsheetId'
  | 'selectedSpreadsheetName'
  | 'createdByService'
  | 'errorCode'
  | 'errorMessage'
>

export type ProvisioningActionClaimStatus = 'creating' | 'verifying'

export type ProvisioningActionClaimInput = {
  attemptId: string
  userId: string
  nextStatus: ProvisioningActionClaimStatus
  createdByService?: boolean
}

export type UpdateClaimedProvisioningAttemptInput = {
  attemptId: string
  userId: string
  expectedStatus: 'creating' | 'verifying'
  status?: ProvisioningPhase
  selectedSpreadsheetId?: string | null
  selectedSpreadsheetName?: string | null
  createdByService?: boolean
  errorCode?: string | null
  errorMessage?: string | null
}

export type PersistProvisioningCredentialsInput = {
  attemptId: string
  userId: string
  expectedStatus: Exclude<ProvisioningPhase, 'completed' | 'failed'>
  expectedTempEncryptedRefreshToken: EncryptedToken
  tempEncryptedRefreshToken: EncryptedToken
  tempScopes: string[]
}

export type CompleteProvisioningAttemptInput = {
  attemptId: string
  userId: string
  expectedStatus: 'creating' | 'verifying' | 'ready_to_confirm'
  expectedSpreadsheetId: string
  expectedSpreadsheetName: string
  expectedOriginalConnectionVersion: number | null
  journalSessionTtlMs: number
}

export type UpdateActiveConnectionCredentialsInput = {
  userId: string
  connectionId: string
  expectedConnectionVersion: number
  encryptedRefreshToken?: EncryptedToken
  /** undefined 表示上游未回傳 scope，必須保留目前值。 */
  scopes?: string[]
}

export type ProvisioningCompletion = {
  connection: ActiveSheetConnectionDocument
  journalSession: SessionDocument
}

export type SheetSelectionTokenDocument = {
  selectionCode: string
  provisioningAttemptId: string
  userId: string
  spreadsheetId: string
  spreadsheetName: string
  modifiedTime: string
  expiresAt: number
  consumedAt: number | null
}

export const SHEET_WRITE_LEASE_MS = 30_000
const SHEET_WRITE_LEASE_HEARTBEAT_MS = SHEET_WRITE_LEASE_MS / 3
const FIRESTORE_BATCH_WRITE_LIMIT = 450
const MAX_PROVISIONING_COMPLETION_SESSIONS = 440
const MAX_PROVISIONING_COMPLETION_WRITES = 450
const SHEET_WRITE_LEASE_LOST_MESSAGE = '資料表寫入 lease 已遺失。'

type FirestoreClient = Firestore | FirestoreAdapter

type ActivateConnectionInput = {
  userId: string
  spreadsheetId: string
  spreadsheetName?: string
  encryptedRefreshToken: EncryptedToken
  scopes?: string[]
  createdByService?: boolean
}

export class ConnectionStore {
  private readonly firestore: FirestoreAdapter

  constructor(firestore: FirestoreClient, private readonly clock: () => number = Date.now) {
    // Keep production coupled only to the Firestore operations this store needs.
    this.firestore = firestore as unknown as FirestoreAdapter
  }

  async getOrCreateUser(profile: {
    googleSub: string
    email: string
    name: string
    picture: string
  }): Promise<UserDocument> {
    const googleSub = requiredIdentifier(profile.googleSub, 'Google 使用者識別碼無效。')
    const userId = hashGoogleSub(googleSub)
    const userRef = this.firestore.collection('users').doc(userId)
    const now = this.clock()

    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef)
      const existing = userFromSnapshot(snapshot)

      if (snapshot.exists && !existing) throw new Error('使用者資料無效。')
      if (existing) {
        if (existing.googleSub !== googleSub) throw new Error('使用者 identity 資料無效。')
        const updated: UserDocument = {
          ...existing,
          email: profile.email.trim(),
          name: profile.name.trim(),
          picture: profile.picture.trim(),
          updatedAt: now,
        }
        transaction.set(userRef, updated)
        return updated
      }

      const created: UserDocument = {
        id: userId,
        googleSub,
        email: profile.email.trim(),
        name: profile.name.trim(),
        picture: profile.picture.trim(),
        createdAt: now,
        updatedAt: now,
      }
      transaction.set(userRef, created)
      return created
    })
  }

  async getUserByGoogleSub(googleSub: string): Promise<UserDocument | undefined> {
    if (!googleSub.trim()) return undefined
    const snapshot = await this.firestore.collection('users').doc(hashGoogleSub(googleSub.trim())).get()
    const user = userFromSnapshot(snapshot)
    return user?.googleSub === googleSub.trim() ? user : undefined
  }

  async getUserById(userId: string): Promise<UserDocument | undefined> {
    if (!userId) return undefined
    return userFromSnapshot(await this.firestore.collection('users').doc(userId).get())
  }

  async findActiveConnection(userId: string): Promise<ActiveSheetConnectionDocument | undefined> {
    if (!userId) return undefined
    const snapshot = await this.firestore
      .collection('sheet_connections')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .get()

    for (const document of snapshot.docs) {
      const connection = connectionFromSnapshot(document)
      if (connection && isActiveConnection(connection)) return connection
    }
    return undefined
  }

  async createOAuthAttempt(attempt: {
    state: string
    codeVerifier: string
    intent: OAuthAttempt['intent']
    expiresAt: number
  }): Promise<void> {
    const state = requiredIdentifier(attempt.state, 'OAuth 狀態無效。')
    if (!attempt.codeVerifier || !Number.isFinite(attempt.expiresAt) || attempt.expiresAt <= this.clock()) {
      throw new Error('OAuth 嘗試已過期。')
    }
    const ref = this.firestore.collection('oauth_attempts').doc(state)
    const document: OAuthAttempt = {
      state,
      codeVerifier: attempt.codeVerifier,
      intent: attempt.intent,
      expiresAt: attempt.expiresAt,
      consumedAt: null,
    }

    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      if (snapshot.exists) throw new Error('OAuth 狀態已存在。')
      transaction.set(ref, document)
    })
  }

  async consumeOAuthAttempt(state: string, now: number = this.clock()): Promise<OAuthAttempt | undefined> {
    if (!isIdentifier(state)) return undefined
    const ref = this.firestore.collection('oauth_attempts').doc(state)

    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const attempt = oauthAttemptFromSnapshot(snapshot)
      if (!attempt || attempt.consumedAt !== null || attempt.expiresAt <= now) return undefined

      const consumed = { ...attempt, consumedAt: now }
      transaction.update(ref, { consumedAt: now })
      return consumed
    })
  }

  async createProvisioningAttempt(data: {
    userId: string
    mode: 'initial' | 'change'
    originalConnectionVersion?: number
    tempEncryptedRefreshToken?: EncryptedToken | null
    tempScopes?: string[]
    ttlMs: number
  }): Promise<ProvisioningAttemptDocument> {
    const userId = requiredIdentifier(data.userId, '使用者識別碼無效。')
    assertPositiveDuration(data.ttlMs, '設定流程效期無效。')
    if (data.originalConnectionVersion !== undefined && !isConnectionVersion(data.originalConnectionVersion)) {
      throw new Error('連線版本無效。')
    }
    if (data.tempEncryptedRefreshToken !== undefined && data.tempEncryptedRefreshToken !== null
      && !isEncryptedToken(data.tempEncryptedRefreshToken)) {
      throw new Error('加密 token 資料無效。')
    }
    if (data.tempScopes !== undefined && !isScopes(data.tempScopes)) {
      throw new Error('Google 權限資料無效。')
    }

    const id = randomUUID()
    const now = this.clock()
    const attempt: ProvisioningAttemptDocument = {
      id,
      userId,
      mode: data.mode,
      originalConnectionVersion: data.originalConnectionVersion ?? null,
      tempEncryptedRefreshToken: data.tempEncryptedRefreshToken ?? null,
      tempScopes: data.tempScopes ? [...data.tempScopes] : [],
      selectedSpreadsheetId: null,
      selectedSpreadsheetName: null,
      createdByService: false,
      status: 'initial_choice',
      expiresAt: now + data.ttlMs,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    }
    const userRef = this.firestore.collection('users').doc(userId)
    const attemptRef = this.firestore.collection('provisioning_attempts').doc(id)

    return this.firestore.runTransaction(async (transaction) => {
      const user = userFromSnapshot(await transaction.get(userRef))
      if (!user) throw new Error('找不到使用者。')
      transaction.set(attemptRef, attempt)
      return attempt
    })
  }

  async getProvisioningAttempt(
    attemptId: string,
    now: number = this.clock(),
  ): Promise<ProvisioningAttemptDocument | undefined> {
    if (!isIdentifier(attemptId)) return undefined
    const snapshot = await this.firestore.collection('provisioning_attempts').doc(attemptId).get()
    const attempt = provisioningAttemptFromSnapshot(snapshot)
    return attempt && attempt.expiresAt > now ? attempt : undefined
  }

  async updateProvisioningAttempt(
    attemptId: string,
    update: Partial<ProvisioningAttemptUpdate>,
    now: number = this.clock(),
  ): Promise<ProvisioningAttemptDocument | undefined> {
    if (!isIdentifier(attemptId)) return undefined
    const ref = this.firestore.collection('provisioning_attempts').doc(attemptId)

    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const current = provisioningAttemptFromSnapshot(snapshot)
      if (!current || current.expiresAt <= now) return undefined

      const safeUpdate = provisioningUpdate(update)
      const updated = applyProvisioningAttemptUpdate(current, safeUpdate, now)
      if (!updated) return undefined
      transaction.update(ref, provisioningAttemptWrite(updated, safeUpdate, now))
      return updated
    })
  }

  async claimProvisioningAttemptAction(
    input: ProvisioningActionClaimInput,
  ): Promise<ProvisioningAttemptDocument | undefined> {
    if (!isIdentifier(input.attemptId) || !isIdentifier(input.userId)
      || !isClaimedProvisioningPhase(input.nextStatus)) {
      return undefined
    }
    const attemptRef = this.firestore.collection('provisioning_attempts').doc(input.attemptId)
    const userRef = this.firestore.collection('users').doc(input.userId)

    return this.firestore.runTransaction(async (transaction) => {
      const now = this.clock()
      const [attemptSnapshot, userSnapshot] = await Promise.all([
        transaction.get(attemptRef),
        transaction.get(userRef),
      ])
      const attempt = provisioningAttemptFromSnapshot(attemptSnapshot)
      const user = userFromSnapshot(userSnapshot)
      if (!user || user.id !== input.userId || !attempt || attempt.userId !== input.userId
        || attempt.expiresAt <= now || !isClaimableProvisioningPhase(attempt.status)) {
        return undefined
      }

      const updated: ProvisioningAttemptDocument = {
        ...attempt,
        status: input.nextStatus,
        createdByService: attempt.createdByService || input.createdByService === true,
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      }
      transaction.update(attemptRef, {
        status: updated.status,
        createdByService: updated.createdByService,
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      })
      return updated
    })
  }

  async updateClaimedProvisioningAttempt(
    input: UpdateClaimedProvisioningAttemptInput,
  ): Promise<ProvisioningAttemptDocument | undefined> {
    if (!isIdentifier(input.attemptId) || !isIdentifier(input.userId)
      || !isClaimedProvisioningPhase(input.expectedStatus)) {
      return undefined
    }
    const safeUpdate = provisioningUpdate({
      status: input.status,
      selectedSpreadsheetId: input.selectedSpreadsheetId,
      selectedSpreadsheetName: input.selectedSpreadsheetName,
      createdByService: input.createdByService,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    })
    const attemptRef = this.firestore.collection('provisioning_attempts').doc(input.attemptId)
    const userRef = this.firestore.collection('users').doc(input.userId)

    return this.firestore.runTransaction(async (transaction) => {
      const now = this.clock()
      const [attemptSnapshot, userSnapshot] = await Promise.all([
        transaction.get(attemptRef),
        transaction.get(userRef),
      ])
      const attempt = provisioningAttemptFromSnapshot(attemptSnapshot)
      const user = userFromSnapshot(userSnapshot)
      if (!user || user.id !== input.userId || !attempt || attempt.userId !== input.userId
        || attempt.expiresAt <= now || attempt.status !== input.expectedStatus) {
        return undefined
      }

      const updated = applyProvisioningAttemptUpdate(attempt, safeUpdate, now)
      if (!updated) return undefined
      transaction.update(attemptRef, provisioningAttemptWrite(updated, safeUpdate, now))
      return updated
    })
  }

  async persistProvisioningCredentials(
    input: PersistProvisioningCredentialsInput,
  ): Promise<ProvisioningAttemptDocument | undefined> {
    if (!isIdentifier(input.attemptId) || !isIdentifier(input.userId)
      || !isCredentialPersistencePhase(input.expectedStatus)
      || !isEncryptedToken(input.expectedTempEncryptedRefreshToken)
      || !isEncryptedToken(input.tempEncryptedRefreshToken) || !isScopes(input.tempScopes)) {
      return undefined
    }
    const attemptRef = this.firestore.collection('provisioning_attempts').doc(input.attemptId)
    const userRef = this.firestore.collection('users').doc(input.userId)

    return this.firestore.runTransaction(async (transaction) => {
      const now = this.clock()
      const [attemptSnapshot, userSnapshot] = await Promise.all([
        transaction.get(attemptRef),
        transaction.get(userRef),
      ])
      const attempt = provisioningAttemptFromSnapshot(attemptSnapshot)
      const user = userFromSnapshot(userSnapshot)
      if (!user || user.id !== input.userId || !attempt || attempt.userId !== input.userId
        || attempt.expiresAt <= now || attempt.status !== input.expectedStatus
        || !attempt.tempEncryptedRefreshToken
        || !encryptedTokensEqual(attempt.tempEncryptedRefreshToken, input.expectedTempEncryptedRefreshToken)) {
        return undefined
      }

      const updated: ProvisioningAttemptDocument = {
        ...attempt,
        tempEncryptedRefreshToken: cloneEncryptedToken(input.tempEncryptedRefreshToken),
        tempScopes: [...input.tempScopes],
        updatedAt: now,
      }
      transaction.update(attemptRef, {
        tempEncryptedRefreshToken: updated.tempEncryptedRefreshToken,
        tempScopes: updated.tempScopes,
        updatedAt: now,
      })
      return updated
    })
  }

  async failProvisioningAttempt(data: {
    attemptId: string
    userId: string
    expectedStatuses: readonly Exclude<ProvisioningPhase, 'completed' | 'failed'>[]
    errorCode: string
  }): Promise<ProvisioningAttemptDocument | undefined> {
    if (!isIdentifier(data.attemptId) || !isIdentifier(data.userId) || !data.expectedStatuses.length
      || data.expectedStatuses.some((status) => !isNonFinalProvisioningPhase(status))
      || !isString(data.errorCode)) {
      return undefined
    }
    const attemptRef = this.firestore.collection('provisioning_attempts').doc(data.attemptId)
    const userRef = this.firestore.collection('users').doc(data.userId)

    return this.firestore.runTransaction(async (transaction) => {
      const now = this.clock()
      const [attemptSnapshot, userSnapshot] = await Promise.all([
        transaction.get(attemptRef),
        transaction.get(userRef),
      ])
      const attempt = provisioningAttemptFromSnapshot(attemptSnapshot)
      const user = userFromSnapshot(userSnapshot)
      if (!user || user.id !== data.userId || !attempt || attempt.userId !== data.userId
        || attempt.expiresAt <= now || !isNonFinalProvisioningPhase(attempt.status)
        || !data.expectedStatuses.includes(attempt.status)) {
        return undefined
      }

      const updated: ProvisioningAttemptDocument = {
        ...attempt,
        status: 'failed',
        errorCode: data.errorCode,
        errorMessage: null,
        updatedAt: now,
      }
      transaction.update(attemptRef, {
        status: 'failed',
        errorCode: data.errorCode,
        errorMessage: null,
        updatedAt: now,
      })
      return updated
    })
  }

  async createSheetSelectionToken(data: {
    provisioningAttemptId: string
    spreadsheetId: string
    spreadsheetName: string
    modifiedTime: string
    ttlMs: number
  }): Promise<string> {
    const provisioningAttemptId = requiredIdentifier(data.provisioningAttemptId, '設定流程識別碼無效。')
    const spreadsheetId = requiredIdentifier(data.spreadsheetId, '資料表識別碼無效。')
    assertPositiveDuration(data.ttlMs, '選擇代碼效期無效。')
    const selectionCode = randomBytes(24).toString('base64url')
    const now = this.clock()
    const attemptRef = this.firestore.collection('provisioning_attempts').doc(provisioningAttemptId)
    const selectionRef = this.firestore.collection('sheet_selection_tokens').doc(selectionCode)

    await this.firestore.runTransaction(async (transaction) => {
      const attempt = provisioningAttemptFromSnapshot(await transaction.get(attemptRef))
      if (!attempt || attempt.expiresAt <= now || !isClaimableProvisioningPhase(attempt.status)) {
        throw new Error('設定流程已過期。')
      }

      const document: SheetSelectionTokenDocument = {
        selectionCode,
        provisioningAttemptId,
        userId: attempt.userId,
        spreadsheetId,
        spreadsheetName: data.spreadsheetName.trim(),
        modifiedTime: data.modifiedTime,
        expiresAt: Math.min(now + data.ttlMs, attempt.expiresAt),
        consumedAt: null,
      }
      transaction.set(selectionRef, document)
    })

    return selectionCode
  }

  async consumeSheetSelectionToken(
    selectionCode: string,
    expected: { provisioningAttemptId: string; userId: string },
    now: number = this.clock(),
  ): Promise<SheetSelectionTokenDocument | undefined> {
    if (!isIdentifier(selectionCode) || !isIdentifier(expected.provisioningAttemptId) || !expected.userId) {
      return undefined
    }
    const selectionRef = this.firestore.collection('sheet_selection_tokens').doc(selectionCode)
    const attemptRef = this.firestore.collection('provisioning_attempts').doc(expected.provisioningAttemptId)

    return this.firestore.runTransaction(async (transaction) => {
      const [selectionSnapshot, attemptSnapshot] = await Promise.all([
        transaction.get(selectionRef),
        transaction.get(attemptRef),
      ])
      const selection = selectionTokenFromSnapshot(selectionSnapshot)
      const attempt = provisioningAttemptFromSnapshot(attemptSnapshot)
      if (!selection || !attempt || selection.consumedAt !== null || selection.expiresAt <= now
        || attempt.expiresAt <= now || (!isClaimableProvisioningPhase(attempt.status)
          && !isClaimedProvisioningPhase(attempt.status))
        || selection.provisioningAttemptId !== expected.provisioningAttemptId
        || selection.userId !== expected.userId || attempt.userId !== expected.userId) {
        return undefined
      }

      const consumed = { ...selection, consumedAt: now }
      transaction.update(selectionRef, { consumedAt: now })
      return consumed
    })
  }

  async activateConnection(data: ActivateConnectionInput): Promise<ActiveSheetConnectionDocument> {
    return this.transitionToActiveConnection(data)
  }

  async archiveAndActivateConnection(data: {
    userId: string
    targetSpreadsheetId: string
    targetSpreadsheetName?: string
    encryptedRefreshToken: EncryptedToken
    scopes?: string[]
    createdByService?: boolean
    expectedOriginalVersion: number
  }): Promise<ActiveSheetConnectionDocument> {
    if (!isConnectionVersion(data.expectedOriginalVersion)) {
      throw new Error('連線版本不符，請重新整理後再試。')
    }
    return this.transitionToActiveConnection({
      userId: data.userId,
      spreadsheetId: data.targetSpreadsheetId,
      spreadsheetName: data.targetSpreadsheetName,
      encryptedRefreshToken: data.encryptedRefreshToken,
      scopes: data.scopes,
      createdByService: data.createdByService,
    }, data.expectedOriginalVersion)
  }

  async completeProvisioningAttempt(
    input: CompleteProvisioningAttemptInput,
  ): Promise<ProvisioningCompletion> {
    const attemptId = requiredIdentifier(input.attemptId, '設定流程識別碼無效。')
    const userId = requiredIdentifier(input.userId, '使用者識別碼無效。')
    const spreadsheetId = requiredIdentifier(input.expectedSpreadsheetId, '資料表識別碼無效。')
    const spreadsheetName = input.expectedSpreadsheetName.trim()
    if (!spreadsheetName || !isCompletionProvisioningPhase(input.expectedStatus)
      || !(input.expectedOriginalConnectionVersion === null
        || isConnectionVersion(input.expectedOriginalConnectionVersion))) {
      throw new Error('設定流程完成資料無效。')
    }
    assertPositiveDuration(input.journalSessionTtlMs, '工作階段效期無效。')

    const userRef = this.firestore.collection('users').doc(userId)
    const attemptRef = this.firestore.collection('provisioning_attempts').doc(attemptId)
    const claimRef = this.firestore.collection('sheet_claims').doc(hashSpreadsheetId(spreadsheetId))
    const connectionsQuery = this.firestore.collection('sheet_connections').where('userId', '==', userId)
    const sessionsQuery = this.firestore.collection('sessions').where('userId', '==', userId)
    const newConnectionId = randomUUID()
    const journalSessionId = randomBytes(32).toString('base64url')
    const journalSessionRef = this.firestore.collection('sessions').doc(journalSessionId)

    return this.firestore.runTransaction(async (transaction) => {
      const now = this.clock()
      const [
        userSnapshot,
        attemptSnapshot,
        claimSnapshot,
        connectionsSnapshot,
        sessionsSnapshot,
        journalSessionSnapshot,
      ] = await Promise.all([
        transaction.get(userRef),
        transaction.get(attemptRef),
        transaction.get(claimRef),
        transaction.get(connectionsQuery),
        transaction.get(sessionsQuery),
        transaction.get(journalSessionRef),
      ])
      const user = userFromSnapshot(userSnapshot)
      const attempt = provisioningAttemptFromSnapshot(attemptSnapshot)
      if (!user || user.id !== userId || !attempt || attempt.userId !== userId || attempt.expiresAt <= now
        || attempt.status !== input.expectedStatus || !attempt.tempEncryptedRefreshToken) {
        throw new Error('設定流程已變更或過期。')
      }
      if (attempt.mode === 'initial') {
        if (input.expectedOriginalConnectionVersion !== null || attempt.originalConnectionVersion !== null) {
          throw new Error('設定流程版本不符。')
        }
      } else if (!isConnectionVersion(input.expectedOriginalConnectionVersion)
        || attempt.originalConnectionVersion !== input.expectedOriginalConnectionVersion) {
        throw new Error('連線版本不符，請重新整理後再試。')
      }
      if (attempt.selectedSpreadsheetId !== spreadsheetId
        || attempt.selectedSpreadsheetName !== spreadsheetName) {
        throw new Error('設定流程目標已變更。')
      }

      const claim = claimFromSnapshot(claimSnapshot)
      if (claimSnapshot.exists && !claim) throw new Error('資料表 claim 資料無效。')
      if (claim && claim.userId !== userId) throw new Error('此資料表已被其他帳號連結。')
      if (journalSessionSnapshot.exists) throw new Error('工作階段識別碼衝突。')

      const connections = connectionsSnapshot.docs.map((document) => {
        const connection = connectionFromSnapshot(document)
        if (!connection) throw new Error('資料表連線資料無效。')
        return { connection, ref: document.ref }
      })
      const activeConnections = connections.filter(({ connection }) => connection.status === 'active')
      if (activeConnections.length > 1) throw new Error('作用中的資料表連線資料無效。')
      const currentActive = activeConnections[0]?.connection
      if (attempt.mode === 'initial') {
        // 初次啟用絕不能把另一個並行完成剛建立的連線封存。
        if (currentActive) throw new Error('已有作用中的資料表連線。')
      } else if (!currentActive || currentActive.connectionVersion !== input.expectedOriginalConnectionVersion) {
        throw new Error('連線版本不符，請重新整理後再試。')
      } else if (currentActive.spreadsheetId === spreadsheetId) {
        throw new Error('目標資料表已作用中。')
      }

      const sessions = sessionsSnapshot.docs.map((document) => {
        const session = sessionFromSnapshot(document)
        if (!session || session.userId !== userId) throw new Error('工作階段資料無效。')
        return { session, ref: document.ref }
      })
      if (sessions.length > MAX_PROVISIONING_COMPLETION_SESSIONS) {
        throw new Error('工作階段數量過多，無法安全完成設定。')
      }

      const existingTarget = connections.find(({ connection }) => connection.spreadsheetId === spreadsheetId)
      const nextVersion = Math.max(0, ...connections.map(({ connection }) => connection.connectionVersion)) + 1
      const target: ActiveSheetConnectionDocument = existingTarget
        ? {
          ...existingTarget.connection,
          spreadsheetName,
          encryptedRefreshToken: cloneEncryptedToken(attempt.tempEncryptedRefreshToken),
          scopes: [...attempt.tempScopes],
          status: 'active',
          connectionVersion: nextVersion,
          createdByService: existingTarget.connection.createdByService || attempt.createdByService,
          updatedAt: now,
        }
        : {
          id: newConnectionId,
          userId,
          spreadsheetId,
          spreadsheetName,
          encryptedRefreshToken: cloneEncryptedToken(attempt.tempEncryptedRefreshToken),
          scopes: [...attempt.tempScopes],
          status: 'active',
          connectionVersion: nextVersion,
          createdByService: attempt.createdByService,
          createdAt: now,
          updatedAt: now,
        }
      const sessionWrites = sessions.filter(({ session }) => session.revokedAt === null).length
      const writeCount = activeConnections.length + 1 + (claim ? 0 : 1) + 1 + sessionWrites + 1
      if (writeCount > MAX_PROVISIONING_COMPLETION_WRITES) {
        throw new Error('工作階段數量過多，無法安全完成設定。')
      }
      const journalSession: SessionDocument = {
        sessionId: journalSessionId,
        userId,
        kind: 'journal',
        expiresAt: now + input.journalSessionTtlMs,
        createdAt: now,
        lastUsedAt: now,
        revokedAt: null,
        provisioningAttemptId: null,
      }

      for (const { ref } of activeConnections) {
        transaction.update(ref, { status: 'archived', updatedAt: now })
      }
      if (!claim) transaction.set(claimRef, {
        spreadsheetHash: hashSpreadsheetId(spreadsheetId),
        userId,
        createdAt: now,
      })
      transaction.set(
        existingTarget?.ref ?? this.firestore.collection('sheet_connections').doc(target.id),
        target,
      )
      transaction.update(attemptRef, {
        status: 'completed',
        tempEncryptedRefreshToken: null,
        tempScopes: [],
        selectedSpreadsheetId: spreadsheetId,
        selectedSpreadsheetName: spreadsheetName,
        createdByService: target.createdByService,
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      })
      for (const { session, ref } of sessions) {
        if (session.revokedAt === null) transaction.update(ref, { revokedAt: now })
      }
      transaction.set(journalSessionRef, journalSession)
      return { connection: target, journalSession }
    })
  }

  async markConnectionNeedsReconnect(connectionId: string): Promise<void> {
    if (!isIdentifier(connectionId)) return
    const ref = this.firestore.collection('sheet_connections').doc(connectionId)
    const now = this.clock()

    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) return
      transaction.update(ref, {
        status: 'needs_reconnect',
        encryptedRefreshToken: null,
        updatedAt: now,
      })
    })
  }

  async markConnectionNeedsReconnectIfActive(data: {
    userId: string
    connectionId: string
    expectedConnectionVersion: number
  }): Promise<boolean> {
    if (!isIdentifier(data.userId) || !isIdentifier(data.connectionId)
      || !isConnectionVersion(data.expectedConnectionVersion)) {
      return false
    }
    const ref = this.firestore.collection('sheet_connections').doc(data.connectionId)
    const connectionsQuery = this.firestore.collection('sheet_connections').where('userId', '==', data.userId)

    const disconnected = await this.firestore.runTransaction(async (transaction) => {
      const now = this.clock()
      const connection = connectionFromSnapshot(await transaction.get(ref))
      if (!connection || !isActiveConnection(connection) || connection.userId !== data.userId
        || connection.connectionVersion !== data.expectedConnectionVersion) {
        return false
      }
      transaction.update(ref, {
        status: 'needs_reconnect',
        encryptedRefreshToken: null,
        updatedAt: now,
      })
      return true
    })
    if (!disconnected) return false

    const connectionsSnapshot = await connectionsQuery.get()
    const now = this.clock()
    for (let start = 0; start < connectionsSnapshot.docs.length; start += FIRESTORE_BATCH_WRITE_LIMIT) {
      const batch = this.firestore.batch()
      for (const document of connectionsSnapshot.docs.slice(start, start + FIRESTORE_BATCH_WRITE_LIMIT)) {
        batch.update(document.ref, { encryptedRefreshToken: null, updatedAt: now })
      }
      await batch.commit()
    }
    return true
  }

  async markConnectionNeedsReconnectIfCurrent(
    connectionId: string,
    expectedToken: EncryptedToken,
  ): Promise<boolean> {
    if (!isIdentifier(connectionId) || !isEncryptedToken(expectedToken)) return false
    const ref = this.firestore.collection('sheet_connections').doc(connectionId)
    const now = this.clock()

    return this.firestore.runTransaction(async (transaction) => {
      const connection = connectionFromSnapshot(await transaction.get(ref))
      if (!connection || !isActiveConnection(connection)
        || !encryptedTokensEqual(connection.encryptedRefreshToken, expectedToken)) {
        return false
      }
      transaction.update(ref, {
        status: 'needs_reconnect',
        encryptedRefreshToken: null,
        updatedAt: now,
      })
      return true
    })
  }

  async updateEncryptedToken(connectionId: string, token: EncryptedToken): Promise<void> {
    if (!isIdentifier(connectionId) || !isEncryptedToken(token)) return
    const ref = this.firestore.collection('sheet_connections').doc(connectionId)
    const now = this.clock()

    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) return
      transaction.update(ref, { encryptedRefreshToken: token, updatedAt: now })
    })
  }

  async updateEncryptedTokenIfCurrent(
    connectionId: string,
    expectedToken: EncryptedToken,
    replacementToken: EncryptedToken,
  ): Promise<boolean> {
    if (!isIdentifier(connectionId) || !isEncryptedToken(expectedToken)
      || !isEncryptedToken(replacementToken)) {
      return false
    }
    const ref = this.firestore.collection('sheet_connections').doc(connectionId)
    const now = this.clock()

    return this.firestore.runTransaction(async (transaction) => {
      const connection = connectionFromSnapshot(await transaction.get(ref))
      if (!connection || !isActiveConnection(connection)
        || !encryptedTokensEqual(connection.encryptedRefreshToken, expectedToken)) {
        return false
      }
      transaction.update(ref, { encryptedRefreshToken: replacementToken, updatedAt: now })
      return true
    })
  }

  /**
   * 將持久化憑證視為連線狀態的一部分；版本 CAS 可阻止舊換表流程覆寫新憑證。
   */
  async updateActiveConnectionCredentialsIfCurrent(
    input: UpdateActiveConnectionCredentialsInput,
  ): Promise<ActiveSheetConnectionDocument | undefined> {
    if (!isIdentifier(input.userId) || !isIdentifier(input.connectionId)
      || !isConnectionVersion(input.expectedConnectionVersion)
      || (input.encryptedRefreshToken !== undefined && !isEncryptedToken(input.encryptedRefreshToken))
      || (input.scopes !== undefined && !isScopes(input.scopes))
      || (input.encryptedRefreshToken === undefined && input.scopes === undefined)) {
      return undefined
    }
    const ref = this.firestore.collection('sheet_connections').doc(input.connectionId)

    return this.firestore.runTransaction(async (transaction) => {
      const current = connectionFromSnapshot(await transaction.get(ref))
      if (!current || !isActiveConnection(current) || current.userId !== input.userId
        || current.connectionVersion !== input.expectedConnectionVersion
        || current.connectionVersion === Number.MAX_SAFE_INTEGER) {
        return undefined
      }
      const updated: ActiveSheetConnectionDocument = {
        ...current,
        encryptedRefreshToken: input.encryptedRefreshToken === undefined
          ? cloneEncryptedToken(current.encryptedRefreshToken)
          : cloneEncryptedToken(input.encryptedRefreshToken),
        scopes: input.scopes === undefined ? [...current.scopes] : [...input.scopes],
        connectionVersion: current.connectionVersion + 1,
        updatedAt: this.clock(),
      }
      transaction.update(ref, {
        encryptedRefreshToken: updated.encryptedRefreshToken,
        scopes: updated.scopes,
        connectionVersion: updated.connectionVersion,
        updatedAt: updated.updatedAt,
      })
      return updated
    })
  }

  async claimLegacySheet(data: ActivateConnectionInput): Promise<ActiveSheetConnectionDocument> {
    return this.activateConnection({ ...data, createdByService: data.createdByService ?? false })
  }

  async withSheetWriteLease<T>(
    connectionId: string,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const id = requiredIdentifier(connectionId, '連線識別碼無效。')
    const leaseId = randomBytes(16).toString('base64url')
    const connectionRef = this.firestore.collection('sheet_connections').doc(id)
    const leaseRef = this.firestore.collection('sheet_write_leases').doc(id)

    await this.firestore.runTransaction(async (transaction) => {
      const now = this.clock()
      const [connectionSnapshot, leaseSnapshot] = await Promise.all([
        transaction.get(connectionRef),
        transaction.get(leaseRef),
      ])
      const connection = connectionFromSnapshot(connectionSnapshot)
      if (!connection || connection.status !== 'active') throw new Error('找不到作用中的資料表連線。')

      const lease = leaseFromSnapshot(leaseSnapshot)
      if (lease && lease.expiresAt > now) {
        throw new Error('目前有另一項操作正在儲存至 Google Sheet，請稍後再試。')
      }

      transaction.set(leaseRef, {
        connectionId: id,
        userId: connection.userId,
        leaseId,
        expiresAt: now + SHEET_WRITE_LEASE_MS,
      })
    })

    const renewLease = async (): Promise<void> => {
      await this.firestore.runTransaction(async (transaction) => {
        const now = this.clock()
        const lease = leaseFromSnapshot(await transaction.get(leaseRef))
        if (!lease || lease.leaseId !== leaseId || lease.expiresAt <= now) {
          throw new Error(SHEET_WRITE_LEASE_LOST_MESSAGE)
        }
        transaction.update(leaseRef, { expiresAt: now + SHEET_WRITE_LEASE_MS })
      })
    }

    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined
    let heartbeatPromise: Promise<void> | undefined
    let heartbeatStopped = false
    let leaseLost = false
    const stopHeartbeat = (): void => {
      heartbeatStopped = true
      if (heartbeatTimer !== undefined) {
        clearTimeout(heartbeatTimer)
        heartbeatTimer = undefined
      }
    }
    const scheduleHeartbeat = (): void => {
      heartbeatTimer = setTimeout(() => {
        heartbeatTimer = undefined
        heartbeatPromise = renewLease()
          .catch(() => {
            // 續約失敗後，此 invocation 無法再證明仍持有 lease。
            leaseLost = true
          })
          .finally(() => {
            heartbeatPromise = undefined
            if (!heartbeatStopped && !leaseLost) scheduleHeartbeat()
          })
      }, SHEET_WRITE_LEASE_HEARTBEAT_MS)
    }
    scheduleHeartbeat()

    try {
      const result = await fn()
      stopHeartbeat()
      await heartbeatPromise
      if (leaseLost) throw new Error(SHEET_WRITE_LEASE_LOST_MESSAGE)

      try {
        await renewLease()
      } catch {
        leaseLost = true
      }
      if (leaseLost) throw new Error(SHEET_WRITE_LEASE_LOST_MESSAGE)
      return result
    } finally {
      stopHeartbeat()
      await heartbeatPromise
      await this.firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(leaseRef)
        const lease = leaseFromSnapshot(snapshot)
        if (lease?.leaseId === leaseId) transaction.delete(leaseRef)
      }).catch(() => undefined)
    }
  }

  async deleteAccountData(userId: string): Promise<void> {
    if (!userId) return
    const userRef = this.firestore.collection('users').doc(userId)
    const userCollections = [
      'sheet_connections',
      'sessions',
      'provisioning_attempts',
      'sheet_selection_tokens',
      'sheet_claims',
      'sheet_write_leases',
    ]
    const queries = userCollections.map((collection) => this.firestore
      .collection(collection)
      .where('userId', '==', userId))

    const [userSnapshot, ...snapshots] = await Promise.all([
      userRef.get(),
      ...queries.map((query) => query.get()),
    ])
    const references = snapshots.flatMap((snapshot) => snapshot.docs.map((document) => document.ref))
    if (userSnapshot.exists) references.push(userRef)

    for (let start = 0; start < references.length; start += FIRESTORE_BATCH_WRITE_LIMIT) {
      const batch = this.firestore.batch()
      for (const reference of references.slice(start, start + FIRESTORE_BATCH_WRITE_LIMIT)) {
        batch.delete(reference)
      }
      await batch.commit()
    }
  }

  private async transitionToActiveConnection(
    input: ActivateConnectionInput,
    expectedOriginalVersion?: number,
  ): Promise<ActiveSheetConnectionDocument> {
    const userId = requiredIdentifier(input.userId, '使用者識別碼無效。')
    const spreadsheetId = requiredIdentifier(input.spreadsheetId, '資料表識別碼無效。')
    if (!isEncryptedToken(input.encryptedRefreshToken)) throw new Error('加密 token 資料無效。')

    const spreadsheetHash = hashSpreadsheetId(spreadsheetId)
    const now = this.clock()
    const newConnectionId = randomUUID()
    const userRef = this.firestore.collection('users').doc(userId)
    const claimRef = this.firestore.collection('sheet_claims').doc(spreadsheetHash)
    const connectionsQuery = this.firestore.collection('sheet_connections').where('userId', '==', userId)

    return this.firestore.runTransaction(async (transaction) => {
      const [userSnapshot, claimSnapshot, connectionsSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(claimRef),
        transaction.get(connectionsQuery),
      ])
      const user = userFromSnapshot(userSnapshot)
      if (!user) throw new Error('找不到使用者。')

      const claim = claimFromSnapshot(claimSnapshot)
      if (claimSnapshot.exists && !claim) throw new Error('資料表 claim 資料無效。')
      if (claim && claim.userId !== userId) throw new Error('此資料表已被其他帳號連結。')

      const connections = connectionsSnapshot.docs.flatMap((document) => {
        const connection = connectionFromSnapshot(document)
        return connection ? [{ connection, ref: document.ref }] : []
      })
      const currentActive = connections.find(({ connection }) => connection.status === 'active')?.connection
      if (expectedOriginalVersion !== undefined
        && (!currentActive || currentActive.connectionVersion !== expectedOriginalVersion)) {
        throw new Error('連線版本不符，請重新整理後再試。')
      }

      const existingTarget = connections.find(({ connection }) => connection.spreadsheetId === spreadsheetId)
      const nextVersion = Math.max(0, ...connections.map(({ connection }) => connection.connectionVersion)) + 1
      const target: ActiveSheetConnectionDocument = existingTarget
        ? {
          ...existingTarget.connection,
          spreadsheetName: input.spreadsheetName?.trim() || existingTarget.connection.spreadsheetName,
          encryptedRefreshToken: input.encryptedRefreshToken,
          scopes: input.scopes ? [...input.scopes] : existingTarget.connection.scopes,
          status: 'active',
          connectionVersion: existingTarget.connection.status === 'active'
            ? existingTarget.connection.connectionVersion
            : nextVersion,
          createdByService: existingTarget.connection.createdByService || input.createdByService === true,
          updatedAt: now,
        }
        : {
          id: newConnectionId,
          userId,
          spreadsheetId,
          spreadsheetName: input.spreadsheetName?.trim() || '每日記事',
          encryptedRefreshToken: input.encryptedRefreshToken,
          scopes: input.scopes ? [...input.scopes] : [],
          status: 'active',
          connectionVersion: nextVersion,
          createdByService: input.createdByService ?? false,
          createdAt: now,
          updatedAt: now,
        }

      for (const { connection, ref } of connections) {
        if (connection.id !== target.id && connection.status === 'active') {
          transaction.update(ref, { status: 'archived', updatedAt: now })
        }
      }
      if (!claim) {
        transaction.set(claimRef, { spreadsheetHash, userId, createdAt: now })
      }
      transaction.set(
        existingTarget?.ref ?? this.firestore.collection('sheet_connections').doc(target.id),
        target,
      )
      return target
    })
  }
}

export function hashSpreadsheetId(spreadsheetId: string): string {
  const id = requiredIdentifier(spreadsheetId, '資料表識別碼無效。')
  return createHash('sha256').update(id).digest('hex')
}

function hashGoogleSub(googleSub: string): string {
  return createHash('sha256').update(googleSub).digest('hex')
}

function requiredIdentifier(value: string, message: string): string {
  const normalized = value.trim()
  if (!isIdentifier(normalized)) throw new Error(message)
  return normalized
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value)
}

function assertPositiveDuration(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(message)
}

function isConnectionVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isEncryptedToken(value: unknown): value is EncryptedToken {
  return isRecord(value)
    && typeof value.ciphertext === 'string'
    && Boolean(value.ciphertext)
    && typeof value.keyVersion === 'string'
    && Boolean(value.keyVersion)
}

function cloneEncryptedToken(value: EncryptedToken): EncryptedToken {
  return { ciphertext: value.ciphertext, keyVersion: value.keyVersion }
}

function encryptedTokensEqual(left: EncryptedToken, right: EncryptedToken): boolean {
  return left.ciphertext === right.ciphertext && left.keyVersion === right.keyVersion
}

function userFromSnapshot(snapshot: FirestoreDocumentSnapshot): UserDocument | undefined {
  const data = snapshot.data()
  if (!data || !isIdentifierValue(data.id) || !isIdentifierValue(data.googleSub)
    || !isString(data.email) || !isString(data.name) || !isString(data.picture)
    || !isTimestamp(data.createdAt) || !isTimestamp(data.updatedAt)) {
    return undefined
  }
  return data as unknown as UserDocument
}

function connectionFromSnapshot(snapshot: FirestoreDocumentSnapshot): SheetConnectionDocument | undefined {
  const data = snapshot.data()
  if (!data || !isIdentifierValue(data.id) || !isIdentifierValue(data.userId)
    || !isIdentifierValue(data.spreadsheetId) || !isString(data.spreadsheetName)
    || !(data.encryptedRefreshToken === null || isEncryptedToken(data.encryptedRefreshToken))
    || !Array.isArray(data.scopes) || !data.scopes.every(isString)
    || !isConnectionStatus(data.status) || !isConnectionVersion(data.connectionVersion)
    || typeof data.createdByService !== 'boolean' || !isTimestamp(data.createdAt) || !isTimestamp(data.updatedAt)) {
    return undefined
  }
  return data as unknown as SheetConnectionDocument
}

function isActiveConnection(connection: SheetConnectionDocument): connection is ActiveSheetConnectionDocument {
  return connection.status === 'active' && isEncryptedToken(connection.encryptedRefreshToken)
}

function claimFromSnapshot(snapshot: FirestoreDocumentSnapshot): SheetClaimDocument | undefined {
  const data = snapshot.data()
  if (!data || !isIdentifierValue(data.spreadsheetHash) || !isIdentifierValue(data.userId)
    || !isTimestamp(data.createdAt)) {
    return undefined
  }
  return data as unknown as SheetClaimDocument
}

function oauthAttemptFromSnapshot(snapshot: FirestoreDocumentSnapshot): OAuthAttempt | undefined {
  const data = snapshot.data()
  if (!data || !isIdentifierValue(data.state) || !isString(data.codeVerifier)
    || (data.intent !== 'sign-in' && data.intent !== 'reauthorize') || !isTimestamp(data.expiresAt)
    || !(data.consumedAt === null || isTimestamp(data.consumedAt))) {
    return undefined
  }
  return data as unknown as OAuthAttempt
}

function sessionFromSnapshot(snapshot: FirestoreDocumentSnapshot): SessionDocument | undefined {
  const data = snapshot.data()
  if (!data || !isIdentifierValue(data.sessionId) || !isIdentifierValue(data.userId)
    || (data.kind !== 'journal' && data.kind !== 'provisioning')
    || !isTimestamp(data.expiresAt) || !isTimestamp(data.createdAt) || !isTimestamp(data.lastUsedAt)
    || !(data.revokedAt === null || isTimestamp(data.revokedAt))
    || !(data.provisioningAttemptId === null || isIdentifierValue(data.provisioningAttemptId))) {
    return undefined
  }
  if ((data.kind === 'journal' && data.provisioningAttemptId !== null)
    || (data.kind === 'provisioning' && data.provisioningAttemptId === null)) {
    return undefined
  }
  return data as unknown as SessionDocument
}

function provisioningAttemptFromSnapshot(
  snapshot: FirestoreDocumentSnapshot,
): ProvisioningAttemptDocument | undefined {
  const data = snapshot.data()
  const tempScopes = data?.tempScopes === undefined ? [] : data?.tempScopes
  if (!data || !isIdentifierValue(data.id) || !isIdentifierValue(data.userId)
    || (data.mode !== 'initial' && data.mode !== 'change')
    || !(data.originalConnectionVersion === null || isConnectionVersion(data.originalConnectionVersion))
    || !(data.tempEncryptedRefreshToken === null || isEncryptedToken(data.tempEncryptedRefreshToken))
    || !isScopes(tempScopes)
    || !(data.selectedSpreadsheetId === null || isIdentifierValue(data.selectedSpreadsheetId))
    || !(data.selectedSpreadsheetName === null || isString(data.selectedSpreadsheetName))
    || typeof data.createdByService !== 'boolean' || !isProvisioningPhase(data.status)
    || !isTimestamp(data.expiresAt) || !(data.errorCode === null || isString(data.errorCode))
    || !(data.errorMessage === null || isString(data.errorMessage))
    || !isTimestamp(data.createdAt) || !isTimestamp(data.updatedAt)) {
    return undefined
  }
  return {
    ...data,
    tempScopes: [...tempScopes],
  } as unknown as ProvisioningAttemptDocument
}

function selectionTokenFromSnapshot(snapshot: FirestoreDocumentSnapshot): SheetSelectionTokenDocument | undefined {
  const data = snapshot.data()
  if (!data || !isIdentifierValue(data.selectionCode) || !isIdentifierValue(data.provisioningAttemptId)
    || !isIdentifierValue(data.userId) || !isIdentifierValue(data.spreadsheetId)
    || !isString(data.spreadsheetName) || !isString(data.modifiedTime) || !isTimestamp(data.expiresAt)
    || !(data.consumedAt === null || isTimestamp(data.consumedAt))) {
    return undefined
  }
  return data as unknown as SheetSelectionTokenDocument
}

function leaseFromSnapshot(snapshot: FirestoreDocumentSnapshot): { leaseId: string; expiresAt: number } | undefined {
  const data = snapshot.data()
  if (!data || !isIdentifierValue(data.leaseId) || !isTimestamp(data.expiresAt)) return undefined
  return { leaseId: data.leaseId, expiresAt: data.expiresAt }
}

function provisioningUpdate(
  update: Partial<ProvisioningAttemptUpdate>,
): Partial<ProvisioningAttemptUpdate> {
  const result: Partial<ProvisioningAttemptUpdate> = {}
  if (update.status !== undefined && isProvisioningPhase(update.status)) result.status = update.status
  if (update.tempEncryptedRefreshToken !== undefined
    && (update.tempEncryptedRefreshToken === null || isEncryptedToken(update.tempEncryptedRefreshToken))) {
    result.tempEncryptedRefreshToken = update.tempEncryptedRefreshToken === null
      ? null
      : cloneEncryptedToken(update.tempEncryptedRefreshToken)
  }
  if (update.tempScopes !== undefined && isScopes(update.tempScopes)) {
    result.tempScopes = [...update.tempScopes]
  }
  if (update.selectedSpreadsheetId !== undefined
    && (update.selectedSpreadsheetId === null || isIdentifier(update.selectedSpreadsheetId))) {
    result.selectedSpreadsheetId = update.selectedSpreadsheetId
  }
  if (update.selectedSpreadsheetName !== undefined
    && (update.selectedSpreadsheetName === null || isString(update.selectedSpreadsheetName))) {
    result.selectedSpreadsheetName = update.selectedSpreadsheetName
  }
  if (update.createdByService !== undefined && typeof update.createdByService === 'boolean') {
    result.createdByService = update.createdByService
  }
  if (update.errorCode !== undefined && (update.errorCode === null || isString(update.errorCode))) {
    result.errorCode = update.errorCode
  }
  if (update.errorMessage !== undefined && (update.errorMessage === null || isString(update.errorMessage))) {
    result.errorMessage = update.errorMessage
  }
  return result
}

function applyProvisioningAttemptUpdate(
  current: ProvisioningAttemptDocument,
  update: Partial<ProvisioningAttemptUpdate>,
  now: number,
): ProvisioningAttemptDocument | undefined {
  const nextStatus = update.status ?? current.status
  if (!isAllowedProvisioningUpdateTransition(current.status, nextStatus)) return undefined

  const changesTarget = update.selectedSpreadsheetId !== undefined
    || update.selectedSpreadsheetName !== undefined
  if (changesTarget && !(
    (current.status === 'creating' && nextStatus === 'creating')
    || (current.status === 'verifying' && (nextStatus === 'verifying' || nextStatus === 'ready_to_confirm'))
  )) {
    return undefined
  }

  return {
    ...current,
    ...update,
    status: nextStatus,
    tempEncryptedRefreshToken: update.tempEncryptedRefreshToken === undefined
      ? current.tempEncryptedRefreshToken
      : update.tempEncryptedRefreshToken === null
        ? null
        : cloneEncryptedToken(update.tempEncryptedRefreshToken),
    tempScopes: update.tempScopes === undefined ? [...current.tempScopes] : [...update.tempScopes],
    createdByService: current.createdByService || update.createdByService === true,
    updatedAt: now,
  }
}

function provisioningAttemptWrite(
  updated: ProvisioningAttemptDocument,
  update: Partial<ProvisioningAttemptUpdate>,
  now: number,
): FirestoreData {
  const result: FirestoreData = { updatedAt: now }
  if (update.status !== undefined) result.status = updated.status
  if (update.tempEncryptedRefreshToken !== undefined) {
    result.tempEncryptedRefreshToken = updated.tempEncryptedRefreshToken
  }
  if (update.tempScopes !== undefined) result.tempScopes = [...updated.tempScopes]
  if (update.selectedSpreadsheetId !== undefined) result.selectedSpreadsheetId = updated.selectedSpreadsheetId
  if (update.selectedSpreadsheetName !== undefined) result.selectedSpreadsheetName = updated.selectedSpreadsheetName
  if (update.createdByService !== undefined) result.createdByService = updated.createdByService
  if (update.errorCode !== undefined) result.errorCode = updated.errorCode
  if (update.errorMessage !== undefined) result.errorMessage = updated.errorMessage
  return result
}

function isAllowedProvisioningUpdateTransition(
  from: ProvisioningPhase,
  to: ProvisioningPhase,
): boolean {
  if (from === 'completed' || from === 'failed') return false
  if (to === 'completed') return false
  if (from === 'initial_choice') return to === 'initial_choice' || to === 'candidate_selection' || to === 'failed'
  if (from === 'candidate_selection') return to === 'candidate_selection' || to === 'failed'
  if (from === 'creating') return to === 'creating' || to === 'ready_to_confirm' || to === 'failed'
  if (from === 'verifying') {
    return to === 'verifying' || to === 'candidate_selection' || to === 'ready_to_confirm' || to === 'failed'
  }
  return to === 'ready_to_confirm' || to === 'failed'
}

function isClaimableProvisioningPhase(value: ProvisioningPhase): value is 'initial_choice' | 'candidate_selection' {
  return value === 'initial_choice' || value === 'candidate_selection'
}

function isClaimedProvisioningPhase(value: ProvisioningPhase): value is 'creating' | 'verifying' {
  return value === 'creating' || value === 'verifying'
}

function isCredentialPersistencePhase(
  value: ProvisioningPhase,
): value is Exclude<ProvisioningPhase, 'completed' | 'failed'> {
  return value === 'initial_choice' || value === 'candidate_selection' || isClaimedProvisioningPhase(value)
    || value === 'ready_to_confirm'
}

function isCompletionProvisioningPhase(
  value: ProvisioningPhase,
): value is CompleteProvisioningAttemptInput['expectedStatus'] {
  return value === 'creating' || value === 'verifying' || value === 'ready_to_confirm'
}

function isNonFinalProvisioningPhase(
  value: ProvisioningPhase,
): value is Exclude<ProvisioningPhase, 'completed' | 'failed'> {
  return value !== 'completed' && value !== 'failed'
}

function isProvisioningPhase(value: unknown): value is ProvisioningPhase {
  return value === 'initial_choice' || value === 'candidate_selection' || value === 'creating'
    || value === 'verifying' || value === 'ready_to_confirm' || value === 'completed' || value === 'failed'
}

function isConnectionStatus(value: unknown): value is ConnectionStatus {
  return value === 'active' || value === 'archived' || value === 'needs_reconnect'
}

function isRecord(value: unknown): value is FirestoreData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScopes(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function isIdentifierValue(value: unknown): value is string {
  return isString(value) && isIdentifier(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
