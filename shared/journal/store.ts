import type { Category, Entry, EntryFilter } from './types'

/** 將領域規則與 Google Sheets 存取隔離，讓服務可在 Node 環境測試。 */
export interface JournalStore {
  withWriteLock<T>(operation: () => T): T
  listCategories(): Category[]
  saveCategory(category: Category): Category
  listEntries(filter?: EntryFilter): Entry[]
  getEntry(id: string): Entry | undefined
  saveEntry(entry: Entry): Entry
  saveEntries(entries: Entry[]): Entry[]
  deleteEntry(id: string): void
  deleteCategory(id: string): void
  getTimezone(): string
}
