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

export type ApiRequest =
  | { action: 'bootstrap' }
  | { action: 'listEntries'; filter: EntryFilter }
  | { action: 'getEntriesForDate'; date: string; filter: Omit<EntryFilter, 'cursor' | 'limit'> }
  | { action: 'getMonthlyEntryCounts'; year: number; month: number; filter: Omit<EntryFilter, 'cursor' | 'limit'> }
  | { action: 'saveEntry'; entry: EntryInput }
  | { action: 'deleteEntry'; id: string }
  | { action: 'saveCategory'; category: Pick<Category, 'name'> & { id?: string } }
  | { action: 'deactivateCategory'; id: string }
  | { action: 'exportEntries'; filter: Omit<EntryFilter, 'cursor' | 'limit'> }

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }
