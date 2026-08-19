import { describe, expect, test, vi } from 'vitest'
import { DriveClient } from './drive-client'

describe('DriveClient', () => {
  test('列出候選 Google Sheets', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      files: [
        { id: 'sheet-1', name: '2026 日記', modifiedTime: '2026-08-19T00:00:00Z' },
        { id: 'sheet-2', name: '工作日記', modifiedTime: '2026-08-18T00:00:00Z' },
      ],
    })))

    const client = new DriveClient(fetchMock as typeof fetch)
    const files = await client.listCandidateSpreadsheets('test-token')

    expect(files).toHaveLength(2)
    expect(files[0]).toEqual({
      id: 'sheet-1',
      name: '2026 日記',
      modifiedTime: '2026-08-19T00:00:00Z',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://www.googleapis.com/drive/v3/files'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
  })

  test('建立新試算表並初始化三張工作表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      spreadsheetId: 'new-sheet-id',
      properties: { title: '我的新日記' },
    })))

    const client = new DriveClient(fetchMock as typeof fetch)
    const created = await client.createSpreadsheet('test-token', '我的新日記')

    expect(created).toEqual({
      id: 'new-sheet-id',
      name: '我的新日記',
    })
    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(options.body as string)).toMatchObject({
      properties: { title: '我的新日記' },
      sheets: [
        { properties: { title: 'entries' } },
        { properties: { title: 'categories' } },
        { properties: { title: 'settings' } },
      ],
    })
  })
})