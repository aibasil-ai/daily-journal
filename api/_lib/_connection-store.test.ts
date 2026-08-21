import { describe, expect, test, vi } from 'vitest'
import {
  ConnectionStore,
  SHEET_WRITE_LEASE_MS,
  type FirestoreAdapter,
  type FirestoreCollectionReference,
  type FirestoreData,
  type FirestoreDocumentReference,
  type FirestoreDocumentSnapshot,
  type FirestoreQuery,
  type FirestoreQueryDocumentSnapshot,
  type FirestoreQuerySnapshot,
  type FirestoreTransaction,
  type FirestoreWhereOperator,
  type FirestoreWriteBatch,
} from './connection-store.js'
import type { EncryptedToken } from './token-crypto.js'

const encryptedToken: EncryptedToken = { ciphertext: 'sealed-token', keyVersion: 'v1' }
const MAX_TEST_BATCH_WRITES = 450

describe('ConnectionStore', () => {
  test('以 Google sub 建立唯一且可更新的使用者 identity', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)

    const original = await createUser(store, 'one')
    const updated = await store.getOrCreateUser({
      googleSub: 'sub-one',
      email: 'new@example.com',
      name: 'Updated User',
      picture: 'https://example.com/new.png',
    })

    expect(updated).toMatchObject({
      id: original.id,
      googleSub: 'sub-one',
      email: 'new@example.com',
      name: 'Updated User',
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    })
    expect(await store.getUserByGoogleSub('sub-one')).toEqual(updated)
    expect(await store.getUserById(updated.id)).toEqual(updated)
    expect(firestore.documentsIn('users')).toHaveLength(1)
  })

  test('交易讀取 user、claim 與連線後，維持單一 active 連線及 Sheet claim 唯一性', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const userA = await createUser(store, 'a')
    const userB = await createUser(store, 'b')

    const first = await store.activateConnection({
      userId: userA.id,
      spreadsheetId: 'sheet-1',
      encryptedRefreshToken: encryptedToken,
    })
    const second = await store.activateConnection({
      userId: userA.id,
      spreadsheetId: 'sheet-2',
      encryptedRefreshToken: encryptedToken,
    })

    expect(first).toMatchObject({ status: 'active', connectionVersion: 1 })
    expect(second).toMatchObject({ status: 'active', connectionVersion: 2 })
    expect(await store.findActiveConnection(userA.id)).toMatchObject({ spreadsheetId: 'sheet-2' })
    expect(firestore.documentsIn('sheet_connections')).toContainEqual(expect.objectContaining({
      spreadsheetId: 'sheet-1',
      status: 'archived',
    }))

    const reactivated = await store.activateConnection({
      userId: userA.id,
      spreadsheetId: 'sheet-1',
      encryptedRefreshToken: encryptedToken,
    })
    expect(reactivated).toMatchObject({ status: 'active', connectionVersion: 3 })

    await expect(store.activateConnection({
      userId: userB.id,
      spreadsheetId: 'sheet-1',
      encryptedRefreshToken: encryptedToken,
    })).rejects.toThrow('此資料表已被其他帳號連結。')
  })

  test('切換連線使用遞增版本拒絕過期確認，並保留原 active 連線', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'switch')
    await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-old',
      encryptedRefreshToken: encryptedToken,
    })

    const switched = await store.archiveAndActivateConnection({
      userId: user.id,
      targetSpreadsheetId: 'sheet-new',
      encryptedRefreshToken: encryptedToken,
      expectedOriginalVersion: 1,
    })
    expect(switched).toMatchObject({ spreadsheetId: 'sheet-new', status: 'active', connectionVersion: 2 })

    await expect(store.archiveAndActivateConnection({
      userId: user.id,
      targetSpreadsheetId: 'sheet-stale',
      encryptedRefreshToken: encryptedToken,
      expectedOriginalVersion: 1,
    })).rejects.toThrow('連線版本不符，請重新整理後再試。')
    expect(await store.findActiveConnection(user.id)).toMatchObject({ spreadsheetId: 'sheet-new' })
  })

  test('OAuth attempt 僅能在到期前消耗一次，且不保存 Google token', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)

    await store.createOAuthAttempt({
      state: 'state-1',
      codeVerifier: 'pkce-verifier',
      intent: 'sign-in',
      expiresAt: 1_001_000,
    })

    expect(await store.consumeOAuthAttempt('state-1', 1_000_999)).toMatchObject({
      state: 'state-1',
      codeVerifier: 'pkce-verifier',
      consumedAt: 1_000_999,
    })
    expect(await store.consumeOAuthAttempt('state-1', 1_000_999)).toBeUndefined()

    await store.createOAuthAttempt({
      state: 'expired-state',
      codeVerifier: 'pkce-verifier',
      intent: 'reauthorize',
      expiresAt: 1_001_000,
    })
    expect(await store.consumeOAuthAttempt('expired-state', 1_001_000)).toBeUndefined()
    expect(JSON.stringify(firestore.documentsIn('oauth_attempts'))).not.toContain('refresh-token')
  })

  test('設定流程與選擇代碼都綁定使用者、流程、一次性使用及到期時間', async () => {
    let now = 1_000_000
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => now)
    const user = await createUser(store, 'provisioning')
    const attempt = await store.createProvisioningAttempt({
      userId: user.id,
      mode: 'initial',
      tempEncryptedRefreshToken: encryptedToken,
      ttlMs: 1_000,
    })

    expect(JSON.stringify(attempt)).not.toContain('refresh-token')
    await store.updateProvisioningAttempt(attempt.id, { status: 'candidate_selection' })
    expect(await store.getProvisioningAttempt(attempt.id)).toMatchObject({ status: 'candidate_selection' })

    const code = await store.createSheetSelectionToken({
      provisioningAttemptId: attempt.id,
      spreadsheetId: 'sheet-candidate',
      spreadsheetName: '我的日記',
      modifiedTime: '2026-08-20T00:00:00Z',
      ttlMs: 10_000,
    })
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    await store.claimProvisioningAttemptAction({
      attemptId: attempt.id,
      userId: user.id,
      nextStatus: 'verifying',
    })
    expect(await store.consumeSheetSelectionToken(code, {
      provisioningAttemptId: attempt.id,
      userId: 'another-user',
    })).toBeUndefined()
    expect(await store.consumeSheetSelectionToken(code, {
      provisioningAttemptId: 'another-attempt',
      userId: user.id,
    })).toBeUndefined()
    expect(await store.consumeSheetSelectionToken(code, {
      provisioningAttemptId: attempt.id,
      userId: user.id,
    })).toMatchObject({ spreadsheetId: 'sheet-candidate' })
    expect(await store.consumeSheetSelectionToken(code, {
      provisioningAttemptId: attempt.id,
      userId: user.id,
    })).toBeUndefined()

    now = attempt.expiresAt
    expect(await store.getProvisioningAttempt(attempt.id)).toBeUndefined()
  })

  test('設定流程外部動作以交易 claim 同一 attempt，只有第一個目標可進入驗證', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'claim')
    const attempt = await store.createProvisioningAttempt({
      userId: user.id,
      mode: 'initial',
      tempEncryptedRefreshToken: encryptedToken,
      ttlMs: 60_000,
    })

    const [urlClaim, createClaim] = await Promise.all([
      store.claimProvisioningAttemptAction({
        attemptId: attempt.id,
        userId: user.id,
        nextStatus: 'verifying',
      }),
      store.claimProvisioningAttemptAction({
        attemptId: attempt.id,
        userId: user.id,
        nextStatus: 'creating',
      }),
    ])

    expect([urlClaim, createClaim].filter(Boolean)).toHaveLength(1)
    expect(await store.getProvisioningAttempt(attempt.id)).toMatchObject({
      status: urlClaim ? 'verifying' : 'creating',
    })
    await expect(store.updateClaimedProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'ready_to_confirm',
      selectedSpreadsheetId: 'another-target',
      selectedSpreadsheetName: '另一份日記',
      createdByService: false,
    })).resolves.toBeUndefined()
  })

  test('完成設定在同一交易內切換連線、完成 attempt 並輪替所有 session', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'completion')
    const old = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-old',
      encryptedRefreshToken: encryptedToken,
      scopes: ['old-scope'],
    })
    const attempt = await store.createProvisioningAttempt({
      userId: user.id,
      mode: 'change',
      originalConnectionVersion: old.connectionVersion,
      tempEncryptedRefreshToken: { ciphertext: 'rotated-token', keyVersion: 'v2' },
      tempScopes: ['rotated-scope'],
      ttlMs: 60_000,
    })
    await store.claimProvisioningAttemptAction({
      attemptId: attempt.id,
      userId: user.id,
      nextStatus: 'verifying',
    })
    await store.updateClaimedProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'verifying',
      status: 'ready_to_confirm',
      selectedSpreadsheetId: 'sheet-new',
      selectedSpreadsheetName: '新日記',
      createdByService: false,
    })
    firestore.setDocument('sessions', 'old-journal-session', sessionDocument(user.id, 'old-journal-session', 'journal'))
    firestore.setDocument('sessions', 'provisioning-session', sessionDocument(
      user.id,
      'provisioning-session',
      'provisioning',
      attempt.id,
    ))

    const completed = await store.completeProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'ready_to_confirm',
      expectedSpreadsheetId: 'sheet-new',
      expectedSpreadsheetName: '新日記',
      expectedOriginalConnectionVersion: old.connectionVersion,
      journalSessionTtlMs: 60_000,
    })

    expect(completed.connection).toMatchObject({
      spreadsheetId: 'sheet-new',
      encryptedRefreshToken: { ciphertext: 'rotated-token', keyVersion: 'v2' },
      scopes: ['rotated-scope'],
      status: 'active',
    })
    expect(firestore.document('sheet_connections', old.id)).toMatchObject({ status: 'archived' })
    expect(await store.getProvisioningAttempt(attempt.id)).toMatchObject({
      status: 'completed',
      tempEncryptedRefreshToken: null,
      tempScopes: [],
    })
    expect(firestore.document('sessions', 'old-journal-session')).toMatchObject({ revokedAt: 1_000_000 })
    expect(firestore.document('sessions', 'provisioning-session')).toMatchObject({ revokedAt: 1_000_000 })
    expect(firestore.document('sessions', completed.journalSession.sessionId)).toMatchObject({
      kind: 'journal',
      revokedAt: null,
    })
  })

  test('初次完成交易重試時若另一個完成已建立 active 連線，不會封存該連線或完成舊 attempt', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'initial-race')
    const attempt = await store.createProvisioningAttempt({
      userId: user.id,
      mode: 'initial',
      tempEncryptedRefreshToken: encryptedToken,
      ttlMs: 60_000,
    })
    await store.claimProvisioningAttemptAction({
      attemptId: attempt.id,
      userId: user.id,
      nextStatus: 'verifying',
    })
    await store.updateClaimedProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'verifying',
      selectedSpreadsheetId: 'sheet-requested',
      selectedSpreadsheetName: '本次日記',
      createdByService: false,
    })
    firestore.retryNextTransaction(() => {
      firestore.setDocument('sheet_connections', 'racing-active', {
        id: 'racing-active',
        userId: user.id,
        spreadsheetId: 'sheet-racing',
        spreadsheetName: '另一個完成',
        encryptedRefreshToken: encryptedToken,
        scopes: [],
        status: 'active',
        connectionVersion: 1,
        createdByService: false,
        createdAt: 1_000_000,
        updatedAt: 1_000_000,
      })
    })

    await expect(store.completeProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'verifying',
      expectedSpreadsheetId: 'sheet-requested',
      expectedSpreadsheetName: '本次日記',
      expectedOriginalConnectionVersion: null,
      journalSessionTtlMs: 60_000,
    })).rejects.toThrow('已有作用中的資料表連線。')

    expect(await store.findActiveConnection(user.id)).toMatchObject({ spreadsheetId: 'sheet-racing' })
    expect(await store.getProvisioningAttempt(attempt.id)).toMatchObject({ status: 'verifying' })
  })

  test('換表重新啟用封存的系統建立 Sheet 時，不會被 selection 的 false 降級', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'restore-service-created')
    await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-service-created',
      encryptedRefreshToken: encryptedToken,
      createdByService: true,
    })
    const current = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-current',
      encryptedRefreshToken: encryptedToken,
    })
    const attempt = await store.createProvisioningAttempt({
      userId: user.id,
      mode: 'change',
      originalConnectionVersion: current.connectionVersion,
      tempEncryptedRefreshToken: encryptedToken,
      ttlMs: 60_000,
    })
    await store.claimProvisioningAttemptAction({
      attemptId: attempt.id,
      userId: user.id,
      nextStatus: 'verifying',
    })
    await store.updateClaimedProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'verifying',
      status: 'ready_to_confirm',
      selectedSpreadsheetId: 'sheet-service-created',
      selectedSpreadsheetName: '系統日記',
      createdByService: false,
    })

    const completed = await store.completeProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'ready_to_confirm',
      expectedSpreadsheetId: 'sheet-service-created',
      expectedSpreadsheetName: '系統日記',
      expectedOriginalConnectionVersion: current.connectionVersion,
      journalSessionTtlMs: 60_000,
    })

    expect(completed.connection).toMatchObject({
      spreadsheetId: 'sheet-service-created',
      createdByService: true,
      status: 'active',
    })
  })

  test('完成交易遇到過多 session 時保守失敗，不會宣告 attempt 已完成', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'too-many-sessions')
    const attempt = await store.createProvisioningAttempt({
      userId: user.id,
      mode: 'initial',
      tempEncryptedRefreshToken: encryptedToken,
      ttlMs: 60_000,
    })
    await store.claimProvisioningAttemptAction({
      attemptId: attempt.id,
      userId: user.id,
      nextStatus: 'verifying',
    })
    await store.updateClaimedProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'verifying',
      selectedSpreadsheetId: 'sheet-many-sessions',
      selectedSpreadsheetName: '不應啟用',
      createdByService: false,
    })
    for (let index = 0; index < 441; index += 1) {
      const sessionId = `session-many-${index}`
      firestore.setDocument('sessions', sessionId, sessionDocument(user.id, sessionId, 'journal'))
    }

    await expect(store.completeProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'verifying',
      expectedSpreadsheetId: 'sheet-many-sessions',
      expectedSpreadsheetName: '不應啟用',
      expectedOriginalConnectionVersion: null,
      journalSessionTtlMs: 60_000,
    })).rejects.toThrow('工作階段數量過多，無法安全完成設定。')
    expect(await store.getProvisioningAttempt(attempt.id)).toMatchObject({ status: 'verifying' })
    expect(await store.findActiveConnection(user.id)).toBeUndefined()
  })

  test('完成交易在 session 資料無效時不會留下半完成連線，且封存連線重新啟用保留 createdByService', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'atomic-session')
    await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-service-created',
      encryptedRefreshToken: encryptedToken,
      createdByService: true,
    })
    await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-other',
      encryptedRefreshToken: encryptedToken,
    })
    const reactivated = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-service-created',
      encryptedRefreshToken: encryptedToken,
      createdByService: false,
    })
    expect(reactivated.createdByService).toBe(true)

    const attempt = await store.createProvisioningAttempt({
      userId: user.id,
      mode: 'change',
      originalConnectionVersion: reactivated.connectionVersion,
      tempEncryptedRefreshToken: encryptedToken,
      ttlMs: 60_000,
    })
    await store.claimProvisioningAttemptAction({
      attemptId: attempt.id,
      userId: user.id,
      nextStatus: 'verifying',
    })
    await store.updateClaimedProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'verifying',
      status: 'ready_to_confirm',
      selectedSpreadsheetId: 'sheet-invalid-session-target',
      selectedSpreadsheetName: '不應啟用',
      createdByService: false,
    })
    firestore.setDocument('sessions', 'invalid-session', { userId: user.id })

    await expect(store.completeProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'ready_to_confirm',
      expectedSpreadsheetId: 'sheet-invalid-session-target',
      expectedSpreadsheetName: '不應啟用',
      expectedOriginalConnectionVersion: reactivated.connectionVersion,
      journalSessionTtlMs: 60_000,
    })).rejects.toThrow('工作階段資料無效。')
    expect(await store.findActiveConnection(user.id)).toMatchObject({
      spreadsheetId: 'sheet-service-created',
      status: 'active',
    })
    expect(await store.getProvisioningAttempt(attempt.id)).toMatchObject({ status: 'ready_to_confirm' })
  })

  test('中斷連線必須比對 user、active connection ID 與版本，換表後不會標記舊封存連線', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'disconnect-race')
    const old = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-old',
      encryptedRefreshToken: encryptedToken,
    })
    await store.archiveAndActivateConnection({
      userId: user.id,
      targetSpreadsheetId: 'sheet-new',
      encryptedRefreshToken: encryptedToken,
      expectedOriginalVersion: old.connectionVersion,
    })

    expect(await store.markConnectionNeedsReconnectIfActive({
      userId: user.id,
      connectionId: old.id,
      expectedConnectionVersion: old.connectionVersion,
    })).toBe(false)
    expect(firestore.document('sheet_connections', old.id)).toMatchObject({
      status: 'archived',
      encryptedRefreshToken: encryptedToken,
    })
  })

  test('條件式中斷成功後清除使用者所有作用中與封存連線的加密 token', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'disconnect-clear-all')
    const archived = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-archived',
      encryptedRefreshToken: encryptedToken,
    })
    const active = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-active',
      encryptedRefreshToken: encryptedToken,
    })

    await expect(store.markConnectionNeedsReconnectIfActive({
      userId: user.id,
      connectionId: active.id,
      expectedConnectionVersion: active.connectionVersion,
    })).resolves.toBe(true)

    expect(firestore.document('sheet_connections', archived.id)).toMatchObject({
      status: 'archived',
      encryptedRefreshToken: null,
    })
    expect(firestore.document('sheet_connections', active.id)).toMatchObject({
      status: 'needs_reconnect',
      encryptedRefreshToken: null,
    })
  })

  test('中斷連線會以受限批次清除超過單一 Firestore 批次的封存連線 token', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'disconnect-batches')
    const active = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-active',
      encryptedRefreshToken: encryptedToken,
    })
    for (let index = 0; index < 451; index += 1) {
      firestore.setDocument('sheet_connections', `archived-${index}`, {
        id: `archived-${index}`,
        userId: user.id,
        spreadsheetId: `sheet-archived-${index}`,
        spreadsheetName: '封存日記',
        encryptedRefreshToken: encryptedToken,
        scopes: [],
        status: 'archived',
        connectionVersion: index + 2,
        createdByService: false,
        createdAt: 1_000_000,
        updatedAt: 1_000_000,
      })
    }

    await expect(store.markConnectionNeedsReconnectIfActive({
      userId: user.id,
      connectionId: active.id,
      expectedConnectionVersion: active.connectionVersion,
    })).resolves.toBe(true)

    expect(firestore.documentsForUser('sheet_connections', user.id)).toHaveLength(452)
    expect(firestore.documentsForUser('sheet_connections', user.id).every((connection) => (
      connection.encryptedRefreshToken === null
    ))).toBe(true)
    expect(firestore.batchWriteCounts()).toEqual([450, 2])
  })

  test('條件式 token 寫入與 reconnect 不會覆寫交錯重新授權後的 token', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'conditional-token')
    const connection = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-conditional-token',
      encryptedRefreshToken: encryptedToken,
    })
    const refreshedToken: EncryptedToken = { ciphertext: 'refreshed-token', keyVersion: 'v2' }

    expect(await store.updateEncryptedTokenIfCurrent(
      connection.id,
      encryptedToken,
      refreshedToken,
    )).toBe(true)

    const reauthorizedToken: EncryptedToken = { ciphertext: 'reauthorized-token', keyVersion: 'v3' }
    firestore.retryNextTransaction(() => {
      firestore.updateDocument('sheet_connections', connection.id, {
        encryptedRefreshToken: reauthorizedToken,
      })
    })

    expect(await store.updateEncryptedTokenIfCurrent(
      connection.id,
      refreshedToken,
      { ciphertext: 'stale-refresh-token', keyVersion: 'v4' },
    )).toBe(false)
    expect(firestore.document('sheet_connections', connection.id)).toMatchObject({
      status: 'active',
      encryptedRefreshToken: reauthorizedToken,
    })

    expect(await store.markConnectionNeedsReconnectIfCurrent(connection.id, refreshedToken)).toBe(false)
    expect(await store.updateEncryptedTokenIfCurrent(
      connection.id,
      { ciphertext: reauthorizedToken.ciphertext, keyVersion: 'wrong-key-version' },
      { ciphertext: 'wrong-version-write', keyVersion: 'v5' },
    )).toBe(false)

    expect(await store.markConnectionNeedsReconnectIfCurrent(connection.id, reauthorizedToken)).toBe(true)
    expect(firestore.document('sheet_connections', connection.id)).toMatchObject({
      status: 'needs_reconnect',
      encryptedRefreshToken: null,
    })
    expect(await store.updateEncryptedTokenIfCurrent(
      connection.id,
      reauthorizedToken,
      { ciphertext: 'inactive-write', keyVersion: 'v6' },
    )).toBe(false)
  })

  test('憑證與 scopes 的版本 CAS 會使已開始的換表確認安全衝突，並保留新憑證', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'credential-change-race')
    const active = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-current',
      encryptedRefreshToken: encryptedToken,
      scopes: ['old-scope'],
    })
    const attempt = await store.createProvisioningAttempt({
      userId: user.id,
      mode: 'change',
      originalConnectionVersion: active.connectionVersion,
      tempEncryptedRefreshToken: { ciphertext: 'change-token', keyVersion: 'v1' },
      tempScopes: ['change-scope'],
      ttlMs: 60_000,
    })
    await store.claimProvisioningAttemptAction({
      attemptId: attempt.id,
      userId: user.id,
      nextStatus: 'verifying',
    })
    await store.updateClaimedProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'verifying',
      status: 'ready_to_confirm',
      selectedSpreadsheetId: 'sheet-target',
      selectedSpreadsheetName: '目標日記',
      createdByService: false,
    })

    const updated = await store.updateActiveConnectionCredentialsIfCurrent({
      userId: user.id,
      connectionId: active.id,
      expectedConnectionVersion: active.connectionVersion,
      encryptedRefreshToken: { ciphertext: 'newest-token', keyVersion: 'v2' },
      scopes: ['newest-scope'],
    })

    expect(updated).toMatchObject({
      status: 'active',
      connectionVersion: active.connectionVersion + 1,
      encryptedRefreshToken: { ciphertext: 'newest-token', keyVersion: 'v2' },
      scopes: ['newest-scope'],
    })
    await expect(store.completeProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'ready_to_confirm',
      expectedSpreadsheetId: 'sheet-target',
      expectedSpreadsheetName: '目標日記',
      expectedOriginalConnectionVersion: active.connectionVersion,
      journalSessionTtlMs: 60_000,
    })).rejects.toThrow('連線版本不符，請重新整理後再試。')

    expect(await store.findActiveConnection(user.id)).toMatchObject({
      spreadsheetId: 'sheet-current',
      connectionVersion: active.connectionVersion + 1,
      encryptedRefreshToken: { ciphertext: 'newest-token', keyVersion: 'v2' },
      scopes: ['newest-scope'],
    })
    expect(await store.getProvisioningAttempt(attempt.id)).toMatchObject({
      status: 'ready_to_confirm',
      tempEncryptedRefreshToken: { ciphertext: 'change-token', keyVersion: 'v1' },
    })
  })

  test('確認換表時的 refresh token 輪替以 attempt token CAS 拒絕過期寫入', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'confirmation-token-cas')
    const attempt = await store.createProvisioningAttempt({
      userId: user.id,
      mode: 'initial',
      tempEncryptedRefreshToken: encryptedToken,
      ttlMs: 60_000,
    })
    await store.claimProvisioningAttemptAction({
      attemptId: attempt.id,
      userId: user.id,
      nextStatus: 'verifying',
    })
    await store.updateClaimedProvisioningAttempt({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'verifying',
      status: 'ready_to_confirm',
      selectedSpreadsheetId: 'sheet-confirmation-target',
      selectedSpreadsheetName: '目標日記',
    })
    const rotatedToken: EncryptedToken = { ciphertext: 'rotated-confirmation-token', keyVersion: 'v2' }

    await expect(store.persistProvisioningCredentials({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'ready_to_confirm',
      expectedTempEncryptedRefreshToken: encryptedToken,
      tempEncryptedRefreshToken: rotatedToken,
      tempScopes: ['rotated-scope'],
    })).resolves.toMatchObject({ tempEncryptedRefreshToken: rotatedToken })
    await expect(store.persistProvisioningCredentials({
      attemptId: attempt.id,
      userId: user.id,
      expectedStatus: 'ready_to_confirm',
      expectedTempEncryptedRefreshToken: encryptedToken,
      tempEncryptedRefreshToken: { ciphertext: 'stale-token', keyVersion: 'v3' },
      tempScopes: ['stale-scope'],
    })).resolves.toBeUndefined()

    expect(await store.getProvisioningAttempt(attempt.id)).toMatchObject({
      status: 'ready_to_confirm',
      tempEncryptedRefreshToken: rotatedToken,
      tempScopes: ['rotated-scope'],
    })
  })

  test('30 秒 write lease 會互斥，且 release 只刪除自己的 lease', async () => {
    const now = 1_000_000
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => now)
    const user = await createUser(store, 'lease')
    const connection = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-lease',
      encryptedRefreshToken: encryptedToken,
    })

    let release!: () => void
    let acquired!: () => void
    const acquiredPromise = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const held = store.withSheetWriteLease(connection.id, async () => {
      acquired()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return 'saved'
    })

    await acquiredPromise
    await expect(store.withSheetWriteLease(connection.id, async () => 'conflict'))
      .rejects.toThrow('目前有另一項操作正在儲存至 Google Sheet，請稍後再試。')
    release()
    await expect(held).resolves.toBe('saved')
    expect(firestore.document('sheet_write_leases', connection.id)).toBeUndefined()

    await expect(store.withSheetWriteLease(connection.id, async () => {
      firestore.setDocument('sheet_write_leases', connection.id, {
        connectionId: connection.id,
        userId: user.id,
        leaseId: 'newer-lease',
        expiresAt: now + 30_000,
      })
    })).rejects.toThrow('資料表寫入 lease 已遺失。')
    expect(firestore.document('sheet_write_leases', connection.id)).toMatchObject({ leaseId: 'newer-lease' })
  })

  test('write lease 的交易重試會在每次 callback 重新取得現在時間', async () => {
    let now = 1_000_000
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => now)
    const user = await createUser(store, 'lease-retry')
    const connection = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-lease-retry',
      encryptedRefreshToken: encryptedToken,
    })

    firestore.retryNextTransaction(() => {
      now += SHEET_WRITE_LEASE_MS + 1
    })

    await store.withSheetWriteLease(connection.id, () => {
      expect(firestore.document('sheet_write_leases', connection.id)).toMatchObject({
        expiresAt: now + SHEET_WRITE_LEASE_MS,
      })
    })
  })

  test('長時間寫入會續約 lease，避免原 lease 到期後讓第二個寫入進入', async () => {
    vi.useFakeTimers()
    try {
      let now = 1_000_000
      const firestore = new FakeFirestore()
      const store = new ConnectionStore(firestore, () => now)
      const user = await createUser(store, 'lease-heartbeat')
      const connection = await store.activateConnection({
        userId: user.id,
        spreadsheetId: 'sheet-lease-heartbeat',
        encryptedRefreshToken: encryptedToken,
      })

      let release!: () => void
      let acquired!: () => void
      const acquiredPromise = new Promise<void>((resolve) => {
        acquired = resolve
      })
      const held = store.withSheetWriteLease(connection.id, async () => {
        acquired()
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return 'saved'
      })

      await acquiredPromise
      now += SHEET_WRITE_LEASE_MS / 3
      await vi.advanceTimersByTimeAsync(SHEET_WRITE_LEASE_MS / 3)
      expect(firestore.document('sheet_write_leases', connection.id)).toMatchObject({
        expiresAt: now + SHEET_WRITE_LEASE_MS,
      })

      now = 1_030_001
      await expect(store.withSheetWriteLease(connection.id, async () => 'conflict'))
        .rejects.toThrow('目前有另一項操作正在儲存至 Google Sheet，請稍後再試。')

      release()
      await expect(held).resolves.toBe('saved')
    } finally {
      vi.useRealTimers()
    }
  })

  test('標記需重新連線時移除加密 token，刪除帳號資料時清除全部關聯文件與 claim', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'delete')
    const connection = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-delete',
      encryptedRefreshToken: encryptedToken,
    })
    await store.markConnectionNeedsReconnect(connection.id)
    expect(firestore.document('sheet_connections', connection.id)).toMatchObject({
      status: 'needs_reconnect',
      encryptedRefreshToken: null,
    })

    const active = await store.activateConnection({
      userId: user.id,
      spreadsheetId: 'sheet-delete',
      encryptedRefreshToken: encryptedToken,
    })
    const attempt = await store.createProvisioningAttempt({
      userId: user.id,
      mode: 'change',
      originalConnectionVersion: active.connectionVersion,
      tempEncryptedRefreshToken: encryptedToken,
      ttlMs: 60_000,
    })
    await store.createSheetSelectionToken({
      provisioningAttemptId: attempt.id,
      spreadsheetId: 'sheet-candidate',
      spreadsheetName: '候選 Sheet',
      modifiedTime: '2026-08-20T00:00:00Z',
      ttlMs: 60_000,
    })
    firestore.setDocument('sessions', 'session-delete', {
      sessionId: 'session-delete',
      userId: user.id,
    })
    firestore.setDocument('sheet_write_leases', active.id, {
      connectionId: active.id,
      userId: user.id,
      leaseId: 'lease-delete',
      expiresAt: 1_030_000,
    })

    await store.deleteAccountData(user.id)

    expect(await store.getUserById(user.id)).toBeUndefined()
    expect(firestore.documentsForUser('sheet_connections', user.id)).toHaveLength(0)
    expect(firestore.documentsForUser('sessions', user.id)).toHaveLength(0)
    expect(firestore.documentsForUser('provisioning_attempts', user.id)).toHaveLength(0)
    expect(firestore.documentsForUser('sheet_selection_tokens', user.id)).toHaveLength(0)
    expect(firestore.documentsForUser('sheet_claims', user.id)).toHaveLength(0)
    expect(firestore.documentsForUser('sheet_write_leases', user.id)).toHaveLength(0)

    const anotherUser = await createUser(store, 'after-delete')
    await expect(store.activateConnection({
      userId: anotherUser.id,
      spreadsheetId: 'sheet-delete',
      encryptedRefreshToken: encryptedToken,
    })).resolves.toMatchObject({ status: 'active' })
  })

  test('deleteAccountData 以安全批次刪除超過 500 筆關聯文件', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'bulk-delete')

    for (let index = 0; index < 901; index += 1) {
      firestore.setDocument('sessions', `bulk-delete-session-${index}`, { userId: user.id })
    }

    await store.deleteAccountData(user.id)

    expect(await store.getUserById(user.id)).toBeUndefined()
    expect(firestore.documentsForUser('sessions', user.id)).toHaveLength(0)
    expect(firestore.batchWriteCounts()).toEqual([450, 450, 2])
  })

  test('deleteAccountData 的後續批次失敗時會傳遞錯誤，而非回報完成', async () => {
    const firestore = new FakeFirestore()
    const store = new ConnectionStore(firestore, () => 1_000_000)
    const user = await createUser(store, 'failing-delete')

    for (let index = 0; index < 451; index += 1) {
      firestore.setDocument('sessions', `failing-delete-session-${index}`, { userId: user.id })
    }
    firestore.failBatchCommit(2)

    await expect(store.deleteAccountData(user.id)).rejects.toThrow('模擬批次提交失敗。')
    expect(await store.getUserById(user.id)).toBeDefined()
    expect(firestore.documentsForUser('sessions', user.id)).toHaveLength(1)
  })
})

