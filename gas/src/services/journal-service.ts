import type { Category, CategoryInput, Entry, EntryFilter, EntryInput } from '../domain/journal'
import { normalizeEntryInput, validateEntryInput } from '../domain/validation'
import type { JournalStore } from '../repositories/journal-store'

export class JournalServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JournalServiceError'
  }
}

type TimestampJournalStore = JournalStore & {
  formatTimestamp(date: Date): string
}

export type BootstrapData = {
  timezone: string
  categories: Category[]
  tagSuggestions: string[]
}

export type EntryListResult = {
  items: Entry[]
  nextCursor: string | null
}

export type EntrySearchFilter = Omit<EntryFilter, 'cursor' | 'limit'>

export type MonthlyEntryCount = {
  date: string
  count: number
}

export type ExportEntriesResult = {
  headers: string[]
  rows: string[][]
}

export class JournalService {
  constructor(
    private readonly store: JournalStore,
    private readonly now: () => string,
    private readonly uuid: () => string,
  ) {}

  bootstrap(): BootstrapData {
    return {
      timezone: this.store.getTimezone(),
      categories: this.store.listCategories().filter((category) => category.isActive),
      tagSuggestions: this.listTagSuggestions(),
    }
  }

  listEntries(filter: EntryFilter): EntryListResult {
    const entries = this.filteredEntries(filter)
    const cursorIndex = filter.cursor === null ? -1 : entries.findIndex((entry) => entry.id === filter.cursor)
    if (filter.cursor !== null && cursorIndex === -1) throw new JournalServiceError('查詢游標已失效，請重新載入。')
    const entriesAfterCursor = entries.slice(cursorIndex + 1)
    const limit = Math.max(0, Math.trunc(filter.limit))
    const items = entriesAfterCursor.slice(0, limit)
    const nextCursor = items.length > 0 && entriesAfterCursor.length > items.length ? items[items.length - 1].id : null

    return { items, nextCursor }
  }

  getEntriesForDate(date: string, filter: EntrySearchFilter): Entry[] {
    return this.filteredEntries(filter).filter((entry) => entry.entryDate === date)
  }

  getMonthlyEntryCounts(year: number, month: number, filter: EntrySearchFilter): MonthlyEntryCount[] {
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new JournalServiceError('月份必須介於 1 到 12。')

    const prefix = `${year}-${String(month).padStart(2, '0')}-`
    const counts = new Map<string, number>()
    for (const entry of this.filteredEntries(filter)) {
      if (!entry.entryDate.startsWith(prefix)) continue
      counts.set(entry.entryDate, (counts.get(entry.entryDate) ?? 0) + 1)
    }

    return Array.from(counts, ([date, count]) => ({ date, count })).sort((left, right) => left.date.localeCompare(right.date))
  }

  listTagSuggestions(): string[] {
    const tags = new Set<string>()
    for (const entry of this.store.listEntries()) {
      for (const tag of entry.tags) tags.add(tag)
    }
    return Array.from(tags).sort()
  }

  exportEntries(filter: EntrySearchFilter): ExportEntriesResult {
    const categories = new Map(this.store.listCategories().map((category) => [category.id, category.name]))
    return {
      headers: ['id', 'entryDate', 'title', 'content', 'categoryName', 'tags', 'links', 'createdAt', 'updatedAt'],
      rows: this.filteredEntries(filter).map((entry) => [
        entry.id,
        entry.entryDate,
        entry.title,
        entry.content,
        categories.get(entry.categoryId) ?? '',
        entry.tags.join('; '),
        entry.links.map((link) => `${link.label} (${link.url})`).join('; '),
        entry.createdAt,
        entry.updatedAt,
      ]),
    }
  }

  saveEntry(input: EntryInput): Entry {
    return this.store.withWriteLock(() => {
      const normalized = normalizeEntryInput(input)
      const current = normalized.id ? this.store.getEntry(normalized.id) : undefined
      if (normalized.id && !current) throw new JournalServiceError('找不到要更新的記事。')
      this.assertValidEntry(normalized)

      const timestamp = this.now()
      return this.store.saveEntry({
        ...normalized,
        id: current?.id ?? this.uuid(),
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
      })
    })
  }

  saveCategory(input: CategoryInput): Category {
    return this.store.withWriteLock(() => {
      const name = input.name.trim()
      if (!name) throw new JournalServiceError('請輸入分類名稱。')

      const categories = this.store.listCategories()
      const current = input.id ? categories.find((category) => category.id === input.id) : undefined
      if (input.id && !current) throw new JournalServiceError('找不到要更新的分類。')
      if (current && !current.isActive) throw new JournalServiceError('停用中的分類不可編輯。')
      if (categories.some((category) => category.id !== input.id && category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        throw new JournalServiceError('分類名稱不可重複。')
      }

      const timestamp = this.now()
      return this.store.saveCategory({
        id: current?.id ?? this.uuid(),
        name,
        isActive: true,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
      })
    })
  }

  deactivateCategory(id: string): Category {
    return this.store.withWriteLock(() => {
      const current = this.store.listCategories().find((category) => category.id === id)
      if (!current) throw new JournalServiceError('找不到要停用的分類。')
      if (!current.isActive) return current

      return this.store.saveCategory({ ...current, isActive: false, updatedAt: this.now() })
    })
  }

  deleteEntry(id: string): void {
    this.store.withWriteLock(() => {
      if (!this.store.getEntry(id)) throw new JournalServiceError('找不到要刪除的記事。')
      this.store.deleteEntry(id)
    })
  }

  private activeCategoryIds(): Set<string> {
    return new Set(this.store.listCategories().filter((category) => category.isActive).map((category) => category.id))
  }

  private filteredEntries(filter: EntrySearchFilter): Entry[] {
    return this.store.listEntries()
      .filter((entry) => this.matchesFilter(entry, filter))
      .sort((left, right) => this.compareEntries(left, right))
  }

  private matchesFilter(entry: Entry, filter: EntrySearchFilter): boolean {
    const query = filter.query.trim().toLocaleLowerCase()
    const searchable = [entry.title, entry.content, ...entry.tags, ...entry.links.map((link) => link.label)]
      .join('\n').toLocaleLowerCase()

    return (!query || searchable.includes(query))
      && (!filter.from || entry.entryDate >= filter.from)
      && (!filter.to || entry.entryDate <= filter.to)
      && (!filter.categoryId || entry.categoryId === filter.categoryId)
      && (!filter.tag || entry.tags.includes(filter.tag))
  }

  private compareEntries(left: Entry, right: Entry): number {
    if (left.entryDate !== right.entryDate) return left.entryDate > right.entryDate ? -1 : 1
    if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1
    if (left.id === right.id) return 0
    return left.id > right.id ? -1 : 1
  }

  private assertValidEntry(input: EntryInput): void {
    const issue = validateEntryInput(input, this.activeCategoryIds())[0]
    if (issue) throw new JournalServiceError(issue.message)
  }
}

export function createJournalService(
  store: TimestampJournalStore,
  now: (() => string) | undefined = undefined,
  uuid: () => string = () => Utilities.getUuid(),
): JournalService {
  return new JournalService(store, now ?? (() => store.formatTimestamp(new Date())), uuid)
}

declare const Utilities: {
  getUuid(): string
}
