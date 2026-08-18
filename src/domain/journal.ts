export type JournalLink = {
  label: string
  url: string
}

export type Category = {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type CategoryInput = {
  id?: string
  name: string
}

export type Entry = {
  id: string
  entryDate: string
  title: string
  content: string
  categoryId: string
  tags: string[]
  links: JournalLink[]
  createdAt: string
  updatedAt: string
}

export type EntryInput = Omit<Entry, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
}

export type EntryFilter = {
  query: string
  from: string | null
  to: string | null
  categoryId: string | null
  tag: string | null
  cursor: string | null
  limit: number
}

export type EntryFilterCriteria = Omit<EntryFilter, 'cursor' | 'limit'>

export type BootstrapData = {
  timezone: string
  categories: Category[]
  tagSuggestions: string[]
}

export type EntryListData = {
  items: Entry[]
  nextCursor: string | null
}

export type DailyEntryCount = {
  date: string
  count: number
}

export type DailyEntries = {
  date: string
  entries: Entry[]
}

export type CsvExportData = {
  headers: string[]
  rows: string[][]
}

export type ApiRequest =
  | { action: 'bootstrap' }
  | { action: 'listCategories' }
  | { action: 'listEntries'; filter: EntryFilter }
  | { action: 'getEntriesForDate'; date: string; filter: EntryFilterCriteria }
  | { action: 'getMonthlyEntryCounts'; year: number; month: number; filter: EntryFilterCriteria }
  | { action: 'getMonthlyEntries'; year: number; month: number; filter: EntryFilterCriteria }
  | { action: 'saveEntry'; entry: EntryInput }
  | { action: 'deleteEntry'; id: string }
  | { action: 'saveCategory'; category: CategoryInput }
  | { action: 'deactivateCategory'; id: string }
  | { action: 'exportEntries'; filter: EntryFilterCriteria }

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }

export const DEFAULT_ENTRY_FILTER: EntryFilter = {
  query: '',
  from: null,
  to: null,
  categoryId: null,
  tag: null,
  cursor: null,
  limit: 20,
}

export function toFilterCriteria(filter: EntryFilter): EntryFilterCriteria {
  return {
    query: filter.query,
    from: filter.from,
    to: filter.to,
    categoryId: filter.categoryId,
    tag: filter.tag,
  }
}
