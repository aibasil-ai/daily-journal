import type { Category } from '../domain/journal'

type FakeJournalStoreOptions = {
  timezone?: string
  categories?: Category[]
}

export class FakeJournalStore {
  private readonly timezone: string
  private readonly categories: Category[]

  constructor({ timezone = 'Asia/Taipei', categories = [] }: FakeJournalStoreOptions = {}) {
    this.timezone = timezone
    this.categories = [...categories]
  }

  listCategories(): Category[] {
    return [...this.categories]
  }

  getTimezone(): string {
    return this.timezone
  }
}
