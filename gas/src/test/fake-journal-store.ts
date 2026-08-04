import type { Category, Entry, EntryFilter } from '../domain/journal'
import type { JournalStore } from '../repositories/journal-store'

type FakeJournalStoreOptions = {
  timezone?: string
  categories?: Category[]
  entries?: Entry[]
}

export class FakeJournalStore implements JournalStore {
  private readonly timezone: string
  private readonly categories: Category[]
  private readonly entries: Entry[]

  constructor({ timezone = 'Asia/Taipei', categories = [], entries = [] }: FakeJournalStoreOptions = {}) {
    this.timezone = timezone
    this.categories = [...categories]
    this.entries = [...entries]
  }

  listCategories(): Category[] {
    return [...this.categories]
  }

  saveCategory(category: Category): Category {
    const index = this.categories.findIndex(({ id }) => id === category.id)
    if (index === -1) this.categories.push(category)
    else this.categories[index] = category
    return category
  }

  listEntries(filter: EntryFilter): Entry[] {
    void filter
    return [...this.entries]
  }

  saveEntry(entry: Entry): Entry {
    const index = this.entries.findIndex(({ id }) => id === entry.id)
    if (index === -1) this.entries.push(entry)
    else this.entries[index] = entry
    return entry
  }

  deleteEntry(id: string): void {
    const index = this.entries.findIndex((entry) => entry.id === id)
    if (index !== -1) this.entries.splice(index, 1)
  }

  getTimezone(): string {
    return this.timezone
  }
}