async function createUser(store: ConnectionStore, suffix: string) {
  return store.getOrCreateUser({
    googleSub: `sub-${suffix}`,
    email: `${suffix}@example.com`,
    name: `User ${suffix}`,
    picture: `https://example.com/${suffix}.png`,
  })
}

function sessionDocument(
  userId: string,
  sessionId: string,
  kind: 'journal' | 'provisioning',
  provisioningAttemptId: string | null = null,
): FirestoreData {
  return {
    sessionId,
    userId,
    kind,
    expiresAt: 1_060_000,
    createdAt: 1_000_000,
    lastUsedAt: 1_000_000,
    revokedAt: null,
    provisioningAttemptId,
  }
}

class FakeFirestore implements FirestoreAdapter {
  private readonly documents = new Map<string, Map<string, FirestoreData>>()
  private readonly committedBatchWriteCounts: number[] = []
  private transactionActive = false
  private transactionQueue: Promise<void> = Promise.resolve()
  private retryAfterNextTransaction: (() => void) | undefined
  private failBatchCommitNumber: number | undefined

  collection(name: string): FirestoreCollectionReference {
    return new FakeCollectionReference(this, name, [])
  }

  batch(): FirestoreWriteBatch {
    return new FakeWriteBatch(this)
  }

  retryNextTransaction(afterFirstAttempt: () => void): void {
    this.retryAfterNextTransaction = afterFirstAttempt
  }

