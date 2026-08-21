import { describe, expect, it, vi } from 'vitest'
import { executeJournalRequest } from './dispatcher'
import type { Category, Entry } from './types'
import { InMemoryJournalStore } from './in-memory-store'
import { JournalService } from './service'

const timestamp = '2026-08-04T12:00:00+08:00'

describe('executeJournalRequest', () => {
  it('未知 action 回傳固定錯誤且不執行服務', () => {
    const serviceMock = { bootstrap: vi.fn() } as unknown as JournalService

    expect(executeJournalRequest({ action: 'unknown' } as never, serviceMock)).toEqual({
      ok: false,
      code: 'INVALID_ACTION',
      message: '不支援的操作。',
    })
    expect(serviceMock.bootstrap).not.toHaveBeenCalled()
  })

  it('將支援 action 導向服務並回傳 JSON 資料', () => {
    const response = executeJournalRequest({ action: 'bootstrap' }, service())

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
    expect(executeJournalRequest({ action: 'listCategories' }, service())).toEqual({
      ok: true,
      data: {
        categories: [expect.objectContaining({ id: 'work' })],
        entryCounts: { work: 0 },
      },
    })
  })

  it('允許搬移記事，並拒絕空白選取與非空類別刪除', () => {
    const journalService = migrationService()

    expect(executeJournalRequest({
      action: 'moveEntries',
      sourceCategoryId: 'work',
      targetCategoryId: 'life',
      entryIds: ['entry-1'],
    }, journalService)).toEqual({ ok: true, data: { movedCount: 1 } })
    expect(executeJournalRequest({
      action: 'moveEntries',
      sourceCategoryId: 'work',
      targetCategoryId: 'life',
      entryIds: [],
    }, migrationService())).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
    expect(executeJournalRequest({ action: 'deleteCategory', id: 'work' }, migrationService())).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    })
  })

  it('回傳月曆顯示所需的每日記事', () => {
    expect(executeJournalRequest({
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

    expect(executeJournalRequest({ action: 'activateCategory', id: 'work' }, journalService)).toEqual({
      ok: true,
      data: expect.objectContaining({ id: 'work', isActive: true }),
    })
  })

  it('將輸入驗證與領域錯誤轉為可操作的繁中訊息', () => {
    const invalidPayload = executeJournalRequest({
      action: 'saveEntry',
      entry: { content: '內容' },
    } as never, service())
    const inactiveCategory = executeJournalRequest({
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

  it('未預期錯誤不洩漏或記錄可能含日記內容的內部訊息', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const brokenService = {
      bootstrap: () => {
        throw new Error('internal detail')
      },
    } as unknown as JournalService

    try {
      expect(executeJournalRequest({ action: 'bootstrap' }, brokenService)).toEqual({
        ok: false,
        code: 'INTERNAL_ERROR',
        message: '處理資料時發生錯誤，請稍後再試。',
      })
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('固定現有 API 契約回歸測試', () => {
    const store = new InMemoryJournalStore({
      timezone: 'Asia/Taipei',
      categories: [category({ id: 'work' })],
      entries: [entry({ id: 'one', categoryId: 'work' })],
    })
    const journalService = new JournalService(store, () => timestamp, () => 'uuid-1')

    expect(executeJournalRequest({
      action: 'listEntries',
      filter: { query: '', from: null, to: null, categoryId: null, tag: null, cursor: null, limit: 20 },
    }, journalService)).toEqual({
      ok: true,
      data: { items: [expect.objectContaining({ id: 'one' })], nextCursor: null },
    })
  })
})

function service(): JournalService {
  return new JournalService(
    new InMemoryJournalStore({ categories: [category()] }),
    () => timestamp,
    () => 'generated-id',
  )
}

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 'work',
    name: '工作',
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function migrationService(): JournalService {
  return new JournalService(
    new InMemoryJournalStore({
      categories: [category(), { ...category(), id: 'life', name: '生活' }],
      entries: [entry()],
    }),
    () => timestamp,
    () => 'generated-id',
  )
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-1',
    entryDate: '2026-08-04',
    title: '',
    content: '內容',
    categoryId: 'work',
    tags: [],
    links: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}
