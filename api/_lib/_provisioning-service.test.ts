import { describe, expect, test } from 'vitest'
import type {
  ActiveSheetConnectionDocument,
  ProvisioningAttemptDocument,
  UserDocument,
} from './connection-store.js'
import type { SessionDocument } from './session-store.js'
import { GoogleConnectionError } from './google-drive.js'
import {
  ProvisioningService,
  provisioningErrorResponse,
  type JournalProvisioningContext,
  type ProvisioningServiceDependencies,
  type ProvisioningSessionContext,
} from './provisioning-service.js'

const config = {
  googleClientId: 'client',
  googleClientSecret: 'secret',
  appOrigin: 'https://journal.example',
  sessionEncryptionKey: Buffer.alloc(32, 1),
  tokenEncryptionKey: Buffer.alloc(32, 2),
  tokenEncryptionKeyVersion: 'v1',
  firestoreProjectId: 'project',
  firestoreCredentials: { clientEmail: 'service@example.com', privateKey: 'private-key' },
  legacyMigrationSecret: 'm'.repeat(32),
  cronSecret: 'c'.repeat(32),
} as const

describe('ProvisioningService', () => {
  test('候選清單僅回傳安全 shape，選擇代碼不可跨使用者、重複使用或逾期', async () => {
    const system = createSystem()
    const alice = system.createProvisioning('alice')
    const bob = system.createProvisioning('bob')

    const candidates = await system.service.listCandidateSheets(alice, {
      query: '日記',
      cursor: null,
    })
    const selectionCode = candidates.items[0]?.selectionCode
    if (!selectionCode) throw new Error('預期取得選擇代碼。')

    expect(candidates).toEqual({
      items: [{
        selectionCode: expect.any(String),
        name: '我的日記',
        modifiedTime: '2026-08-20T00:00:00.000Z',
      }],
      nextCursor: null,
    })
    expect(JSON.stringify(candidates)).not.toContain('opaque-resource-a')

    await expect(system.service.selectCandidate(bob, selectionCode))
      .rejects.toMatchObject({ code: 'invalid_selection' })
    await expect(system.service.selectCandidate(alice, selectionCode))
      .resolves.toMatchObject({ status: { phase: 'completed', sheetName: '我的日記' } })
    await expect(system.service.selectCandidate(alice, selectionCode))
      .rejects.toMatchObject({ code: 'invalid_selection' })

    system.nextPageToken = 'upstream-page-token'
    const cursorPage = await system.service.listCandidateSheets(bob, { query: '日記', cursor: null })
    expect(cursorPage.nextCursor).toMatch(/^[A-Za-z0-9_.-]+$/)
    expect(cursorPage.nextCursor).not.toContain('upstream-page-token')

    const fresh = system.createProvisioning('bob')
    const expiredCandidates = await system.service.listCandidateSheets(fresh, {
      query: '日記',
      cursor: null,
    })
    const expiredCode = expiredCandidates.items[0]?.selectionCode
    if (!expiredCode) throw new Error('預期取得選擇代碼。')
    system.advance(10 * 60_000)
    await expect(system.service.selectCandidate(fresh, expiredCode))
      .rejects.toMatchObject({ code: 'invalid_selection' })
  })

  test('A 已 claim 的資料表不能由 B 以網址初始化或啟用', async () => {
    const system = createSystem()
    system.activateExisting('alice', 'opaque-resource-a', 'A 的日記')
    const bob = system.createProvisioning('bob')

    await expect(system.service.submitSheetUrl(
      bob,
      'https://docs.google.com/spreadsheets/d/opaque-resource-a/edit',
    )).rejects.toMatchObject({ code: 'sheet_unavailable' })

    expect(system.sheetInitializeCalls).toBe(0)
    expect(system.active.get('alice')?.spreadsheetName).toBe('A 的日記')
    expect(system.active.get('bob')).toBeUndefined()
  })

  test('非空不相容資料表被拒絕時不寫入，也不建立作用中連線', async () => {
    const system = createSystem()
    system.initializeFailure = true
    const alice = system.createProvisioning('alice')
    const candidates = await system.service.listCandidateSheets(alice, { query: '日記', cursor: null })
    const selectionCode = candidates.items[0]?.selectionCode
    if (!selectionCode) throw new Error('預期取得選擇代碼。')

    await expect(system.service.selectCandidate(alice, selectionCode))
      .rejects.toMatchObject({ code: 'sheet_incompatible' })

    expect(system.sheetInitializeCalls).toBe(1)
    expect(system.sheetWrites).toBe(0)
    expect(system.active.get('alice')).toBeUndefined()
  })

  test('初次建立成功後立即啟用連線、撤銷 provisioning session 並建立 journal session', async () => {
    const system = createSystem()
    const alice = system.createProvisioning('alice')

    const result = await system.service.createSheet(alice)

    expect(result.status).toEqual({
      phase: 'completed',
      sheetName: '每日記事',
      lastUpdatedAt: system.now(),
      connectionVersion: 1,
      canDeleteActiveSystemSheet: true,
      errorCode: null,
    })
    expect(result.journalSession).toMatchObject({ kind: 'journal', userId: 'alice' })
    expect(system.active.get('alice')).toMatchObject({
      spreadsheetName: '每日記事',
      createdByService: true,
    })
    expect(system.revokedUsers).toContain('alice')
    expect(system.attempts.get(alice.attempt.id)?.status).toBe('completed')
    expect(JSON.stringify(result)).not.toContain('created-resource')
    expect(JSON.stringify(result)).not.toContain('sealed-alice')
  })

  test('更換資料表時建立新 Sheet 會進入 ready_to_confirm 狀態供使用者確認切換', async () => {
    const system = createSystem()
    const alice = system.createProvisioning('alice', 'change')

    const result = await system.service.createSheet(alice)

    expect(result.status).toMatchObject({
      phase: 'ready_to_confirm',
      sheetName: '每日記事',
    })
    expect(system.attempts.get(alice.attempt.id)?.status).toBe('ready_to_confirm')
  })

  test('同一 attempt 並行建立與網址選擇時，只有取得 phase claim 的動作可呼叫外部服務', async () => {
    const system = createSystem()
    const alice = system.createProvisioning('alice')

    const results = await Promise.allSettled([
      system.service.createSheet(alice),
      system.service.submitSheetUrl(
        alice,
        'https://docs.google.com/spreadsheets/d/opaque-resource-b/edit',
      ),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'connection_conflict' },
    })
    expect(system.sheetCreateCalls + system.driveGetCalls).toBe(1)
  })

  test('同一 attempt 並行建立與候選選擇不同目標時，只有一個動作能取得 claim', async () => {
    const system = createSystem()
    const alice = system.createProvisioning('alice')
    const candidates = await system.service.listCandidateSheets(alice, { query: '日記', cursor: null })
    const selectionCode = candidates.items[0]?.selectionCode
    if (!selectionCode) throw new Error('預期取得候選選擇代碼。')
    const current = system.currentProvisioning(alice)

    const results = await Promise.allSettled([
      system.service.createSheet(current),
      system.service.selectCandidate(current, selectionCode),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(system.sheetCreateCalls + system.driveGetCalls).toBe(1)
  })

  test('換表起始保留 journal session，並保存二十分鐘的原連線版本與加密暫存 token', async () => {
    const system = createSystem()
    system.activateExisting('alice', 'opaque-resource-a', '原本日記')
    const journal = system.createJournal('alice')

    const result = await system.service.startChange(journal)
    const attempt = [...system.attempts.values()][0]

    expect(result.status).toMatchObject({ phase: 'initial_choice', sheetName: '原本日記', connectionVersion: 1 })
    expect(result.provisioningSession).toMatchObject({ kind: 'provisioning', userId: 'alice' })
    expect(attempt).toMatchObject({
      mode: 'change',
      originalConnectionVersion: 1,
      tempEncryptedRefreshToken: { ciphertext: 'sealed-alice', keyVersion: 'v1' },
      tempScopes: [],
      expiresAt: system.now() + 20 * 60_000,
    })
    expect(system.revokedUsers).toEqual([])
  })

  test('取消更換只撤銷 provisioning session，保留原本的作用中連線', async () => {
    const system = createSystem()
    system.activateExisting('alice', 'opaque-resource-a', '原本日記')
    const journal = system.createJournal('alice')
    const started = await system.service.startChange(journal)
    const attempt = [...system.attempts.values()][0]
    const provisioningSession = system.sessions.get(started.provisioningSession.sessionId)
    if (!attempt || !provisioningSession) throw new Error('預期建立換表流程工作階段。')

    await system.service.cancelChange({ session: provisioningSession, attempt })

    expect(system.sessions.get(provisioningSession.sessionId)).toMatchObject({ revokedAt: system.now() })
    expect(system.sessions.get(journal.session.sessionId)).toMatchObject({ revokedAt: null })
    expect(system.active.get('alice')).toMatchObject({
      spreadsheetId: 'opaque-resource-a',
      spreadsheetName: '原本日記',
      status: 'active',
    })
  })

  test('建立失敗會標記 attempt failed，絕不啟用連線', async () => {
    const system = createSystem()
    system.createFailure = true
    const alice = system.createProvisioning('alice')

    await expect(system.service.createSheet(alice))
      .rejects.toMatchObject({ code: 'provisioning_failed' })

    expect(system.attempts.get(alice.attempt.id)).toMatchObject({
      status: 'failed',
      createdByService: true,
      errorCode: 'provisioning_failed',
    })
    expect(system.active.get('alice')).toBeUndefined()
  })

  test('缺少 scope 的 refresh 回應保留既有 attempt scopes，而非覆寫成空陣列', async () => {
    const system = createSystem()
    const alice = system.createProvisioning('alice')
    const stored = system.attempts.get(alice.attempt.id)
    if (!stored) throw new Error('預期存在設定流程。')
    stored.tempScopes = ['granted-scope']
    system.refreshedCredentials = { accessToken: 'short-lived' }

    await system.service.listCandidateSheets(system.currentProvisioning(alice), {
      query: '日記',
      cursor: null,
    })

    expect(system.attempts.get(alice.attempt.id)).toMatchObject({
      tempScopes: ['granted-scope'],
    })
  })

  test('未知 token key version 回安全設定錯誤，且保留 provisioning attempt、token 與 session', async () => {
    const system = createSystem()
    const alice = system.createProvisioning('alice')
    const stored = system.attempts.get(alice.attempt.id)
    if (!stored) throw new Error('預期存在設定流程。')
    stored.tempEncryptedRefreshToken = {
      ciphertext: 'unavailable-ciphertext',
      keyVersion: 'retired-key',
    }

    let failure: unknown
    try {
      await system.service.listCandidateSheets(system.currentProvisioning(alice), {
        query: '日記',
        cursor: null,
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({ code: 'upstream_failure', status: 502 })
    expect(JSON.stringify(failure)).not.toContain('unavailable-ciphertext')
    expect(JSON.stringify(failure)).not.toContain('opaque-resource-a')
    const response = provisioningErrorResponse(failure)
    const payload = await response.json()
    expect(response.status).toBe(502)
    expect(payload).toEqual({ error: 'upstream_failure' })
    expect(JSON.stringify(payload)).not.toContain('unavailable-ciphertext')
    expect(JSON.stringify(payload)).not.toContain('opaque-resource-a')
    expect(system.attempts.get(alice.attempt.id)).toMatchObject({
      status: 'initial_choice',
      errorCode: null,
      tempEncryptedRefreshToken: { ciphertext: 'unavailable-ciphertext', keyVersion: 'retired-key' },
    })
    expect(system.sessions.get(alice.session.sessionId)).toMatchObject({ revokedAt: null })
    expect(system.active.get('alice')).toBeUndefined()
  })

  test('新 Sheet 初始化失敗會保留伺服器端 failed target，不會啟用不完整連線', async () => {
    const system = createSystem()
    system.initializeFailure = true
    const alice = system.createProvisioning('alice')

    await expect(system.service.createSheet(alice))
      .rejects.toMatchObject({ code: 'provisioning_failed' })

    expect(system.attempts.get(alice.attempt.id)).toMatchObject({
      status: 'failed',
      createdByService: true,
      selectedSpreadsheetId: 'created-resource',
      selectedSpreadsheetName: '每日記事',
    })
    expect(system.active.get('alice')).toBeUndefined()
  })

  test('換表確認遇到連線版本衝突時，保留原作用中連線', async () => {
    const system = createSystem()
    system.activateExisting('alice', 'opaque-resource-a', '原本日記')
    const change = system.createProvisioning('alice', 'change', 1)

    await system.service.submitSheetUrl(
      change,
      'https://docs.google.com/spreadsheets/d/opaque-resource-b/edit',
    )
    system.activateExisting('alice', 'opaque-resource-c', '另一個分頁已切換')

    await expect(system.service.confirmChange(system.currentProvisioning(change)))
      .rejects.toMatchObject({ code: 'connection_conflict' })

    expect(system.active.get('alice')).toMatchObject({
      spreadsheetName: '另一個分頁已切換',
      connectionVersion: 2,
    })
  })

  test('換表確認在 Firestore 完成前重新取得憑證、驗證 Drive，且只做唯讀 Sheet 驗證', async () => {
    const system = createSystem()
    system.activateExisting('alice', 'opaque-resource-a', '原本日記')
    const change = system.createProvisioning('alice', 'change', 1)

    await system.service.submitSheetUrl(
      change,
      'https://docs.google.com/spreadsheets/d/opaque-resource-b/edit',
    )
    await system.service.confirmChange(system.currentProvisioning(change))

    expect(system.refreshCalls).toBe(2)
    expect(system.driveGetCalls).toBe(2)
    expect(system.sheetInitializeCalls).toBe(1)
    expect(system.sheetValidationCalls).toBe(1)
    expect(system.sheetWrites).toBe(1)
  })

  test('換表確認的 Drive TOCTOU 驗證失敗時，保留舊連線與可恢復 attempt', async () => {
    const system = createSystem()
    system.activateExisting('alice', 'opaque-resource-a', '原本日記')
    const change = system.createProvisioning('alice', 'change', 1)

    await system.service.submitSheetUrl(
      change,
      'https://docs.google.com/spreadsheets/d/opaque-resource-b/edit',
    )
    system.driveUnavailableAtConfirmation = true

    await expect(system.service.confirmChange(system.currentProvisioning(change)))
      .rejects.toMatchObject({ code: 'sheet_unavailable' })

    expect(system.active.get('alice')).toMatchObject({
      spreadsheetId: 'opaque-resource-a',
      spreadsheetName: '原本日記',
      status: 'active',
      connectionVersion: 1,
    })
    expect(system.attempts.get(change.attempt.id)).toMatchObject({
      status: 'ready_to_confirm',
      selectedSpreadsheetId: 'opaque-resource-b',
      tempEncryptedRefreshToken: expect.any(Object),
    })
    expect(system.sheetInitializeCalls).toBe(1)
    expect(system.sheetValidationCalls).toBe(0)
  })

  test('換表確認的最終目標 TOCTOU 變動回傳 conflict，且不完成或失敗 attempt', async () => {
    const system = createSystem()
    system.activateExisting('alice', 'opaque-resource-a', '原本日記')
    const change = system.createProvisioning('alice', 'change', 1)

    await system.service.submitSheetUrl(
      change,
      'https://docs.google.com/spreadsheets/d/opaque-resource-b/edit',
    )
    system.mutateTargetDuringValidation = true

    await expect(system.service.confirmChange(system.currentProvisioning(change)))
      .rejects.toMatchObject({ code: 'connection_conflict' })

    expect(system.active.get('alice')).toMatchObject({
      spreadsheetId: 'opaque-resource-a',
      status: 'active',
      connectionVersion: 1,
    })
    expect(system.attempts.get(change.attempt.id)).toMatchObject({
      status: 'ready_to_confirm',
      selectedSpreadsheetId: 'opaque-resource-c',
      selectedSpreadsheetName: '另一份資料表',
    })
  })

  test('換表確認使用驗證期間持久化的輪替 token 與 scopes，而非舊 active 連線資料', async () => {
    const system = createSystem()
    system.activateExisting('alice', 'opaque-resource-a', '原本日記')
    const change = system.createProvisioning('alice', 'change', 1)
    system.refreshedCredentials = {
      accessToken: 'short-lived',
      refreshToken: 'rotated-refresh-token',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    }

    await system.service.submitSheetUrl(
      change,
      'https://docs.google.com/spreadsheets/d/opaque-resource-b/edit',
    )
    system.refreshedCredentials = {
      accessToken: 'short-lived-confirmation',
      refreshToken: 'confirmation-rotated-refresh-token',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    }
    await system.service.confirmChange(system.currentProvisioning(change))

    expect(system.active.get('alice')).toMatchObject({
      encryptedRefreshToken: { ciphertext: 'confirmation-rotated-refresh-token', keyVersion: 'v1' },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
  })

  test('中斷連線保留 Sheet；Drive 刪除失敗不刪帳號資料', async () => {
    const system = createSystem()
    system.activateExisting('alice', 'opaque-resource-a', '系統日記', true)
    const journal = system.createJournal('alice')

    await system.service.disconnect(journal)
    expect(system.active.get('alice')).toMatchObject({
      status: 'needs_reconnect',
      encryptedRefreshToken: null,
    })
    expect(system.revokedUsers).toContain('alice')
    expect(system.deletedUsers).toEqual([])

    system.activateExisting('alice', 'opaque-resource-a', '系統日記', true)
    system.driveDeleteFailure = true
    await expect(system.service.deleteAccount(journal, {
      deleteSystemCreatedSheet: true,
      confirmation: '刪除我的帳號',
    })).rejects.toMatchObject({ code: 'upstream_failure' })
    expect(system.deletedUsers).toEqual([])

    system.driveDeleteFailure = false
    await system.service.deleteAccount(journal, {
      deleteSystemCreatedSheet: true,
      confirmation: '刪除我的帳號',
    })
    expect(system.driveDeleteCalls).toBe(2)
    expect(system.deletedUsers).toEqual(['alice'])
  })

  test('中斷連線與換表競態時回傳安全 conflict，且不撤銷新連線的 sessions', async () => {
    const system = createSystem()
    system.activateExisting('alice', 'opaque-resource-a', '原本日記')
    const journal = system.createJournal('alice')
    system.disconnectConflict = true

    await expect(system.service.disconnect(journal)).rejects.toMatchObject({ code: 'connection_conflict' })
    expect(system.active.get('alice')).toMatchObject({ status: 'active' })
    expect(system.revokedUsers).not.toContain('alice')
  })

  test('刪帳號預設保留 Sheet，未勾選系統資料表刪除時不呼叫 Drive', async () => {
    const system = createSystem()
    system.activateExisting('alice', 'opaque-resource-a', '系統日記', true)
    const journal = system.createJournal('alice')

    await system.service.deleteAccount(journal, {
      deleteSystemCreatedSheet: false,
      confirmation: '刪除我的帳號',
    })

    expect(system.driveDeleteCalls).toBe(0)
    expect(system.deletedUsers).toEqual(['alice'])
  })
})

function createSystem() {
  let currentTime = 1_800_000_000_000
  let selectionCounter = 0
  let sessionCounter = 0
  let attemptCounter = 0
  const users = new Map<string, UserDocument>([
    ['alice', user('alice')],
    ['bob', user('bob')],
  ])
  const active = new Map<string, ActiveSheetConnectionDocument>()
  const attempts = new Map<string, ProvisioningAttemptDocument>()
  const selections = new Map<string, {
    attemptId: string
    userId: string
    spreadsheetId: string
    spreadsheetName: string
    modifiedTime: string
    expiresAt: number
    consumedAt: number | null
  }>()
  const sessions = new Map<string, SessionDocument>()
  const claims = new Map<string, string>()
  const revokedUsers: string[] = []
  const deletedUsers: string[] = []
  const drive = new Map([
    ['opaque-resource-a', { id: 'opaque-resource-a', name: '我的日記', modifiedTime: '2026-08-20T00:00:00.000Z' }],
    ['opaque-resource-b', { id: 'opaque-resource-b', name: '目標資料表', modifiedTime: '2026-08-19T00:00:00.000Z' }],
    ['opaque-resource-c', { id: 'opaque-resource-c', name: '另一份資料表', modifiedTime: '2026-08-18T00:00:00.000Z' }],
  ])
  const system = {
    active,
    attempts,
    sessions,
    revokedUsers,
    deletedUsers,
    sheetInitializeCalls: 0,
    sheetValidationCalls: 0,
    sheetCreateCalls: 0,
    sheetWrites: 0,
    driveGetCalls: 0,
    refreshCalls: 0,
    createFailure: false,
    initializeFailure: false,
    driveDeleteFailure: false,
    driveDeleteCalls: 0,
    disconnectConflict: false,
    driveUnavailableAtConfirmation: false,
    mutateTargetDuringValidation: false,
    refreshedCredentials: {
      accessToken: 'short-lived',
      scopes: [] as string[],
    } as { accessToken: string; refreshToken?: string; scopes?: string[] },
    nextPageToken: undefined as string | undefined,
    now: () => currentTime,
    advance(milliseconds: number): void {
      currentTime += milliseconds
    },
    createProvisioning(userId: string, mode: 'initial' | 'change' = 'initial', originalConnectionVersion: number | null = null): ProvisioningSessionContext {
      const id = `attempt-${attemptCounter += 1}`
      const attempt: ProvisioningAttemptDocument = {
        id,
        userId,
        mode,
        originalConnectionVersion,
        tempEncryptedRefreshToken: { ciphertext: `sealed-${userId}`, keyVersion: 'v1' },
        tempScopes: [],
        selectedSpreadsheetId: null,
        selectedSpreadsheetName: null,
        createdByService: false,
        status: 'initial_choice',
        expiresAt: currentTime + 20 * 60_000,
        errorCode: null,
        errorMessage: null,
        createdAt: currentTime,
        updatedAt: currentTime,
      }
      attempts.set(id, attempt)
      const session = createSession(userId, 'provisioning', id)
      return {
        session,
        attempt: {
          ...attempt,
          tempEncryptedRefreshToken: attempt.tempEncryptedRefreshToken
            ? { ...attempt.tempEncryptedRefreshToken }
            : null,
          tempScopes: [...attempt.tempScopes],
        },
      }
    },
    currentProvisioning(context: ProvisioningSessionContext): ProvisioningSessionContext {
      const attempt = attempts.get(context.attempt.id)
      if (!attempt) throw new Error('預期存在設定流程。')
      return {
        session: context.session,
        attempt: {
          ...attempt,
          tempEncryptedRefreshToken: attempt.tempEncryptedRefreshToken
            ? { ...attempt.tempEncryptedRefreshToken }
            : null,
          tempScopes: [...attempt.tempScopes],
        },
      }
    },
    createJournal(userId: string): JournalProvisioningContext {
      const connection = active.get(userId)
      if (!connection) throw new Error('預期有作用中連線。')
      return { session: createSession(userId, 'journal'), user: users.get(userId)!, connection }
    },
    activateExisting(userId: string, spreadsheetId: string, spreadsheetName: string, createdByService: boolean = false): void {
      const previous = active.get(userId)
      const connection: ActiveSheetConnectionDocument = {
        id: `connection-${userId}-${spreadsheetId}`,
        userId,
        spreadsheetId,
        spreadsheetName,
        encryptedRefreshToken: { ciphertext: `sealed-${userId}`, keyVersion: 'v1' },
        scopes: [],
        status: 'active',
        connectionVersion: (previous?.connectionVersion ?? 0) + 1,
        createdByService,
        createdAt: currentTime,
        updatedAt: currentTime,
      }
      active.set(userId, connection)
      claims.set(spreadsheetId, userId)
    },
  }

  const createSession = (userId: string, kind: 'journal' | 'provisioning', provisioningAttemptId: string | null = null): SessionDocument => {
    const session: SessionDocument = {
      sessionId: `session-${sessionCounter += 1}`,
      userId,
      kind,
      expiresAt: currentTime + (kind === 'journal' ? 30 * 24 * 60 * 60_000 : 20 * 60_000),
      createdAt: currentTime,
      lastUsedAt: currentTime,
      revokedAt: null,
      provisioningAttemptId,
    }
    sessions.set(session.sessionId, session)
    return session
  }

  const dependencies = {
    config,
    connections: {
      getUserById: async (userId: string) => users.get(userId),
      findActiveConnection: async (userId: string) => active.get(userId),
      createProvisioningAttempt: async (input: {
        userId: string
        mode: 'initial' | 'change'
        originalConnectionVersion?: number
        tempEncryptedRefreshToken?: { ciphertext: string; keyVersion: string } | null
        tempScopes?: string[]
        ttlMs: number
      }) => {
        const context = system.createProvisioning(
          input.userId,
          input.mode,
          input.originalConnectionVersion ?? null,
        )
        const attempt = {
          ...context.attempt,
          tempEncryptedRefreshToken: input.tempEncryptedRefreshToken ?? null,
          tempScopes: input.tempScopes ? [...input.tempScopes] : [],
          expiresAt: currentTime + input.ttlMs,
        }
        attempts.set(attempt.id, attempt)
        return attempt
      },
      getProvisioningAttempt: async (attemptId: string) => attempts.get(attemptId),
      updateProvisioningAttempt: async (attemptId: string, update: Record<string, unknown>) => {
        const current = attempts.get(attemptId)
        if (!current) return undefined
        Object.assign(current, update, {
          createdByService: current.createdByService || update.createdByService === true,
          updatedAt: currentTime,
        })
        attempts.set(attemptId, current)
        return current
      },
      claimProvisioningAttemptAction: async (input: {
        attemptId: string
        userId: string
        nextStatus: 'creating' | 'verifying'
        createdByService?: boolean
      }) => {
        const current = attempts.get(input.attemptId)
        if (!current || current.userId !== input.userId || current.expiresAt <= currentTime
          || (current.status !== 'initial_choice' && current.status !== 'candidate_selection')) {
          return undefined
        }
        Object.assign(current, {
          status: input.nextStatus,
          createdByService: current.createdByService || input.createdByService === true,
          errorCode: null,
          errorMessage: null,
          updatedAt: currentTime,
        })
        return current
      },
      updateClaimedProvisioningAttempt: async (input: {
        attemptId: string
        userId: string
        expectedStatus: 'creating' | 'verifying'
        status?: 'creating' | 'verifying' | 'candidate_selection' | 'ready_to_confirm' | 'failed'
        selectedSpreadsheetId?: string | null
        selectedSpreadsheetName?: string | null
        createdByService?: boolean
        errorCode?: string | null
        errorMessage?: string | null
      }) => {
        const current = attempts.get(input.attemptId)
        if (!current || current.userId !== input.userId || current.expiresAt <= currentTime
          || current.status !== input.expectedStatus) {
          return undefined
        }
        Object.assign(current, input, {
          status: input.status ?? current.status,
          createdByService: current.createdByService || input.createdByService === true,
          updatedAt: currentTime,
        })
        return current
      },
      persistProvisioningCredentials: async (input: {
        attemptId: string
        userId: string
        expectedStatus: 'initial_choice' | 'candidate_selection' | 'creating' | 'verifying' | 'ready_to_confirm'
        tempEncryptedRefreshToken: { ciphertext: string; keyVersion: string }
        tempScopes: string[]
      }) => {
        const current = attempts.get(input.attemptId)
        if (!current || current.userId !== input.userId || current.expiresAt <= currentTime
          || current.status !== input.expectedStatus) {
          return undefined
        }
        Object.assign(current, {
          tempEncryptedRefreshToken: { ...input.tempEncryptedRefreshToken },
          tempScopes: [...input.tempScopes],
          updatedAt: currentTime,
        })
        return current
      },
      failProvisioningAttempt: async (input: {
        attemptId: string
        userId: string
        expectedStatuses: string[]
        errorCode: string
      }) => {
        const current = attempts.get(input.attemptId)
        if (!current || current.userId !== input.userId || current.expiresAt <= currentTime
          || !input.expectedStatuses.includes(current.status)) {
          return undefined
        }
        Object.assign(current, {
          status: 'failed',
          errorCode: input.errorCode,
          errorMessage: null,
          updatedAt: currentTime,
        })
        return current
      },
      createSheetSelectionToken: async (input: {
        provisioningAttemptId: string
        spreadsheetId: string
        spreadsheetName: string
        modifiedTime: string
        ttlMs: number
      }) => {
        const attempt = attempts.get(input.provisioningAttemptId)
        if (!attempt || (attempt.status !== 'initial_choice' && attempt.status !== 'candidate_selection')) {
          throw new Error('找不到可選擇的 attempt。')
        }
        const code = `selection-${selectionCounter += 1}`
        selections.set(code, {
          attemptId: input.provisioningAttemptId,
          userId: attempt.userId,
          spreadsheetId: input.spreadsheetId,
          spreadsheetName: input.spreadsheetName,
          modifiedTime: input.modifiedTime,
          expiresAt: currentTime + input.ttlMs,
          consumedAt: null,
        })
        return code
      },
      consumeSheetSelectionToken: async (code: string, expected: { provisioningAttemptId: string; userId: string }) => {
        const selection = selections.get(code)
        const attempt = attempts.get(expected.provisioningAttemptId)
        if (!selection || selection.consumedAt !== null || selection.expiresAt <= currentTime
          || selection.attemptId !== expected.provisioningAttemptId || selection.userId !== expected.userId
          || !attempt || (attempt.status !== 'initial_choice' && attempt.status !== 'candidate_selection'
            && attempt.status !== 'verifying')) {
          return undefined
        }
        selection.consumedAt = currentTime
        return {
          selectionCode: code,
          provisioningAttemptId: selection.attemptId,
          userId: selection.userId,
          spreadsheetId: selection.spreadsheetId,
          spreadsheetName: selection.spreadsheetName,
          modifiedTime: selection.modifiedTime,
          expiresAt: selection.expiresAt,
          consumedAt: selection.consumedAt,
        }
      },
      activateConnection: async (input: {
        userId: string
        spreadsheetId: string
        spreadsheetName?: string
        encryptedRefreshToken: { ciphertext: string; keyVersion: string }
        createdByService?: boolean
      }) => {
        const owner = claims.get(input.spreadsheetId)
        if (owner && owner !== input.userId) throw new Error('資料表已被其他帳號連結。')
        const previous = active.get(input.userId)
        const connection: ActiveSheetConnectionDocument = {
          id: `connection-${input.userId}-${input.spreadsheetId}`,
          userId: input.userId,
          spreadsheetId: input.spreadsheetId,
          spreadsheetName: input.spreadsheetName ?? '每日記事',
          encryptedRefreshToken: input.encryptedRefreshToken,
          scopes: [],
          status: 'active',
          connectionVersion: (previous?.connectionVersion ?? 0) + 1,
          createdByService: input.createdByService ?? false,
          createdAt: currentTime,
          updatedAt: currentTime,
        }
        active.set(input.userId, connection)
        claims.set(input.spreadsheetId, input.userId)
        return connection
      },
      archiveAndActivateConnection: async (input: {
        userId: string
        targetSpreadsheetId: string
        targetSpreadsheetName?: string
        encryptedRefreshToken: { ciphertext: string; keyVersion: string }
        createdByService?: boolean
        expectedOriginalVersion: number
      }) => {
        const current = active.get(input.userId)
        if (!current || current.connectionVersion !== input.expectedOriginalVersion) {
          throw new Error('連線版本不符。')
        }
        const owner = claims.get(input.targetSpreadsheetId)
        if (owner && owner !== input.userId) throw new Error('資料表已被其他帳號連結。')
        const connection: ActiveSheetConnectionDocument = {
          ...current,
          id: `connection-${input.userId}-${input.targetSpreadsheetId}`,
          spreadsheetId: input.targetSpreadsheetId,
          spreadsheetName: input.targetSpreadsheetName ?? '每日記事',
          encryptedRefreshToken: input.encryptedRefreshToken,
          createdByService: input.createdByService ?? false,
          connectionVersion: current.connectionVersion + 1,
          updatedAt: currentTime,
        }
        active.set(input.userId, connection)
        claims.set(input.targetSpreadsheetId, input.userId)
        return connection
      },
      completeProvisioningAttempt: async (input: {
        attemptId: string
        userId: string
        expectedStatus: 'creating' | 'verifying' | 'ready_to_confirm'
        expectedSpreadsheetId: string
        expectedSpreadsheetName: string
        expectedOriginalConnectionVersion: number | null
        journalSessionTtlMs: number
      }) => {
        const attempt = attempts.get(input.attemptId)
        if (!attempt || attempt.userId !== input.userId || attempt.expiresAt <= currentTime
          || attempt.status !== input.expectedStatus || !attempt.tempEncryptedRefreshToken
          || (attempt.selectedSpreadsheetId !== null && attempt.selectedSpreadsheetId !== input.expectedSpreadsheetId)
          || (attempt.selectedSpreadsheetName !== null && attempt.selectedSpreadsheetName !== input.expectedSpreadsheetName)) {
          throw new Error('設定流程已變更。')
        }
        const current = active.get(input.userId)
        if (attempt.mode === 'initial') {
          if (current || input.expectedOriginalConnectionVersion !== null || attempt.originalConnectionVersion !== null) {
            throw new Error('已有作用中的資料表連線。')
          }
        } else if (!current || current.connectionVersion !== input.expectedOriginalConnectionVersion
          || attempt.originalConnectionVersion !== input.expectedOriginalConnectionVersion) {
          throw new Error('連線版本不符。')
        }
        const owner = claims.get(input.expectedSpreadsheetId)
        if (owner && owner !== input.userId) throw new Error('資料表已被其他帳號連結。')
        const connection: ActiveSheetConnectionDocument = {
          id: `connection-${input.userId}-${input.expectedSpreadsheetId}`,
          userId: input.userId,
          spreadsheetId: input.expectedSpreadsheetId,
          spreadsheetName: input.expectedSpreadsheetName,
          encryptedRefreshToken: { ...attempt.tempEncryptedRefreshToken },
          scopes: [...attempt.tempScopes],
          status: 'active',
          connectionVersion: (current?.connectionVersion ?? 0) + 1,
          createdByService: attempt.createdByService,
          createdAt: currentTime,
          updatedAt: currentTime,
        }
        for (const session of sessions.values()) {
          if (session.userId === input.userId && session.revokedAt === null) session.revokedAt = currentTime
        }
        revokedUsers.push(input.userId)
        const journalSession = createSession(input.userId, 'journal')
        Object.assign(attempt, {
          status: 'completed',
          tempEncryptedRefreshToken: null,
          tempScopes: [],
          selectedSpreadsheetId: input.expectedSpreadsheetId,
          selectedSpreadsheetName: input.expectedSpreadsheetName,
          createdByService: connection.createdByService,
          errorCode: null,
          errorMessage: null,
          updatedAt: currentTime,
        })
        active.set(input.userId, connection)
        claims.set(input.expectedSpreadsheetId, input.userId)
        return { connection, journalSession }
      },
      markConnectionNeedsReconnect: async (connectionId: string) => {
        for (const [userId, connection] of active) {
          if (connection.id !== connectionId) continue
          active.set(userId, {
            ...connection,
            status: 'needs_reconnect',
            encryptedRefreshToken: null,
            updatedAt: currentTime,
          } as ActiveSheetConnectionDocument)
        }
      },
      markConnectionNeedsReconnectIfActive: async (input: {
        userId: string
        connectionId: string
        expectedConnectionVersion: number
      }) => {
        if (system.disconnectConflict) return false
        const connection = active.get(input.userId)
        if (!connection || connection.id !== input.connectionId || connection.status !== 'active'
          || connection.connectionVersion !== input.expectedConnectionVersion) {
          return false
        }
        active.set(input.userId, {
          ...connection,
          status: 'needs_reconnect',
          encryptedRefreshToken: null,
          updatedAt: currentTime,
        } as ActiveSheetConnectionDocument)
        return true
      },
      deleteAccountData: async (userId: string) => {
        deletedUsers.push(userId)
      },
    },
    sessions: {
      create: async (input: { userId: string; kind: 'journal' | 'provisioning'; ttlMs: number; provisioningAttemptId?: string }) => {
        const session = createSession(
          input.userId,
          input.kind,
          input.kind === 'provisioning' ? input.provisioningAttemptId : null,
        )
        return { sessionId: session.sessionId, expiresAt: session.expiresAt, session }
      },
      resolveJournalSession: async (sessionId: string) => sessions.get(sessionId),
      resolveProvisioningSession: async (sessionId: string) => sessions.get(sessionId),
      revokeSession: async (sessionId: string) => {
        const session = sessions.get(sessionId)
        if (session) session.revokedAt = currentTime
      },
      revokeUserSessions: async (userId: string) => {
        revokedUsers.push(userId)
        for (const session of sessions.values()) {
          if (session.userId === userId) session.revokedAt = currentTime
        }
      },
    },
    drive: {
      listOwnedSpreadsheets: async () => ({
        items: [...drive.values()],
        ...(system.nextPageToken ? { nextPageToken: system.nextPageToken } : {}),
      }),
      getOwnedSpreadsheet: async (_accessToken: string, spreadsheetId: string) => {
        system.driveGetCalls += 1
        if (system.driveUnavailableAtConfirmation) throw new GoogleConnectionError()
        const item = drive.get(spreadsheetId)
        if (!item) throw new Error('找不到資料表。')
        return item
      },
      deleteSystemCreatedSpreadsheet: async () => {
        system.driveDeleteCalls += 1
        if (system.driveDeleteFailure) throw new Error('Drive 無法刪除。')
      },
    },
    sheets: {
      create: async () => {
        system.sheetCreateCalls += 1
        if (system.createFailure) throw new Error('建立失敗。')
        return { spreadsheetId: 'created-resource' }
      },
      initialize: async () => {
        system.sheetInitializeCalls += 1
        if (system.initializeFailure) throw new Error('不相容。')
        system.sheetWrites += 1
      },
      validateExisting: async () => {
        system.sheetValidationCalls += 1
        if (system.mutateTargetDuringValidation) {
          const attempt = [...attempts.values()].find((current) => current.status === 'ready_to_confirm')
          if (attempt) {
            attempt.selectedSpreadsheetId = 'opaque-resource-c'
            attempt.selectedSpreadsheetName = '另一份資料表'
          }
        }
      },
    },
    claimVerifier: {
      assertTargetAvailable: async (userId: string, spreadsheetId: string) => {
        const owner = claims.get(spreadsheetId)
        if (owner && owner !== userId) throw new Error('資料表已被其他帳號連結。')
      },
    },
    decryptRefreshToken: (value: { ciphertext: string }) => value.ciphertext,
    encryptRefreshToken: (value: string) => ({ ciphertext: value, keyVersion: 'v1' }),
    refreshGoogleCredentials: async () => {
      system.refreshCalls += 1
      return system.refreshedCredentials
    },
    encryptSession: (value: { sessionId: string }) => `opaque-${value.sessionId}`,
    decryptSession: () => undefined,
    clock: () => currentTime,
  }
  const service = new ProvisioningService(dependencies as unknown as ProvisioningServiceDependencies)
  return Object.assign(system, { service })
}

function user(id: string): UserDocument {
  return {
    id,
    googleSub: `sub-${id}`,
    email: `${id}@example.com`,
    name: id,
    picture: '',
    createdAt: 1,
    updatedAt: 1,
  }
}