  async runTransaction<T>(callback: (transaction: FirestoreTransaction) => Promise<T>): Promise<T> {
    let releaseQueue!: () => void
    const previousTransaction = this.transactionQueue
    this.transactionQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve
    })
    await previousTransaction
    const retryAfterFirstAttempt = this.retryAfterNextTransaction
    this.retryAfterNextTransaction = undefined
    this.transactionActive = true
    try {
      let transaction = new FakeTransaction(this)
      let result = await callback(transaction)
      if (retryAfterFirstAttempt) {
        retryAfterFirstAttempt()
        transaction = new FakeTransaction(this)
        result = await callback(transaction)
      }
      transaction.commit()
      return result
    } finally {
      this.transactionActive = false
      releaseQueue()
    }
  }

  directDocument(collection: string, id: string, ref: FirestoreDocumentReference): FirestoreDocumentSnapshot {
    this.assertNoDirectReadInTransaction()
    return this.documentSnapshot(collection, id, ref)
  }

  documentSnapshot(collection: string, id: string, ref: FirestoreDocumentReference): FirestoreDocumentSnapshot {
    return new FakeDocumentSnapshot(this.documents.get(collection)?.get(id), ref)
  }

  directQuery(
    collection: string,
    filters: ReadonlyArray<{ field: string; op: FirestoreWhereOperator; value: unknown }>,
  ): FirestoreQuerySnapshot {
    this.assertNoDirectReadInTransaction()
    return this.querySnapshot(collection, filters)
  }

  querySnapshot(
    collection: string,
    filters: ReadonlyArray<{ field: string; op: FirestoreWhereOperator; value: unknown }>,
  ): FirestoreQuerySnapshot {
    const docs = [...(this.documents.get(collection) ?? new Map<string, FirestoreData>())]
      .filter(([, data]) => filters.every((filter) => matches(data[filter.field], filter)))
      .map(([id, data]) => new FakeQueryDocumentSnapshot(
        data,
        new FakeDocumentReference(this, collection, id),
      ))
    return new FakeQuerySnapshot(docs)
  }

  setDocument(collection: string, id: string, data: FirestoreData): void {
    const docs = this.documents.get(collection) ?? new Map<string, FirestoreData>()
    docs.set(id, clone(data))
    this.documents.set(collection, docs)
  }

  updateDocument(collection: string, id: string, data: FirestoreData): void {
    const current = this.documents.get(collection)?.get(id)
    if (!current) throw new Error(`找不到文件：${collection}/${id}`)
    Object.assign(current, clone(data))
  }

  deleteDocument(collection: string, id: string): void {
    this.documents.get(collection)?.delete(id)
  }

  document(collection: string, id: string): FirestoreData | undefined {
    const data = this.documents.get(collection)?.get(id)
    return data === undefined ? undefined : clone(data)
  }

  documentsIn(collection: string): FirestoreData[] {
    return [...(this.documents.get(collection)?.values() ?? [])].map((data) => clone(data))
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

  private assertNoDirectReadInTransaction(): void {
    if (this.transactionActive) {
      throw new Error('交易中必須使用 transaction.get 讀取所有必要文件。')
    }
  }
}

