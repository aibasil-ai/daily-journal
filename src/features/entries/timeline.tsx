import type { Category, Entry } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { daysBetween, formatEntryDate, getJournalDate } from '../../utils/date'
import { EntryCard } from './entry-card'

type TimelineProps = {
  entries: Entry[]
  categories: Category[]
  timezone: string
  nextCursor: string | null
  isLoading?: boolean
  onLoadMore: () => void
  onOpen: (entry: Entry) => void
  onEdit: (entry: Entry) => void
  onDelete: (id: string) => Promise<void>
  onCreate: () => void
}

export function Timeline({
  entries,
  categories,
  timezone,
  nextCursor,
  isLoading = false,
  onLoadMore,
  onOpen,
  onEdit,
  onDelete,
  onCreate,
}: TimelineProps) {
  const groups = groupEntries(entries)
  const categoriesById = new Map(categories.map((category) => [category.id, category]))

  if (!entries.length && !isLoading) {
    return (
      <section className="empty-state">
        <span className="empty-state__icon material-symbols-outlined" aria-hidden="true">edit_note</span>
        <h3>{zhTW.timeline.emptyTitle}</h3>
        <p>{zhTW.timeline.emptyDescription}</p>
        <button className="button button--primary" type="button" onClick={onCreate}>{zhTW.actions.addEntry}</button>
      </section>
    )
  }

  return (
    <section className="timeline" aria-label={zhTW.navigation.timeline} aria-busy={isLoading}>
      {[...groups.entries()].map(([date, dateEntries]) => (
        <section className="timeline__group" key={date} aria-labelledby={`date-${date}`}>
          <header className="timeline__date-heading">
            <h3 id={`date-${date}`}>{formatEntryDate(date)}</h3>
            <DateRelationBadge date={date} timezone={timezone} />
          </header>
          <div className="timeline__entries">
            {dateEntries.map((entry) => {
              const category = categoriesById.get(entry.categoryId)
              return (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  categoryName={category?.name ?? zhTW.detail.category}
                  categoryColor={category?.color ?? null}
                  timezone={timezone}
                  onOpen={() => onOpen(entry)}
                  onEdit={() => onEdit(entry)}
                  onDelete={() => onDelete(entry.id)}
                />
              )
            })}
          </div>
        </section>
      ))}
      {nextCursor !== null && (
        <div className="timeline__load-more">
          <button className="button button--secondary" type="button" onClick={onLoadMore} disabled={isLoading}>
            {isLoading ? zhTW.timeline.loadingMore : zhTW.actions.loadMore}
          </button>
        </div>
      )}
    </section>
  )
}

function DateRelationBadge({ date, timezone }: { date: string; timezone: string }) {
  const offset = daysBetween(date, getJournalDate(timezone))
  if (offset === 0) return <span className="date-badge">{zhTW.timeline.today}</span>
  if (offset === 1) return <span className="date-badge">{zhTW.timeline.yesterday}</span>
  return null
}

function groupEntries(entries: Entry[]): Map<string, Entry[]> {
  return entries.reduce((groups, entry) => {
    const group = groups.get(entry.entryDate) ?? []
    group.push(entry)
    groups.set(entry.entryDate, group)
    return groups
  }, new Map<string, Entry[]>())
}
