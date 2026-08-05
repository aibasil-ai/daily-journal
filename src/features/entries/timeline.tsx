import type { Entry } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { EntryCard } from './entry-card'

type TimelineProps = {
  entries: Entry[]
  categoryNameById: ReadonlyMap<string, string>
  nextCursor: string | null
  onEdit: (entry: Entry) => void
  onDelete: (id: string) => Promise<void>
  onLoadMore: () => void
  isLoadingMore?: boolean
}

export function Timeline({ entries, categoryNameById, nextCursor, onEdit, onDelete, onLoadMore, isLoadingMore = false }: TimelineProps) {
  const groups = entries.reduce<Map<string, Entry[]>>((result, entry) => {
    result.set(entry.entryDate, [...(result.get(entry.entryDate) ?? []), entry])
    return result
  }, new Map())

  return (
    <section className="timeline" aria-label={zhTW.entries.timeline}>
      {entries.length === 0 && <p>{zhTW.entries.empty}</p>}
      {[...groups.entries()].map(([entryDate, dateEntries]) => (
        <section className="timeline__group" key={entryDate}>
          <h2>{entryDate}</h2>
          {dateEntries.map((entry) => <EntryCard key={entry.id} entry={entry} categoryName={categoryNameById.get(entry.categoryId) ?? zhTW.entries.unknownCategory} onEdit={onEdit} onDelete={onDelete} />)}
        </section>
      ))}
      {nextCursor !== null && <button type="button" onClick={onLoadMore} disabled={isLoadingMore}>{isLoadingMore ? zhTW.entries.loading : zhTW.entries.loadMore}</button>}
    </section>
  )
}
