import { useEffect, useState } from 'react'
import type { Category, DailyEntries, Entry, EntryInput } from './domain/journal'
import { toFilterCriteria } from './domain/journal'
import { Icon } from './components/icon'
import { zhTW } from './i18n/zh-TW'
import { JournalApiClient } from './services/journal-api-client'
import { CategoryManager } from './features/categories/category-manager'
import { CalendarView } from './features/entries/calendar-view'
import { downloadCsv, createCsvBlob } from './features/entries/csv-download'
import { EntryDetail } from './features/entries/entry-detail'
import { EntryForm } from './features/entries/entry-form'
import { FilterBar } from './features/entries/filter-bar'
import { Timeline } from './features/entries/timeline'
import { ConnectionScreen } from './features/journal/connection-screen'
import { useJournal, type JournalClient } from './features/journal/use-journal'
import {
  getInitialView,
  readViewPreference,
  saveViewPreference,
  type JournalView,
} from './features/journal/view-preference'
import { getJournalMonth, getLocalDate, monthParts } from './utils/date'
import './styles/global.css'

type AppProps = {
  client?: JournalClient
}

type Page = JournalView | 'categories' | 'export'

export function App({ client }: AppProps) {
  const [journalClient] = useState<JournalClient>(() => client ?? new JournalApiClient())
  const journal = useJournal(journalClient)
  const [page, setPage] = useState<Page>(() => getInitialPage())
  const [calendarMonth, setCalendarMonth] = useState(() => getLocalDate().slice(0, 7))
  const [calendarDays, setCalendarDays] = useState<DailyEntries[]>([])
  const [calendarError, setCalendarError] = useState<string>()
  const [isCalendarLoading, setIsCalendarLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>()
  const [selectedDateEntries, setSelectedDateEntries] = useState<Entry[]>([])
  const [selectedEntry, setSelectedEntry] = useState<Entry>()
  const [editingEntry, setEditingEntry] = useState<Entry | null | undefined>()
  const [isExporting, setIsExporting] = useState<'filtered' | 'all'>()
  const [exportError, setExportError] = useState<string>()

  const {
    status,
    error,
    timezone,
    categories,
    categoryEntryCounts,
    tagSuggestions,
    entries,
    nextCursor,
    filter,
    isLoadingEntries,
    revision,
    signIn,
    retry,
    signOut,
    updateFilter,
    loadMore,
    saveEntry,
    deleteEntry,
    saveCategory,
    deactivateCategory,
    activateCategory,
    loadCategoryEntryPage,
    moveEntries,
    deleteCategory,
    exportEntries,
    handleRequestError,
  } = journal
  const journalTimezone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    if (timezone) setCalendarMonth(getJournalMonth(timezone))
  }, [timezone])

  useEffect(() => {
    if (status !== 'signed-out') return
    setCalendarDays([])
    setCalendarError(undefined)
    setIsCalendarLoading(false)
    setSelectedDate(undefined)
    setSelectedDateEntries([])
    setSelectedEntry(undefined)
    setEditingEntry(undefined)
    setIsExporting(undefined)
    setExportError(undefined)
  }, [status])

  useEffect(() => {
    if (status !== 'ready' || page !== 'calendar') return

    let cancelled = false
    const { year, month } = monthParts(calendarMonth)
    setIsCalendarLoading(true)
    setCalendarError(undefined)
    void journalClient.run<DailyEntries[]>({
      action: 'getMonthlyEntries',
      year,
      month,
      filter: toFilterCriteria(filter),
    }).then((counts) => {
      if (!cancelled) setCalendarDays(counts)
    }).catch((loadError: unknown) => {
      if (!cancelled) {
        setCalendarDays([])
        setCalendarError(toErrorMessage(loadError))
        handleRequestError(loadError)
      }
    }).finally(() => {
      if (!cancelled) setIsCalendarLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [calendarMonth, filter, handleRequestError, journalClient, page, revision, status])

  useEffect(() => {
    if (status !== 'ready' || page !== 'calendar' || !selectedDate) return

    let cancelled = false
    setIsCalendarLoading(true)
    setCalendarError(undefined)
    void journalClient.run<Entry[]>({
      action: 'getEntriesForDate',
      date: selectedDate,
      filter: toFilterCriteria(filter),
    }).then((dateEntries) => {
      if (!cancelled) setSelectedDateEntries(dateEntries)
    }).catch((loadError: unknown) => {
      if (!cancelled) {
        setSelectedDateEntries([])
        setCalendarError(toErrorMessage(loadError))
        handleRequestError(loadError)
      }
    }).finally(() => {
      if (!cancelled) setIsCalendarLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [filter, handleRequestError, journalClient, page, revision, selectedDate, status])

  if (status !== 'ready') {
    return (
      <ConnectionScreen
        status={status}
        error={error}
        onSignIn={signIn}
        onRetry={() => void retry()}
      />
    )
  }

  const navigate = (nextPage: Page) => {
    if (nextPage === 'timeline' || nextPage === 'calendar') saveViewPreference(nextPage)
    setSelectedDate(undefined)
    setSelectedEntry(undefined)
    setPage(nextPage)
  }

  const handleSaveEntry = async (input: EntryInput) => {
    const saved = await saveEntry(input)
    setEditingEntry(undefined)
    setSelectedEntry((current) => current?.id === saved.id ? saved : current)
  }

  const handleDeleteEntry = async (id: string) => {
    await deleteEntry(id)
    setSelectedEntry((current) => current?.id === id ? undefined : current)
    setSelectedDateEntries((current) => current.filter((entry) => entry.id !== id))
  }

  const handleSelectDate = (date: string) => {
    setCalendarError(undefined)
    setSelectedDateEntries([])
    setSelectedDate(date)
  }

  const handleExport = async (scope: 'filtered' | 'all') => {
    setIsExporting(scope)
    setExportError(undefined)
    try {
      const data = await exportEntries(scope)
      downloadCsv(createCsvBlob(data.headers, data.rows), `daily-journal-${getLocalDate()}.csv`)
    } catch (downloadError) {
      setExportError(toErrorMessage(downloadError))
    } finally {
      setIsExporting(undefined)
    }
  }

  const handleSignOut = () => {
    signOut()
    setPage(getInitialPage())
  }

  if (selectedEntry) {
    return (
      <main className="focused-screen">
        <EntryDetail
          entry={selectedEntry}
          categoryName={categories.find((category) => category.id === selectedEntry.categoryId)?.name ?? zhTW.detail.category}
          timezone={journalTimezone}
          onBack={() => setSelectedEntry(undefined)}
          onEdit={() => setEditingEntry(selectedEntry)}
          onDelete={() => handleDeleteEntry(selectedEntry.id)}
        />
        {editingEntry && renderEditor(editingEntry, categories, tagSuggestions, journalTimezone, handleSaveEntry, () => setEditingEntry(undefined))}
      </main>
    )
  }

  return (
    <div className="app-shell">
      <DesktopNavigation page={page} onNavigate={navigate} onCreate={() => setEditingEntry(null)} onSignOut={handleSignOut} />
      <div className="app-shell__workspace">
        <MobileHeader onCreate={() => setEditingEntry(null)} onSignOut={handleSignOut} />
        <main className="app-main">
          {(page === 'timeline' || page === 'calendar') && (
            <>
              <header className="page-heading app-main__heading">
                <div>
                  <h1>{page === 'timeline' ? zhTW.navigation.timeline : zhTW.navigation.calendar}</h1>
                  <p>{page === 'timeline' ? zhTW.app.timelineDescription : zhTW.app.tagline}</p>
                </div>
                <ViewToggle page={page} onNavigate={navigate} />
              </header>
              <FilterBar filter={filter} categories={categories.filter((category) => category.isActive)} tagSuggestions={tagSuggestions} onChange={(changes) => void updateFilter(changes)} />
              {error && (
                <section className="page-error" role="alert">
                  <p>{error}</p>
                  <button className="button button--secondary" type="button" onClick={() => void retry()}>{zhTW.connection.retry}</button>
                </section>
              )}
            </>
          )}

          {page === 'timeline' && (
            <Timeline
              entries={entries}
              categories={categories}
              timezone={journalTimezone}
              nextCursor={nextCursor}
              isLoading={isLoadingEntries}
              onLoadMore={() => void loadMore()}
              onOpen={setSelectedEntry}
              onEdit={setEditingEntry}
              onDelete={handleDeleteEntry}
              onCreate={() => setEditingEntry(null)}
            />
          )}

          {page === 'calendar' && !selectedDate && (
            <>
              {calendarError && <p className="form-error" role="alert">{calendarError}</p>}
              {isCalendarLoading && <p className="loading-note" role="status">{zhTW.connection.connecting}</p>}
              <CalendarView
                month={calendarMonth}
                days={calendarDays}
                timezone={journalTimezone}
                onMonthChange={setCalendarMonth}
                onSelectDate={handleSelectDate}
                onOpenEntry={setSelectedEntry}
              />
            </>
          )}

          {page === 'calendar' && selectedDate && (
            <section className="calendar-selection">
              <header className="calendar-selection__header">
                <button className="button button--text" type="button" onClick={() => setSelectedDate(undefined)}>
                  <Icon>arrow_back</Icon>
                  {zhTW.actions.backToCalendar}
                </button>
                <h2>{zhTW.calendar.selectedDateTitle(selectedDate)}</h2>
              </header>
              <Timeline
                entries={selectedDateEntries}
                categories={categories}
                timezone={journalTimezone}
                nextCursor={null}
                isLoading={isCalendarLoading}
                onLoadMore={() => undefined}
                onOpen={setSelectedEntry}
                onEdit={setEditingEntry}
                onDelete={handleDeleteEntry}
                onCreate={() => setEditingEntry(null)}
              />
            </section>
          )}

          {page === 'categories' && (
            <CategoryManager
              categories={categories}
              entryCounts={categoryEntryCounts}
              onLoadEntryPage={loadCategoryEntryPage}
              onMoveEntries={moveEntries}
              onDelete={deleteCategory}
              onSave={saveCategory}
              onDeactivate={deactivateCategory}
              onActivate={activateCategory}
            />
          )}

          {page === 'export' && (
            <section className="export-panel" aria-labelledby="export-title">
              <span className="export-panel__icon"><Icon filled>file_download</Icon></span>
              <h1 id="export-title">{zhTW.export.title}</h1>
              <p>{zhTW.export.description}</p>
              {exportError && <p className="form-error" role="alert">{exportError}</p>}
              <div className="export-panel__actions">
                <button className="button button--primary" type="button" disabled={Boolean(isExporting)} onClick={() => void handleExport('filtered')}>
                  <Icon>filter_alt</Icon>
                  {isExporting === 'filtered' ? zhTW.export.exporting : zhTW.export.filtered}
                </button>
                <button className="button button--secondary" type="button" disabled={Boolean(isExporting)} onClick={() => void handleExport('all')}>
                  <Icon>download</Icon>
                  {isExporting === 'all' ? zhTW.export.exporting : zhTW.export.all}
                </button>
              </div>
            </section>
          )}
        </main>
        {(page === 'timeline' || page === 'calendar') && (
          <button className="mobile-fab" type="button" aria-label={zhTW.actions.addEntry} onClick={() => setEditingEntry(null)}>
            <Icon filled>add</Icon>
          </button>
        )}
        <MobileNavigation page={page} onNavigate={navigate} />
      </div>
      {editingEntry !== undefined && renderEditor(editingEntry ?? undefined, categories, tagSuggestions, journalTimezone, handleSaveEntry, () => setEditingEntry(undefined))}
    </div>
  )
}

function renderEditor(
  entry: Entry | undefined,
  categories: Category[],
  tagSuggestions: string[],
  timezone: string,
  onSave: (input: EntryInput) => Promise<void>,
  onClose: () => void,
) {
  return (
    <div className="editor-overlay" role="presentation">
      <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="entry-editor-title">
        <header className="editor-modal__header">
          <div>
            <button className="icon-button" type="button" aria-label={zhTW.actions.close} onClick={onClose}><Icon>close</Icon></button>
            <h1 id="entry-editor-title">{entry ? zhTW.form.editTitle : zhTW.form.createTitle}</h1>
          </div>
        </header>
        <EntryForm entry={entry} categories={categories} tagSuggestions={tagSuggestions} timezone={timezone} onSave={onSave} onCancel={onClose} />
      </section>
    </div>
  )
}

function DesktopNavigation({ page, onNavigate, onCreate, onSignOut }: {
  page: Page
  onNavigate: (page: Page) => void
  onCreate: () => void
  onSignOut: () => void
}) {
  const items: Array<{ page: Page; label: string; icon: string }> = [
    { page: 'timeline', label: zhTW.navigation.timeline, icon: 'timeline' },
    { page: 'calendar', label: zhTW.navigation.calendar, icon: 'calendar_month' },
    { page: 'categories', label: zhTW.navigation.categories, icon: 'category' },
    { page: 'export', label: zhTW.navigation.export, icon: 'ios_share' },
  ]

  return (
    <aside className="desktop-nav">
      <div className="desktop-nav__brand">
        <span className="desktop-nav__brand-mark"><Icon filled>edit_note</Icon></span>
        <div><h1>{zhTW.app.name}</h1><small>{zhTW.app.tagline}</small></div>
      </div>
      <button className="button button--primary desktop-nav__create" type="button" onClick={onCreate}><Icon filled>add</Icon>{zhTW.actions.addEntry}</button>
      <nav aria-label={zhTW.accessibility.primaryNavigation}>
        {items.map((item) => (
          <button className={`nav-item${page === item.page ? ' nav-item--active' : ''}`} type="button" key={item.page} aria-current={page === item.page ? 'page' : undefined} onClick={() => onNavigate(item.page)}>
            <Icon filled={page === item.page}>{item.icon}</Icon>{item.label}
          </button>
        ))}
      </nav>
      <div className="desktop-nav__footer">
        <span><Icon>lock</Icon>{zhTW.accessibility.sheetStorageNotice}</span>
        <button className="button button--text desktop-nav__sign-out" type="button" onClick={onSignOut}>
          <Icon>logout</Icon>{zhTW.actions.signOut}
        </button>
      </div>
    </aside>
  )
}

function MobileHeader({ onCreate, onSignOut }: { onCreate: () => void; onSignOut: () => void }) {
  return (
    <header className="mobile-header">
      <div><strong>{zhTW.app.name}</strong><small>{zhTW.app.tagline}</small></div>
      <div className="mobile-header__actions">
        <button className="icon-button" type="button" aria-label={zhTW.actions.signOut} onClick={onSignOut}><Icon>logout</Icon></button>
        <button className="icon-button" type="button" aria-label={zhTW.actions.addEntry} onClick={onCreate}><Icon filled>add</Icon></button>
      </div>
    </header>
  )
}

function MobileNavigation({ page, onNavigate }: { page: Page; onNavigate: (page: Page) => void }) {
  const items: Array<{ page: Page; label: string; icon: string }> = [
    { page: 'timeline', label: zhTW.navigation.timeline, icon: 'timeline' },
    { page: 'calendar', label: zhTW.navigation.calendar, icon: 'calendar_month' },
    { page: 'categories', label: zhTW.navigation.categories, icon: 'category' },
    { page: 'export', label: zhTW.navigation.export, icon: 'ios_share' },
  ]
  return (
    <nav className="mobile-nav" aria-label={zhTW.accessibility.primaryNavigation}>
      {items.map((item) => (
        <button className={`mobile-nav__item${page === item.page ? ' mobile-nav__item--active' : ''}`} type="button" key={item.page} aria-current={page === item.page ? 'page' : undefined} onClick={() => onNavigate(item.page)}>
          <Icon filled={page === item.page}>{item.icon}</Icon>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

function ViewToggle({ page, onNavigate }: { page: Page; onNavigate: (page: Page) => void }) {
  return (
    <div className="view-toggle" aria-label={zhTW.accessibility.viewToggle}>
      <button type="button" aria-pressed={page === 'timeline'} onClick={() => onNavigate('timeline')}><Icon filled={page === 'timeline'}>timeline</Icon><span>{zhTW.navigation.timeline}</span></button>
      <button type="button" aria-pressed={page === 'calendar'} onClick={() => onNavigate('calendar')}><Icon filled={page === 'calendar'}>calendar_month</Icon><span>{zhTW.navigation.calendar}</span></button>
    </div>
  )
}

function getInitialPage(): JournalView {
  return getInitialView(window.innerWidth, readViewPreference())
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : zhTW.errors.generic
}