class FakeDocumentReference implements FirestoreDocumentReference {
  constructor(
    private readonly firestore: FakeFirestore,
    readonly collection: string,
    readonly id: string,
  ) {}

  async get(): Promise<FirestoreDocumentSnapshot> {
    return this.firestore.directDocument(this.collection, this.id, this)
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
    return this.firestore.directQuery(this.name, this.filters)
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
    if (target instanceof FakeDocumentReference) {
      return this.firestore.documentSnapshot(target.collection, target.id, target)
    }
    if (target instanceof FakeCollectionReference) {
      return this.firestore.querySnapshot(target.name, target.filters)
    }
    throw new Error('不支援的 fake transaction 讀取目標。')
  }

  set(reference: FirestoreDocumentReference, data: FirestoreData): this {
    this.wrote = true
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.setDocument(target.collection, target.id, data))
    return this
  }

  update(reference: FirestoreDocumentReference, data: FirestoreData): this {
    this.wrote = true
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.updateDocument(target.collection, target.id, data))
    return this
  }

  delete(reference: FirestoreDocumentReference): this {
    this.wrote = true
    const target = reference as FakeDocumentReference
    this.operations.push(() => this.firestore.deleteDocument(target.collection, target.id))
    return this
  }

  commit(): void {
    if (this.operations.length > MAX_TEST_BATCH_WRITES) {
      throw new Error('單一交易不可超過 450 次寫入。')
    }
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
