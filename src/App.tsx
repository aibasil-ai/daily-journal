import { useEffect, useRef, useState } from 'react'
import { CalendarView } from './features/entries/calendar-view'
import { downloadCsv } from './features/entries/csv-download'
import { EntryEditorDialog } from './features/entries/entry-editor-dialog'
import { EntryPickerDialog } from './features/entries/entry-picker-dialog'
import { EntryReaderDialog } from './features/entries/entry-reader-dialog'
import { ExportDialog } from './features/entries/export-dialog'
import { FilterBar } from './features/entries/filter-bar'
import { Timeline } from './features/entries/timeline'
import { CategoryManager } from './features/categories/category-manager'
import { AppNavigation } from './features/journal/app-navigation'
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
  const appFocusTargetRef = useRef<HTMLElement>(null)
  const loginError = getLoginError()

  return (
    <main ref={appFocusTargetRef} tabIndex={-1}>
      <h1>{zhTW.appTitle}</h1>
      <JournalApplication client={journalClient} loginError={loginError} appFocusTargetRef={appFocusTargetRef} />
    </main>
  )
}

function JournalApplication({ client, loginError, appFocusTargetRef }: { client: JournalClient, loginError?: string, appFocusTargetRef: { current: HTMLElement | null } }) {
  const journal = useJournal(client)
  const [view, setView] = useState<JournalView>(() => getInitialView(typeof window === 'undefined' ? 1024 : window.innerWidth, loadViewPreference()))
  const [editingEntry, setEditingEntry] = useState<Entry | undefined>()
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [readingEntry, setReadingEntry] = useState<Entry | undefined>()
  const [selectedDateEntries, setSelectedDateEntries] = useState<Entry[]>([])
  const [month, setMonth] = useState<string | undefined>()
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | undefined>()
  const exportSessionEpoch = useRef(0)
  const calendarSelectionEpoch = useRef(0)
  const todayMonth = currentMonth(journal.bootstrap?.timezone)
  const currentJournalMonth = month ?? todayMonth

  useEffect(() => {
    if (journal.status !== 'ready' || view !== 'calendar') return
    void journal.loadMonthlyEntryCounts(currentJournalMonth)
  }, [journal.status, view, currentJournalMonth, journal.filter.query, journal.filter.from, journal.filter.to, journal.filter.categoryId, journal.filter.tag, journal.monthlyEntryCountsRevision])

  function changeView(nextView: JournalView) {
    calendarSelectionEpoch.current += 1
    setView(nextView)
    saveViewPreference(nextView)
  }

  async function selectCalendarDate(date: string) {
    const requestEpoch = ++calendarSelectionEpoch.current
    const entries = await journal.getEntriesForDate(date)
    if (requestEpoch !== calendarSelectionEpoch.current) return
    if (!entries?.length) return
    if (entries.length === 1) setReadingEntry(entries[0])
    else setSelectedDateEntries(entries)
  }

  function focusAppTarget() {
    appFocusTargetRef.current?.focus()
  }

  function closeReader() {
    focusAppTarget()
    setReadingEntry(undefined)
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
    calendarSelectionEpoch.current += 1
    setEditingEntry(undefined)
    setIsEditorOpen(false)
    setReadingEntry(undefined)
    setSelectedDateEntries([])
    setMonth(undefined)
    setIsExportDialogOpen(false)
    setIsExporting(false)
    setExportError(undefined)
    journal.signOut()
  }

  if (journal.status === 'ready') {
    const categoryNameById = new Map(journal.categories.map((category) => [category.id, category.name]))
    const filterProps = {
      categories: journal.categories,
      tagSuggestions: journal.tagSuggestions,
      filter: journal.filter,
      onChange: journal.setFilter,
    }

    return (
      <div className="journal-application">
        <AppNavigation
          view={view}
          onViewChange={changeView}
          onCreateEntry={() => {
            setEditingEntry(undefined)
            setIsEditorOpen(true)
          }}
          onExport={() => setIsExportDialogOpen(true)}
          onSignOut={signOut}
        />
        <p>{zhTW.journal.ready}</p>
        {journal.error && <p className="journal-error" role="alert">{journal.error}</p>}
        <div className={`journal-layout${view === 'timeline' ? ' journal-layout--timeline' : ''}`}>
          {view !== 'categories' && view !== 'timeline' && <FilterBar {...filterProps} />}
          <section className="journal-layout__content">
            {view === 'timeline' ? (
              <>
                <header className="journal-page-header">
                  <div className="journal-page-header__title">
                    <h2>時間軸</h2>
                    <p>回顧您的每一天。</p>
                  </div>
                  <FilterBar variant="timeline" {...filterProps} />
                </header>
                <Timeline
                  entries={journal.entries}
                  categoryNameById={categoryNameById}
                  nextCursor={journal.nextCursor}
                  isLoadingMore={journal.isLoadingEntries}
                  onOpen={setReadingEntry}
                  onEdit={(entry) => {
                    setEditingEntry(entry)
                    setIsEditorOpen(true)
                  }}
                  onDelete={journal.deleteEntry}
                  onLoadMore={() => journal.loadEntries({ ...journal.filter, cursor: journal.nextCursor }, true)}
                />
              </>
            ) : view === 'calendar' ? (
              <CalendarView
                month={currentJournalMonth}
                todayMonth={todayMonth}
                counts={journal.monthlyEntryCounts}
                onMonthChange={setMonth}
                onSelectDate={selectCalendarDate}
              />
            ) : (
              <CategoryManager categories={journal.categories} onSave={journal.saveCategory} onDeactivate={journal.deactivateCategory} />
            )}
          </section>
        </div>
        <EntryEditorDialog
          entry={editingEntry}
          open={isEditorOpen}
          categories={journal.categories}
          tagSuggestions={journal.tagSuggestions}
          timezone={journal.bootstrap?.timezone}
          onSave={journal.saveEntry}
          onDelete={journal.deleteEntry}
          onRequestClose={() => {
            setEditingEntry(undefined)
            setIsEditorOpen(false)
          }}
        />
        <EntryReaderDialog
          entry={readingEntry}
          categoryName={categoryNameById.get(readingEntry?.categoryId ?? '') ?? zhTW.entries.unknownCategory}
          open={Boolean(readingEntry)}
          onEdit={(entry) => {
            setReadingEntry(undefined)
            setEditingEntry(entry)
            setIsEditorOpen(true)
          }}
          onDelete={async (id) => {
            await journal.deleteEntry(id)
          }}
          onRequestClose={closeReader}
          onDeleted={closeReader}
        />
        <EntryPickerDialog
          date={selectedDateEntries[0]?.entryDate}
          entries={selectedDateEntries}
          open={selectedDateEntries.length > 1}
          onSelect={(entry) => {
            setSelectedDateEntries([])
            setReadingEntry(entry)
          }}
          onRequestClose={() => setSelectedDateEntries([])}
        />
        <ExportDialog
          open={isExportDialogOpen}
          isExporting={isExporting}
          error={exportError}
          onExport={exportEntries}
          onRequestClose={() => setIsExportDialogOpen(false)}
        />
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
