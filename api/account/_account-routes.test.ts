import { describe, expect, test, vi } from 'vitest'
import { PROVISIONING_COOKIE_NAME, SESSION_COOKIE_NAME } from '../_lib/cookies.js'
import { ProvisioningServiceError, type JournalProvisioningContext } from '../_lib/provisioning-service.js'
import { createDeleteAccountHandler, GET as deleteGet } from './delete.js'
import { createDisconnectHandler, GET as disconnectGet } from './disconnect.js'

const config = { appOrigin: 'https://journal.example' }

describe('account lifecycle routes', () => {
  test('中斷連線只接受 journal session，成功後清除兩種安全 cookie', async () => {
    const service = fakeService()
    const handler = createDisconnectHandler({ config, service, rateLimiter: rateLimiter() })

    const response = await handler(new Request('https://journal.example/api/account/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: '{}',
    }))

    expect(response.status).toBe(204)
    expect(service.requireJournalContext).toHaveBeenCalledOnce()
    expect(service.disconnect).toHaveBeenCalledWith(expect.anything())
    expect(response.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(response.headers.get('Set-Cookie')).toContain(`${PROVISIONING_COOKIE_NAME}=;`)
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Lax; Path=/')
  })

  test('刪帳號要求 JSON、同源 Origin 與精確確認文字，預設保留 Google Sheet', async () => {
    const service = fakeService()
    const handler = createDeleteAccountHandler({ config, service, rateLimiter: rateLimiter() })

    const invalid = await handler(new Request('https://journal.example/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: JSON.stringify({ deleteSystemCreatedSheet: false, confirmation: '刪除帳號' }),
    }))
    expect(invalid.status).toBe(400)
    expect(service.deleteAccount).not.toHaveBeenCalled()

    const response = await handler(new Request('https://journal.example/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: JSON.stringify({ deleteSystemCreatedSheet: false, confirmation: '刪除我的帳號' }),
    }))
    expect(response.status).toBe(204)
    expect(service.deleteAccount).toHaveBeenCalledWith(expect.anything(), {
      deleteSystemCreatedSheet: false,
      confirmation: '刪除我的帳號',
    })
    expect(response.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(response.headers.get('Set-Cookie')).toContain(`${PROVISIONING_COOKIE_NAME}=;`)
  })

  test('journal session 失效只清除 journal cookie，錯誤不洩漏帳號或資料表資訊', async () => {
    const service = fakeService()
    service.requireJournalContext.mockRejectedValueOnce(new ProvisioningServiceError(
      'unauthenticated',
      401,
      'journal',
    ))
    const handler = createDisconnectHandler({ config, service, rateLimiter: rateLimiter() })

    const response = await handler(new Request('https://journal.example/api/account/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: '{}',
    }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(response.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(response.headers.get('Set-Cookie')).not.toContain(`${PROVISIONING_COOKIE_NAME}=;`)
  })

  test('中斷連線遇到換表競態時只回傳安全 conflict payload，且不清除新 session cookie', async () => {
    const service = fakeService()
    service.disconnect.mockRejectedValueOnce(new ProvisioningServiceError('connection_conflict', 409))
    const handler = createDisconnectHandler({ config, service, rateLimiter: rateLimiter() })

    const response = await handler(new Request('https://journal.example/api/account/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: '{}',
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'connection_conflict' })
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  test('route 保留正確 method guard', () => {
    expect(disconnectGet().status).toBe(405)
    expect(disconnectGet().headers.get('Allow')).toBe('POST')
    expect(deleteGet().status).toBe(405)
    expect(deleteGet().headers.get('Allow')).toBe('POST')
  })
})

function fakeService() {
  const context: JournalProvisioningContext = {
    session: {
      sessionId: 'journal-session',
      userId: 'user-a',
      kind: 'journal',
      expiresAt: Date.now() + 60_000,
      createdAt: 1,
      lastUsedAt: 1,
      revokedAt: null,
      provisioningAttemptId: null,
    },
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
  return {
    requireJournalContext: vi.fn(async () => context),
    disconnect: vi.fn(async () => undefined),
    deleteAccount: vi.fn(async () => undefined),
  }
}

function rateLimiter() {
  return { consume: vi.fn(async () => undefined) }
}
