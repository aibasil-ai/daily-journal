import { useEffect, useState } from 'react'
import type { Category, DailyEntries, Entry } from '../../domain/journal'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'
import {
  formatCalendarMonthDay,
  formatCalendarWeekday,
  getCalendarDateRange,
  listCalendarDates,
} from './calendar-date'
import { WeekEntryCard } from './week-entry-card'

type CalendarWeekViewProps = {
  anchorDate: string
  today: string
  days: DailyEntries[]
  categories: Category[]
  expansionResetKey: string
  onFocusDate: (date: string) => void
  onOpenEntry: (entry: Entry) => void
  onCreateEntry: (date: string) => void
}

const VISIBLE_ENTRIES_PER_DAY = 3

export function CalendarWeekView({
  anchorDate,
  today,
  days,
  categories,
  expansionResetKey,
  onFocusDate,
  onOpenEntry,
  onCreateEntry,
}: CalendarWeekViewProps) {
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set())
  const { from, to } = getCalendarDateRange('week', anchorDate)
  const dates = listCalendarDates(from, to)
  const entriesByDate = new Map(days.map((day) => [day.date, day.entries]))
  const categoriesById = new Map(categories.map((category) => [category.id, category]))

  useEffect(() => {
    setExpandedDates(new Set())
  }, [expansionResetKey])

  return (
    <div className="calendar-week-view">
      {dates.map((date) => {
        const entries = entriesByDate.get(date) ?? []
        const expanded = expandedDates.has(date)
        const visibleEntries = expanded ? entries : entries.slice(0, VISIBLE_ENTRIES_PER_DAY)
        const hiddenCount = entries.length - VISIBLE_ENTRIES_PER_DAY
        const headingId = `calendar-week-date-${date}`
        const entriesId = `calendar-week-entries-${date}`
        const headingParts = [
          formatCalendarWeekday(date),
          formatCalendarMonthDay(date),
          zhTW.calendar.entryCount(entries.length),
          date === today ? zhTW.calendar.todayIndicator : '',
          date === anchorDate ? zhTW.calendar.anchorDateIndicator : '',
        ].filter(Boolean)

        return (
          <section
            className={`calendar-week-day${date === today ? ' calendar-week-day--today' : ''}${date === anchorDate ? ' calendar-week-day--focused' : ''}`}
            role="region"
            aria-labelledby={headingId}
            key={date}
          >
            <h3 id={headingId} className="calendar-week-day__header">
              <button type="button" onClick={() => onFocusDate(date)}>
                {headingParts.map((part) => <span key={part}>{part}</span>)}
              </button>
            </h3>
            {entries.length > 0 && (
              <div className="calendar-week-day__entries" id={entriesId}>
                {visibleEntries.map((entry) => {
                  const category = categoriesById.get(entry.categoryId)
                  return (
                    <WeekEntryCard
                      key={entry.id}
                      entry={entry}
                      categoryName={category?.name ?? zhTW.detail.category}
                      categoryColor={category?.color ?? null}
                      onOpen={() => {
                        onFocusDate(date)
                        onOpenEntry(entry)
                      }}
                    />
                  )
                })}
              </div>
            )}
            {entries.length > VISIBLE_ENTRIES_PER_DAY && (
              <button
                className="calendar-week-day__expand"
                type="button"
                aria-expanded={expanded}
                aria-controls={entriesId}
                onClick={() => {
                  onFocusDate(date)
                  setExpandedDates((current) => {
                    const next = new Set(current)
                    if (expanded) next.delete(date)
                    else next.add(date)
                    return next
                  })
                }}
              >
                {expanded ? zhTW.actions.collapse : zhTW.calendar.moreCompactEntries(hiddenCount)}
              </button>
            )}
            <button
              className="calendar-week-day__create"
              type="button"
              aria-label={zhTW.calendar.addEntryForSpecificDate(date)}
              onClick={() => {
                onFocusDate(date)
                onCreateEntry(date)
              }}
            >
              <Icon filled>add</Icon>
              <span>{zhTW.actions.addEntry}</span>
            </button>
          </section>
        )
      })}
    </div>
  )
}