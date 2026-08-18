import { describe, expect, it } from 'vitest'
import type { Category, Entry, EntryFilter, EntryFilterCriteria, EntryInput } from '../domain/journal'
import { FakeJournalStore } from '../test/fake-journal-store'
import { JournalService } from './journal-service'

const timestamp = '2026-08-04T12:00:00+08:00'

const emptyFilter: EntryFilter = {
  query: '',
  from: null,
  to: null,
  categoryId: null,
  tag: null,
  cursor: null,
  limit: 20,
}

const emptyCriteria: EntryFilterCriteria = {
  query: '',
  from: null,
  to: null,
  categoryId: null,
  tag: null,
}

describe('JournalService', () => {
  it('初始化時只回傳啟用分類、試算表時區與排序後的標籤建議', () => {
    const service = createService({
      categories: [category({ id: 'work', name: '工作' }), category({ id: 'old', isActive: false })],
      entries: [entry({ tags: ['會議', '學習', '會議'] })],
    })

    expect(service.bootstrap()).toEqual({
      timezone: 'Asia/Taipei',
      categories: [expect.objectContaining({ id: 'work' })],
      tagSuggestions: ['學習', '會議'],
    })
  })

  it('分類管理清單會保留停用分類並將啟用分類排在前面', () => {
    const service = createService({
      categories: [
        category({ id: 'old', name: '舊分類', isActive: false }),
        category({ id: 'life', name: '生活' }),
        category({ id: 'work', name: '工作' }),
      ],
    })

    expect(service.listCategories().map((item) => item.id)).toEqual(['work', 'life', 'old'])
  })

  it('新增與更新記事時會正規化內容、保留建立時間', () => {
    let currentTimestamp = '2026-08-04T12:00:00+08:00'
    const store = new FakeJournalStore({ categories: [category()] })
    const service = new JournalService(store, () => currentTimestamp, () => 'entry-new')

    const created = service.saveEntry(entryInput({
      title: '  週會  ',
      content: '  完成規劃  ',
      tags: ['  會議 ', '會議', ''],
      links: [
        { label: '  會議紀錄 ', url: ' https://example.com/meeting ' },
        { label: '', url: '' },
      ],
    }))
    currentTimestamp = '2026-08-05T09:00:00+08:00'
    const updated = service.saveEntry(entryInput({
      id: created.id,
      title: '更新後標題',
      content: '更新內容',
      tags: [],
      links: [],
    }))

    expect(created).toMatchObject({
      id: 'entry-new',
      title: '週會',
      content: '完成規劃',
      tags: ['會議'],
      links: [{ label: '會議紀錄', url: 'https://example.com/meeting' }],
      createdAt: '2026-08-04T12:00:00+08:00',
    })
    expect(updated).toMatchObject({
      id: 'entry-new',
      createdAt: '2026-08-04T12:00:00+08:00',
      updatedAt: '2026-08-05T09:00:00+08:00',
    })
  })

  it('拒絕停用分類、空白內容與無效連結', () => {
    const service = createService({ categories: [category({ id: 'old', isActive: false })] })

    expect(() => service.saveEntry(entryInput({ categoryId: 'old' }))).toThrow('請選擇啟用中的分類。')
    expect(() => service.saveEntry(entryInput({ categoryId: 'old', content: ' ' }))).toThrow('請輸入記事內容。')

    const activeService = createService({ categories: [category()] })
    expect(() => activeService.saveEntry(entryInput({
      links: [{ label: '文件', url: 'ftp://example.com/file' }],
    }))).toThrow('每個連結都需要名稱與有效的 http 或 https 網址。')
  })

  it('可新增、改名及停用分類，但不會重新啟用已停用分類', () => {
    const service = createService({
      categories: [category({ id: 'work', name: '工作' }), category({ id: 'old', name: '舊分類', isActive: false })],
    })

    expect(() => service.saveCategory({ name: ' 工作 ' })).toThrow('分類名稱已存在，請使用不同名稱。')
    expect(service.saveCategory({ id: 'old', name: '歷史分類' })).toMatchObject({
      id: 'old',
      name: '歷史分類',
      isActive: false,
    })
    expect(service.deactivateCategory('work')).toMatchObject({ id: 'work', isActive: false })
  })

  it('停用分類會保留歷史記事，且可永久刪除記事', () => {
    const store = new FakeJournalStore({
      categories: [category({ id: 'work' })],
      entries: [entry({ id: 'history', categoryId: 'work' })],
    })
    const service = new JournalService(store, () => timestamp, () => 'unused')

    service.deactivateCategory('work')
    expect(store.getEntry('history')?.categoryId).toBe('work')
    service.deleteEntry('history')
    expect(store.getEntry('history')).toBeUndefined()
    expect(() => service.deleteEntry('history')).toThrow('找不到要刪除的記事。')
  })

  it('以關鍵字、日期、分類與標籤交集篩選記事', () => {
    const service = createService({
      categories: [category({ id: 'work', name: '工作' }), category({ id: 'life', name: '生活' })],
      entries: [
        entry({
          id: '1',
          entryDate: '2026-08-03',
          title: '週會',
          content: '規劃專案',
          categoryId: 'work',
          tags: ['會議'],
          links: [{ label: '會議文件', url: 'https://example.com/meeting' }],
        }),
        entry({
          id: '2',
          entryDate: '2026-08-04',
          title: '閱讀',
          content: '閱讀文章',
          categoryId: 'life',
          tags: ['學習'],
        }),
      ],
    })

    const result = service.listEntries({
      query: '專案',
      from: '2026-08-01',
      to: '2026-08-04',
      categoryId: 'work',
      tag: '會議',
      cursor: null,
      limit: 20,
    })

    expect(result.items).toEqual([expect.objectContaining({ id: '1' })])
  })

  it('同日以建立時間倒序排序，並以記事 ID 作為 cursor 分頁', () => {
    const service = createService({
      categories: [category()],
      entries: [
        entry({ id: 'old-day', entryDate: '2026-08-03', createdAt: '2026-08-03T23:00:00+08:00' }),
        entry({ id: 'morning', entryDate: '2026-08-04', createdAt: '2026-08-04T09:00:00+08:00' }),
        entry({ id: 'afternoon', entryDate: '2026-08-04', createdAt: '2026-08-04T15:00:00+08:00' }),
      ],
    })

    const firstPage = service.listEntries({ ...emptyFilter, limit: 1 })
    const secondPage = service.listEntries({ ...emptyFilter, limit: 1, cursor: firstPage.nextCursor })
    const thirdPage = service.listEntries({ ...emptyFilter, limit: 1, cursor: secondPage.nextCursor })

    expect(firstPage).toMatchObject({ items: [expect.objectContaining({ id: 'afternoon' })], nextCursor: 'afternoon' })
    expect(secondPage).toMatchObject({ items: [expect.objectContaining({ id: 'morning' })], nextCursor: 'morning' })
    expect(thirdPage).toMatchObject({ items: [expect.objectContaining({ id: 'old-day' })], nextCursor: null })
  })

  it('產生指定日期、月曆數量、標籤建議及 CSV 列資料', () => {
    const service = createService({
      categories: [category({ id: 'work', name: '工作' })],
      entries: [
        entry({
          id: 'one',
          entryDate: '2026-08-04',
          tags: ['會議', '學習'],
          links: [{ label: '會議紀錄', url: 'https://example.com/meeting' }],
        }),
        entry({ id: 'two', entryDate: '2026-08-04', tags: ['會議'] }),
        entry({ id: 'three', entryDate: '2026-08-05', tags: ['閱讀'] }),
      ],
    })

    expect(service.getEntriesForDate('2026-08-04', emptyCriteria).map((item) => item.id)).toEqual(['two', 'one'])
    expect(service.getMonthlyEntryCounts(2026, 8, emptyCriteria)).toEqual([
      { date: '2026-08-04', count: 2 },
      { date: '2026-08-05', count: 1 },
    ])
    expect(service.getMonthlyEntries(2026, 8, emptyCriteria)).toEqual([
      { date: '2026-08-04', entries: [expect.objectContaining({ id: 'two' }), expect.objectContaining({ id: 'one' })] },
      { date: '2026-08-05', entries: [expect.objectContaining({ id: 'three' })] },
    ])
    expect(service.listTagSuggestions()).toEqual(['學習', '會議', '閱讀'])

    const csv = service.exportEntries(emptyCriteria)
    expect(csv.headers).toEqual([
      'id',
      'entryDate',
      'title',
      'content',
      'categoryName',
      'tags',
      'links',
      'createdAt',
      'updatedAt',
    ])
    expect(csv.rows.find((row) => row[0] === 'one')).toEqual(expect.arrayContaining([
      '工作',
      '會議; 學習',
      '會議紀錄 (https://example.com/meeting)',
    ]))
    expect(() => service.getMonthlyEntryCounts(2026, 13, emptyCriteria)).toThrow('月份必須介於 1 到 12。')
  })
})

function createService(options: ConstructorParameters<typeof FakeJournalStore>[0] = {}): JournalService {
  return new JournalService(new FakeJournalStore(options), () => timestamp, () => 'generated-id')
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

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'entry',
    entryDate: '2026-08-04',
    title: '標題',
    content: '內容',
    categoryId: 'work',
    tags: [],
    links: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function entryInput(overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    entryDate: '2026-08-04',
    title: '標題',
    content: '內容',
    categoryId: 'work',
    tags: [],
    links: [],
    ...overrides,
  }
}
