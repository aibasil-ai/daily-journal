import type { Category, Entry } from '../domain/journal'

export interface JournalStore {
  withWriteLock<T>(operation: () => T): T
  listCategories(): Category[]
  saveCategory(category: Category): Category
  listEntries(): Entry[]
  getEntry(id: string): Entry | undefined
  saveEntry(entry: Entry): Entry
  deleteEntry(id: string): void
  getTimezone(): string
}
