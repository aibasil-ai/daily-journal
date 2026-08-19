import { describe, expect, test } from 'vitest'
import { createFakeFirestore } from './test-firestore'
import { ConnectionStore } from './connection-store'

const token = { ciphertext: 'encrypted', keyVersion: 'v1' }

describe('ConnectionStore', () => {
  test('建立與依 Google sub 取得使用者', async () => {
    const firestore = createFakeFirestore()
    const store = new ConnectionStore(firestore)

    const user = await store.getOrCreateUser({
      googleSub: 'sub-1',
      email: 'user@example.com',
      name: 'User One',
      picture: 'https://example.com/pic.png',
    })

    expect(user).toMatchObject({
      googleSub: 'sub-1',
      email: 'user@example.com',
    })

    const found = await store.getUserByGoogleSub('sub-1')
    expect(found?.id).toBe(user.id)
  })

  test('啟用連線並防止不同使用者連結同一 Sheet', async () => {
    const firestore = createFakeFirestore()
    const store = new ConnectionStore(firestore)

    await expect(store.activateConnection({
      userId: 'user-a',
      spreadsheetId: 'sheet-1',
      encryptedRefreshToken: token,
    })).resolves.toMatchObject({ status: 'active' })

    await expect(store.activateConnection({
      userId: 'user-b',
      spreadsheetId: 'sheet-1',
      encryptedRefreshToken: token,
    })).rejects.toThrow('此資料表已被其他帳號連結')
  })

  test('同一使用者可重新啟用自己封存的連線', async () => {
    const firestore = createFakeFirestore()
    const store = new ConnectionStore(firestore)

    await store.activateConnection({
      userId: 'user-a',
      spreadsheetId: 'sheet-1',
      encryptedRefreshToken: token,
    })

    await store.activateConnection({
      userId: 'user-a',
      spreadsheetId: 'sheet-2',
      encryptedRefreshToken: token,
    })

    const active = await store.findActiveConnection('user-a')
    expect(active?.spreadsheetId).toBe('sheet-2')

    await store.activateConnection({
      userId: 'user-a',
      spreadsheetId: 'sheet-1',
      encryptedRefreshToken: token,
    })

    const reActivated = await store.findActiveConnection('user-a')
    expect(reActivated?.spreadsheetId).toBe('sheet-1')
    expect(reActivated?.connectionVersion).toBe(2)
  })

  test('OAuth attempt 建立與一次性消耗', async () => {
    const firestore = createFakeFirestore()
    const store = new ConnectionStore(firestore)

    await store.createOAuthAttempt({
      state: 'csrf-1',
      codeVerifier: 'verifier-1',
      intent: 'sign-in',
      expiresAt: Date.now() + 60_000,
    })

    const consumed = await store.consumeOAuthAttempt('csrf-1')
    expect(consumed?.codeVerifier).toBe('verifier-1')

    expect(await store.consumeOAuthAttempt('csrf-1')).toBeUndefined()
  })

  test('Sheet selection token 建立與一次性消耗', async () => {
    const firestore = createFakeFirestore()
    const store = new ConnectionStore(firestore)

    const code = await store.createSheetSelectionToken({
      provisioningAttemptId: 'attempt-1',
      spreadsheetId: 'sheet-x',
      spreadsheetName: '我的日記',
      modifiedTime: '2026-08-19T00:00:00Z',
      ttlMs: 60_000,
    })

    expect(await store.consumeSheetSelectionToken(code, 'wrong-attempt')).toBeUndefined()
    const consumed = await store.consumeSheetSelectionToken(code, 'attempt-1')
    expect(consumed?.spreadsheetId).toBe('sheet-x')
    expect(await store.consumeSheetSelectionToken(code, 'attempt-1')).toBeUndefined()
  })

  test('withSheetWriteLease 串行化同一 Sheet 的寫入', async () => {
    const firestore = createFakeFirestore()
    const store = new ConnectionStore(firestore)

    let running = false
    let leaseAcquired!: () => void
    const leaseAcquiredPromise = new Promise<void>((resolve) => {
      leaseAcquired = resolve
    })

    const task = store.withSheetWriteLease('conn-1', async () => {
      running = true
      leaseAcquired()
      await new Promise((resolve) => setTimeout(resolve, 50))
      running = false
      return 'ok'
    })

    await leaseAcquiredPromise
    await expect(store.withSheetWriteLease('conn-1', async () => 'conflict'))
      .rejects.toThrow('目前有另一項操作正在儲存至 Google Sheet')

    await expect(task).resolves.toBe('ok')
    expect(running).toBe(false)

    await expect(store.withSheetWriteLease('conn-1', async () => 'next-ok'))
      .resolves.toBe('next-ok')
  })

  test('deleteAccountData 刪除所有相關資料', async () => {
    const firestore = createFakeFirestore()
    const store = new ConnectionStore(firestore)

    const user = await store.getOrCreateUser({
      googleSub: 'sub-del',
      email: 'del@example.com',
      name: 'Delete Me',
      picture: '',
    })

    await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-del',
      encryptedRefreshToken: token,
    })

    await store.deleteAccountData(user.id)

    expect(await store.getUserById(user.id)).toBeUndefined()
    expect(await store.findActiveConnection(user.id)).toBeUndefined()

    await expect(store.activateConnection({
      userId: 'other-user',
      spreadsheetId: 'sheet-del',
      encryptedRefreshToken: token,
    })).resolves.toMatchObject({ status: 'active' })
  })
})
