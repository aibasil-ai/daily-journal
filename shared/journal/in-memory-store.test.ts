import { describe, expect, it } from 'vitest'
import { InMemoryJournalStore } from './in-memory-store'
import type { Category, Entry } from './types'

const timestamp = '2026-08-04T12:00:00+08:00'

describe('InMemoryJournalStore', () => {
  it('建構、讀取與儲存時均深拷貝分類、標籤與連結', () => {
    const initialCategory = category()
    const initialEntry = entry()
    const store = new InMemoryJournalStore({
      categories: [initialCategory],
      entries: [initialEntry],
    })

    initialCategory.name = '外部變更'
    initialEntry.tags[0] = '外部標籤'
    initialEntry.links[0].label = '外部連結'

    const listedCategory = store.listCategories()[0]
    const listedEntry = store.getEntry('entry-1')!
    listedCategory.name = '讀取變更'
    listedEntry.tags[0] = '讀取標籤'
    listedEntry.links[0].url = 'https://changed.example.com'

    const savedCategory = store.saveCategory(category({ id: 'life', name: '生活' }))
    const savedEntry = store.saveEntry(entry({
      id: 'entry-2',
      tags: ['學習'],
      links: [{ label: '文件', url: 'https://example.com/document' }],
    }))
    savedCategory.name = '儲存變更'
    savedEntry.tags[0] = '儲存標籤'
    savedEntry.links[0].label = '儲存連結'

    expect(store.snapshot()).toEqual({
      timezone: 'Asia/Taipei',
      categories: [
        category(),
        category({ id: 'life', name: '生活' }),
      ],
      entries: [
        entry(),
        entry({
          id: 'entry-2',
          tags: ['學習'],
          links: [{ label: '文件', url: 'https://example.com/document' }],
        }),
      ],
    })
  })

  it('snapshot 回傳可安全修改的完整深拷貝', () => {
    const store = new InMemoryJournalStore({
      timezone: 'Asia/Tokyo',
      categories: [category()],
      entries: [entry()],
    })

    const snapshot = store.snapshot()
    snapshot.categories[0].name = '快照變更'
    snapshot.entries[0].tags[0] = '快照標籤'
    snapshot.entries[0].links[0].label = '快照連結'

    expect(store.snapshot()).toEqual({
      timezone: 'Asia/Tokyo',
      categories: [category()],
      entries: [entry()],
    })
  })
})

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
    id: 'entry-1',
    entryDate: '2026-08-04',
    title: '標題',
    content: '內容',
    categoryId: 'work',
    tags: ['工作'],
    links: [{ label: '文件', url: 'https://example.com' }],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}
