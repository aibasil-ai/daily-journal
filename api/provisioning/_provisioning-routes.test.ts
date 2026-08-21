import { describe, expect, test, vi } from 'vitest'
import { PROVISIONING_COOKIE_NAME, SESSION_COOKIE_NAME } from '../_lib/cookies.js'
import { ProvisioningServiceError, type JournalProvisioningContext, type ProvisioningSessionContext } from '../_lib/provisioning-service.js'
import { createProvisioningCreateHandler, GET as createGet } from './create.js'
import { createProvisioningSheetsHandler, POST as sheetsPost } from './sheets.js'
import { createStartChangeHandler, GET as startChangeGet } from './start-change.js'
import { createProvisioningStatusHandler, POST as statusPost } from './status.js'

const config = {
  appOrigin: 'https://journal.example',
  sessionEncryptionKey: Buffer.alloc(32, 7),
}

describe('provisioning routes', () => {
  test('候選 route 只接受 provisioning session，限制 query 並維持安全候選 payload', async () => {
    const service = fakeService()
    const handler = createProvisioningSheetsHandler({ config, service, rateLimiter: rateLimiter() })

    const tooShort = await handler(new Request('https://journal.example/api/provisioning/sheets?q=日'))
    expect(tooShort.status).toBe(400)
    await expect(tooShort.json()).resolves.toEqual({ error: 'invalid_request' })

    const response = await handler(new Request('https://journal.example/api/provisioning/sheets?q=日記'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      items: [{ selectionCode: 'opaque-choice', name: '我的日記', modifiedTime: '2026-08-20T00:00:00.000Z' }],
      nextCursor: null,
    })
    expect(service.requireProvisioningContext).toHaveBeenCalledOnce()
    expect(service.listCandidateSheets).toHaveBeenCalledWith(
      expect.anything(),
      { query: '日記', cursor: null },
    )
    expect(JSON.stringify(body)).not.toContain('resource')
  })

  test('建立 route 要求 JSON 與同源 Origin，成功時只輪替 provisioning cookie', async () => {
    const service = fakeService()
    const handler = createProvisioningCreateHandler({ config, service, rateLimiter: rateLimiter() })

    const wrongContentType = await handler(new Request('https://journal.example/api/provisioning/create', {
      method: 'POST',
      body: '{}',
    }))
    expect(wrongContentType.status).toBe(415)

    const wrongOrigin = await handler(new Request('https://journal.example/api/provisioning/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
      body: '{}',
    }))
    expect(wrongOrigin.status).toBe(403)

    const response = await handler(new Request('https://journal.example/api/provisioning/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: '{}',
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Set-Cookie')).toContain(`${PROVISIONING_COOKIE_NAME}=;`)
    expect(response.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE_NAME}=opaque-journal-session`)
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Lax; Path=/')
    expect(response.headers.get('Set-Cookie')).not.toContain('sealed')
    expect(response.headers.get('Set-Cookie')).not.toContain('resource')
  })

  test('換表起始只接受 journal session，保留 journal cookie 並建立安全 provisioning cookie', async () => {
    const service = fakeService()
    const handler = createStartChangeHandler({ config, service, rateLimiter: rateLimiter() })

    const response = await handler(new Request('https://journal.example/api/provisioning/start-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: '{}',
    }))

    expect(response.status).toBe(200)
    expect(service.requireJournalContext).toHaveBeenCalledOnce()
    expect(service.requireProvisioningContext).not.toHaveBeenCalled()
    expect(response.headers.get('Set-Cookie')).toContain(`${PROVISIONING_COOKIE_NAME}=opaque-change-session`)
    expect(response.headers.get('Set-Cookie')).not.toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Lax; Path=/')
  })

  test('失效 provisioning session 僅清除 provisioning cookie，並保留 journal cookie', async () => {
    const service = fakeService()
    service.requireProvisioningContext.mockRejectedValueOnce(new ProvisioningServiceError(
      'unauthenticated',
      401,
      'provisioning',
    ))
    const handler = createProvisioningSheetsHandler({ config, service, rateLimiter: rateLimiter() })

    const response = await handler(new Request('https://journal.example/api/provisioning/sheets?q=日記'))

    expect(response.status).toBe(401)
    expect(response.headers.get('Set-Cookie')).toContain(`${PROVISIONING_COOKIE_NAME}=;`)
    expect(response.headers.get('Set-Cookie')).not.toContain(`${SESSION_COOKIE_NAME}=;`)
  })

  test('status route 僅輸出 ProvisioningStatus 欄位，不含資源或憑證識別資訊', async () => {
    const service = fakeService()
    const handler = createProvisioningStatusHandler({ service })

    const response = await handler(new Request('https://journal.example/api/provisioning/status'))
    const body = await response.json() as Record<string, unknown>

    expect(Object.keys(body).sort()).toEqual([
      'canDeleteActiveSystemSheet',
      'connectionVersion',
      'errorCode',
      'lastUpdatedAt',
      'phase',
      'sheetName',
    ])
    expect(JSON.stringify(body)).not.toContain('opaque-resource-a')
    expect(JSON.stringify(body)).not.toContain('sealed-a')
  })

  test('所有 route 保留正確 method guard', () => {
    expect(createGet().status).toBe(405)
    expect(createGet().headers.get('Allow')).toBe('POST')
    expect(sheetsPost().status).toBe(405)
    expect(sheetsPost().headers.get('Allow')).toBe('GET')
    expect(startChangeGet().status).toBe(405)
    expect(startChangeGet().headers.get('Allow')).toBe('POST')
    expect(statusPost().status).toBe(405)
    expect(statusPost().headers.get('Allow')).toBe('GET')
  })
})

function fakeService() {
  const provisioning: ProvisioningSessionContext = {
    session: {
      sessionId: 'provisioning-session',
      userId: 'user-a',
      kind: 'provisioning',
      expiresAt: Date.now() + 60_000,
      createdAt: 1,
      lastUsedAt: 1,
      revokedAt: null,
      provisioningAttemptId: 'attempt-a',
    },
    attempt: {
      id: 'attempt-a',
      userId: 'user-a',
      mode: 'initial',
      originalConnectionVersion: null,
      tempEncryptedRefreshToken: { ciphertext: 'sealed-a', keyVersion: 'v1' },
      tempScopes: [],
      selectedSpreadsheetId: null,
      selectedSpreadsheetName: null,
      createdByService: false,
      status: 'initial_choice',
      expiresAt: Date.now() + 60_000,
      errorCode: null,
      errorMessage: null,
      createdAt: 1,
      updatedAt: 1,
    },
  }
  const journal: JournalProvisioningContext = {
    session: { ...provisioning.session, sessionId: 'journal-session', kind: 'journal', provisioningAttemptId: null },
    user: {
      id: 'user-a',
      googleSub: 'sub-a',
      email: 'a@example.com',
      name: 'A',
      picture: '',
      createdAt: 1,
      updatedAt: 1,
    },
    connection: {
      id: 'connection-a',
      userId: 'user-a',
      spreadsheetId: 'opaque-resource-a',
      spreadsheetName: '我的日記',
      encryptedRefreshToken: { ciphertext: 'sealed-a', keyVersion: 'v1' },
      scopes: [],
      status: 'active',
      connectionVersion: 1,
      createdByService: false,
      createdAt: 1,
      updatedAt: 1,
    },
  }
  const status = {
    phase: 'completed' as const,
    sheetName: '我的日記',
    lastUpdatedAt: 1,
    connectionVersion: 1,
    canDeleteActiveSystemSheet: false,
    errorCode: null,
  }
  return {
    requireProvisioningContext: vi.fn(async () => provisioning),
    requireJournalContext: vi.fn(async () => journal),
    listCandidateSheets: vi.fn(async () => ({
      items: [{ selectionCode: 'opaque-choice', name: '我的日記', modifiedTime: '2026-08-20T00:00:00.000Z' }],
      nextCursor: null,
    })),
    createSheet: vi.fn(async () => ({
      status,
      journalSession: { sessionId: 'journal-session', expiresAt: Date.now() + 60_000, kind: 'journal' as const, userId: 'user-a' },
    })),
    startChange: vi.fn(async () => ({
      status: { ...status, phase: 'initial_choice' as const },
      provisioningSession: { sessionId: 'change-session', expiresAt: Date.now() + 60_000, kind: 'provisioning' as const, userId: 'user-a' },
    })),
    getStatus: vi.fn(async () => ({ status, cookies: [] })),
    createSessionCookie: vi.fn((session: { sessionId: string }) => `daily_journal_session=opaque-${session.sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1`),
    createProvisioningCookie: vi.fn((session: { sessionId: string }) => `daily_journal_provisioning=opaque-${session.sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1`),
  }
}

function rateLimiter() {
  return { consume: vi.fn(async () => undefined) }
}
