import { describe, expect, test, vi } from 'vitest'
import type {
  FirestoreAdapter,
  FirestoreCollectionReference,
  FirestoreData,
  FirestoreDocumentReference,
  FirestoreDocumentSnapshot,
  FirestoreQuery,
  FirestoreQueryDocumentSnapshot,
  FirestoreQuerySnapshot,
  FirestoreTransaction,
  FirestoreWhereOperator,
  FirestoreWriteBatch,
} from './connection-store.js'
import { PROVISIONING_COOKIE_NAME } from './cookies.js'
import { GoogleConnectionError } from './google-drive.js'
import {
  ExpiredDataCleanupService,
  FirestoreExpiredDataCleanup,
  FirestoreLegacyMigrationStore,
  LegacyMigrationClaimConflictError,
  runLegacyMigration,
  type LegacyMigrationContext,
  type LegacySheetClaimInput,
} from './legacy-migration.js'
import type { ServerConfig } from './server-config.js'
import { SessionStore } from './session-store.js'
import type { EncryptedToken } from './token-crypto.js'
import { JournalError } from '../../shared/journal/errors.js'
import { createSessionHandler } from '../session.js'

const now = 1_000_000
const encryptedToken: EncryptedToken = { ciphertext: 'sealed-token', keyVersion: 'v1' }
const config: ServerConfig = {
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  appOrigin: 'https://journal.example',
  sessionEncryptionKey: Buffer.alloc(32, 1),
  tokenEncryptionKey: Buffer.alloc(32, 2),
  tokenEncryptionKeyVersion: 'v1',
  firestoreProjectId: 'journal-project',
  firestoreCredentials: { clientEmail: 'service@example.com', privateKey: 'private-key' },
  legacyMigrationSecret: 'm'.repeat(32),
  cronSecret: 'c'.repeat(32),
}
const migrationInput = {
  googleSub: 'google-sub-1',
  sheetUrl: 'https://docs.google.com/spreadsheets/d/legacy-sheet-1/edit#gid=0',
}

describe('過期內部資料清理', () => {
  test('只刪除到期的 OAuth、設定流程與選擇代碼，並移除到期 attempt 的暫存加密 token', async () => {
    const firestore = new CleanupFirestore()
    firestore.set('oauth_attempts', 'expired-oauth', { expiresAt: now, state: 'expired-oauth' })
    firestore.set('oauth_attempts', 'active-oauth', { expiresAt: now + 1, state: 'active-oauth' })
    firestore.set('provisioning_attempts', 'expired-attempt', {
      expiresAt: now,
      tempEncryptedRefreshToken: encryptedToken,
    })
    firestore.set('provisioning_attempts', 'active-attempt', {
      expiresAt: now + 1,
      tempEncryptedRefreshToken: encryptedToken,
    })
    firestore.set('sheet_selection_tokens', 'expired-code', { expiresAt: now })
    firestore.set('sheet_selection_tokens', 'active-code', { expiresAt: now + 1 })

    const shortLived = new FirestoreExpiredDataCleanup(firestore)
    const rateLimits = vi.fn(async () => 4)
    const sessions = vi.fn(async () => 5)
    const service = new ExpiredDataCleanupService({
      cleanupOAuthAttempts: (time) => shortLived.cleanupOAuthAttempts(time),
      cleanupProvisioningAttempts: (time) => shortLived.cleanupProvisioningAttempts(time),
      cleanupSelectionCodes: (time) => shortLived.cleanupSelectionCodes(time),
      cleanupRateLimits: rateLimits,
      cleanupSessions: sessions,
    }, () => now)

    await expect(service.cleanup()).resolves.toEqual({
      oauthAttempts: 1,
      provisioningAttempts: 1,
      selectionCodes: 1,
      rateLimits: 4,
      sessions: 5,
    })
    expect(firestore.document('oauth_attempts', 'expired-oauth')).toBeUndefined()
    expect(firestore.document('provisioning_attempts', 'expired-attempt')).toBeUndefined()
    expect(firestore.document('sheet_selection_tokens', 'expired-code')).toBeUndefined()
    expect(firestore.document('provisioning_attempts', 'active-attempt')).toMatchObject({
      tempEncryptedRefreshToken: encryptedToken,
    })
    expect(rateLimits).toHaveBeenCalledWith(now)
    expect(sessions).toHaveBeenCalledWith(now)
  })

  test('每輪最多清理 450 筆短效文件，剩餘文件交由下一輪處理', async () => {
    const firestore = new CleanupFirestore()
    const shortLived = new FirestoreExpiredDataCleanup(firestore)

    for (let index = 0; index < 451; index += 1) {
      firestore.set('oauth_attempts', `expired-oauth-${index}`, { expiresAt: now })
    }

    await expect(shortLived.cleanupOAuthAttempts(now)).resolves.toBe(450)
    expect(firestore.documents('oauth_attempts')).toHaveLength(1)
    await expect(shortLived.cleanupOAuthAttempts(now)).resolves.toBe(1)
  })

  test('短效文件在 cleanup 查詢後被重設時，交易會保留文件並回傳實際刪除數', async () => {
    const firestore = new CleanupFirestore()
    const shortLived = new FirestoreExpiredDataCleanup(firestore)
    const collections = [
      ['oauth_attempts', 'renewed-oauth'],
      ['provisioning_attempts', 'renewed-attempt'],
      ['sheet_selection_tokens', 'renewed-code'],
    ] as const

    for (const [collection, id] of collections) {
      firestore.set(collection, id, { expiresAt: now })
      firestore.resetExpiresAtAfterNextQuery(collection, id, now + 1)
    }

    await expect(Promise.all([
      shortLived.cleanupOAuthAttempts(now),
      shortLived.cleanupProvisioningAttempts(now),
      shortLived.cleanupSelectionCodes(now),
    ])).resolves.toEqual([0, 0, 0])

    for (const [collection, id] of collections) {
      expect(firestore.document(collection, id)).toMatchObject({ expiresAt: now + 1 })
    }
  })
})

