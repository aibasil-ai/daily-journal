import type { Category, EntryFilter } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { Icon } from '../../components/icon'

type FilterBarProps = {
  filter: EntryFilter
  categories: Category[]
  tagSuggestions: string[]
  onChange: (changes: Partial<EntryFilter>) => void
}

export function FilterBar({ filter, categories, tagSuggestions, onChange }: FilterBarProps) {
  const hasFilters = Boolean(filter.query || filter.from || filter.to || filter.categoryId || filter.tag)

  return (
    <section className="filter-bar" aria-label={zhTW.filters.title}>
      <label className="filter-bar__search">
        <Icon>search</Icon>
        <span className="sr-only">{zhTW.filters.search}</span>
        <input
          type="search"
          value={filter.query}
          placeholder={zhTW.filters.search}
          onChange={(event) => onChange({ query: event.target.value })}
        />
      </label>
      <label className="filter-bar__field">
        <span>{zhTW.filters.from}</span>
        <input
          type="date"
          aria-label={zhTW.filters.from}
          value={filter.from ?? ''}
          onChange={(event) => onChange({ from: event.target.value || null })}
        />
      </label>
      <label className="filter-bar__field">
        <span>{zhTW.filters.to}</span>
        <input
          type="date"
          aria-label={zhTW.filters.to}
          value={filter.to ?? ''}
          onChange={(event) => onChange({ to: event.target.value || null })}
        />
      </label>
      <label className="filter-bar__field">
        <span>{zhTW.filters.category}</span>
        <select
          aria-label={zhTW.filters.category}
          value={filter.categoryId ?? ''}
          onChange={(event) => onChange({ categoryId: event.target.value || null })}
        >
          <option value="">{zhTW.filters.allCategories}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </label>
      <label className="filter-bar__field">
        <span>{zhTW.filters.tag}</span>
        <select
          aria-label={zhTW.filters.tag}
          value={filter.tag ?? ''}
          onChange={(event) => onChange({ tag: event.target.value || null })}
        >
          <option value="">{zhTW.filters.allTags}</option>
          {tagSuggestions.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      </label>
      {hasFilters && (
        <button
          className="button button--text filter-bar__clear"
          type="button"
          onClick={() => onChange({ query: '', from: null, to: null, categoryId: null, tag: null })}
        >
          <Icon>filter_alt_off</Icon>
          {zhTW.filters.clear}
        </button>
      )}
    </section>
  )
}
