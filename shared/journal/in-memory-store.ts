import { JournalError } from './errors.js'
import type { Category, Entry, EntryFilter } from './types.js'
import type { JournalStore } from './store.js'

export type InMemoryJournalStoreOptions = {
  timezone?: string
  categories?: Category[]
  entries?: Entry[]
}

/** 測試與開發環境用的記憶體儲存庫。 */
export class InMemoryJournalStore implements JournalStore {
  private readonly timezone: string
  private categories: Category[]
  private entries: Entry[]

  constructor(options: InMemoryJournalStoreOptions = {}) {
    this.timezone = options.timezone ?? 'Asia/Taipei'
    this.categories = (options.categories ?? []).map(cloneCategory)
    this.entries = (options.entries ?? []).map(cloneEntry)
  }

  snapshot(): { entries: Entry[]; categories: Category[]; timezone: string } {
    return {
      entries: this.entries.map(cloneEntry),
      categories: this.categories.map(cloneCategory),
      timezone: this.timezone,
    }
  }

  withWriteLock<T>(operation: () => T): T {
    return operation()
  }

  listCategories(): Category[] {
    return this.categories.map(cloneCategory)
  }

  saveCategory(category: Category): Category {
    const copy = cloneCategory(category)
    const index = this.categories.findIndex((item) => item.id === copy.id)
    if (index === -1) this.categories.push(copy)
    else this.categories[index] = copy
    return cloneCategory(copy)
  }

  listEntries(_filter?: EntryFilter): Entry[] {
    return this.entries.map(cloneEntry)
  }

  getEntry(id: string): Entry | undefined {
    const entry = this.entries.find((item) => item.id === id)
    return entry ? cloneEntry(entry) : undefined
  }

  saveEntry(entry: Entry): Entry {
    const copy = cloneEntry(entry)
    const index = this.entries.findIndex((item) => item.id === copy.id)
    if (index === -1) this.entries.push(copy)
    else this.entries[index] = copy
    return cloneEntry(copy)
  }

  saveEntries(entries: Entry[]): Entry[] {
    return entries.map((entry) => this.saveEntry(entry))
  }

  deleteEntry(id: string): void {
    const index = this.entries.findIndex((item) => item.id === id)
    if (index === -1) {
      throw new JournalError('NOT_FOUND', '找不到要刪除的記事。')
    }
    this.entries.splice(index, 1)
  }

  deleteCategory(id: string): void {
    const index = this.categories.findIndex((category) => category.id === id)
    if (index === -1) {
      throw new JournalError('NOT_FOUND', '找不到要刪除的分類。')
    }
    this.categories.splice(index, 1)
  }

  getTimezone(): string {
    return this.timezone
  }
}

function cloneCategory(category: Category): Category {
  return { ...category }
}

function cloneEntry(entry: Entry): Entry {
  return {
    ...entry,
    tags: [...entry.tags],
    links: entry.links.map((link) => ({ ...link })),
  }
}