describe('runLegacyMigration', () => {
  test('重新驗證擁有權與 schema／資料列後，以 createdByService false claim 既有 Sheet', async () => {
    const system = createMigrationSystem()

    await expect(run(system)).resolves.toBeUndefined()

    expect(system.decryptToken).toHaveBeenCalledWith(encryptedToken, expect.any(Map))
    expect(system.refreshCredentials).toHaveBeenCalledWith('refresh-token', config)
    expect(system.drive.getOwnedSpreadsheet).toHaveBeenCalledWith('access-token', 'legacy-sheet-1')
    expect(system.sheets.validateExisting).toHaveBeenCalledWith('access-token', 'legacy-sheet-1')
    expect(system.store.claimLegacySheet).toHaveBeenCalledWith(expect.objectContaining({
      spreadsheetId: 'legacy-sheet-1',
      spreadsheetName: '既有日記',
      encryptedRefreshToken: { ciphertext: 'rotated-token', keyVersion: 'v1' },
      scopes: ['openid', 'https://www.googleapis.com/auth/spreadsheets'],
      createdByService: false,
      now,
    }))
  })

  test('重複遷移在第一次完成後安全拒絕，不會再次讀取或寫入 Google Sheet', async () => {
    const system = createMigrationSystem()
    let context: LegacyMigrationContext | undefined = system.context
    system.store.findMigratableContext.mockImplementation(async () => context)
    system.store.claimLegacySheet.mockImplementation(async () => {
      context = undefined
    })

    await expect(run(system)).resolves.toBeUndefined()
    await expect(run(system)).rejects.toMatchObject({ code: 'migration_rejected' })

    expect(system.drive.getOwnedSpreadsheet).toHaveBeenCalledTimes(1)
    expect(system.sheets.validateExisting).toHaveBeenCalledTimes(1)
    expect(system.store.claimLegacySheet).toHaveBeenCalledTimes(1)
  })

  test('transaction claim 的重複或競態拒絕不會暴露底層資料', async () => {
    const system = createMigrationSystem()
    system.store.claimLegacySheet.mockRejectedValueOnce(new LegacyMigrationClaimConflictError())

    await expect(run(system)).rejects.toMatchObject({
      code: 'migration_conflict',
      status: 409,
    })
  })

  test('非擁有者的 Sheet 在 Drive 驗證失敗後不會執行 schema 驗證或 claim', async () => {
    const system = createMigrationSystem()
    system.drive.getOwnedSpreadsheet.mockRejectedValueOnce(new GoogleConnectionError())

    await expect(run(system)).rejects.toMatchObject({ code: 'migration_rejected' })

    expect(system.sheets.validateExisting).not.toHaveBeenCalled()
    expect(system.store.claimLegacySheet).not.toHaveBeenCalled()
  })

  test('schema 或資料列不相容時安全拒絕，絕不建立連線或寫入資料列', async () => {
    const system = createMigrationSystem()
    system.sheets.validateExisting.mockRejectedValueOnce(new JournalError('DATA_ERROR', '資料列不相容'))

    await expect(run(system)).rejects.toMatchObject({ code: 'migration_rejected' })

    expect(system.store.claimLegacySheet).not.toHaveBeenCalled()
  })

  test('尚未登入而不存在 user 或未過期 provisioning attempt 時拒絕，不呼叫 Google', async () => {
    const system = createMigrationSystem()
    system.store.findMigratableContext.mockResolvedValueOnce(undefined)

    await expect(run(system)).rejects.toMatchObject({ code: 'migration_rejected' })

    expect(system.decryptToken).not.toHaveBeenCalled()
    expect(system.refreshCredentials).not.toHaveBeenCalled()
    expect(system.drive.getOwnedSpreadsheet).not.toHaveBeenCalled()
    expect(system.store.claimLegacySheet).not.toHaveBeenCalled()
  })

  test('未知 token 金鑰版本保留原 provisioning attempt，不解密、不清除也不 claim', async () => {
    const unknownToken: EncryptedToken = { ciphertext: 'sealed-old-token', keyVersion: 'retired-v0' }
    const system = createMigrationSystem({
      attempt: { ...migrationContext().attempt, tempEncryptedRefreshToken: unknownToken },
    })

    await expect(run(system)).rejects.toMatchObject({ code: 'migration_unavailable' })

    expect(system.decryptToken).not.toHaveBeenCalled()
    expect(system.store.claimLegacySheet).not.toHaveBeenCalled()
    expect(system.context.attempt.tempEncryptedRefreshToken).toEqual(unknownToken)
  })

  test('Firestore claim 在同一交易建立 active connection、清除暫存 token 並拒絕重複 claim', async () => {
    const firestore = new CleanupFirestore()
    const context = migrationContext()
    firestore.set('users', context.user.id, context.user)
    firestore.set('provisioning_attempts', context.attempt.id, context.attempt)
    const store = new FirestoreLegacyMigrationStore(firestore, () => now)
    const input = legacyClaimInput(context)

    await expect(store.claimLegacySheet(input)).resolves.toBeUndefined()

    expect(firestore.documents('sheet_claims')).toHaveLength(1)
    expect(firestore.documents('sheet_connections')).toContainEqual(expect.objectContaining({
      userId: context.user.id,
      spreadsheetId: 'legacy-sheet-1',
      status: 'active',
      createdByService: false,
      encryptedRefreshToken: encryptedToken,
    }))
    expect(firestore.document('provisioning_attempts', context.attempt.id)).toMatchObject({
      status: 'completed',
      tempEncryptedRefreshToken: null,
      tempScopes: [],
    })

    await expect(store.claimLegacySheet(input)).rejects.toBeInstanceOf(LegacyMigrationClaimConflictError)
    expect(firestore.documents('sheet_connections')).toHaveLength(1)
  })

  test('成功遷移會原子撤銷使用者所有 provisioning session，不建立 journal session，後續 probe 為 signed-out', async () => {
    const firestore = new CleanupFirestore()
    const context = migrationContext()
    firestore.set('users', context.user.id, context.user)
    firestore.set('provisioning_attempts', context.attempt.id, context.attempt)
    firestore.set('sessions', 'provisioning-one', provisioningSessionDocument(
      context.user.id,
      'provisioning-one',
      context.attempt.id,
    ))
    firestore.set('sessions', 'provisioning-two', provisioningSessionDocument(
      context.user.id,
      'provisioning-two',
      'another-attempt',
    ))
    firestore.set('sessions', 'other-user-provisioning', provisioningSessionDocument(
      'user-2',
      'other-user-provisioning',
      'another-attempt',
    ))
    const store = new FirestoreLegacyMigrationStore(firestore, () => now)

    await runLegacyMigration(migrationInput, {
      config,
      store,
      drive: {
        getOwnedSpreadsheet: async () => ({
          id: 'legacy-sheet-1',
          name: '既有日記',
          modifiedTime: '2026-08-20T00:00:00.000Z',
        }),
      },
      sheets: { validateExisting: async () => undefined },
      decryptRefreshToken: () => 'refresh-token',
      encryptRefreshToken: () => encryptedToken,
      refreshGoogleCredentials: async () => ({ accessToken: 'access-token' }),
      clock: () => now,
    })

    expect(firestore.document('sessions', 'provisioning-one')).toMatchObject({ revokedAt: now })
    expect(firestore.document('sessions', 'provisioning-two')).toMatchObject({ revokedAt: now })
    expect(firestore.document('sessions', 'other-user-provisioning')).toMatchObject({ revokedAt: null })
    expect(firestore.documents('sessions').some((session) => session.kind === 'journal')).toBe(false)

    const sessionHandler = createSessionHandler({
      config,
      sessionStore: new SessionStore(firestore, () => now),
      decryptSession: () => ({ sessionId: 'provisioning-one', expiresAt: now + 60_000 }),
    })
    const response = await sessionHandler(new Request('https://journal.example/api/session', {
      headers: { Cookie: `${PROVISIONING_COOKIE_NAME}=opaque-provisioning-session` },
    }))

    await expect(response.json()).resolves.toEqual({ state: 'signed-out' })
    expect(response.headers.get('Set-Cookie')).toContain(`${PROVISIONING_COOKIE_NAME}=;`)
  })

  test('Drive 與 Sheets 驗證期間跨過 attempt 效期時，最終 claim transaction 會拒絕寫入', async () => {
    const firestore = new CleanupFirestore()
    const context = migrationContext()
    context.attempt.expiresAt = now + 1
    firestore.set('users', context.user.id, context.user)
    firestore.set('provisioning_attempts', context.attempt.id, context.attempt)
    let transactionNow = now
    const store = new FirestoreLegacyMigrationStore(firestore, () => transactionNow)
    const sheets = {
      validateExisting: vi.fn(async () => {
        transactionNow = context.attempt.expiresAt
      }),
    }

    await expect(runLegacyMigration(migrationInput, {
      config,
      store,
      drive: {
        getOwnedSpreadsheet: async () => ({
          id: 'legacy-sheet-1',
          name: '既有日記',
          modifiedTime: '2026-08-20T00:00:00.000Z',
        }),
      },
      sheets,
      decryptRefreshToken: () => 'refresh-token',
      encryptRefreshToken: () => encryptedToken,
      refreshGoogleCredentials: async () => ({ accessToken: 'access-token' }),
      clock: () => now,
    })).rejects.toMatchObject({ code: 'migration_conflict' })

    expect(sheets.validateExisting).toHaveBeenCalledOnce()
    expect(firestore.documents('sheet_claims')).toHaveLength(0)
    expect(firestore.documents('sheet_connections')).toHaveLength(0)
    expect(firestore.document('provisioning_attempts', context.attempt.id)).toMatchObject({
      status: 'initial_choice',
      tempEncryptedRefreshToken: encryptedToken,
    })
  })
})

