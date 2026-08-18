import { useState } from 'react'
import type { DailyEntries, Entry } from '../../domain/journal'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { zhTW } from '../../i18n/zh-TW'
import { getJournalMonth, monthParts } from '../../utils/date'
import { Icon } from '../../components/icon'

const VISIBLE_ENTRIES_PER_DAY = 2

type CalendarViewProps = {
  month: string
  days: DailyEntries[]
  timezone: string
  onMonthChange: (month: string) => void
  onSelectDate: (date: string) => void
  onOpenEntry: (entry: Entry) => void
}

export function CalendarView({ month, days, timezone, onMonthChange, onSelectDate, onOpenEntry }: CalendarViewProps) {
  const [overflowDay, setOverflowDay] = useState<DailyEntries>()
  const { year, month: monthNumber } = monthParts(month)
  const entriesByDate = new Map(days.map((day) => [day.date, day.entries]))
  const gridCells = createMonthCells(year, monthNumber)

  return (
    <section className="calendar-view" aria-label={zhTW.navigation.calendar}>
      <header className="calendar-view__header">
        <div>
          <h2>{zhTW.calendar.monthTitle(year, monthNumber)}</h2>
          <p>{zhTW.app.calendarDescription(days.reduce((total, day) => total + day.entries.length, 0))}</p>
        </div>
        <div className="calendar-view__controls">
          <button className="icon-button" type="button" aria-label={zhTW.actions.previousMonth} onClick={() => onMonthChange(previousMonth(month))}>
            <Icon>chevron_left</Icon>
          </button>
          <button className="button button--secondary" type="button" onClick={() => onMonthChange(getJournalMonth(timezone))}>
            {zhTW.actions.today}
          </button>
          <button className="icon-button" type="button" aria-label={zhTW.actions.nextMonth} onClick={() => onMonthChange(nextMonth(month))}>
            <Icon>chevron_right</Icon>
          </button>
        </div>
      </header>
      <div className="calendar-grid" role="grid" aria-label={zhTW.calendar.monthLabel(year, monthNumber)}>
        {zhTW.calendar.weekdays.map((weekday) => <div className="calendar-grid__weekday" role="columnheader" key={weekday}>{weekday}</div>)}
        {gridCells.map((cell, index) => {
          if (!cell) return <div className="calendar-grid__cell calendar-grid__cell--empty" role="gridcell" key={`empty-${index}`} />

          const entries = entriesByDate.get(cell) ?? []
          const count = entries.length
          const visibleEntries = entries.slice(0, VISIBLE_ENTRIES_PER_DAY)
          const hiddenEntryCount = entries.length - visibleEntries.length
          return (
            <div
              className={`calendar-grid__cell${count ? ' calendar-grid__cell--has-entries' : ''}`}
              role="gridcell"
              key={cell}
              onClick={() => {
                if (count) onSelectDate(cell)
              }}
            >
              <button
                type="button"
                className={`calendar-day${count ? ' calendar-day--has-entries' : ''}`}
                aria-label={zhTW.calendar.selectDate(cell, count)}
                disabled={count === 0}
                onClick={(event) => {
                  event.stopPropagation()
                  onSelectDate(cell)
                }}
              >
                <span>{Number(cell.slice(-2))}</span>
              </button>
              {count > 0 && (
                <div className="calendar-day__entries">
                  {visibleEntries.map((entry) => {
                    const title = entryTitle(entry)
                    return (
                      <button
                        className="calendar-entry"
                        type="button"
                        key={entry.id}
                        title={title}
                        aria-label={`${zhTW.timeline.readEntry}：${title}`}
                        onClick={(event) => {
                          event.stopPropagation()
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
                        setOverflowDay({ date: cell, entries })
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
      {overflowDay && (
        <ConfirmDialog labelledBy={`calendar-overflow-${overflowDay.date}`} onCancel={() => setOverflowDay(undefined)}>
          <div className="calendar-entry-picker">
            <span className="confirm-dialog__icon"><Icon>format_list_bulleted</Icon></span>
            <h2 id={`calendar-overflow-${overflowDay.date}`}>{zhTW.calendar.chooseEntryTitle(overflowDay.date)}</h2>
            <p>{zhTW.calendar.chooseEntryDescription}</p>
            <div className="calendar-entry-picker__list">
              {overflowDay.entries.map((entry) => {
                const title = entryTitle(entry)
                return (
                  <button
                    className="calendar-entry-picker__item"
                    type="button"
                    key={entry.id}
                    onClick={() => {
                      setOverflowDay(undefined)
                      onOpenEntry(entry)
                    }}
                  >
                    <span>{title}</span>
                    <Icon>chevron_right</Icon>
                  </button>
                )
              })}
            </div>
            <div className="confirm-dialog__actions">
              <button className="button button--secondary" type="button" data-dialog-initial-focus onClick={() => setOverflowDay(undefined)}>
                {zhTW.actions.cancel}
              </button>
            </div>
          </div>
        </ConfirmDialog>
      )}
    </section>
  )
}

function entryTitle(entry: Entry): string {
  return entry.title || entry.content.slice(0, 48) || zhTW.timeline.untitled
}

function createMonthCells(year: number, month: number): Array<string | null> {
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: Array<string | null> = Array.from({ length: firstWeekday }, () => null)

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function previousMonth(month: string): string {
  const { year, month: monthNumber } = monthParts(month)
  const date = new Date(Date.UTC(year, monthNumber - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function nextMonth(month: string): string {
  const { year, month: monthNumber } = monthParts(month)
  const date = new Date(Date.UTC(year, monthNumber, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
