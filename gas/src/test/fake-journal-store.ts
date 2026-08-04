import type { Category, Entry, EntryFilter } from '../domain/journal'

type FakeJournalStoreOptions = {
  timezone?: string
  categories?: Category[]
  entries?: Entry[]
}

export class FakeJournalStore {
  private readonly timezone: string
  private readonly categories: Category[]
  private readonly entries: Entry[]

  constructor({ timezone = 'Asia/Taipei', categories = [], entries = [] }: FakeJournalStoreOptions = {}) {
    this.timezone = timezone
    this.categories = categories.map(copyCategory)
    this.entries = entries.map(copyEntry)
  }

  listCategories(): Category[] {
    return this.categories.map(copyCategory)
  }

  saveCategory(category: Category): Category {
    const index = this.categories.findIndex((current) => current.id === category.id)
    if (index === -1) this.categories.push(copyCategory(category))
    else this.categories[index] = copyCategory(category)
    return copyCategory(category)
  }

  listEntries(filter: EntryFilter): Entry[] {
    void filter
    return this.entries.map(copyEntry)
  }

  getEntry(id: string): Entry | undefined {
    const entry = this.entries.find((current) => current.id === id)
    return entry ? copyEntry(entry) : undefined
  }

  saveEntry(entry: Entry): Entry {
    const index = this.entries.findIndex((current) => current.id === entry.id)
    if (index === -1) this.entries.push(copyEntry(entry))
    else this.entries[index] = copyEntry(entry)
    return copyEntry(entry)
  }

  deleteEntry(id: string): void {
    const index = this.entries.findIndex((entry) => entry.id === id)
    if (index !== -1) this.entries.splice(index, 1)
  }

  getTimezone(): string {
    return this.timezone
  }
}

function copyCategory(category: Category): Category {
  return { ...category }
}

function copyEntry(entry: Entry): Entry {
  return {
    ...entry,
    tags: [...entry.tags],
    links: entry.links.map((link) => ({ ...link })),
  }
}