function run(system: ReturnType<typeof createMigrationSystem>): Promise<void> {
  return runLegacyMigration(migrationInput, {
    config,
    store: system.store,
    drive: system.drive,
    sheets: system.sheets,
    decryptRefreshToken: system.decryptToken,
    encryptRefreshToken: system.encryptToken,
    refreshGoogleCredentials: system.refreshCredentials,
    clock: () => now,
  })
}

function createMigrationSystem(overrides: Partial<LegacyMigrationContext> = {}) {
  const context: LegacyMigrationContext = {
    ...migrationContext(),
    ...overrides,
  }
  const store = {
    findMigratableContext: vi.fn(async () => context),
    claimLegacySheet: vi.fn(async () => undefined),
  }
  const drive = {
    getOwnedSpreadsheet: vi.fn(async () => ({
      id: 'legacy-sheet-1',
      name: '既有日記',
      modifiedTime: '2026-08-20T00:00:00.000Z',
    })),
  }
  const sheets = { validateExisting: vi.fn(async () => undefined) }
  const decryptToken = vi.fn(() => 'refresh-token')
  const encryptToken = vi.fn((): EncryptedToken => ({ ciphertext: 'rotated-token', keyVersion: 'v1' }))
  const refreshCredentials = vi.fn(async () => ({
    accessToken: 'access-token',
    refreshToken: 'rotated-refresh-token',
    scopes: ['openid', 'https://www.googleapis.com/auth/spreadsheets'],
  }))
  return { context, store, drive, sheets, decryptToken, encryptToken, refreshCredentials }
}

