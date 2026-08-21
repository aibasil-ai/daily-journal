import { describe, expect, test } from 'vitest'
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
import { SessionStore } from './session-store.js'

const MAX_TEST_BATCH_WRITES = 450

describe('SessionStore', () => {
  test('建立 journal session 時只儲存伺服器端 session 資料', async () => {
    let now = 1_000_000
    const firestore = new FakeFirestore()
    const store = new SessionStore(firestore, () => now)

    const created = await store.create({
      userId: 'user-1',
      kind: 'journal',
      ttlMs: 60_000,
    })

    expect(created.session).toStrictEqual({
      sessionId: created.sessionId,
      userId: 'user-1',
      kind: 'journal',
      expiresAt: 1_060_000,
      createdAt: 1_000_000,
      lastUsedAt: 1_000_000,
      revokedAt: null,
      provisioningAttemptId: null,
    })
    expect(JSON.stringify(created.session)).not.toContain('refresh-token')

    now += 1
    expect(await store.resolveJournalSession(created.sessionId)).toMatchObject({
      sessionId: created.sessionId,
      userId: 'user-1',
      kind: 'journal',
      lastUsedAt: now,
    })
  })

  test('journal 與 provisioning guard 嚴格分流', async () => {
    const firestore = new FakeFirestore()
    const store = new SessionStore(firestore, () => 1_000_000)
    const journal = await store.create({ userId: 'user-1', kind: 'journal', ttlMs: 60_000 })
    const provisioning = await store.create({
      userId: 'user-1',
      kind: 'provisioning',
      provisioningAttemptId: 'attempt-1',
      ttlMs: 60_000,
    })

    expect(await store.resolveProvisioningSession(journal.sessionId)).toBeUndefined()
    expect(await store.resolveJournalSession(provisioning.sessionId)).toBeUndefined()
    expect(await store.resolveProvisioningSession(provisioning.sessionId)).toMatchObject({
      provisioningAttemptId: 'attempt-1',
    })

    await firestore.collection('sessions').doc('malformed-journal').set({
      sessionId: 'malformed-journal',
      userId: 'user-1',
      kind: 'journal',
      expiresAt: 1_060_000,
      createdAt: 1_000_000,
      lastUsedAt: 1_000_000,
      revokedAt: null,
      provisioningAttemptId: 'attempt-1',
    })
    await firestore.collection('sessions').doc('malformed-provisioning').set({
      sessionId: 'malformed-provisioning',
      userId: 'user-1',
      kind: 'provisioning',
      expiresAt: 1_060_000,
      createdAt: 1_000_000,
      lastUsedAt: 1_000_000,
      revokedAt: null,
      provisioningAttemptId: null,
    })

    expect(await store.resolveJournalSession('malformed-journal')).toBeUndefined()
    expect(await store.resolveProvisioningSession('malformed-provisioning')).toBeUndefined()
  })

  test('已撤銷、過期或格式錯誤的 session 無法解析', async () => {
    let now = 1_000_000
    const firestore = new FakeFirestore()
    const store = new SessionStore(firestore, () => now)
    const created = await store.create({ userId: 'user-1', kind: 'journal', ttlMs: 1_000 })

    now = created.expiresAt
    expect(await store.resolveJournalSession(created.sessionId)).toBeUndefined()

    now = 1_000_001
    await store.revokeSession(created.sessionId)
    expect(await store.resolveJournalSession(created.sessionId)).toBeUndefined()
    expect(await store.resolveJournalSession('')).toBeUndefined()
  })

  test('解析時拒絕文件 ID 與文件內 sessionId 不一致的損毀資料', async () => {
    const firestore = new FakeFirestore()
    const store = new SessionStore(firestore, () => 1_000_001)
    await firestore.collection('sessions').doc('journal-document-id').set({
      ...testSession('user-1', 1_060_000),
      sessionId: 'different-journal-session-id',
    })
    await firestore.collection('sessions').doc('provisioning-document-id').set({
      ...testSession('user-1', 1_060_000),
      sessionId: 'different-provisioning-session-id',
      kind: 'provisioning',
      provisioningAttemptId: 'attempt-1',
    })

    expect(await store.resolveJournalSession('journal-document-id')).toBeUndefined()
    expect(await store.resolveProvisioningSession('provisioning-document-id')).toBeUndefined()
    expect(firestore.documentsIn('sessions')).toContainEqual(expect.objectContaining({
      sessionId: 'different-journal-session-id',
      lastUsedAt: 1_000_000,
    }))
  })

  test('revokeUserSessions 只撤銷指定使用者的所有 session', async () => {
    const firestore = new FakeFirestore()
    const store = new SessionStore(firestore, () => 1_000_000)
    const userOneJournal = await store.create({ userId: 'user-1', kind: 'journal', ttlMs: 60_000 })
    const userOneProvisioning = await store.create({
      userId: 'user-1',
      kind: 'provisioning',
      provisioningAttemptId: 'attempt-1',
      ttlMs: 60_000,
    })
    const userTwoJournal = await store.create({ userId: 'user-2', kind: 'journal', ttlMs: 60_000 })

    await store.revokeUserSessions('user-1')

    expect(await store.resolveJournalSession(userOneJournal.sessionId)).toBeUndefined()
    expect(await store.resolveProvisioningSession(userOneProvisioning.sessionId)).toBeUndefined()
    expect(await store.resolveJournalSession(userTwoJournal.sessionId)).toBeDefined()
  })

  test('revokeUserSessions 以安全批次撤銷超過 500 筆 session', async () => {
    const firestore = new FakeFirestore()
    const store = new SessionStore(firestore, () => 1_000_000)

    for (let index = 0; index < 901; index += 1) {
      firestore.setDocument('sessions', `bulk-revoke-${index}`, testSession('bulk-user', 1_060_000))
    }

    await store.revokeUserSessions('bulk-user')

    const sessions = firestore.documentsForUser('sessions', 'bulk-user')
    expect(sessions).toHaveLength(901)
    expect(sessions.every((session) => session.revokedAt === 1_000_000)).toBe(true)
    expect(firestore.batchWriteCounts()).toEqual([450, 450, 1])
  })

  test('cleanupExpired 每輪最多刪除 450 筆 session，剩餘文件交由下一輪處理', async () => {
    const firestore = new FakeFirestore()
    const store = new SessionStore(firestore, () => 1_000_000)

    for (let index = 0; index < 901; index += 1) {
      firestore.setDocument('sessions', `bulk-expired-${index}`, testSession('bulk-user', 1_000_000))
    }

    await expect(store.cleanupExpired(1_000_000)).resolves.toBe(450)
    expect(firestore.documentsIn('sessions')).toHaveLength(451)
    await expect(store.cleanupExpired(1_000_000)).resolves.toBe(450)
    expect(firestore.documentsIn('sessions')).toHaveLength(1)
  })

  test('cleanupExpired 在查詢後重新讀取 session，保留已重設文件並回傳實際刪除數', async () => {
    const firestore = new FakeFirestore()
    const store = new SessionStore(firestore, () => 1_000_000)
    firestore.setDocument('sessions', 'renewed-session', testSession('user-1', 1_000_000))
    firestore.resetExpiresAtAfterNextQuery('sessions', 'renewed-session', 1_060_000)

    await expect(store.cleanupExpired(1_000_000)).resolves.toBe(0)
    expect(firestore.documentsIn('sessions')).toContainEqual(expect.objectContaining({
      expiresAt: 1_060_000,
    }))
  })

  test('revokeUserSessions 的後續批次失敗時會傳遞錯誤，而非回報完成', async () => {
    const firestore = new FakeFirestore()
    const store = new SessionStore(firestore, () => 1_000_000)

    for (let index = 0; index < 451; index += 1) {
      firestore.setDocument('sessions', `failing-revoke-${index}`, testSession('failing-user', 1_060_000))
    }
    firestore.failBatchCommit(2)

    await expect(store.revokeUserSessions('failing-user')).rejects.toThrow('模擬批次提交失敗。')
    expect(firestore.documentsForUser('sessions', 'failing-user')
      .filter((session) => session.revokedAt === null)).toHaveLength(1)
  })
})

