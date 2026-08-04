import type { Category, Entry, EntryInput } from '../domain/journal'
import type { JournalStore } from '../repositories/journal-store'

export type BootstrapData = {
  timezone: string
  categories: Category[]
  tagSuggestions: string[]
}

export class JournalService {
  constructor(
    private readonly store: Pick<JournalStore, 'getTimezone' | 'listCategories'>,
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
    void input
    void this.now
    void this.uuid
    throw new Error('記事儲存功能尚未完成。')
  }

  saveCategory(input: Pick<Category, 'id' | 'name'> & { id?: string }): Category {
    void input
    throw new Error('分類儲存功能尚未完成。')
  }

  deactivateCategory(id: string): Category {
    void id
    throw new Error('分類停用功能尚未完成。')
  }
}
