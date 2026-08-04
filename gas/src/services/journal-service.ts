import type { Category, Entry, EntryInput } from '../domain/journal'
import { normalizeEntryInput, validateEntryInput } from '../domain/validation'
import type { JournalStore } from '../repositories/journal-store'

export type BootstrapData = {
  timezone: string
  categories: Category[]
  tagSuggestions: string[]
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
      tagSuggestions: [],
    }
  }

  saveEntry(input: EntryInput): Entry {
    const normalized = normalizeEntryInput(input)
    const current = normalized.id ? this.store.getEntry(normalized.id) : undefined
    if (normalized.id && !current) throw new Error('找不到要更新的記事。')
    if (current && !this.activeCategoryIds().has(current.categoryId)) throw new Error('請選擇啟用中的分類。')
    this.assertValidEntry(normalized)

    const timestamp = this.now()
    return this.store.saveEntry({
      ...normalized,
      id: current?.id ?? this.uuid(),
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
  }

  saveCategory(input: Pick<Category, 'name'> & { id?: string }): Category {
    const name = input.name.trim()
    if (!name) throw new Error('請輸入分類名稱。')

    const current = input.id ? this.store.listCategories().find((category) => category.id === input.id) : undefined
    if (input.id && !current) throw new Error('找不到要更新的分類。')
    if (current && !current.isActive) throw new Error('停用中的分類不可編輯。')
    if (this.store.listCategories().some((category) => category.id !== input.id && category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error('分類名稱不可重複。')
    }

    const timestamp = this.now()
    return this.store.saveCategory({
      id: current?.id ?? this.uuid(),
      name,
      isActive: true,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
  }

  deactivateCategory(id: string): Category {
    const current = this.store.listCategories().find((category) => category.id === id)
    if (!current) throw new Error('找不到要停用的分類。')
    if (!current.isActive) return current

    return this.store.saveCategory({ ...current, isActive: false, updatedAt: this.now() })
  }

  deleteEntry(id: string): void {
    if (!this.store.getEntry(id)) throw new Error('找不到要刪除的記事。')
    this.store.deleteEntry(id)
  }

  private activeCategoryIds(): Set<string> {
    return new Set(this.store.listCategories().filter((category) => category.isActive).map((category) => category.id))
  }

  private assertValidEntry(input: EntryInput): void {
    const issue = validateEntryInput(input, this.activeCategoryIds())[0]
    if (issue) throw new Error(issue.message)
  }
}
