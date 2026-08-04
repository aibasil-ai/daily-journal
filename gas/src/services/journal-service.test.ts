// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import type { Category, Entry, EntryFilter, EntryInput } from '../domain/journal'
import { createJournalService, JournalService } from './journal-service'
import { FakeJournalStore } from '../test/fake-journal-store'

describe('JournalService.bootstrap', () => {
  test('回傳試算表時區及啟用中的分類', () => {
    const store = new FakeJournalStore({
      timezone: 'Asia/Taipei',
      categories: [
        { id: 'work', name: '工作', isActive: true, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00' },
        { id: 'old', name: '舊分類', isActive: false, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00' },
      ],
    })

    expect(new JournalService(store, () => '2026-08-04T00:00:00+08:00', () => 'uuid').bootstrap()).toEqual({
      timezone: 'Asia/Taipei',
      categories: [{ id: 'work', name: '工作', isActive: true, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00' }],
      tagSuggestions: [],
    })
  })
})

describe('createJournalService', () => {
  test('以試算表時區格式化時間並允許替換 UUID 來源', () => {
    const formatTimestamp = vi.fn(() => '2026-08-04T09:00:00+08:00')
    const store = Object.assign(new FakeJournalStore(), { formatTimestamp })

    expect(createJournalService(store, undefined, () => 'category-new').saveCategory({ name: '生活' })).toMatchObject({
      id: 'category-new',
      createdAt: '2026-08-04T09:00:00+08:00',
      updatedAt: '2026-08-04T09:00:00+08:00',
    })
    expect(formatTimestamp).toHaveBeenCalledWith(expect.any(Date))
  })
})

describe('JournalService 分類與記事寫入', () => {
  test('有歷史記事的分類可停用且原記事保留分類', () => {
    const store = new FakeJournalStore({ categories: [activeCategory('work')], entries: [storedEntry({ categoryId: 'work' })] })
    const service = new JournalService(store, now, uuid)

    expect(service.deactivateCategory('work')).toMatchObject({ id: 'work', isActive: false })
    expect(store.listEntries()[0].categoryId).toBe('work')
  })

  test('拒絕將記事寫入停用分類', () => {
    const store = new FakeJournalStore({ categories: [inactiveCategory('old')] })
    const service = new JournalService(store, now, uuid)

    expect(() => service.saveEntry(entryInput({ categoryId: 'old' }))).toThrow('請選擇啟用中的分類。')
  })

  test('更新停用分類的歷史記事時必須改選啟用分類', () => {
    const current = storedEntry({ categoryId: 'old', createdAt: '2026-08-01T09:00:00+08:00' })
    const store = new FakeJournalStore({ categories: [inactiveCategory('old'), activeCategory('work')], entries: [current] })
    const service = new JournalService(store, now, uuid)

    expect(() => service.saveEntry(entryInput({ id: 'entry-1', categoryId: 'old' }))).toThrow('請選擇啟用中的分類。')
    expect(service.saveEntry(entryInput({ id: 'entry-1', categoryId: 'work', content: '改選分類後更新' }))).toMatchObject({
      categoryId: 'work', content: '改選分類後更新', createdAt: '2026-08-01T09:00:00+08:00',
    })
  })

  test('新增記事會正規化內容、標籤與連結並寫入時間戳記', () => {
    const store = new FakeJournalStore({ categories: [activeCategory('work')] })
    const service = new JournalService(store, now, uuid)

    expect(service.saveEntry(entryInput({ content: '  完成規劃  ', tags: [' 工作 ', '工作', ''], links: [{ label: ' 文件 ', url: ' https://example.com/docs ' }] }))).toEqual({
      id: 'entry-new',
      entryDate: '2026-08-04',
      title: '每日記事',
      content: '完成規劃',
      categoryId: 'work',
      tags: ['工作'],
      links: [{ label: '文件', url: 'https://example.com/docs' }],
      createdAt: '2026-08-04T09:00:00+08:00',
      updatedAt: '2026-08-04T09:00:00+08:00',
    })
  })

  test('更新記事保留建立時間並更新內容與更新時間', () => {
    const current = storedEntry({ id: 'entry-1', content: '原內容', createdAt: '2026-08-01T09:00:00+08:00', updatedAt: '2026-08-01T09:00:00+08:00' })
    const store = new FakeJournalStore({ categories: [activeCategory('work')], entries: [current] })
    const service = new JournalService(store, () => '2026-08-04T10:00:00+08:00', uuid)

    expect(service.saveEntry(entryInput({ id: 'entry-1', content: '新內容' }))).toMatchObject({
      id: 'entry-1', content: '新內容', createdAt: '2026-08-01T09:00:00+08:00', updatedAt: '2026-08-04T10:00:00+08:00',
    })
  })

  test('更新不存在的記事時回傳明確錯誤', () => {
    const service = new JournalService(new FakeJournalStore({ categories: [activeCategory('work')] }), now, uuid)

    expect(() => service.saveEntry(entryInput({ id: 'missing' }))).toThrow('找不到要更新的記事。')
  })

  test('永久刪除既有記事並拒絕不存在的 ID', () => {
    const store = new FakeJournalStore({ categories: [activeCategory('work')], entries: [storedEntry({ id: 'entry-1' })] })
    const service = new JournalService(store, now, uuid)

    service.deleteEntry('entry-1')

    expect(store.getEntry('entry-1')).toBeUndefined()
    expect(() => service.deleteEntry('missing')).toThrow('找不到要刪除的記事。')
  })

  test('去除分類名稱空白並拒絕不分大小寫的重複名稱', () => {
    const store = new FakeJournalStore({ categories: [activeCategory('work', '工作')] })
    const service = new JournalService(store, now, uuid)

    expect(service.saveCategory({ name: '  Personal  ' })).toMatchObject({
      id: 'entry-new', name: 'Personal', isActive: true, createdAt: '2026-08-04T09:00:00+08:00', updatedAt: '2026-08-04T09:00:00+08:00',
    })
    expect(() => service.saveCategory({ name: 'personal' })).toThrow('分類名稱不可重複。')
    expect(() => service.saveCategory({ name: '   ' })).toThrow('請輸入分類名稱。')
  })

  test('拒絕空白內容與無效網址', () => {
    const service = new JournalService(new FakeJournalStore({ categories: [activeCategory('work')] }), now, uuid)

    expect(() => service.saveEntry(entryInput({ content: '   ' }))).toThrow('請輸入記事內容。')
    expect(() => service.saveEntry(entryInput({ links: [{ label: '參考', url: 'ftp://example.com' }] }))).toThrow('每個連結都需要名稱與有效的 http 或 https 網址。')
  })

  test('所有寫入操作都在同一交易內完成規則讀取與寫入', () => {
    const categoryStore = new FakeJournalStore({ categories: [activeCategory('work')] })
    new JournalService(categoryStore, now, uuid).saveCategory({ name: '生活' })
    expect(categoryStore.writeLockCalls).toBe(1)
    expect(categoryStore.operations).toEqual(['listCategories:locked', 'saveCategory:locked'])

    const deactivateStore = new FakeJournalStore({ categories: [activeCategory('work')] })
    new JournalService(deactivateStore, now, uuid).deactivateCategory('work')
    expect(deactivateStore.writeLockCalls).toBe(1)
    expect(deactivateStore.operations).toEqual(['listCategories:locked', 'saveCategory:locked'])

    const newEntryStore = new FakeJournalStore({ categories: [activeCategory('work')] })
    new JournalService(newEntryStore, now, uuid).saveEntry(entryInput())
    expect(newEntryStore.writeLockCalls).toBe(1)
    expect(newEntryStore.operations).toEqual(['listCategories:locked', 'saveEntry:locked'])

    const updateEntryStore = new FakeJournalStore({ categories: [activeCategory('work')], entries: [storedEntry()] })
    new JournalService(updateEntryStore, now, uuid).saveEntry(entryInput({ id: 'entry-1' }))
    expect(updateEntryStore.writeLockCalls).toBe(1)
    expect(updateEntryStore.operations).toEqual(['getEntry:locked', 'listCategories:locked', 'saveEntry:locked'])

    const deleteStore = new FakeJournalStore({ categories: [activeCategory('work')], entries: [storedEntry()] })
    new JournalService(deleteStore, now, uuid).deleteEntry('entry-1')
    expect(deleteStore.writeLockCalls).toBe(1)
    expect(deleteStore.operations).toEqual(['getEntry:locked', 'deleteEntry:locked'])
  })
})

describe('JournalService 查詢與匯出', () => {
  test('以關鍵字、日期、分類與標籤交集篩選記事', () => {
    const service = serviceWithEntries([
      storedEntry({ id: 'match', entryDate: '2026-08-15', title: 'needle', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'missing-query', entryDate: '2026-08-16', title: 'other', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'before-from', entryDate: '2026-08-09', title: 'needle', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'after-to', entryDate: '2026-08-21', title: 'needle', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'wrong-category', entryDate: '2026-08-17', title: 'needle', categoryId: 'life', tags: ['focus'] }),
      storedEntry({ id: 'wrong-tag', entryDate: '2026-08-18', title: 'needle', categoryId: 'work', tags: ['other'] }),
    ])
    const filter = { query: 'needle', from: '2026-08-10', to: '2026-08-20', categoryId: 'work', tag: 'focus', cursor: null, limit: 20 }

    expect(service.listEntries(filter).items.map((entry) => entry.id)).toEqual(['match'])
    expect(service.listEntries({ ...filter, query: '' }).items.map((entry) => entry.id)).toEqual(['missing-query', 'match'])
    expect(service.listEntries({ ...filter, from: null }).items.map((entry) => entry.id)).toEqual(['match', 'before-from'])
    expect(service.listEntries({ ...filter, to: null }).items.map((entry) => entry.id)).toEqual(['after-to', 'match'])
    expect(service.listEntries({ ...filter, categoryId: null }).items.map((entry) => entry.id)).toEqual(['wrong-category', 'match'])
    expect(service.listEntries({ ...filter, tag: null }).items.map((entry) => entry.id)).toEqual(['wrong-tag', 'match'])
  })

  test('關鍵字不分大小寫搜尋標題、內容、標籤與連結顯示名稱', () => {
    const service = serviceWithEntries([
      storedEntry({ id: 'title', title: 'Project notes' }),
      storedEntry({ id: 'content', content: 'Read the ALPHA brief' }),
      storedEntry({ id: 'tag', tags: ['Beta'] }),
      storedEntry({ id: 'link', links: [{ label: 'Gamma guide', url: 'https://example.com/guide' }] }),
    ])

    expect(service.listEntries({ ...defaultFilter, query: 'project' }).items.map((entry) => entry.id)).toEqual(['title'])
    expect(service.listEntries({ ...defaultFilter, query: 'alpha' }).items.map((entry) => entry.id)).toEqual(['content'])
    expect(service.listEntries({ ...defaultFilter, query: 'beta' }).items.map((entry) => entry.id)).toEqual(['tag'])
    expect(service.listEntries({ ...defaultFilter, query: 'gamma' }).items.map((entry) => entry.id)).toEqual(['link'])
  })

  test('依日期與建立時間倒序排列，並以最後一筆 ID 作為分頁 cursor', () => {
    const service = serviceWithEntries([
      storedEntry({ id: 'previous', entryDate: '2026-08-03', createdAt: '2026-08-03T09:00:00+08:00' }),
      storedEntry({ id: 'older', entryDate: '2026-08-04', createdAt: '2026-08-04T08:00:00+08:00' }),
      storedEntry({ id: 'newer', entryDate: '2026-08-04', createdAt: '2026-08-04T10:00:00+08:00' }),
    ])

    const firstPage = service.listEntries({ ...defaultFilter, limit: 2 })

    expect(firstPage.items.map((entry) => entry.id)).toEqual(['newer', 'older'])
    expect(firstPage.nextCursor).toBe('older')
    expect(service.listEntries({ ...defaultFilter, cursor: firstPage.nextCursor, limit: 2 })).toEqual({
      items: [expect.objectContaining({ id: 'previous' })], nextCursor: null,
    })
  })

  test('刪除 cursor 對應的記事後拒絕沿用游標', () => {
    const service = serviceWithEntries([
      storedEntry({ id: 'cursor', entryDate: '2026-08-04' }),
      storedEntry({ id: 'later', entryDate: '2026-08-03' }),
    ])

    service.deleteEntry('cursor')

    expect(() => service.listEntries({ ...defaultFilter, cursor: 'cursor' })).toThrow('查詢游標已失效，請重新載入。')
  })

  test('拒絕任意不存在的 cursor', () => {
    const service = serviceWithEntries([storedEntry({ id: 'existing' })])

    expect(() => service.listEntries({ ...defaultFilter, cursor: 'missing' })).toThrow('查詢游標已失效，請重新載入。')
  })

  test('篩選變更後拒絕不再符合條件的 cursor', () => {
    const service = serviceWithEntries([
      storedEntry({ id: 'work', categoryId: 'work' }),
      storedEntry({ id: 'life', categoryId: 'life' }),
    ])

    expect(() => service.listEntries({ ...defaultFilter, categoryId: 'life', cursor: 'work' })).toThrow('查詢游標已失效，請重新載入。')
  })

  test('依指定日期套用所有篩選條件，並分別限制日期範圍', () => {
    const service = serviceWithEntries([
      storedEntry({ id: 'match', entryDate: '2026-08-15', title: 'needle', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'missing-query', entryDate: '2026-08-15', title: 'other', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'wrong-category', entryDate: '2026-08-15', title: 'needle', categoryId: 'life', tags: ['focus'] }),
      storedEntry({ id: 'wrong-tag', entryDate: '2026-08-15', title: 'needle', categoryId: 'work', tags: ['other'] }),
      storedEntry({ id: 'before-from', entryDate: '2026-08-09', title: 'needle', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'after-to', entryDate: '2026-08-21', title: 'needle', categoryId: 'work', tags: ['focus'] }),
    ])
    const filter = { query: 'needle', from: '2026-08-10', to: '2026-08-20', categoryId: 'work', tag: 'focus' }

    expect(service.getEntriesForDate('2026-08-15', filter).map((entry) => entry.id)).toEqual(['match'])
    expect(service.getEntriesForDate('2026-08-15', { ...filter, query: '' }).map((entry) => entry.id)).toEqual(['missing-query', 'match'])
    expect(service.getEntriesForDate('2026-08-15', { ...filter, categoryId: null }).map((entry) => entry.id)).toEqual(['wrong-category', 'match'])
    expect(service.getEntriesForDate('2026-08-15', { ...filter, tag: null }).map((entry) => entry.id)).toEqual(['wrong-tag', 'match'])
    expect(service.getEntriesForDate('2026-08-09', filter)).toEqual([])
    expect(service.getEntriesForDate('2026-08-09', { ...filter, from: null }).map((entry) => entry.id)).toEqual(['before-from'])
    expect(service.getEntriesForDate('2026-08-21', filter)).toEqual([])
    expect(service.getEntriesForDate('2026-08-21', { ...filter, to: null }).map((entry) => entry.id)).toEqual(['after-to'])
  })

  test('月曆只回傳指定月份且符合篩選的有記事日期', () => {
    const service = serviceWithEntries([
      storedEntry({ id: 'match', entryDate: '2026-08-15', title: 'needle', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'missing-query', entryDate: '2026-08-16', title: 'other', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'before-from', entryDate: '2026-08-09', title: 'needle', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'after-to', entryDate: '2026-08-21', title: 'needle', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'wrong-category', entryDate: '2026-08-17', title: 'needle', categoryId: 'life', tags: ['focus'] }),
      storedEntry({ id: 'wrong-tag', entryDate: '2026-08-18', title: 'needle', categoryId: 'work', tags: ['other'] }),
    ])

    expect(service.getMonthlyEntryCounts(2026, 8, { query: 'needle', from: '2026-08-10', to: '2026-08-20', categoryId: 'work', tag: 'focus' }))
      .toEqual([{ date: '2026-08-15', count: 1 }])
  })

  test('拒絕不在 1 到 12 的月份', () => {
    const service = serviceWithEntries([])

    expect(() => service.getMonthlyEntryCounts(2026, 0, emptyQueryFilter)).toThrow('月份必須介於 1 到 12。')
    expect(() => service.getMonthlyEntryCounts(2026, 1.5, emptyQueryFilter)).toThrow('月份必須介於 1 到 12。')
    expect(() => service.getMonthlyEntryCounts(2026, 13, emptyQueryFilter)).toThrow('月份必須介於 1 到 12。')
  })

  test('標籤建議去除重複並依 Unicode 順序排序', () => {
    const service = serviceWithEntries([
      storedEntry({ id: 'first', tags: ['乙', 'A'] }),
      storedEntry({ id: 'second', tags: ['一', '乙'] }),
    ])

    expect(service.listTagSuggestions()).toEqual(['A', '一', '乙'])
    expect(service.bootstrap().tagSuggestions).toEqual(['A', '一', '乙'])
  })

  test('匯出包含 Excel 所需欄位、分類名稱、標籤與連結文字', () => {
    const service = serviceWithEntries([
      storedEntry({
        id: 'match', entryDate: '2026-08-15', title: 'needle', content: '整理內容', categoryId: 'work', tags: ['focus', '規劃'],
        links: [{ label: '會議紀錄', url: 'https://example.com/meeting' }, { label: '文件', url: 'https://example.com/docs' }],
      }),
      storedEntry({ id: 'missing-query', entryDate: '2026-08-16', title: 'other', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'before-from', entryDate: '2026-08-09', title: 'needle', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'after-to', entryDate: '2026-08-21', title: 'needle', categoryId: 'work', tags: ['focus'] }),
      storedEntry({ id: 'wrong-category', entryDate: '2026-08-17', title: 'needle', categoryId: 'life', tags: ['focus'] }),
      storedEntry({ id: 'wrong-tag', entryDate: '2026-08-18', title: 'needle', categoryId: 'work', tags: ['other'] }),
    ])

    expect(service.exportEntries({ query: 'needle', from: '2026-08-10', to: '2026-08-20', categoryId: 'work', tag: 'focus' })).toEqual({
      headers: ['id', 'entryDate', 'title', 'content', 'categoryName', 'tags', 'links', 'createdAt', 'updatedAt'],
      rows: [['match', '2026-08-15', 'needle', '整理內容', '工作', 'focus; 規劃', '會議紀錄 (https://example.com/meeting); 文件 (https://example.com/docs)', '2026-08-01T09:00:00+08:00', '2026-08-01T09:00:00+08:00']],
    })
  })
})

const defaultFilter = { query: '', from: null, to: null, categoryId: null, tag: null, cursor: null, limit: 20 }
const emptyQueryFilter: Omit<EntryFilter, 'cursor' | 'limit'> = { query: '', from: null, to: null, categoryId: null, tag: null }
const now = () => '2026-08-04T09:00:00+08:00'
const uuid = () => 'entry-new'

function serviceWithEntries(entries: Entry[]): JournalService {
  return new JournalService(new FakeJournalStore({ categories: [activeCategory('work', '工作'), activeCategory('life', '生活')], entries }), now, uuid)
}

function activeCategory(id: string, name = id): Category {
  return { id, name, isActive: true, createdAt: '2026-08-01T09:00:00+08:00', updatedAt: '2026-08-01T09:00:00+08:00' }
}

function inactiveCategory(id: string): Category {
  return { ...activeCategory(id), isActive: false }
}

function entryInput(overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    entryDate: '2026-08-04', title: '每日記事', content: '記事內容', categoryId: 'work', tags: [], links: [], ...overrides,
  }
}

function storedEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-1', ...entryInput(), createdAt: '2026-08-01T09:00:00+08:00', updatedAt: '2026-08-01T09:00:00+08:00', ...overrides,
  }
}
