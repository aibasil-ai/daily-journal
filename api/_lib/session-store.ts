import type { Firestore } from '@google-cloud/firestore'
import { randomBytes } from 'node:crypto'

export type SessionKind = 'journal' | 'provisioning'

export type SessionDocument = {
  sessionId: string
  userId: string
  kind: SessionKind
  expiresAt: number
  createdAt: number
  lastUsedAt: number
  revokedAt: number | null
  provisioningAttemptId?: string | null
}

export class SessionStore {
  constructor(private readonly firestore: Firestore) {}

  async create(data: {
    userId: string
    kind: SessionKind
    ttlMs: number
    provisioningAttemptId?: string | null
  }): Promise<{ sessionId: string; expiresAt: number; session: SessionDocument }> {
    const sessionId = randomBytes(32).toString('base64url')
    const now = Date.now()
    const expiresAt = now + data.ttlMs
    const session: SessionDocument = {
      sessionId,
      userId: data.userId,
      kind: data.kind,
      expiresAt,
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null,
      provisioningAttemptId: data.provisioningAttemptId ?? null,
    }

    await this.firestore.collection('sessions').doc(sessionId).set(session)
    return { sessionId, expiresAt, session }
  }

  async resolveJournalSession(sessionId: string, now: number = Date.now()): Promise<SessionDocument | undefined> {
    return this.resolveSession(sessionId, 'journal', now)
  }

  async resolveProvisioningSession(sessionId: string, now: number = Date.now()): Promise<SessionDocument | undefined> {
    return this.resolveSession(sessionId, 'provisioning', now)
  }

  private async resolveSession(
    sessionId: string,
    expectedKind: SessionKind,
    now: number,
  ): Promise<SessionDocument | undefined> {
    if (!sessionId || typeof sessionId !== 'string') return undefined

    const docRef = this.firestore.collection('sessions').doc(sessionId)
    const snapshot = await docRef.get()
    if (!snapshot.exists) return undefined

    const session = snapshot.data() as SessionDocument
    if (session.kind !== expectedKind) return undefined
    if (session.revokedAt !== null || session.expiresAt <= now) return undefined

    await docRef.update({ lastUsedAt: now }).catch(() => undefined)
    return session
  }

  async revokeSession(sessionId: string): Promise<void> {
    if (!sessionId) return
    const docRef = this.firestore.collection('sessions').doc(sessionId)
    await docRef.update({ revokedAt: Date.now() }).catch(() => undefined)
  }

  async revokeUserSessions(userId: string): Promise<void> {
    if (!userId) return
    const querySnapshot = await this.firestore
      .collection('sessions')
      .where('userId', '==', userId)
      .where('revokedAt', '==', null)
      .get()

    if (querySnapshot.empty) return

    const batch = this.firestore.batch()
    const now = Date.now()
    for (const doc of querySnapshot.docs) {
      batch.update(doc.ref, { revokedAt: now })
    }
    await batch.commit()
  }
}
