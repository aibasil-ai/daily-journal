import { describe, expect, test, vi } from 'vitest'
import { POST as cleanupPost, createCleanupHandler } from './cleanup.js'
import { GET as migrationGet, createLegacyMigrationHandler } from './migrate-legacy-sheet.js'
import { LegacyMigrationError, type CleanupCounts } from '../_lib/legacy-migration.js'

const cronSecret = 'c'.repeat(32)
const migrationSecret = 'm'.repeat(32)

describe('internal maintenance routes', () => {
  test('cleanup 只接受精確的 CRON_SECRET，且拒絕時不執行清理', async () => {
    const cleanup = { cleanup: vi.fn(async (): Promise<CleanupCounts> => emptyCleanupCounts()) }
    const handler = createCleanupHandler({ config: { cronSecret }, cleanup })

    const missing = await handler(new Request('https://journal.example/api/internal/cleanup'))
    const wrong = await handler(new Request('https://journal.example/api/internal/cleanup', {
      headers: { Authorization: `Bearer ${cronSecret}extra` },
    }))
    const sameLengthWrong = await handler(new Request('https://journal.example/api/internal/cleanup', {
      headers: { Authorization: `Bearer x${cronSecret.slice(1)}` },
    }))

    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(sameLengthWrong.status).toBe(401)
    await expect(missing.json()).resolves.toEqual({ error: 'unauthorized' })
    await expect(sameLengthWrong.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(cleanup.cleanup).not.toHaveBeenCalled()
  })

  test('cleanup 成功回應只包含各資料類別的清除數量', async () => {
    const counts: CleanupCounts = {
      oauthAttempts: 2,
      provisioningAttempts: 3,
      selectionCodes: 5,
      rateLimits: 7,
      sessions: 11,
    }
    const cleanup = { cleanup: vi.fn(async () => ({ ...counts, leakedAttemptId: 'attempt-private' })) }
    const handler = createCleanupHandler({ config: { cronSecret }, cleanup })

    const response = await handler(new Request('https://journal.example/api/internal/cleanup', {
      headers: { Authorization: `Bearer ${cronSecret}` },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(counts)
    expect(cleanup.cleanup).toHaveBeenCalledOnce()
  })

  test('legacy migration 只接受精確的管理密鑰，拒絕時不讀取 body 或呼叫服務', async () => {
    const migrate = vi.fn(async () => undefined)
    const handler = createLegacyMigrationHandler({ config: { legacyMigrationSecret: migrationSecret }, migrate })

    const response = await handler(new Request('https://journal.example/api/internal/migrate-legacy-sheet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer x${migrationSecret.slice(1)}`,
      },
      body: 'not json',
    }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(migrate).not.toHaveBeenCalled()
  })

  test('legacy migration 要求精確 googleSub 與完整 Google Sheet URL，成功後不回傳識別碼', async () => {
    const migrate = vi.fn(async () => undefined)
    const handler = createLegacyMigrationHandler({ config: { legacyMigrationSecret: migrationSecret }, migrate })
    const input = {
      googleSub: 'google-sub-1',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/legacy-sheet-1/edit#gid=0',
    }

    const invalid = await handler(migrationRequest({ googleSub: input.googleSub, sheetUrl: 'legacy-sheet-1' }))
    const response = await handler(migrationRequest(input))

    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({ error: 'invalid_request' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ migrated: true })
    expect(migrate).toHaveBeenCalledOnce()
    expect(migrate).toHaveBeenCalledWith(input)
  })

  test('legacy migration 將安全拒絕轉為不含 Sheet、帳號或 token 的回應', async () => {
    const migrate = vi.fn(async () => {
      throw new LegacyMigrationError('migration_rejected')
    })
    const handler = createLegacyMigrationHandler({ config: { legacyMigrationSecret: migrationSecret }, migrate })

    const response = await handler(migrationRequest({
      googleSub: 'google-sub-1',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/private-sheet-id/edit',
    }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body).toEqual({ error: 'migration_rejected' })
    expect(JSON.stringify(body)).not.toContain('private-sheet-id')
  })

  test('internal routes 維持正確 method guard', () => {
    expect(cleanupPost().status).toBe(405)
    expect(cleanupPost().headers.get('Allow')).toBe('GET')
    expect(migrationGet().status).toBe(405)
    expect(migrationGet().headers.get('Allow')).toBe('POST')
  })
})

function emptyCleanupCounts(): CleanupCounts {
  return {
    oauthAttempts: 0,
    provisioningAttempts: 0,
    selectionCodes: 0,
    rateLimits: 0,
    sessions: 0,
  }
}

function migrationRequest(body: Record<string, unknown>): Request {
  return new Request('https://journal.example/api/internal/migrate-legacy-sheet', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${migrationSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
