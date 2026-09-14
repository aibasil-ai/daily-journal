import type { CategoryColor, Entry } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { categoryColorStyle } from '../../utils/category-color'

type WeekEntryCardProps = {
  entry: Entry
  categoryName: string
  categoryColor: CategoryColor | null
  onOpen: () => void
}

export function WeekEntryCard({ entry, categoryName, categoryColor, onOpen }: WeekEntryCardProps) {
  const title = entry.title || entry.content.slice(0, 80) || zhTW.timeline.untitled

  return (
    <article className="week-entry-card">
      <button
        className="week-entry-card__read"
        type="button"
        aria-label={`${zhTW.timeline.readEntry}：${title}`}
        onClick={onOpen}
      >
        <span
          className={`category-badge${categoryColor ? ' category-badge--custom-color' : ''}`}
          style={categoryColorStyle(categoryColor)}
        >
          {categoryName}
        </span>
        <strong className="week-entry-card__title">{title}</strong>
        <span className="week-entry-card__summary">{entry.content}</span>
        {entry.tags.length > 0 && (
          <span className="week-entry-card__tags">
            {entry.tags.slice(0, 2).map((tag) => <span className="tag-chip" key={tag}>#{tag}</span>)}
          </span>
        )}
      </button>
    </article>
  )
}