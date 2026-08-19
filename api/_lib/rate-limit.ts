import type { Firestore } from '@google-cloud/firestore'
import { createHash } from 'node:crypto'

export class RateLimitError extends Error {
  constructor(message: string = '請求過於頻繁，請稍後再試。') {
    super(message)
    this.name = 'RateLimitError'
  }
}

export type RateLimitOptions = {
  scope: string
  subject: string
  limit: number
  windowMs: number
}

export class RateLimiter {
  constructor(private readonly firestore: Firestore) {}

  async consume(options: RateLimitOptions, now: number = Date.now()): Promise<void> {
    const hash = createHash('sha256').update(options.subject).digest('hex')
    const docId = `${options.scope}_${hash}`
    const docRef = this.firestore.collection('rate_limits').doc(docId)

    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef)
      const data = snapshot.data() as { count: number; resetAt: number } | undefined

      if (!snapshot.exists || !data || data.resetAt <= now) {
        transaction.set(docRef, {
          scope: options.scope,
          subjectHash: hash,
          count: 1,
          resetAt: now + options.windowMs,
          expiresAt: now + options.windowMs,
        })
        return
      }

      if (data.count >= options.limit) {
        throw new RateLimitError()
      }

      transaction.update(docRef, {
        count: data.count + 1,
      })
    })
  }

  async cleanupExpired(now: number = Date.now()): Promise<number> {
    const querySnapshot = await this.firestore
      .collection('rate_limits')
      .where('expiresAt', '<=', now)
      .get()

    if (querySnapshot.empty) return 0

    const batch = this.firestore.batch()
    for (const doc of querySnapshot.docs) {
      batch.delete(doc.ref)
    }
    await batch.commit()
    return querySnapshot.size
  }
}
