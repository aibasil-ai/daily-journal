import { describe, expect, test, vi } from 'vitest'
import {
  GoogleConnectionError,
  GoogleDriveClient,
  GoogleUpstreamError,
} from './google-drive'

describe('GoogleDriveClient', () => {
  test('僅列出目前使用者擁有、可編輯且未丟入垃圾桶的 Google Sheet', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      nextPageToken: 'next-page',
      files: [
        spreadsheetFile({ id: 'sheet-ref-a', name: 'Sheet A' }),
        spreadsheetFile({ id: 'sheet-ref-b', ownedByMe: false }),
        spreadsheetFile({ id: 'sheet-ref-c', capabilities: { canEdit: false } }),
        spreadsheetFile({ id: 'sheet-ref-d', trashed: true }),
        spreadsheetFile({ id: 'sheet-ref-e', mimeType: 'text/plain' }),
      ],
    }))
    const client = new GoogleDriveClient(fetchMock as typeof fetch)

    await expect(client.listSpreadsheets('test-token', 'current-page')).resolves.toEqual({
      items: [{ id: 'sheet-ref-a', name: 'Sheet A', modifiedTime: '2026-08-20T00:00:00Z' }],
      nextPageToken: 'next-page',
    })

    const [urlText, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(urlText)
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/files')
    expect(url.searchParams.get('pageSize')).toBe('20')
    expect(url.searchParams.get('corpora')).toBe('user')
    expect(url.searchParams.get('pageToken')).toBe('current-page')
    expect(url.searchParams.get('q')).toContain("mimeType='application/vnd.google-apps.spreadsheet'")
    expect(url.searchParams.get('q')).toContain('trashed=false')
      expect(url.searchParams.get('q')).toContain("'me' in owners")
      expect(url.searchParams.get('fields')).toContain('ownedByMe')
      expect(url.searchParams.get('fields')).toContain('shared')
      expect(url.searchParams.get('fields')).toContain('capabilities(canEdit)')
      expect(init.headers).toEqual({ Authorization: 'Bearer test-token' })
    })

  test.each(['user', 'group', 'domain', 'anyone'])('候選清單排除透過 %s 共用的 Sheet', async (permissionType) => {
    const client = new GoogleDriveClient(vi.fn(async () => jsonResponse({
      files: [spreadsheetFile({
        id: 'sheet-ref-private',
        shared: true,
        permissions: [{ type: permissionType }],
      })],
    })) as typeof fetch)

    await expect(client.listOwnedSpreadsheets('test-token')).resolves.toEqual({ items: [] })
  })

  test('提供列出與取得目前使用者擁有 Sheet 的 canonical 介面', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        files: [spreadsheetFile({ id: 'sheet-ref-a', name: 'Sheet A' })],
      }))
      .mockResolvedValueOnce(jsonResponse(spreadsheetFile({ id: 'sheet-ref-b', name: 'Sheet B' })))
    const client = new GoogleDriveClient(fetchMock as typeof fetch)

    await expect(client.listOwnedSpreadsheets('test-token')).resolves.toEqual({
      items: [{ id: 'sheet-ref-a', name: 'Sheet A', modifiedTime: '2026-08-20T00:00:00Z' }],
    })
    await expect(client.getOwnedSpreadsheet('test-token', 'sheet-ref-b')).resolves.toEqual({
      id: 'sheet-ref-b',
      name: 'Sheet B',
      modifiedTime: '2026-08-20T00:00:00Z',
    })
    const [urlText] = fetchMock.mock.calls[1] as [string]
    expect(new URL(urlText).searchParams.get('fields')).toContain('shared')
  })

  test.each([
    ['非 Google Sheet', spreadsheetFile({ mimeType: 'text/plain' })],
    ['已丟入垃圾桶', spreadsheetFile({ trashed: true })],
    ['非擁有者', spreadsheetFile({ ownedByMe: false })],
    ['不可編輯', spreadsheetFile({ capabilities: { canEdit: false } })],
    ['透過 user 共用', spreadsheetFile({ shared: true, permissions: [{ type: 'user' }] })],
    ['透過 group 共用', spreadsheetFile({ shared: true, permissions: [{ type: 'group' }] })],
    ['透過 domain 共用', spreadsheetFile({ shared: true, permissions: [{ type: 'domain' }] })],
    ['透過 anyone 共用', spreadsheetFile({ shared: true, permissions: [{ type: 'anyone' }] })],
    ['shared=true', spreadsheetFile({ shared: true })],
    ['未明示 shared=false', spreadsheetFile({ shared: undefined })],
  ])('驗證時拒絕%s，且錯誤不洩漏 Sheet ID', async (_reason, file) => {
    const client = new GoogleDriveClient(vi.fn(async () => jsonResponse(file)) as typeof fetch)

    const error = await client.verifySpreadsheet('test-token', 'sheet-ref-private').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GoogleConnectionError)
    expect((error as Error).message).not.toContain('sheet-ref-private')
  })

  test('驗證合格的 Sheet 時只保留伺服器內部必要欄位', async () => {
    const client = new GoogleDriveClient(vi.fn(async () => jsonResponse(spreadsheetFile({
      id: 'sheet-ref-a',
      name: 'Sheet A',
    }))) as typeof fetch)

    await expect(client.verifySpreadsheet('test-token', 'sheet-ref-a')).resolves.toEqual({
      id: 'sheet-ref-a',
      name: 'Sheet A',
      modifiedTime: '2026-08-20T00:00:00Z',
    })
  })

  test('只允許刪除伺服器連線資料明示為系統建立的 Sheet', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    const client = new GoogleDriveClient(fetchMock as typeof fetch)

    const rejected = await client.deleteSystemCreatedSpreadsheet('test-token', {
      spreadsheetId: 'sheet-ref-private',
      createdByService: false,
    }).catch((caught: unknown) => caught)

    expect(rejected).toBeInstanceOf(GoogleConnectionError)
    expect((rejected as Error).message).not.toContain('sheet-ref-private')
    expect(fetchMock).not.toHaveBeenCalled()

    await client.deleteSystemCreatedSpreadsheet('test-token', {
      spreadsheetId: 'sheet-ref-system',
      createdByService: true,
    })

    const [urlText, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(urlText).toBe('https://www.googleapis.com/drive/v3/files/sheet-ref-system')
    expect(init).toEqual({
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-token' },
    })
  })

  test.each([
    [401, GoogleConnectionError],
    [403, GoogleConnectionError],
    [404, GoogleConnectionError],
    [429, GoogleUpstreamError],
    [500, GoogleUpstreamError],
  ])('將 Google HTTP %i 安全分類為可處理錯誤且不洩漏 Sheet ID', async (status, ErrorType) => {
    const client = new GoogleDriveClient(vi.fn(async () => new Response(null, { status })) as typeof fetch)

    const error = await client.getOwnedSpreadsheet('test-token', 'sheet-ref-private').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ErrorType)
    expect((error as Error).message).not.toContain('sheet-ref-private')
  })

  test('將網路錯誤分類為可安全重試的上游錯誤且不洩漏 Sheet ID', async () => {
    const client = new GoogleDriveClient(vi.fn(async () => {
      throw new TypeError('network failure')
    }) as typeof fetch)

    const error = await client.getOwnedSpreadsheet('test-token', 'sheet-ref-private').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GoogleUpstreamError)
    expect((error as Error).message).not.toContain('sheet-ref-private')
  })
})

function spreadsheetFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sheet-ref-default',
    name: 'Sheet',
    modifiedTime: '2026-08-20T00:00:00Z',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    trashed: false,
    ownedByMe: true,
    shared: false,
    capabilities: { canEdit: true },
    ...overrides,
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  })
}
