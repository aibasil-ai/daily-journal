import type { Category, Entry } from '../../domain/journal'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'
import { EntryCard } from './entry-card'

type CalendarDayViewProps = {
  date: string
  today: string
  entries: Entry[]
  categories: Category[]
  timezone: string
  onOpenEntry: (entry: Entry) => void
  onEditEntry: (entry: Entry) => void
  onDeleteEntry: (id: string) => Promise<void>
  onCreateEntry: (date: string) => void
}

export function CalendarDayView({
  date,
  today,
  entries,
  categories,
  timezone,
  onOpenEntry,
  onEditEntry,
  onDeleteEntry,
  onCreateEntry,
}: CalendarDayViewProps) {
  const categoriesById = new Map(categories.map((category) => [category.id, category]))

  return (
    <section className="calendar-day-view" aria-label={date}>
      <p className="calendar-day-view__status">
        {date === today && <span aria-current="date">{zhTW.calendar.todayIndicator}</span>}
        <span>{zhTW.calendar.anchorDateIndicator}</span>
      </p>
      {entries.length > 0 && (
        <div className="calendar-day-view__entries">
          {entries.map((entry) => {
            const category = categoriesById.get(entry.categoryId)
            return (
              <EntryCard
                key={entry.id}
                entry={entry}
                categoryName={category?.name ?? zhTW.detail.category}
                categoryColor={category?.color ?? null}
                timezone={timezone}
                onOpen={() => onOpenEntry(entry)}
                onEdit={() => onEditEntry(entry)}
                onDelete={() => onDeleteEntry(entry.id)}
              />
            )
          })}
        </div>
      )}
      <button className="button button--primary calendar-day-view__create" type="button" onClick={() => onCreateEntry(date)}>
        <Icon filled>add</Icon>
        {zhTW.actions.addEntryForDate}
      </button>
    </section>
  )
}