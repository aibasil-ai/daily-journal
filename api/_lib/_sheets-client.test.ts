import { describe, expect, test, vi } from 'vitest'
import { SheetsClient } from './sheets-client'

describe('SheetsClient', () => {
  test('讀取試算表中繼資料', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      spreadsheetId: 'sheet-123',
      properties: { title: '我的日記', timeZone: 'Asia/Taipei' },
      sheets: [
        { properties: { sheetId: 0, title: 'entries' } },
        { properties: { sheetId: 1, title: 'categories' } },
      ],
    })))

    const client = new SheetsClient(fetchMock as typeof fetch)
    const meta = await client.getSpreadsheet('token', 'sheet-123')

    expect(meta.properties.timeZone).toBe('Asia/Taipei')
    expect(meta.sheets).toHaveLength(2)
  })

  test('batchGet 批次讀取範圍資料', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      valueRanges: [
        { range: 'entries!A1:I', values: [['id', 'entryDate']] },
        { range: 'categories!A1:E', values: [['id', 'name']] },
      ],
    })))

    const client = new SheetsClient(fetchMock as typeof fetch)
    const ranges = await client.batchGet('token', 'sheet-123', ['entries!A1:I', 'categories!A1:E'])

    expect(ranges).toHaveLength(2)
    expect(ranges[0].values).toEqual([['id', 'entryDate']])
  })

  test('batchUpdateValues 批次寫入資料', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({})))
    const client = new SheetsClient(fetchMock as typeof fetch)

    await client.batchUpdateValues('token', 'sheet-123', [
      { range: 'entries!A2:I2', values: [['e1', '2026-08-19']] },
    ])

    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(options.body as string)).toMatchObject({
      valueInputOption: 'USER_ENTERED',
      data: [{ range: 'entries!A2:I2', values: [['e1', '2026-08-19']] }],
    })
  })

  test('batchUpdate 發送結構更新 requests', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({})))
    const client = new SheetsClient(fetchMock as typeof fetch)

    await client.batchUpdate('token', 'sheet-123', [
      { addSheet: { properties: { title: 'settings' } } },
    ])

    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(options.body as string)).toMatchObject({
      requests: [{ addSheet: { properties: { title: 'settings' } } }],
    })
  })
})
