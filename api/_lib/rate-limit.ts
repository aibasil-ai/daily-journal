import type { Firestore } from '@google-cloud/firestore'
import { createHash } from 'node:crypto'
import type {
  FirestoreAdapter,
  FirestoreDocumentSnapshot,
  FirestoreQuery,
} from './connection-store.js'

export const RATE_LIMIT_WINDOWS = {
  oauthLogin: { limit: 10, windowMs: 15 * 60_000 },
  provisioning: { limit: 20, windowMs: 15 * 60_000 },
  journalWrites: { limit: 60, windowMs: 60_000 },
} as const

export class RateLimitError extends Error {
  constructor() {
    super('請求過於頻繁，請稍後再試。')
    this.name = 'RateLimitError'
  }
}

export type RateLimitOptions = {
  scope: string
  subject: string
  limit: number
  windowMs: number
}

type FirestoreClient = Firestore | FirestoreAdapter
const MAX_CLEANUP_DOCUMENTS = 450

export class RateLimiter {
  private readonly firestore: FirestoreAdapter

  constructor(firestore: FirestoreClient) {
    this.firestore = firestore as unknown as FirestoreAdapter
  }

  async consume(options: RateLimitOptions, now: number = Date.now()): Promise<void> {
    validateOptions(options)
    const subjectHash = hash(options.subject)
    const documentId = hash(`${options.scope}\u0000${options.subject}`)
    const ref = this.firestore.collection('rate_limits').doc(documentId)

    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const current = limitFromSnapshot(snapshot.data())

      if (!snapshot.exists || !current || current.resetAt <= now) {
        transaction.set(ref, {
          scope: options.scope,
          subjectHash,
          count: 1,
          resetAt: now + options.windowMs,
          expiresAt: now + options.windowMs,
        })
        return
      }
      if (current.count >= options.limit) throw new RateLimitError()
      transaction.update(ref, { count: current.count + 1 })
    })
  }

  async cleanupExpired(now: number = Date.now()): Promise<number> {
    const snapshot = await limitCleanupQuery(
      this.firestore.collection('rate_limits').where('expiresAt', '<=', now),
    ).get()
    const documents = snapshot.docs.slice(0, MAX_CLEANUP_DOCUMENTS)
    if (!documents.length) return 0

    return this.firestore.runTransaction(async (transaction) => {
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

function validateOptions(options: RateLimitOptions): void {
  if (!options.scope || !options.subject || !Number.isSafeInteger(options.limit) || options.limit <= 0
    || !Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) {
    throw new Error('速率限制設定無效。')
  }
}

function limitFromSnapshot(value: unknown): { count: number; resetAt: number } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const data = value as { count?: unknown; resetAt?: unknown }
  const { count, resetAt } = data
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0
    || typeof resetAt !== 'number' || !Number.isFinite(resetAt)) {
    return undefined
  }
  return { count, resetAt }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
