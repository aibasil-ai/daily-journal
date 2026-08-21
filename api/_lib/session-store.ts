import type { Firestore } from '@google-cloud/firestore'
import { randomBytes } from 'node:crypto'
import type {
  FirestoreAdapter,
  FirestoreDocumentSnapshot,
  FirestoreQuery,
} from './connection-store.js'

export type SessionKind = 'journal' | 'provisioning'

export type SessionDocument = {
  sessionId: string
  userId: string
  kind: SessionKind
  expiresAt: number
  createdAt: number
  lastUsedAt: number
  revokedAt: number | null
  provisioningAttemptId: string | null
}

export type CreateSessionInput =
  | {
    userId: string
    kind: 'journal'
    ttlMs: number
    provisioningAttemptId?: never
  }
  | {
    userId: string
    kind: 'provisioning'
    ttlMs: number
    provisioningAttemptId: string
  }

type FirestoreClient = Firestore | FirestoreAdapter
const FIRESTORE_BATCH_WRITE_LIMIT = 450

export class SessionStore {
  private readonly firestore: FirestoreAdapter

  constructor(firestore: FirestoreClient, private readonly clock: () => number = Date.now) {
    this.firestore = firestore as unknown as FirestoreAdapter
  }

  async create(data: CreateSessionInput): Promise<{
    sessionId: string
    expiresAt: number
    session: SessionDocument
  }> {
    if (!data.userId || !Number.isSafeInteger(data.ttlMs) || data.ttlMs <= 0) {
      throw new Error('工作階段資料無效。')
    }
    if (data.kind === 'provisioning' && !data.provisioningAttemptId) {
      throw new Error('設定流程工作階段缺少流程識別碼。')
    }

    const sessionId = randomBytes(32).toString('base64url')
    const now = this.clock()
    const session: SessionDocument = {
      sessionId,
      userId: data.userId,
      kind: data.kind,
      expiresAt: now + data.ttlMs,
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null,
      provisioningAttemptId: data.kind === 'provisioning' ? data.provisioningAttemptId : null,
    }
    const ref = this.firestore.collection('sessions').doc(sessionId)

    await this.firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref)
      if (existing.exists) throw new Error('工作階段識別碼衝突。')
      transaction.set(ref, session)
    })

    return { sessionId, expiresAt: session.expiresAt, session }
  }

  async resolveJournalSession(
    sessionId: string,
    now: number = this.clock(),
  ): Promise<SessionDocument | undefined> {
    return this.resolveSession(sessionId, 'journal', now)
  }

  async resolveProvisioningSession(
    sessionId: string,
    now: number = this.clock(),
  ): Promise<SessionDocument | undefined> {
    return this.resolveSession(sessionId, 'provisioning', now)
  }

  async revokeSession(sessionId: string): Promise<void> {
    if (!sessionId) return
    const ref = this.firestore.collection('sessions').doc(sessionId)
    const now = this.clock()

    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const session = sessionFromSnapshot(snapshot)
      if (!session || session.revokedAt !== null) return
      transaction.update(ref, { revokedAt: now })
    })
  }

  async revokeUserSessions(userId: string): Promise<void> {
    if (!userId) return
    const snapshot = await this.firestore
      .collection('sessions')
      .where('userId', '==', userId)
      .where('revokedAt', '==', null)
      .get()
    if (snapshot.empty) return

    const now = this.clock()
    for (let start = 0; start < snapshot.docs.length; start += FIRESTORE_BATCH_WRITE_LIMIT) {
      const batch = this.firestore.batch()
      for (const document of snapshot.docs.slice(start, start + FIRESTORE_BATCH_WRITE_LIMIT)) {
        batch.update(document.ref, { revokedAt: now })
      }
      await batch.commit()
    }
  }

  async cleanupExpired(now: number = this.clock()): Promise<number> {
    const snapshot = await limitCleanupQuery(
      this.firestore.collection('sessions').where('expiresAt', '<=', now),
    ).get()
    const documents = snapshot.docs.slice(0, FIRESTORE_BATCH_WRITE_LIMIT)
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

  private async resolveSession(
    sessionId: string,
    expectedKind: SessionKind,
    now: number,
  ): Promise<SessionDocument | undefined> {
    if (!sessionId) return undefined
    const ref = this.firestore.collection('sessions').doc(sessionId)

    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const session = sessionFromSnapshot(snapshot)
      if (!session || session.sessionId !== sessionId || session.kind !== expectedKind
        || session.revokedAt !== null || session.expiresAt <= now) {
        return undefined
      }
      if (expectedKind === 'journal' && session.provisioningAttemptId !== null) return undefined
      if (expectedKind === 'provisioning' && !session.provisioningAttemptId) return undefined

      const resolved = { ...session, lastUsedAt: now }
      transaction.update(ref, { lastUsedAt: now })
      return resolved
    })
  }
}

function limitCleanupQuery(query: FirestoreQuery): FirestoreQuery {
  const limitedQuery = query as FirestoreQuery & {
    limit?: (maximum: number) => FirestoreQuery
  }
  return limitedQuery.limit?.(FIRESTORE_BATCH_WRITE_LIMIT) ?? query
}

function hasExpiredAtOrBefore(snapshot: FirestoreDocumentSnapshot, now: number): boolean {
  const expiresAt = snapshot.data()?.expiresAt
  return typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt <= now
}

function sessionFromSnapshot(snapshot: FirestoreDocumentSnapshot): SessionDocument | undefined {
  const data = snapshot.data()
  if (!data || typeof data.sessionId !== 'string' || !data.sessionId
    || typeof data.userId !== 'string' || !data.userId
    || (data.kind !== 'journal' && data.kind !== 'provisioning')
    || !isTimestamp(data.expiresAt) || !isTimestamp(data.createdAt) || !isTimestamp(data.lastUsedAt)
    || !(data.revokedAt === null || isTimestamp(data.revokedAt))
    || !(data.provisioningAttemptId === null || typeof data.provisioningAttemptId === 'string')) {
    return undefined
  }
  return data as unknown as SessionDocument
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
