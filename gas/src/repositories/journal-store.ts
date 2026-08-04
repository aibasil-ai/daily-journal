import type { Category, Entry, EntryFilter } from '../domain/journal'

export interface JournalStore {
  listCategories(): Category[]
  saveCategory(category: Category): Category
  listEntries(filter: EntryFilter): Entry[]
  saveEntry(entry: Entry): Entry
  deleteEntry(id: string): void
  getTimezone(): string
}
