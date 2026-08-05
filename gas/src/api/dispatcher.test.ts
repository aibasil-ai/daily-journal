// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { JournalServiceError } from '../services/journal-service'
import { JournalSetupError } from '../domain/errors'
import { executeAppRequest } from './dispatcher'

describe('executeAppRequest', () => {
  test('將 bootstrap 請求分派至 JournalService 並回傳資料', () => {
    const service = journalService({ bootstrap: vi.fn(() => ({ timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] })) })

    expect(executeAppRequest({ action: 'bootstrap' }, service)).toEqual({
      ok: true,
      data: { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] },
    })
  })

  test.each([
    [{ action: 'listEntries', filter: listFilter }, 'listEntries', 'list'],
    [{ action: 'getEntriesForDate', date: '2026-08-04', filter: searchFilter }, 'getEntriesForDate', 'date'],
    [{ action: 'getMonthlyEntryCounts', year: 2026, month: 8, filter: searchFilter }, 'getMonthlyEntryCounts', 'month'],
    [{ action: 'saveEntry', entry: entry }, 'saveEntry', 'entry'],
    [{ action: 'deleteEntry', id: 'entry-1' }, 'deleteEntry', null],
    [{ action: 'saveCategory', category: { name: '生活' } }, 'saveCategory', 'category'],
    [{ action: 'deactivateCategory', id: 'category-1' }, 'deactivateCategory', 'category'],
    [{ action: 'exportEntries', filter: searchFilter }, 'exportEntries', 'export'],
  ] as const)('將 %s 分派至對應服務方法', (request, method, expected) => {
    const service = journalService({ [method]: vi.fn(() => expected) })

    expect(executeAppRequest(request, service)).toEqual({ ok: true, data: expected })
  })

  test('未知 action 回傳固定錯誤，不執行服務', () => {
    const bootstrap = vi.fn()

    expect(executeAppRequest({ action: 'unknown' } as never, journalService({ bootstrap }))).toEqual({
      ok: false,
      code: 'INVALID_ACTION',
      message: '不支援的操作。',
    })
    expect(bootstrap).not.toHaveBeenCalled()
  })

  test('將可預期服務錯誤轉為結構化繁中回應', () => {
    const service = journalService({ bootstrap: () => { throw new JournalServiceError('請先完成初始化。') } })

    expect(executeAppRequest({ action: 'bootstrap' }, service)).toEqual({
      ok: false,
      code: 'REQUEST_ERROR',
      message: '請先完成初始化。',
    })
  })

  test('將預期的部署與工作表設定錯誤轉為可操作回應', () => {
    const service = journalService({ bootstrap: () => { throw new JournalSetupError('找不到 SPREADSHEET_ID。請在 Apps Script「專案設定」>「指令碼屬性」新增 SPREADSHEET_ID，填入 Google Sheets ID 後再執行 initializeJournal。') } })

    expect(executeAppRequest({ action: 'bootstrap' }, service)).toEqual({
      ok: false,
      code: 'REQUEST_ERROR',
      message: '找不到 SPREADSHEET_ID。請在 Apps Script「專案設定」>「指令碼屬性」新增 SPREADSHEET_ID，填入 Google Sheets ID 後再執行 initializeJournal。',
    })
  })

  test('未預期錯誤不洩漏內部訊息', () => {
    const service = journalService({ bootstrap: () => { throw new Error('database secret') } })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(executeAppRequest({ action: 'bootstrap' }, service)).toEqual({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: '處理資料時發生錯誤，請稍後再試。',
    })
    expect(error).toHaveBeenCalledWith('executeAppRequest 失敗：', expect.any(Error))
  })
})

const searchFilter = { query: '', from: null, to: null, categoryId: null, tag: null }
const listFilter = { ...searchFilter, cursor: null, limit: 20 }
const entry = { entryDate: '2026-08-04', title: '每日記事', content: '內容', categoryId: 'category-1', tags: [], links: [] }

function journalService(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    bootstrap: () => undefined,
    listEntries: () => undefined,
    getEntriesForDate: () => undefined,
    getMonthlyEntryCounts: () => undefined,
    saveEntry: () => undefined,
    deleteEntry: () => undefined,
    saveCategory: () => undefined,
    deactivateCategory: () => undefined,
    exportEntries: () => undefined,
    ...overrides,
  } as never
}
