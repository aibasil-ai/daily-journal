import { JournalError } from './errors.js'
import type { CategoryColor } from './category-colors.js'
import type {
  BootstrapData,
  Category,
  CategoryManagementData,
  CategoryInput,
  CsvExportData,
  DailyEntries,
  DailyEntryCount,
  Entry,
  EntryFilter,
  EntryFilterCriteria,
  EntryInput,
  EntryListData,
  MoveEntriesInput,
  MoveEntriesResult,
} from './types.js'
import {
  assertEntryFilter,
  assertEntryFilterCriteria,
  assertValidEntry,
  assertValidEntryDate,
  normalizeEntryInput,
} from './validation.js'
import type { JournalStore } from './store.js'

export const CSV_HEADERS = [
  'id',
  'entryDate',
  'title',
  'content',
  'categoryName',
  'tags',
  'links',
  'createdAt',
  'updatedAt',
]

/** 與資料來源無關的記事領域規則。 */
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

  /** 類別管理需同時顯示啟用與停用分類；新增記事仍只使用 bootstrap 的啟用分類。 */
  listCategories(): CategoryManagementData {
    const categories = [...this.store.listCategories()].sort((left, right) => {
      if (left.isActive !== right.isActive) return left.isActive ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    const entryCounts = Object.fromEntries(categories.map((category) => [category.id, 0])) as Record<string, number>
    for (const entry of this.store.listEntries()) {
      if (entryCounts[entry.categoryId] !== undefined) entryCounts[entry.categoryId] += 1
    }
    return { categories, entryCounts }
  }

  saveCategory(input: CategoryInput): Category {
    return this.store.withWriteLock(() => {
      const id = input.id?.trim() || undefined
      const name = input.name.trim()
      if (!name) {
        throw new JournalError('VALIDATION_ERROR', '請輸入分類名稱。')
      }

      const categories = this.store.listCategories()
      const current = id ? categories.find((category) => category.id === id) : undefined
      if (id && !current) {
        throw new JournalError('NOT_FOUND', '找不到要更新的分類。')
      }
      if (
        categories.some(
          (category) => category.id !== current?.id && normalizeCategoryName(category.name) === normalizeCategoryName(name),
        )
      ) {
        throw new JournalError('CONFLICT', '分類名稱已存在，請使用不同名稱。')
      }

      const timestamp = this.now()
      const category: Category = current
        ? {
            ...current,
            name,
            // 改名只能保留既有啟用狀態，避免 API 意外重新啟用分類。
            isActive: current.isActive,
            updatedAt: timestamp,
          }
        : {
            id: this.uuid(),
            name,
            color: null,
            isActive: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          }

      return this.store.saveCategory(category)
    })
  }

  setCategoryColor(id: string, color: CategoryColor | null): Category {
    return this.store.withWriteLock(() => {
      const categoryId = id.trim()
      const current = this.store.listCategories().find((category) => category.id === categoryId)
      if (!current) {
        throw new JournalError('NOT_FOUND', '找不到要更新顏色的分類。')
      }
      if (current.color === color) return { ...current }
      return this.store.saveCategory({
        ...current,
        color,
        updatedAt: this.now(),
      })
    })
  }

  deactivateCategory(id: string): Category {
    return this.store.withWriteLock(() => {
      const category = this.store.listCategories().find((item) => item.id === id)
      if (!category) {
        throw new JournalError('NOT_FOUND', '找不到要停用的分類。')
      }
      if (!category.isActive) return { ...category }

      return this.store.saveCategory({
        ...category,
        isActive: false,
        updatedAt: this.now(),
      })
    })
  }

  activateCategory(id: string): Category {
    return this.store.withWriteLock(() => {
      const category = this.store.listCategories().find((item) => item.id === id)
      if (!category) {
        throw new JournalError('NOT_FOUND', '找不到要重新啟用的分類。')
      }
      if (category.isActive) return { ...category }

      return this.store.saveCategory({
        ...category,
        isActive: true,
        updatedAt: this.now(),
      })
    })
  }

  saveEntry(input: EntryInput): Entry {
    return this.store.withWriteLock(() => {
      const normalized = normalizeEntryInput(input)
      assertValidEntry(normalized, this.activeCategoryIds())

      const current = normalized.id ? this.store.getEntry(normalized.id) : undefined
      if (normalized.id && !current) {
        throw new JournalError('NOT_FOUND', '找不到要更新的記事。')
      }

      const timestamp = this.now()
      const entry: Entry = {
        id: current?.id ?? this.uuid(),
        entryDate: normalized.entryDate,
        title: normalized.title,
        content: normalized.content,
        categoryId: normalized.categoryId,
        tags: [...normalized.tags],
        links: normalized.links.map((link) => ({ ...link })),
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      return this.store.saveEntry(entry)
    })
  }

  deleteEntry(id: string): void {
    this.store.withWriteLock(() => {
      if (!this.store.getEntry(id)) {
        throw new JournalError('NOT_FOUND', '找不到要刪除的記事。')
      }
      this.store.deleteEntry(id)
    })
  }

  moveEntries(input: MoveEntriesInput): MoveEntriesResult {
    return this.store.withWriteLock(() => {
      const sourceCategoryId = input.sourceCategoryId.trim()
      const targetCategoryId = input.targetCategoryId.trim()
      const entryIds = input.entryIds.map((id) => id.trim())
      if (!entryIds.length || entryIds.some((id) => !id) || new Set(entryIds).size !== entryIds.length) {
        throw new JournalError('VALIDATION_ERROR', '請選擇至少一則不重複的記事進行搬移。')
      }
      if (!sourceCategoryId || !targetCategoryId) {
        throw new JournalError('VALIDATION_ERROR', '請提供來源與目的地分類。')
      }
      if (sourceCategoryId === targetCategoryId) {
        throw new JournalError('VALIDATION_ERROR', '不能將記事移至原本的類別。')
      }

      const categories = this.store.listCategories()
      const source = categories.find((category) => category.id === sourceCategoryId)
      const target = categories.find((category) => category.id === targetCategoryId)
      if (!source) {
        throw new JournalError('NOT_FOUND', '找不到要搬移的來源分類。')
      }
      if (!target) {
        throw new JournalError('NOT_FOUND', '找不到搬移目的地分類。')
      }
      if (!target.isActive) {
        throw new JournalError('VALIDATION_ERROR', '搬移目的地必須是啟用中的類別。')
      }

      const entriesById = new Map(this.store.listEntries().map((entry) => [entry.id, entry]))
      const selectedEntries = entryIds.map((id) => {
        const entry = entriesById.get(id)
        if (!entry || entry.categoryId !== source.id) {
          throw new JournalError('CONFLICT', '其中一則記事已不屬於來源類別，請重新整理後再試。')
        }
        return entry
      })
      const movedAt = this.now()
      const movedEntries = selectedEntries.map((entry) => ({
        ...entry,
        categoryId: target.id,
        updatedAt: movedAt,
      }))
      this.store.saveEntries(movedEntries)
      return { movedCount: movedEntries.length }
    })
  }

  deleteCategory(id: string): void {
    this.store.withWriteLock(() => {
      const categoryId = id.trim()
      const category = this.store.listCategories().find((item) => item.id === categoryId)
      if (!category) {
        throw new JournalError('NOT_FOUND', '找不到要刪除的分類。')
      }
      if (this.store.listEntries().some((entry) => entry.categoryId === categoryId)) {
        throw new JournalError('CONFLICT', '類別仍有記事，請先搬移所有記事後再刪除。')
      }
      this.store.deleteCategory(categoryId)
    })
  }

  listEntries(filter: EntryFilter): EntryListData {
    assertEntryFilter(filter)
    const entries = this.filteredEntries(filter)
    let startIndex = 0

    if (filter.cursor !== null) {
      const cursorIndex = entries.findIndex((entry) => entry.id === filter.cursor)
      if (cursorIndex === -1) {
        throw new JournalError('VALIDATION_ERROR', '分頁游標已失效，請重新載入資料。')
      }
      startIndex = cursorIndex + 1
    }

    const items = entries.slice(startIndex, startIndex + filter.limit)
    const hasMore = startIndex + filter.limit < entries.length
    return {
      items,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    }
  }

  getEntriesForDate(date: string, filter: EntryFilterCriteria): Entry[] {
    assertValidEntryDate(date)
    assertEntryFilterCriteria(filter)
    return this.filteredEntries(filter).filter((entry) => entry.entryDate === date)
  }

  getMonthlyEntryCounts(year: number, month: number, filter: EntryFilterCriteria): DailyEntryCount[] {
    return this.getMonthlyEntries(year, month, filter).map(({ date, entries }) => ({
      date,
      count: entries.length,
    }))
  }

  getMonthlyEntries(year: number, month: number, filter: EntryFilterCriteria): DailyEntries[] {
    assertEntryFilterCriteria(filter)
    if (!Number.isInteger(year) || year < 1 || year > 9999) {
      throw new JournalError('VALIDATION_ERROR', '年份必須是正整數。')
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new JournalError('VALIDATION_ERROR', '月份必須介於 1 到 12。')
    }

    const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-`
    const entriesByDate = new Map<string, Entry[]>()
    for (const entry of this.filteredEntries(filter)) {
      if (!entry.entryDate.startsWith(prefix)) continue
      const entries = entriesByDate.get(entry.entryDate) ?? []
      entries.push(entry)
      entriesByDate.set(entry.entryDate, entries)
    }

    return [...entriesByDate.entries()]
      .map(([date, entries]) => ({ date, entries }))
      .sort((left, right) => left.date.localeCompare(right.date))
  }

  listTagSuggestions(): string[] {
    const tags = new Set<string>()
    for (const entry of this.store.listEntries()) {
      for (const tag of entry.tags) {
        const normalized = tag.trim()
        if (normalized) tags.add(normalized)
      }
    }
    return [...tags].sort()
  }

  exportEntries(filter: EntryFilterCriteria): CsvExportData {
    assertEntryFilterCriteria(filter)
    const categories = this.store.listCategories()
    const rows = this.filteredEntries(filter).map((entry) => {
      const category = categories.find((item) => item.id === entry.categoryId)
      if (!category) {
        throw new JournalError(
          'DATA_ERROR',
          `記事「${entry.id}」找不到對應分類。請修正 Google Sheets 中的資料後再試。`,
        )
      }

      return [
        entry.id,
        entry.entryDate,
        entry.title,
        entry.content,
        category.name,
        entry.tags.join('; '),
        entry.links.map((link) => `${link.label} (${link.url})`).join('; '),
        entry.createdAt,
        entry.updatedAt,
      ]
    })

    return { headers: [...CSV_HEADERS], rows }
  }

  private activeCategoryIds(): Set<string> {
    return new Set(
      this.store
        .listCategories()
        .filter((category) => category.isActive)
        .map((category) => category.id),
    )
  }

  private filteredEntries(filter: EntryFilterCriteria): Entry[] {
    return [...this.store.listEntries()]
      .filter((entry) => this.matchesFilter(entry, filter))
      .sort(compareEntriesNewestFirst)
  }

  private matchesFilter(entry: Entry, filter: EntryFilterCriteria): boolean {
    const query = filter.query.trim().toLocaleLowerCase()
    const searchable = [entry.title, entry.content, ...entry.tags, ...entry.links.map((link) => link.label)]
      .join('\n')
      .toLocaleLowerCase()

    return (!query || searchable.includes(query))
      && (!filter.from || entry.entryDate >= filter.from)
      && (!filter.to || entry.entryDate <= filter.to)
      && (!filter.categoryId || entry.categoryId === filter.categoryId)
      && (!filter.tag || entry.tags.includes(filter.tag))
  }
}

function normalizeCategoryName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function compareEntriesNewestFirst(left: Entry, right: Entry): number {
  const byDate = right.entryDate.localeCompare(left.entryDate)
  if (byDate !== 0) return byDate

  const byCreatedAt = right.createdAt.localeCompare(left.createdAt)
  if (byCreatedAt !== 0) return byCreatedAt

  // 同一時間建立時以 ID 固定排序，讓 cursor 分頁不會遺漏或重複資料。
  return right.id.localeCompare(left.id)
}