function testSession(userId: string, expiresAt: number): FirestoreData {
  return {
    sessionId: 'test-session',
    userId,
    kind: 'journal',
    expiresAt,
    createdAt: 1_000_000,
    lastUsedAt: 1_000_000,
    revokedAt: null,
    provisioningAttemptId: null,
  }
}

class FakeFirestore implements FirestoreAdapter {
  private readonly documents = new Map<string, Map<string, FirestoreData>>()
  private readonly committedBatchWriteCounts: number[] = []
  private readonly afterNextQuery = new Map<string, () => void>()
  private failBatchCommitNumber: number | undefined

  collection(name: string): FirestoreCollectionReference {
    return new FakeCollectionReference(this, name, [])
  }

  batch(): FirestoreWriteBatch {
    return new FakeWriteBatch(this)
  }

  async runTransaction<T>(callback: (transaction: FirestoreTransaction) => Promise<T>): Promise<T> {
    const transaction = new FakeTransaction(this)
    const result = await callback(transaction)
    transaction.commit()
    return result
  }

  getDocument(collection: string, id: string, ref: FirestoreDocumentReference): FirestoreDocumentSnapshot {
    return new FakeDocumentSnapshot(this.documents.get(collection)?.get(id), ref)
  }

  setDocument(collection: string, id: string, data: FirestoreData): void {
    const documents = this.documents.get(collection) ?? new Map<string, FirestoreData>()
    documents.set(id, clone(data))
    this.documents.set(collection, documents)
  }

