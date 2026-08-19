import { describe, expect, test } from 'vitest'
import { createFakeFirestore } from './test-firestore'
import { SessionStore } from './session-store'

describe('SessionStore', () => {
  test('建立並解析 journal session', async () => {
    const firestore = createFakeFirestore()
    const store = new SessionStore(firestore)

    const { sessionId, expiresAt } = await store.create({
      userId: 'user-1',
      kind: 'journal',
      ttlMs: 60_000,
    })

    const resolved = await store.resolveJournalSession(sessionId)
    expect(resolved).toMatchObject({
      sessionId,
      userId: 'user-1',
      kind: 'journal',
      expiresAt,
      revokedAt: null,
    })
  })

  test('journal session 無法以 provisioning guard 解析', async () => {
    const firestore = createFakeFirestore()
    const store = new SessionStore(firestore)

    const { sessionId } = await store.create({
      userId: 'user-1',
      kind: 'journal',
      ttlMs: 60_000,
    })

    expect(await store.resolveProvisioningSession(sessionId)).toBeUndefined()
  })

  test('provisioning session 無法以 journal guard 解析', async () => {
    const firestore = createFakeFirestore()
    const store = new SessionStore(firestore)

    const { sessionId } = await store.create({
      userId: 'user-1',
      kind: 'provisioning',
      ttlMs: 60_000,
      provisioningAttemptId: 'attempt-1',
    })

    expect(await store.resolveJournalSession(sessionId)).toBeUndefined()
    const provisioning = await store.resolveProvisioningSession(sessionId)
    expect(provisioning).toMatchObject({
      kind: 'provisioning',
      provisioningAttemptId: 'attempt-1',
    })
  })

  test('已撤銷或過期的 session 無法解析', async () => {
    const firestore = createFakeFirestore()
    const store = new SessionStore(firestore)

    const { sessionId, expiresAt } = await store.create({
      userId: 'user-1',
      kind: 'journal',
      ttlMs: 1_000,
    })

    expect(await store.resolveJournalSession(sessionId, expiresAt + 1)).toBeUndefined()

    await store.revokeSession(sessionId)
    expect(await store.resolveJournalSession(sessionId)).toBeUndefined()
  })

  test('revokeUserSessions 撤銷該使用者的所有 session', async () => {
    const firestore = createFakeFirestore()
    const store = new SessionStore(firestore)

    const s1 = await store.create({ userId: 'user-1', kind: 'journal', ttlMs: 60_000 })
    const s2 = await store.create({ userId: 'user-1', kind: 'provisioning', ttlMs: 60_000 })
    const s3 = await store.create({ userId: 'user-2', kind: 'journal', ttlMs: 60_000 })

    await store.revokeUserSessions('user-1')

    expect(await store.resolveJournalSession(s1.sessionId)).toBeUndefined()
    expect(await store.resolveProvisioningSession(s2.sessionId)).toBeUndefined()
    expect(await store.resolveJournalSession(s3.sessionId)).toBeDefined()
  })
})
