// @vitest-environment node

import { describe, expect, test } from 'vitest'
import type { Category, Entry, EntryInput } from '../domain/journal'
import { JournalService } from './journal-service'
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

describe('JournalService 分類與記事寫入', () => {
  test('有歷史記事的分類可停用且原記事保留分類', () => {
    const store = new FakeJournalStore({ categories: [activeCategory('work')], entries: [storedEntry({ categoryId: 'work' })] })
    const service = new JournalService(store, now, uuid)

    expect(service.deactivateCategory('work')).toMatchObject({ id: 'work', isActive: false })
    expect(store.listEntries(defaultFilter)[0].categoryId).toBe('work')
  })

  test('拒絕將記事寫入停用分類', () => {
    const store = new FakeJournalStore({ categories: [inactiveCategory('old')] })
    const service = new JournalService(store, now, uuid)

    expect(() => service.saveEntry(entryInput({ categoryId: 'old' }))).toThrow('請選擇啟用中的分類。')
  })

  test('拒絕編輯已停用分類的歷史記事', () => {
    const store = new FakeJournalStore({ categories: [inactiveCategory('old'), activeCategory('work')], entries: [storedEntry({ categoryId: 'old' })] })
    const service = new JournalService(store, now, uuid)

    expect(() => service.saveEntry(entryInput({ id: 'entry-1', categoryId: 'work' }))).toThrow('請選擇啟用中的分類。')
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
})

const defaultFilter = { query: '', from: null, to: null, categoryId: null, tag: null, cursor: null, limit: 20 }
const now = () => '2026-08-04T09:00:00+08:00'
const uuid = () => 'entry-new'

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