  updateDocument(collection: string, id: string, data: FirestoreData): void {
    const current = this.documents.get(collection)?.get(id)
    if (!current) throw new Error(`找不到文件：${collection}/${id}`)
    Object.assign(current, clone(data))
  }

  deleteDocument(collection: string, id: string): void {
    this.documents.get(collection)?.delete(id)
  }

  resetExpiresAtAfterNextQuery(collection: string, id: string, expiresAt: number): void {
    this.afterNextQuery.set(collection, () => this.updateDocument(collection, id, { expiresAt }))
  }

  documentsIn(collection: string): FirestoreData[] {
    return [...(this.documents.get(collection)?.values() ?? [])].map((document) => clone(document))
  }

  documentsForUser(collection: string, userId: string): FirestoreData[] {
    return this.documentsIn(collection).filter((document) => document.userId === userId)
  }

  batchWriteCounts(): number[] {
    return [...this.committedBatchWriteCounts]
  }

  failBatchCommit(commitNumber: number): void {
    this.failBatchCommitNumber = commitNumber
  }

  commitBatch(operations: ReadonlyArray<() => void>): void {
    const commitNumber = this.committedBatchWriteCounts.push(operations.length)
    if (operations.length > MAX_TEST_BATCH_WRITES) {
      throw new Error('單一批次不可超過 450 次寫入。')
    }
    if (commitNumber === this.failBatchCommitNumber) throw new Error('模擬批次提交失敗。')
    for (const operation of operations) operation()
  }

  query(
    collection: string,
    filters: ReadonlyArray<{ field: string; op: FirestoreWhereOperator; value: unknown }>,
  ): FirestoreQuerySnapshot {
    const docs = [...(this.documents.get(collection) ?? new Map<string, FirestoreData>())]
      .filter(([, data]) => filters.every((filter) => matches(data[filter.field], filter)))
      .map(([id, data]) => {
        const ref = new FakeDocumentReference(this, collection, id)
        return new FakeQueryDocumentSnapshot(clone(data), ref)
      })
    const afterQuery = this.afterNextQuery.get(collection)
    this.afterNextQuery.delete(collection)
    afterQuery?.()
    return new FakeQuerySnapshot(docs)
  }
}

class FakeDocumentReference implements FirestoreDocumentReference {
  constructor(
    private readonly firestore: FakeFirestore,
    readonly collection: string,
    readonly id: string,
  ) {}