function migrationContext(): LegacyMigrationContext {
  return {
    user: { id: 'user-1', googleSub: 'google-sub-1' },
    attempt: {
      id: 'attempt-1',
      userId: 'user-1',
      tempEncryptedRefreshToken: encryptedToken,
      tempScopes: ['openid'],
      mode: 'initial',
      status: 'initial_choice',
      expiresAt: now + 60_000,
    },
  }
}

function legacyClaimInput(context: LegacyMigrationContext): LegacySheetClaimInput {
  return {
    user: context.user,
    attempt: context.attempt,
    spreadsheetId: 'legacy-sheet-1',
    spreadsheetName: '既有日記',
    encryptedRefreshToken: encryptedToken,
    scopes: ['openid'],
    createdByService: false,
    now,
  }
}

function provisioningSessionDocument(userId: string, sessionId: string, attemptId: string): FirestoreData {
  return {
    sessionId,
    userId,
    kind: 'provisioning',
    expiresAt: now + 60_000,
    createdAt: now,
    lastUsedAt: now,
    revokedAt: null,
    provisioningAttemptId: attemptId,
  }
}

class CleanupFirestore implements FirestoreAdapter {
  private readonly records = new Map<string, Map<string, FirestoreData>>()
  private readonly afterNextQuery = new Map<string, () => void>()

