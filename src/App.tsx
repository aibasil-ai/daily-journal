import { useEffect, useRef, useState } from 'react'
import { EntryForm } from './features/entries/entry-form'
import { CalendarView } from './features/entries/calendar-view'
import { downloadCsv } from './features/entries/csv-download'
import { FilterBar } from './features/entries/filter-bar'
import { Timeline } from './features/entries/timeline'
import { CategoryManager } from './features/categories/category-manager'
import { ConnectionScreen } from './features/journal/connection-screen'
import { SessionEndedError, type JournalClient, useJournal } from './features/journal/use-journal'
import { getInitialView, loadViewPreference, saveViewPreference, type JournalView } from './features/journal/view-preference'
import type { Entry } from './domain/journal'
import { monthInTimeZone } from './domain/time-zone'
import { zhTW } from './i18n/zh-TW'
import { JournalApiClient } from './services/journal-api-client'

type AppProps = {
  client?: JournalClient
}

export function App({ client }: AppProps) {
  const [journalClient] = useState<JournalClient>(() => client ?? new JournalApiClient())
  const loginError = getLoginError()

  return (
    <main>
      <h1>{zhTW.appTitle}</h1>
      <JournalApplication client={journalClient} loginError={loginError} />
    </main>
  )
}

function JournalApplication({ client, loginError }: { client: JournalClient, loginError?: string }) {
  const journal = useJournal(client)
  const [editingEntry, setEditingEntry] = useState<Entry | undefined>()
  const [view, setView] = useState<JournalView>(() => getInitialView(typeof window === 'undefined' ? 1024 : window.innerWidth, loadViewPreference()))
  const [month, setMonth] = useState<string | undefined>()
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | undefined>()
  const exportSessionEpoch = useRef(0)
  const currentJournalMonth = month ?? currentMonth(journal.bootstrap?.timezone)

  useEffect(() => {
    if (journal.status !== 'ready' || view !== 'calendar') return
    void journal.loadMonthlyEntryCounts(currentJournalMonth)
  }, [journal.status, view, currentJournalMonth, journal.filter.query, journal.filter.from, journal.filter.to, journal.filter.categoryId, journal.filter.tag, journal.monthlyEntryCountsRevision])

  function changeView(nextView: JournalView) {
    setView(nextView)
    saveViewPreference(nextView)
  }

  async function exportEntries(scope: 'filtered' | 'all') {
    if (isExporting) return

    const requestSession = exportSessionEpoch.current
    setIsExporting(true)
    setExportError(undefined)
    try {
      const result = await journal.exportEntries(scope)
      if (requestSession !== exportSessionEpoch.current) return
      downloadCsv(result.headers, result.rows)
    } catch (error) {
      if (requestSession !== exportSessionEpoch.current || error instanceof SessionEndedError) return
      setExportError(error instanceof Error ? error.message : zhTW.api.requestFailed)
    } finally {
      if (requestSession === exportSessionEpoch.current) setIsExporting(false)
    }
  }

  function signOut() {
    exportSessionEpoch.current += 1
    setEditingEntry(undefined)
    setMonth(undefined)
    setIsExporting(false)
    setExportError(undefined)
    journal.signOut()
  }

  if (journal.status === 'ready') {
    const categoryNameById = new Map(journal.categories.map((category) => [category.id, category.name]))

    return (
      <div className="journal-application">
        <div className="journal-application__header">
          <p>{zhTW.journal.ready}</p>
          <button type="button" className="button--secondary" onClick={signOut}>{zhTW.journal.signOut}</button>
        </div>
        <div className="view-switcher" role="group" aria-label={zhTW.journal.viewMode}>
          <button type="button" className={view === 'timeline' ? '' : 'button--secondary'} aria-pressed={view === 'timeline'} onClick={() => changeView('timeline')}>{zhTW.journal.timelineView}</button>
          <button type="button" className={view === 'calendar' ? '' : 'button--secondary'} aria-pressed={view === 'calendar'} onClick={() => changeView('calendar')}>{zhTW.journal.calendarView}</button>
        </div>
        {journal.error && <p className="journal-error" role="alert">{journal.error}</p>}
        <div className="journal-layout">
          <section id="entry-form">
            <EntryForm
              key={editingEntry?.id ?? 'new'}
              entry={editingEntry}
              categories={journal.categories}
              timezone={journal.bootstrap?.timezone}
              tagSuggestions={journal.tagSuggestions}
              onSave={async (input) => {
                await journal.saveEntry(input)
                setEditingEntry(undefined)
              }}
              onCancel={editingEntry ? () => setEditingEntry(undefined) : undefined}
            />
            <CategoryManager categories={journal.categories} onSave={journal.saveCategory} onDeactivate={journal.deactivateCategory} />
          </section>
          <section className="journal-layout__content">
            <FilterBar
              categories={journal.categories}
              tagSuggestions={journal.tagSuggestions}
              filter={journal.filter}
              onChange={journal.setFilter}
            />
            <section className="csv-export" aria-labelledby="csv-export-title">
              <h2 id="csv-export-title">{zhTW.exports.title}</h2>
              {exportError && <p className="csv-export__error" role="alert">{exportError}</p>}
              <div className="csv-export__actions">
                <button type="button" onClick={() => exportEntries('filtered')} disabled={isExporting}>{zhTW.exports.filtered}</button>
                <button type="button" className="button--secondary" onClick={() => exportEntries('all')} disabled={isExporting}>{zhTW.exports.all}</button>
              </div>
            </section>
            {view === 'calendar' && (
              <CalendarView
                month={currentJournalMonth}
                counts={journal.monthlyEntryCounts}
                onMonthChange={setMonth}
                onSelectDate={journal.getEntriesForDate}
              />
            )}
            <Timeline
              entries={journal.entries}
              categoryNameById={categoryNameById}
              nextCursor={view === 'timeline' ? journal.nextCursor : null}
              isLoadingMore={journal.isLoadingEntries}
              onEdit={setEditingEntry}
              onDelete={journal.deleteEntry}
              onLoadMore={() => journal.loadEntries({ ...journal.filter, cursor: journal.nextCursor }, true)}
            />
          </section>
        </div>
        <button type="button" className="entry-form__mobile-add" onClick={() => document.getElementById('entry-form')?.scrollIntoView()}>{zhTW.entries.add}</button>
      </div>
    )
  }

  return (
    <ConnectionScreen
      status={journal.status}
      error={journal.error}
      loginError={loginError}
      onSignIn={journal.signIn}
      onRetry={journal.retry}
    />
  )
}

export function currentMonth(timezone: string | undefined, date = new Date()): string {
  return monthInTimeZone(timezone, date)
}

function getLoginError(): string | undefined {
  if (typeof window === 'undefined') return undefined

  return new URLSearchParams(window.location.search).get('login_error') === 'oauth_failed'
    ? zhTW.auth.oauthFailed
    : undefined
}
