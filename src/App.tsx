import { useEffect, useState } from 'react'
import { loadRuntimeConfig } from './config/runtime-config'
import { EntryForm } from './features/entries/entry-form'
import { CalendarView } from './features/entries/calendar-view'
import { downloadCsv } from './features/entries/csv-download'
import { FilterBar } from './features/entries/filter-bar'
import { Timeline } from './features/entries/timeline'
import { CategoryManager } from './features/categories/category-manager'
import { ConnectionScreen } from './features/journal/connection-screen'
import { type JournalClient, useJournal } from './features/journal/use-journal'
import { getInitialView, loadViewPreference, saveViewPreference, type JournalView } from './features/journal/view-preference'
import type { Entry } from './domain/journal'
import { zhTW } from './i18n/zh-TW'
import { GoogleOAuth } from './services/google-oauth'
import { ExecutionClient } from './services/execution-client'

type AppProps = {
  client?: JournalClient
}

type ConfigurationState =
  | { status: 'checking-config' }
  | { status: 'ready'; client: JournalClient }
  | { status: 'error'; error: string }

export function App({ client }: AppProps) {
  const [configuration, setConfiguration] = useState<ConfigurationState>(() => (
    client ? { status: 'ready', client } : { status: 'checking-config' }
  ))
  const [configurationAttempt, setConfigurationAttempt] = useState(0)

  useEffect(() => {
    if (client) return

    try {
      const config = loadRuntimeConfig()
      const oauth = new GoogleOAuth(config)
      const executionClient = new ExecutionClient(config, oauth)
      setConfiguration({
        status: 'ready',
        client: {
          signIn: () => oauth.getAccessToken('consent').then(() => undefined),
          run: (request) => executionClient.run(request),
        },
      })
    } catch (error) {
      setConfiguration({
        status: 'error',
        error: error instanceof Error ? error.message : zhTW.api.requestFailed,
      })
    }
  }, [client, configurationAttempt])

  return (
    <main>
      <h1>{zhTW.appTitle}</h1>
      {configuration.status === 'checking-config' && (
        <ConnectionScreen status="checking-config" onSignIn={() => {}} onRetry={() => {}} />
      )}
      {configuration.status === 'error' && (
        <ConnectionScreen
          status="error"
          title={zhTW.journal.configErrorTitle}
          error={configuration.error}
          onSignIn={() => setConfigurationAttempt((attempt) => attempt + 1)}
          onRetry={() => setConfigurationAttempt((attempt) => attempt + 1)}
        />
      )}
      {configuration.status === 'ready' && <JournalApplication client={configuration.client} />}
    </main>
  )
}

function JournalApplication({ client }: { client: JournalClient }) {
  const journal = useJournal(client)
  const [editingEntry, setEditingEntry] = useState<Entry | undefined>()
  const [view, setView] = useState<JournalView>(() => getInitialView(typeof window === 'undefined' ? 1024 : window.innerWidth, loadViewPreference()))
  const [month, setMonth] = useState(currentMonth)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | undefined>()

  useEffect(() => {
    if (journal.status !== 'ready' || view !== 'calendar') return
    void journal.loadMonthlyEntryCounts(month)
  }, [journal.status, view, month, journal.filter.query, journal.filter.from, journal.filter.to, journal.filter.categoryId, journal.filter.tag, journal.monthlyEntryCountsRevision])

  function changeView(nextView: JournalView) {
    setView(nextView)
    saveViewPreference(nextView)
  }

  async function exportEntries(scope: 'filtered' | 'all') {
    if (isExporting) return

    setIsExporting(true)
    setExportError(undefined)
    try {
      const result = await journal.exportEntries(scope)
      downloadCsv(result.headers, result.rows)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : zhTW.api.requestFailed)
    } finally {
      setIsExporting(false)
    }
  }

  if (journal.status === 'ready') {
    return (
      <div className="journal-application">
        <p>{zhTW.journal.ready}</p>
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
                month={month}
                counts={journal.monthlyEntryCounts}
                onMonthChange={setMonth}
                onSelectDate={journal.getEntriesForDate}
              />
            )}
            <Timeline
              entries={journal.entries}
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
      onSignIn={journal.signIn}
      onRetry={journal.retry}
    />
  )
}

function currentMonth(): string {
  const date = new Date()
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 7)
}