  collection(name: string): FirestoreCollectionReference {
    return new CleanupCollectionReference(this, name, [])
  }

  batch(): FirestoreWriteBatch {
    return new CleanupWriteBatch(this)
  }

  async runTransaction<T>(callback: (transaction: FirestoreTransaction) => Promise<T>): Promise<T> {
    const transaction = new CleanupTransaction(this)
    const result = await callback(transaction)
    transaction.commit()
    return result
  }

  set(collection: string, id: string, data: FirestoreData): void {
    const records = this.records.get(collection) ?? new Map<string, FirestoreData>()
    records.set(id, structuredClone(data))
    this.records.set(collection, records)
  }

  update(collection: string, id: string, data: FirestoreData): void {
    const current = this.records.get(collection)?.get(id)
    if (!current) throw new Error(`找不到文件：${collection}/${id}`)
    Object.assign(current, structuredClone(data))
  }

  delete(collection: string, id: string): void {
    this.records.get(collection)?.delete(id)
  }

  resetExpiresAtAfterNextQuery(collection: string, id: string, expiresAt: number): void {
    this.afterNextQuery.set(collection, () => this.update(collection, id, { expiresAt }))
  }

  document(collection: string, id: string): FirestoreData | undefined {
    const data = this.records.get(collection)?.get(id)
    return data === undefined ? undefined : structuredClone(data)
  }

  documents(collection: string): FirestoreData[] {
    return [...(this.records.get(collection)?.values() ?? [])].map((data) => structuredClone(data))
  }

  snapshot(collection: string, id: string, reference: FirestoreDocumentReference): FirestoreDocumentSnapshot {
    return new CleanupDocumentSnapshot(this.document(collection, id), reference)
  }

  query(
    collection: string,
    filters: ReadonlyArray<{ field: string; op: FirestoreWhereOperator; value: unknown }>,
  ): FirestoreQuerySnapshot {
    const documents = [...(this.records.get(collection)?.entries() ?? [])]
      .filter(([, data]) => filters.every((filter) => matches(data[filter.field], filter)))
      .map(([id, data]) => new CleanupQueryDocumentSnapshot(
        structuredClone(data),
        new CleanupDocumentReference(this, collection, id),
      ))
    const afterQuery = this.afterNextQuery.get(collection)
    this.afterNextQuery.delete(collection)
    afterQuery?.()
    return new CleanupQuerySnapshot(documents)
  }
}

class CleanupDocumentReference implements FirestoreDocumentReference {
  constructor(
    private readonly firestore: CleanupFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  get(): Promise<FirestoreDocumentSnapshot> {
    return Promise.resolve(this.firestore.snapshot(this.collectionName, this.id, this))
  }

  async set(data: FirestoreData): Promise<void> {
    this.firestore.set(this.collectionName, this.id, data)
  }

  async update(data: FirestoreData): Promise<void> {
    this.firestore.update(this.collectionName, this.id, data)
  }

  async delete(): Promise<void> {
    this.firestore.delete(this.collectionName, this.id)
  }
}

class CleanupDocumentSnapshot implements FirestoreDocumentSnapshot {
  constructor(
    private readonly value: FirestoreData | undefined,
    readonly reference: FirestoreDocumentReference,
  ) {}

