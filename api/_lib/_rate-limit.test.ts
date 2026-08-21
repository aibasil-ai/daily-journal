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
import { RateLimitError, RateLimiter, RATE_LIMIT_WINDOWS } from './rate-limit.js'

const MAX_TEST_BATCH_WRITES = 450

describe('RateLimiter', () => {
  test('提供 OAuth、設定流程與日記寫入的固定視窗設定', () => {
    expect(RATE_LIMIT_WINDOWS).toEqual({
      oauthLogin: { limit: 10, windowMs: 15 * 60_000 },
      provisioning: { limit: 20, windowMs: 15 * 60_000 },
      journalWrites: { limit: 60, windowMs: 60_000 },
    })
  })

  test('依 call-site 傳入的 scope、subject 與限制套用各項固定視窗', async () => {
    const firestore = new FakeFirestore()
    const limiter = new RateLimiter(firestore)
    const policies = [
      { scope: 'oauth_login', subject: '203.0.113.1', ...RATE_LIMIT_WINDOWS.oauthLogin },
      { scope: 'provisioning', subject: 'user-1', ...RATE_LIMIT_WINDOWS.provisioning },
      { scope: 'journal_write', subject: 'user-1', ...RATE_LIMIT_WINDOWS.journalWrites },
    ]

    for (const policy of policies) {
      for (let index = 0; index < policy.limit; index += 1) {
        await expect(limiter.consume(policy, 1_000_000)).resolves.toBeUndefined()
      }
      await expect(limiter.consume(policy, 1_000_000)).rejects.toBeInstanceOf(RateLimitError)
    }
  })

  test('固定視窗只在 resetAt 到期後重設，不會變成滑動視窗', async () => {
    const firestore = new FakeFirestore()
    const limiter = new RateLimiter(firestore)
    const options = { scope: 'login', subject: '203.0.113.1', limit: 2, windowMs: 1_000 }

    await limiter.consume(options, 10_000)
    await limiter.consume(options, 10_999)
    await expect(limiter.consume(options, 10_999)).rejects.toBeInstanceOf(RateLimitError)
    await expect(limiter.consume(options, 11_000)).resolves.toBeUndefined()

    expect(firestore.values()).toContainEqual(expect.objectContaining({ count: 1, resetAt: 12_000 }))
  })

  test('不同 scope 分開計數且不保存原始 subject', async () => {
    const firestore = new FakeFirestore()
    const limiter = new RateLimiter(firestore)
    const subject = 'sensitive-user-identifier'

    await limiter.consume({ scope: 'login', subject, limit: 1, windowMs: 1_000 }, 1_000)
    await expect(limiter.consume({ scope: 'provisioning', subject, limit: 1, windowMs: 1_000 }, 1_000))
      .resolves.toBeUndefined()

    expect(JSON.stringify(firestore.values())).not.toContain(subject)
    expect(firestore.ids().every((id) => !id.includes(subject))).toBe(true)
  })

  test('cleanupExpired 每輪最多刪除 450 筆 rate limit 文件，剩餘文件交由下一輪處理', async () => {
    const firestore = new FakeFirestore()
    const limiter = new RateLimiter(firestore)

    for (let index = 0; index < 901; index += 1) {
      firestore.set(`expired-${index}`, {
        scope: 'test',
        subjectHash: `subject-${index}`,
        count: 1,
        resetAt: 1_000_000,
        expiresAt: 1_000_000,
      })
    }

    await expect(limiter.cleanupExpired(1_000_000)).resolves.toBe(450)
    expect(firestore.values()).toHaveLength(451)
    await expect(limiter.cleanupExpired(1_000_000)).resolves.toBe(450)
    expect(firestore.values()).toHaveLength(1)
  })

  test('cleanupExpired 在查詢後重新讀取文件，保留已重設的 rate limit 並回傳實際刪除數', async () => {
    const firestore = new FakeFirestore()
    const limiter = new RateLimiter(firestore)
    firestore.set('renewed-limit', {
      scope: 'test',
      subjectHash: 'renewed-subject',
      count: 1,
      resetAt: 1_001_000,
      expiresAt: 1_000_000,
    })
    firestore.resetExpiresAtAfterNextQuery('renewed-limit', 1_001_000)

    await expect(limiter.cleanupExpired(1_000_000)).resolves.toBe(0)
    expect(firestore.values()).toContainEqual(expect.objectContaining({
      expiresAt: 1_001_000,
      resetAt: 1_001_000,
    }))
  })
})

