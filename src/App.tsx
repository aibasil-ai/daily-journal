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
  const currentJournalMonth = month ?? currentMonth(journal.bootstrap?.timezone)

  useEffect(() => {
    if (journal.status !== 'ready' || view !== 'calendar') return
    void journal.loadMonthlyEntryCounts(currentJournalMonth)
  }, [journal.status, view, currentJournalMonth, journal.filter.query, journal.filter.from, journal.filter.to, journal.filter.categoryId, journal.filter.tag, journal.monthlyEntryCountsRevision])

  function changeView(nextView: JournalView) {
    setView(nextView)
    saveViewPreference(nextView)
  }

  async function selectCalendarDate(date: string) {
    const entries = await journal.getEntriesForDate(date)
    if (!entries?.length) return
    if (entries.length === 1) setReadingEntry(entries[0])
    else setSelectedDateEntries(entries)
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
        <div className="journal-layout">
          {view !== 'categories' && (
            <FilterBar
              categories={journal.categories}
              tagSuggestions={journal.tagSuggestions}
              filter={journal.filter}
              onChange={journal.setFilter}
            />
          )}
          <section className="journal-layout__content">
            {view === 'timeline' ? (
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
            ) : view === 'calendar' ? (
              <CalendarView
                month={currentJournalMonth}
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
            setReadingEntry(undefined)
          }}
          onRequestClose={() => setReadingEntry(undefined)}
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
