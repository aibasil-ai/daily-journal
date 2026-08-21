import { describe, expect, test, vi } from 'vitest'
import {
  GoogleConnectionError,
  GoogleUpstreamError,
} from './google-drive'
import { GoogleSheetsClient } from './google-sheets'

describe('GoogleSheetsClient', () => {
  test('以 Bearer token 呼叫 Sheets REST API，並保留必要中繼資料', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      spreadsheetId: 'sheet-ref-a',
      properties: { title: 'Sheet A', timeZone: 'Asia/Taipei' },
      sheets: [{ properties: { sheetId: 7, title: 'entries', sheetType: 'GRID' } }],
    }))
    const client = new GoogleSheetsClient(fetchMock as typeof fetch)

    await expect(client.getSpreadsheet('test-token', 'sheet-ref-a')).resolves.toMatchObject({
      spreadsheetId: 'sheet-ref-a',
      properties: { title: 'Sheet A', timeZone: 'Asia/Taipei' },
      sheets: [{ properties: { sheetId: 7, title: 'entries' } }],
    })

    const [urlText, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(urlText).toContain('/v4/spreadsheets/sheet-ref-a')
    expect(init.headers).toEqual({ Authorization: 'Bearer test-token' })
  })

  test('讀取 grid data 時要求並保留安全驗證所需的工作表結構 metadata', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      spreadsheetId: 'sheet-ref-a',
      properties: { title: 'Sheet A', timeZone: 'Asia/Taipei' },
      sheets: [{
        properties: {
          sheetId: 7,
          title: 'entries',
          sheetType: 'GRID',
          gridProperties: { frozenRowCount: 1 },
        },
        data: [{
          startRow: 1,
          startColumn: 9,
          rowData: [{ values: [{
            userEnteredValue: { stringValue: 'outside-schema' },
            pivotTable: {},
          }] }],
        }],
        merges: [{}],
        conditionalFormats: [{}],
        filterViews: [{}],
        protectedRanges: [{}],
        basicFilter: {},
        charts: [{}],
        bandedRanges: [{}],
        developerMetadata: [{}],
        rowGroups: [{}],
        columnGroups: [{}],
        slicers: [{}],
        tables: [{}],
      }],
    }))
    const client = new GoogleSheetsClient(fetchMock as typeof fetch)

    await expect(client.getSpreadsheet('test-token', 'sheet-ref-a', { includeGridData: true })).resolves.toMatchObject({
      sheets: [{
        data: [{
          startRow: 1,
          startColumn: 9,
          rowData: [{ values: [{
            userEnteredValue: { stringValue: 'outside-schema' },
            pivotTable: {},
          }] }],
        }],
        properties: { gridProperties: { frozenRowCount: 1 } },
        merges: [{}],
        conditionalFormats: [{}],
        filterViews: [{}],
        protectedRanges: [{}],
        basicFilter: {},
        charts: [{}],
        bandedRanges: [{}],
        developerMetadata: [{}],
        rowGroups: [{}],
        columnGroups: [{}],
        slicers: [{}],
        tables: [{}],
      }],
    })

    const [urlText] = fetchMock.mock.calls[0] as [string, RequestInit]
    const params = new URL(urlText).searchParams
    const fields = params.get('fields') ?? ''
    expect(params.get('includeGridData')).toBe('true')
    for (const field of [
      'properties(sheetId,title,sheetType,gridProperties(frozenRowCount',
      'data(startRow,startColumn,rowData(values(userEnteredValue,userEnteredFormat,note,dataValidation,textFormatRuns,pivotTable',
      'merges',
      'conditionalFormats',
      'filterViews',
      'protectedRanges',
      'basicFilter',
      'charts',
      'bandedRanges',
      'developerMetadata',
      'rowGroups',
      'columnGroups',
      'slicers',
      'tables',
    ]) {
      expect(fields).toContain(field)
    }
  })

  test('建立試算表、批次讀取與 batchUpdate 均使用 REST 端點', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        spreadsheetId: 'sheet-ref-new',
        properties: { title: 'Sheet A', timeZone: 'Asia/Taipei' },
        sheets: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        valueRanges: [{ range: 'entries!1:1', values: [['id']] }],
      }))
      .mockResolvedValueOnce(jsonResponse({ replies: [] }))
    const client = new GoogleSheetsClient(fetchMock as typeof fetch)

    await expect(client.createSpreadsheet('test-token', 'Sheet A')).resolves.toMatchObject({
      spreadsheetId: 'sheet-ref-new',
      properties: { title: 'Sheet A' },
    })
    await expect(client.batchGet('test-token', 'sheet-ref-new', ['entries!1:1'])).resolves.toEqual([
      { range: 'entries!1:1', values: [['id']] },
    ])
    await client.batchUpdate('test-token', 'sheet-ref-new', [{ addSheet: { properties: { title: 'entries' } } }])

    const [createUrl, createInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(createUrl).toBe('https://sheets.googleapis.com/v4/spreadsheets')
    expect(createInit.headers).toEqual({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(createInit.body as string)).toEqual({ properties: { title: 'Sheet A' } })

    const [readUrl, readInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(readUrl).toContain('/values:batchGet?')
    expect(new URL(readUrl).searchParams.getAll('ranges')).toEqual(['entries!1:1'])
    expect(readInit.headers).toEqual({ Authorization: 'Bearer test-token' })

    const [writeUrl, writeInit] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(writeUrl).toBe('https://sheets.googleapis.com/v4/spreadsheets/sheet-ref-new:batchUpdate')
    expect(JSON.parse(writeInit.body as string)).toEqual({
      requests: [{ addSheet: { properties: { title: 'entries' } } }],
    })
  })

  test.each([
    [401, GoogleConnectionError],
    [403, GoogleConnectionError],
    [429, GoogleUpstreamError],
    [500, GoogleUpstreamError],
  ])('將 Sheets HTTP %i 分類為安全錯誤', async (status, ErrorType) => {
    const client = new GoogleSheetsClient(vi.fn(async () => new Response(null, { status })) as typeof fetch)

    await expect(client.getSpreadsheet('test-token', 'sheet-ref-a')).rejects.toBeInstanceOf(ErrorType)
  })

  test('將 Sheets 網路錯誤分類為可安全重試的上游錯誤', async () => {
    const client = new GoogleSheetsClient(vi.fn(async () => {
      throw new TypeError('network failure')
    }) as typeof fetch)

    await expect(client.getSpreadsheet('test-token', 'sheet-ref-a')).rejects.toBeInstanceOf(GoogleUpstreamError)
  })
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  })
}
