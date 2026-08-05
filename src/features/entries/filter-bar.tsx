import type { Category, EntryFilter } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'

type FilterBarProps = {
  categories: Category[]
  tagSuggestions: string[]
  filter: EntryFilter
  onChange: (filter: EntryFilter) => void
}

export function FilterBar({ categories, tagSuggestions, filter, onChange }: FilterBarProps) {
  function updateFilter(change: Partial<EntryFilter>) {
    onChange({ ...filter, ...change, cursor: null })
  }

  return (
    <section className="filter-bar" aria-label={zhTW.entries.filters}>
      <label>
        {zhTW.entries.keyword}
        <input type="search" value={filter.query} onChange={(event) => updateFilter({ query: event.target.value })} />
      </label>
      <label>
        {zhTW.entries.from}
        <input type="date" value={filter.from ?? ''} onChange={(event) => updateFilter({ from: event.target.value || null })} />
      </label>
      <label>
        {zhTW.entries.to}
        <input type="date" value={filter.to ?? ''} onChange={(event) => updateFilter({ to: event.target.value || null })} />
      </label>
      <label>
        {zhTW.entries.categoryFilter}
        <select value={filter.categoryId ?? ''} onChange={(event) => updateFilter({ categoryId: event.target.value || null })}>
          <option value="">{zhTW.entries.allCategories}</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.isActive ? category.name : zhTW.entries.inactiveCategoryOption(category.name)}</option>)}
        </select>
      </label>
      <label>
        {zhTW.entries.tagFilter}
        <select value={filter.tag ?? ''} onChange={(event) => updateFilter({ tag: event.target.value || null })}>
          <option value="">{zhTW.entries.allTags}</option>
          {tagSuggestions.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </select>
      </label>
    </section>
  )
}