  get exists(): boolean {
    return this.value !== undefined
  }

  data(): FirestoreData | undefined {
    return this.value === undefined ? undefined : structuredClone(this.value)
  }
}

class CleanupQueryDocumentSnapshot extends CleanupDocumentSnapshot implements FirestoreQueryDocumentSnapshot {
  get ref(): FirestoreDocumentReference {
    return this.reference
  }
}

class CleanupQuerySnapshot implements FirestoreQuerySnapshot {
  constructor(readonly docs: readonly FirestoreQueryDocumentSnapshot[]) {}

  get empty(): boolean {
    return this.docs.length === 0
  }

  get size(): number {
    return this.docs.length
  }
}

class CleanupCollectionReference implements FirestoreCollectionReference {
  constructor(
    private readonly firestore: CleanupFirestore,
    readonly collectionName: string,
    readonly filters: ReadonlyArray<{ field: string; op: FirestoreWhereOperator; value: unknown }>,
  ) {}

  doc(id: string): FirestoreDocumentReference {
    return new CleanupDocumentReference(this.firestore, this.collectionName, id)
  }

  where(field: string, op: FirestoreWhereOperator, value: unknown): FirestoreQuery {
    return new CleanupCollectionReference(this.firestore, this.collectionName, [...this.filters, { field, op, value }])
  }

  get(): Promise<FirestoreQuerySnapshot> {
    return Promise.resolve(this.firestore.query(this.collectionName, this.filters))
  }
}

class CleanupWriteBatch implements FirestoreWriteBatch {
  private readonly operations: Array<() => void> = []

  constructor(private readonly firestore: CleanupFirestore) {}

  update(reference: FirestoreDocumentReference, data: FirestoreData): this {
    const document = reference as CleanupDocumentReference
    this.operations.push(() => this.firestore.update(document.collectionName, document.id, data))
    return this
  }

  delete(reference: FirestoreDocumentReference): this {
    const document = reference as CleanupDocumentReference
    this.operations.push(() => this.firestore.delete(document.collectionName, document.id))
    return this
  }

  async commit(): Promise<void> {
    for (const operation of this.operations) operation()
  }
}

class CleanupTransaction implements FirestoreTransaction {
  private readonly operations: Array<() => void> = []

  constructor(private readonly firestore: CleanupFirestore) {}

  get(reference: FirestoreDocumentReference): Promise<FirestoreDocumentSnapshot>
  get(query: FirestoreQuery): Promise<FirestoreQuerySnapshot>
  get(target: FirestoreDocumentReference | FirestoreQuery): Promise<FirestoreDocumentSnapshot | FirestoreQuerySnapshot> {
    if (target instanceof CleanupDocumentReference) {
      return Promise.resolve(this.firestore.snapshot(target.collectionName, target.id, target))
    }
    if (target instanceof CleanupCollectionReference) {
      return Promise.resolve(this.firestore.query(target.collectionName, target.filters))
    }
    throw new Error('不支援的 transaction 讀取目標。')
  }

  set(reference: FirestoreDocumentReference, data: FirestoreData): this {
    const document = reference as CleanupDocumentReference
    this.operations.push(() => this.firestore.set(document.collectionName, document.id, data))
    return this
  }

  update(reference: FirestoreDocumentReference, data: FirestoreData): this {
    const document = reference as CleanupDocumentReference
    this.operations.push(() => this.firestore.update(document.collectionName, document.id, data))
    return this
  }

  delete(reference: FirestoreDocumentReference): this {
    const document = reference as CleanupDocumentReference
    this.operations.push(() => this.firestore.delete(document.collectionName, document.id))
    return this
  }

  commit(): void {
    for (const operation of this.operations) operation()
  }
}

function matches(value: unknown, filter: { op: FirestoreWhereOperator; value: unknown }): boolean {
  if (filter.op === '==') return value === filter.value
  return typeof value === 'number' && typeof filter.value === 'number' && value <= filter.value
}
