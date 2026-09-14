import { useState } from 'react'
import type { Category, DailyEntries, Entry } from '../../domain/journal'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'
import { categoryColorStyle } from '../../utils/category-color'
import { getCalendarDateRange } from './calendar-date'

const VISIBLE_ENTRIES_PER_DAY = 2

type CalendarMonthViewProps = {
  anchorDate: string
  today: string
  days: DailyEntries[]
  categories: Category[]
  onFocusDate: (date: string) => void
  onSelectDate: (date: string) => void
  onOpenEntry: (entry: Entry) => void
}

export function CalendarMonthView({
  anchorDate,
  today,
  days,
  categories,
  onFocusDate,
  onSelectDate,
  onOpenEntry,
}: CalendarMonthViewProps) {
  const [overflowDate, setOverflowDate] = useState<string>()
  const year = Number(anchorDate.slice(0, 4))
  const month = Number(anchorDate.slice(5, 7))
  const entriesByDate = new Map(days.map((day) => [day.date, day.entries]))
  const categoriesById = new Map(categories.map((category) => [category.id, category]))
  const overflowEntries = overflowDate ? entriesByDate.get(overflowDate) : undefined

  return (
    <div className="calendar-month-view">
      <div className="calendar-grid" role="grid" aria-label={zhTW.calendar.monthLabel(year, month)}>
        {zhTW.calendar.weekdays.map((weekday) => (
          <div className="calendar-grid__weekday" role="columnheader" key={weekday}>{weekday}</div>
        ))}
        {createMonthCells(anchorDate).map((cell, index) => {
          if (!cell) {
            return <div className="calendar-grid__cell calendar-grid__cell--empty" role="gridcell" key={`empty-${index}`} />
          }

          const entries = entriesByDate.get(cell) ?? []
          const count = entries.length
          const visibleEntries = entries.slice(0, VISIBLE_ENTRIES_PER_DAY)
          const hiddenEntryCount = count - visibleEntries.length
          const dateLabel = [
            zhTW.calendar.selectDate(cell, count),
            cell === today ? zhTW.calendar.todayIndicator : '',
            cell === anchorDate ? zhTW.calendar.anchorDateIndicator : '',
          ].filter(Boolean).join('，')

          return (
            <div
              className={`calendar-grid__cell${count ? ' calendar-grid__cell--has-entries' : ''}`}
              role="gridcell"
              key={cell}
              onClick={() => {
                if (!count) return
                onFocusDate(cell)
                onSelectDate(cell)
              }}
            >
              <button
                type="button"
                className={`calendar-day${count ? ' calendar-day--has-entries' : ''}${cell === today ? ' calendar-day--today' : ''}${cell === anchorDate ? ' calendar-day--focused' : ''}`}
                aria-label={dateLabel}
                aria-current={cell === today ? 'date' : undefined}
                disabled={count === 0}
                onClick={(event) => {
                  event.stopPropagation()
                  onFocusDate(cell)
                  onSelectDate(cell)
                }}
              >
                <span>{Number(cell.slice(-2))}</span>
              </button>
              {count > 0 && (
                <div className="calendar-day__entries">
                  {visibleEntries.map((entry) => {
                    const title = entryTitle(entry)
                    const categoryColor = categoriesById.get(entry.categoryId)?.color ?? null
                    return (
                      <button
                        className="calendar-entry"
                        type="button"
                        key={entry.id}
                        title={title}
                        aria-label={`${zhTW.timeline.readEntry}：${title}`}
                        style={categoryColorStyle(categoryColor)}
                        onClick={(event) => {
                          event.stopPropagation()
                          onFocusDate(cell)
                          onOpenEntry(entry)
                        }}
                      >
                        {title}
                      </button>
                    )
                  })}
                  {hiddenEntryCount > 0 && (
                    <button
                      className="calendar-entry calendar-entry--more"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onFocusDate(cell)
                        setOverflowDate(cell)
                      }}
                    >
                      {zhTW.calendar.moreEntries(hiddenEntryCount)}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {overflowDate && overflowEntries && (
        <ConfirmDialog labelledBy={`calendar-overflow-${overflowDate}`} onCancel={() => setOverflowDate(undefined)}>
          <div className="calendar-entry-picker">
            <header className="calendar-entry-picker__header">
              <span className="confirm-dialog__icon calendar-entry-picker__icon"><Icon>format_list_bulleted</Icon></span>
              <div>
                <h2 id={`calendar-overflow-${overflowDate}`}>{zhTW.calendar.chooseEntryTitle(overflowDate)}</h2>
                <p>{zhTW.calendar.chooseEntryDescription}</p>
              </div>
            </header>
            <div className="calendar-entry-picker__list">
              {overflowEntries.map((entry) => {
                const title = entryTitle(entry)
                const categoryColor = categoriesById.get(entry.categoryId)?.color ?? null
                return (
                  <button
                    className="calendar-entry-picker__item"
                    type="button"
                    key={entry.id}
                    title={title}
                    style={categoryColorStyle(categoryColor)}
                    onClick={() => {
                      onFocusDate(overflowDate)
                      setOverflowDate(undefined)
                      onOpenEntry(entry)
                    }}
                  >
                    <span className="calendar-entry-picker__title">{title}</span>
                    <Icon>chevron_right</Icon>
                  </button>
                )
              })}
            </div>
            <div className="confirm-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                data-dialog-initial-focus
                onClick={() => setOverflowDate(undefined)}
              >
                {zhTW.actions.cancel}
              </button>
            </div>
          </div>
        </ConfirmDialog>
      )}
    </div>
  )
}

function entryTitle(entry: Entry): string {
  return entry.title || entry.content.slice(0, 48) || zhTW.timeline.untitled
}

function createMonthCells(anchorDate: string): Array<string | null> {
  const year = Number(anchorDate.slice(0, 4))
  const month = Number(anchorDate.slice(5, 7))
  const first = new Date(0)
  first.setUTCFullYear(year, month - 1, 1)
  const firstWeekday = (first.getUTCDay() + 6) % 7
  const daysInMonth = Number(getCalendarDateRange('month', anchorDate).to.slice(-2))
  const cells: Array<string | null> = Array.from({ length: firstWeekday }, () => null)

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}