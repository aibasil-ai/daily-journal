import type { Category, Entry, EntryFilter } from './types.js'

/** 將領域規則與實際資料來源隔離。 */
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
