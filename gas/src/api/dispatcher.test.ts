import { describe, expect, it, vi } from 'vitest'
import { executeAppRequest } from './dispatcher'
import type { Category } from '../domain/journal'
import { FakeJournalStore } from '../test/fake-journal-store'
import { JournalService } from '../services/journal-service'

const timestamp = '2026-08-04T12:00:00+08:00'

describe('executeAppRequest', () => {
  it('未知 action 回傳固定錯誤且不執行服務', () => {
    const service = { bootstrap: vi.fn() } as unknown as JournalService

    expect(executeAppRequest({ action: 'unknown' } as never, service)).toEqual({
      ok: false,
      code: 'INVALID_ACTION',
      message: '不支援的操作。',
    })
    expect(service.bootstrap).not.toHaveBeenCalled()
  })

  it('將支援 action 導向服務並回傳 JSON 資料', () => {
    const response = executeAppRequest({ action: 'bootstrap' }, service())

    expect(response).toEqual({
      ok: true,
      data: {
        timezone: 'Asia/Taipei',
        categories: [expect.objectContaining({ id: 'work' })],
        tagSuggestions: [],
      },
    })
  })

  it('允許類別管理讀取全部分類', () => {
    expect(executeAppRequest({ action: 'listCategories' }, service())).toEqual({
      ok: true,
      data: [expect.objectContaining({ id: 'work' })],
    })
  })

  it('回傳月曆顯示所需的每日記事', () => {
    expect(executeAppRequest({
      action: 'getMonthlyEntries',
      year: 2026,
      month: 8,
      filter: { query: '', from: null, to: null, categoryId: null, tag: null },
    }, service())).toEqual({
      ok: true,
      data: [],
    })
  })

  it('允許重新啟用停用分類', () => {
    const journalService = service()
    journalService.deactivateCategory('work')

    expect(executeAppRequest({ action: 'activateCategory', id: 'work' }, journalService)).toEqual({
      ok: true,
      data: expect.objectContaining({ id: 'work', isActive: true }),
    })
  })

  it('將輸入驗證與領域錯誤轉為可操作的繁中訊息', () => {
    const invalidPayload = executeAppRequest({
      action: 'saveEntry',
      entry: { content: '內容' },
    } as never, service())
    const inactiveCategory = executeAppRequest({
      action: 'saveEntry',
      entry: {
        entryDate: '2026-08-04',
        title: '',
        content: '內容',
        categoryId: 'missing',
        tags: [],
        links: [],
      },
    }, service())

    expect(invalidPayload).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
      message: '請檢查送出的資料格式後再試。',
    })
    expect(inactiveCategory).toEqual({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: '請選擇啟用中的分類。',
    })
  })

  it('未預期錯誤不洩漏內部訊息', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const brokenService = {
      bootstrap: () => {
        throw new Error('internal detail')
      },
    } as unknown as JournalService

    expect(executeAppRequest({ action: 'bootstrap' }, brokenService)).toEqual({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: '處理資料時發生錯誤，請稍後再試。',
    })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

function service(): JournalService {
  return new JournalService(
    new FakeJournalStore({ categories: [category()] }),
    () => timestamp,
    () => 'generated-id',
  )
}

function category(): Category {
  return {
    id: 'work',
    name: '工作',
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
