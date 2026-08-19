import { describe, expect, test } from 'vitest'
import { createFakeFirestore } from './test-firestore'
import { RateLimiter, RateLimitError } from './rate-limit'

describe('RateLimiter', () => {
  test('在限制次數內允許請求', async () => {
    const firestore = createFakeFirestore()
    const limiter = new RateLimiter(firestore)

    await expect(limiter.consume({ scope: 'login', subject: '1.2.3.4', limit: 2, windowMs: 60_000 }))
      .resolves.toBeUndefined()
    await expect(limiter.consume({ scope: 'login', subject: '1.2.3.4', limit: 2, windowMs: 60_000 }))
      .resolves.toBeUndefined()
  })

  test('超過限制次數時拋出 RateLimitError', async () => {
    const firestore = createFakeFirestore()
    const limiter = new RateLimiter(firestore)

    await limiter.consume({ scope: 'login', subject: '1.2.3.4', limit: 1, windowMs: 60_000 })
    await expect(limiter.consume({ scope: 'login', subject: '1.2.3.4', limit: 1, windowMs: 60_000 }))
      .rejects.toBeInstanceOf(RateLimitError)
  })

  test('不同 subject 分別計算次數', async () => {
    const firestore = createFakeFirestore()
    const limiter = new RateLimiter(firestore)

    await limiter.consume({ scope: 'login', subject: 'user-1', limit: 1, windowMs: 60_000 })
    await expect(limiter.consume({ scope: 'login', subject: 'user-2', limit: 1, windowMs: 60_000 }))
      .resolves.toBeUndefined()
  })

  test('視窗到期後重設次數', async () => {
    const firestore = createFakeFirestore()
    const limiter = new RateLimiter(firestore)
    const now = 1_000_000

    await limiter.consume({ scope: 'login', subject: '1.2.3.4', limit: 1, windowMs: 1_000 }, now)
    await expect(limiter.consume({ scope: 'login', subject: '1.2.3.4', limit: 1, windowMs: 1_000 }, now + 1_001))
      .resolves.toBeUndefined()
  })
})
