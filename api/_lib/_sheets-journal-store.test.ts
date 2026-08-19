import { describe, expect, test, vi } from 'vitest'
import { SheetsClient } from './sheets-client'
import { SheetsJournalStore } from './sheets-journal-store'
import { JournalError } from '../../shared/journal/errors'

describe('SheetsJournalStore', () => {
  test('ensureSchema 建立缺失的工作表並寫入標題列與 schemaVersion', async () => {
    let requestsSent: unknown[] = []
    let valuesUpdated: unknown[] = []

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/values:batchUpdate')) {
        const body = JSON.parse(init?.body as string) as { data: unknown[] }
        valuesUpdated.push(...body.data)
        return new Response(JSON.stringify({}))
      }
      if (url.includes(':batchUpdate')) {
        const body = JSON.parse(init?.body as string) as { requests: unknown[] }
        requestsSent.push(...body.requests)
        return new Response(JSON.stringify({}))
      }
      if (url.includes('/values:batchGet')) {
        return new Response(JSON.stringify({ valueRanges: [] }))
      }
      // getSpreadsheet
      return new Response(JSON.stringify({
        spreadsheetId: 'sheet-1',
        properties: { title: '我的日記', timeZone: 'Asia/Taipei' },
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
      }))
    })

    const client = new SheetsClient(fetchMock as typeof fetch)
    await SheetsJournalStore.ensureSchema(client, 'sheet-1', 'token')

    expect(requestsSent).toEqual(expect.arrayContaining([
      { addSheet: { properties: { title: 'entries' } } },
      { addSheet: { properties: { title: 'categories' } } },
      { addSheet: { properties: { title: 'settings' } } },
    ]))
    expect(valuesUpdated).toEqual(expect.arrayContaining([
      expect.objectContaining({ range: 'entries!A1:I1' }),
      expect.objectContaining({ range: 'categories!A1:E1' }),
      expect.objectContaining({ range: 'settings!A1:B2' }),
    ]))
  })

  test('verifySchema 驗證合格結構，遇到缺表或標題不符時拋出 SCHEMA_MISMATCH', async () => {
    const validFetchMock = vi.fn(async (url: string) => {
      if (url.includes('/values:batchGet')) {
        return new Response(JSON.stringify({
          valueRanges: [
            { range: 'entries!A1:I1', values: [['id', 'entryDate', 'title', 'content', 'categoryId', 'tags', 'links', 'createdAt', 'updatedAt']] },
            { range: 'categories!A1:E1', values: [['id', 'name', 'isActive', 'createdAt', 'updatedAt']] },
            { range: 'settings!A1:B', values: [['key', 'value'], ['schemaVersion', '1']] },
          ],
        }))
      }
      return new Response(JSON.stringify({
        spreadsheetId: 'sheet-1',
        properties: { title: '我的日記', timeZone: 'Asia/Taipei' },
        sheets: [
          { properties: { sheetId: 0, title: 'entries' } },
          { properties: { sheetId: 1, title: 'categories' } },
          { properties: { sheetId: 2, title: 'settings' } },
        ],
      }))
    })

    const client = new SheetsClient(validFetchMock as typeof fetch)
    await expect(SheetsJournalStore.verifySchema(client, 'sheet-1', 'token')).resolves.toBeUndefined()

    // Missing sheet test
    const missingSheetFetchMock = vi.fn(async () => new Response(JSON.stringify({
      spreadsheetId: 'sheet-1',
      properties: { title: '我的日記' },
      sheets: [{ properties: { sheetId: 0, title: 'entries' } }],
    })))
    const brokenClient = new SheetsClient(missingSheetFetchMock as typeof fetch)
    await expect(SheetsJournalStore.verifySchema(brokenClient, 'sheet-1', 'token'))
      .rejects.toBeInstanceOf(JournalError)
  })

  test('load 載入所有分類與記事並支援同步操作與 flush 回寫', async () => {
    let updatedValues: unknown[] = []

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/values:batchUpdate')) {
        const body = JSON.parse(init?.body as string) as { data: unknown[] }
        updatedValues = body.data
        return new Response(JSON.stringify({}))
      }
      if (url.includes('/values:batchGet')) {
        if (decodeURIComponent(url).includes('A1:I1')) {
          return new Response(JSON.stringify({
            valueRanges: [
              { range: 'entries!A1:I1', values: [['id', 'entryDate', 'title', 'content', 'categoryId', 'tags', 'links', 'createdAt', 'updatedAt']] },
              { range: 'categories!A1:E1', values: [['id', 'name', 'isActive', 'createdAt', 'updatedAt']] },
              { range: 'settings!A1:B', values: [['key', 'value'], ['schemaVersion', '1']] },
            ],
          }))
        }
        return new Response(JSON.stringify({
          valueRanges: [
            {
              range: 'entries!A2:I',
              values: [
                ['e1', '2026-08-19', '標題一', '內容一', 'cat-1', '["工作"]', '[{"label":"連結","url":"https://example.com"}]', '2026-08-19T00:00:00Z', '2026-08-19T00:00:00Z'],
              ],
            },
            {
              range: 'categories!A2:E',
              values: [
                ['cat-1', '日常', 'true', '2026-08-19T00:00:00Z', '2026-08-19T00:00:00Z'],
              ],
            },
          ],
        }))
      }
      return new Response(JSON.stringify({
        spreadsheetId: 'sheet-1',
        properties: { title: '我的日記', timeZone: 'Asia/Taipei' },
        sheets: [
          { properties: { sheetId: 0, title: 'entries' } },
          { properties: { sheetId: 1, title: 'categories' } },
          { properties: { sheetId: 2, title: 'settings' } },
        ],
      }))
    })

    const client = new SheetsClient(fetchMock as typeof fetch)
    const store = await SheetsJournalStore.load(client, 'sheet-1', 'token')

    expect(store.getTimezone()).toBe('Asia/Taipei')
    expect(store.listCategories()).toHaveLength(1)
    expect(store.listEntries()).toHaveLength(1)
    expect(store.getEntry('e1')).toMatchObject({
      id: 'e1',
      title: '標題一',
      tags: ['工作'],
      links: [{ label: '連結', url: 'https://example.com' }],
    })

    // Add entry & flush
    store.saveEntry({
      id: 'e2',
      entryDate: '2026-08-19',
      title: '標題二',
      content: '內容二',
      categoryId: 'cat-1',
      tags: [],
      links: [],
      createdAt: '2026-08-19T01:00:00Z',
      updatedAt: '2026-08-19T01:00:00Z',
    })

    await store.flush(client, 'sheet-1', 'token')

    expect(updatedValues).toHaveLength(2)
    expect(store.listEntries()).toHaveLength(2)
  })
})