  async get(): Promise<FirestoreDocumentSnapshot> {
    return this.firestore.getDocument(this.collection, this.id, this)
  }

  async set(data: FirestoreData): Promise<void> {
    this.firestore.setDocument(this.collection, this.id, data)
  }

  async update(data: FirestoreData): Promise<void> {
    this.firestore.updateDocument(this.collection, this.id, data)
  }

  async delete(): Promise<void> {
    this.firestore.deleteDocument(this.collection, this.id)
  }
}

class FakeDocumentSnapshot implements FirestoreDocumentSnapshot {
  constructor(
    private readonly value: FirestoreData | undefined,
    readonly ref: FirestoreDocumentReference,
  ) {}

  get exists(): boolean {
    return this.value !== undefined
  }

  data(): FirestoreData | undefined {
    return this.value === undefined ? undefined : clone(this.value)
  }
}

class FakeQueryDocumentSnapshot extends FakeDocumentSnapshot implements FirestoreQueryDocumentSnapshot {}

class FakeQuerySnapshot implements FirestoreQuerySnapshot {
  constructor(readonly docs: readonly FirestoreQueryDocumentSnapshot[]) {}

  get empty(): boolean {
    return this.docs.length === 0
  }

  get size(): number {
    return this.docs.length
  }
}

class FakeCollectionReference implements FirestoreCollectionReference {
  constructor(
    private readonly firestore: FakeFirestore,
    readonly name: string,
    readonly filters: ReadonlyArray<{ field: string; op: FirestoreWhereOperator; value: unknown }>,
  ) {}

  doc(id: string): FirestoreDocumentReference {
    return new FakeDocumentReference(this.firestore, this.name, id)
  }

  where(field: string, op: FirestoreWhereOperator, value: unknown): FirestoreQuery {
    return new FakeCollectionReference(this.firestore, this.name, [...this.filters, { field, op, value }])
  }

  async get(): Promise<FirestoreQuerySnapshot> {
    return this.firestore.query(this.name, this.filters)
  }
}

class FakeTransaction implements FirestoreTransaction {
  private readonly operations: Array<() => void> = []

  constructor(private readonly firestore: FakeFirestore) {}

  get(reference: FirestoreDocumentReference): Promise<FirestoreDocumentSnapshot>
  get(query: FirestoreQuery): Promise<FirestoreQuerySnapshot>
  async get(
    target: FirestoreDocumentReference | FirestoreQuery,
  ): Promise<FirestoreDocumentSnapshot | FirestoreQuerySnapshot> {
    if (target instanceof FakeDocumentReference) {
      return this.firestore.getDocument(target.collection, target.id, target)
    }
    if (target instanceof FakeCollectionReference) {
      return this.firestore.query(target.name, target.filters)
    }
    throw new Error('不支援的 fake transaction 讀取目標。')
  }

  set(reference: FirestoreDocumentReference, data: FirestoreData): this {
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.setDocument(target.collection, target.id, data))
    return this
  }

  update(reference: FirestoreDocumentReference, data: FirestoreData): this {
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.updateDocument(target.collection, target.id, data))
    return this
  }

  delete(reference: FirestoreDocumentReference): this {
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.deleteDocument(target.collection, target.id))
    return this
  }

  commit(): void {
    for (const operation of this.operations) operation()
  }
}

class FakeWriteBatch implements FirestoreWriteBatch {
  private readonly operations: Array<() => void> = []

  constructor(private readonly firestore: FakeFirestore) {}

  update(reference: FirestoreDocumentReference, data: FirestoreData): this {
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.updateDocument(target.collection, target.id, data))
    return this
  }

  delete(reference: FirestoreDocumentReference): this {
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.deleteDocument(target.collection, target.id))
    return this
  }

  async commit(): Promise<void> {
    this.firestore.commitBatch(this.operations)
  }
}

function matches(value: unknown, filter: { op: FirestoreWhereOperator; value: unknown }): boolean {
  if (filter.op === '==') return value === filter.value
  return typeof value === 'number' && typeof filter.value === 'number' && value <= filter.value
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