class FakeFirestore implements FirestoreAdapter {
  private readonly documents = new Map<string, FirestoreData>()
  private readonly committedBatchWriteCounts: number[] = []
  private failBatchCommitNumber: number | undefined
  private afterNextQuery: (() => void) | undefined

  collection(_name: string): FirestoreCollectionReference {
    return new FakeCollectionReference(this, [])
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

  snapshot(id: string, ref: FirestoreDocumentReference): FirestoreDocumentSnapshot {
    return new FakeDocumentSnapshot(this.documents.get(id), ref)
  }

  set(id: string, data: FirestoreData): void {
    this.documents.set(id, clone(data))
  }

  update(id: string, data: FirestoreData): void {
    const current = this.documents.get(id)
    if (!current) throw new Error(`找不到文件：${id}`)
    Object.assign(current, clone(data))
  }

  delete(id: string): void {
    this.documents.delete(id)
  }

  resetExpiresAtAfterNextQuery(id: string, expiresAt: number): void {
    this.afterNextQuery = () => this.update(id, { expiresAt })
  }

  query(filters: ReadonlyArray<{ field: string; op: FirestoreWhereOperator; value: unknown }>): FirestoreQuerySnapshot {
    const docs = [...this.documents.entries()]
      .filter(([, data]) => filters.every((filter) => matches(data[filter.field], filter)))
      .map(([id, data]) => new FakeQueryDocumentSnapshot(clone(data), new FakeDocumentReference(this, id)))
    const afterQuery = this.afterNextQuery
    this.afterNextQuery = undefined
    afterQuery?.()
    return new FakeQuerySnapshot(docs)
  }

  values(): FirestoreData[] {
    return [...this.documents.values()].map((data) => clone(data))
  }

  ids(): string[] {
    return [...this.documents.keys()]
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
}

class FakeDocumentReference implements FirestoreDocumentReference {
  constructor(
    private readonly firestore: FakeFirestore,
    readonly id: string,
  ) {}

  async get(): Promise<FirestoreDocumentSnapshot> {
    return this.firestore.snapshot(this.id, this)
  }

  async set(data: FirestoreData): Promise<void> {
    this.firestore.set(this.id, data)
  }

  async update(data: FirestoreData): Promise<void> {
    this.firestore.update(this.id, data)
  }

  async delete(): Promise<void> {
    this.firestore.delete(this.id)
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
    private readonly filters: ReadonlyArray<{ field: string; op: FirestoreWhereOperator; value: unknown }>,
  ) {}

  doc(id: string): FirestoreDocumentReference {
    return new FakeDocumentReference(this.firestore, id)
  }

  where(field: string, op: FirestoreWhereOperator, value: unknown): FirestoreQuery {
    return new FakeCollectionReference(this.firestore, [...this.filters, { field, op, value }])
  }

  async get(): Promise<FirestoreQuerySnapshot> {
    return this.firestore.query(this.filters)
  }
}

class FakeTransaction implements FirestoreTransaction {
  private readonly operations: Array<() => void> = []
  private wrote = false

  constructor(private readonly firestore: FakeFirestore) {}

  get(reference: FirestoreDocumentReference): Promise<FirestoreDocumentSnapshot>
  get(query: FirestoreQuery): Promise<FirestoreQuerySnapshot>
  async get(
    target: FirestoreDocumentReference | FirestoreQuery,
  ): Promise<FirestoreDocumentSnapshot | FirestoreQuerySnapshot> {
    if (this.wrote) throw new Error('交易寫入後不得再讀取。')
    if (target instanceof FakeDocumentReference) return this.firestore.snapshot(target.id, target)
    throw new Error('RateLimiter 測試不應以交易查詢集合。')
  }

  set(reference: FirestoreDocumentReference, data: FirestoreData): this {
    this.wrote = true
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.set(target.id, data))
    return this
  }

  update(reference: FirestoreDocumentReference, data: FirestoreData): this {
    this.wrote = true
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.update(target.id, data))
    return this
  }

  delete(reference: FirestoreDocumentReference): this {
    this.wrote = true
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.delete(target.id))
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
    this.operations.push(() => this.firestore.update(target.id, data))
    return this
  }

  delete(reference: FirestoreDocumentReference): this {
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.delete(target.id))
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
