import { useCallback, useEffect, useRef, useState } from 'react'
import type { Category, DailyEntries, Entry, EntryInput } from './domain/journal'
import { toFilterCriteria } from './domain/journal'
import { Icon } from './components/icon'
import { zhTW } from './i18n/zh-TW'
import {
  AuthenticationError,
  JournalApiClient,
  type AccountClient,
  type DeleteAccountInput,
  type ProvisioningClient,
  type ProvisioningStatus,
} from './services/journal-api-client'
import { CategoryManager } from './features/categories/category-manager'
import { CalendarFrame } from './features/entries/calendar-frame'
import { CalendarDayView } from './features/entries/calendar-day-view'
import { CalendarWeekView } from './features/entries/calendar-week-view'
import { CalendarMonthView } from './features/entries/calendar-month-view'
import {
  clampCalendarAnchorDate,
  getCalendarDateRange,
  shiftCalendarAnchorDate,
  type CalendarMode,
} from './features/entries/calendar-date'
import {
  readCalendarModePreference,
  saveCalendarModePreference,
} from './features/entries/calendar-mode-preference'
import { downloadCsv, createCsvBlob } from './features/entries/csv-download'
import { EntryDetail } from './features/entries/entry-detail'
import { EntryForm } from './features/entries/entry-form'
import { FilterBar } from './features/entries/filter-bar'
import { Timeline } from './features/entries/timeline'
import { ConnectionScreen } from './features/journal/connection-screen'
import { useJournal, type JournalClient } from './features/journal/use-journal'
import { DataSpaceSetup } from './features/provisioning/data-space-setup'
import { DataConnectionSettings } from './features/settings/data-connection-settings'
import {
  getInitialView,
  readViewPreference,
  saveViewPreference,
  type JournalView,
} from './features/journal/view-preference'
import { getJournalDate, getLocalDate } from './utils/date'
import './styles/global.css'

type AppProps = {
  client?: AppClient
}

type Page = JournalView | 'categories' | 'export' | 'settings'
type AppClient = JournalClient & ProvisioningClient & AccountClient

type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; data: T }
  | { status: 'error'; key: string; message: string }

const WORKSPACE_REVALIDATION_INTERVAL_MS = 2_000
const AUTH_HINT_KEY = 'daily-journal-auth-hint'

function readAuthHint(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(AUTH_HINT_KEY) === '1'
  } catch {
    return false
  }
}

function writeAuthHint(hasAuth: boolean): void {
  try {
    if (typeof window === 'undefined') return
    if (hasAuth) window.localStorage.setItem(AUTH_HINT_KEY, '1')
    else window.localStorage.removeItem(AUTH_HINT_KEY)
  } catch {
    // Ignore storage errors
  }
}

function AppLoadingScreen() {
  return (
    <div className="app-shell app-shell--loading" aria-busy="true" aria-live="polite">
      <div className="app-loading-container">
        <div className="app-loading-spinner" aria-hidden="true" />
        <div className="app-loading-brand">
          <strong>{zhTW.app.name}</strong>
          <span>{zhTW.connection.connecting}</span>
        </div>
      </div>
    </div>
  )
}

export function App({ client }: AppProps) {
  const [journalClient] = useState<AppClient>(() => client ?? new JournalApiClient())
  const [page, setPage] = useState<Page>(() => getInitialPage())
  const journal = useJournal(journalClient, page === 'timeline')
  const [calendarMode, setCalendarMode] = useState<CalendarMode>(() => readCalendarModePreference())
  const [calendarAnchorDate, setCalendarAnchorDate] = useState<string>()
  const [calendarQuery, setCalendarQuery] = useState<LoadState<DailyEntries[]>>({ status: 'idle' })
  const [selectedDate, setSelectedDate] = useState<string>()
  const [selectedDateQuery, setSelectedDateQuery] = useState<LoadState<Entry[]>>({ status: 'idle' })
  const [calendarReloadToken, setCalendarReloadToken] = useState(0)
  const [selectedDateReloadToken, setSelectedDateReloadToken] = useState(0)
  const [selectedEntry, setSelectedEntry] = useState<Entry>()
  const [editingEntry, setEditingEntry] = useState<Entry | null | undefined>()
  const [isExporting, setIsExporting] = useState<'filtered' | 'all'>()
  const [exportError, setExportError] = useState<string>()
  const [isChangingDataSpace, setIsChangingDataSpace] = useState(false)
  const [isStartingDataSpaceChange, setIsStartingDataSpaceChange] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ProvisioningStatus>()
  const [connectionStatusError, setConnectionStatusError] = useState<string>()
  const [isFilterOpen, setIsFilterOpen] = useState(false)

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
    clearSession,
    signOut,
    updateFilter,
    loadMore,
    refreshEntries,
    saveEntry,
    deleteEntry,
    saveCategory,
    setCategoryColor,
    savingCategoryColorIds,
    deactivateCategory,
    activateCategory,
    loadCategoryEntryPage,
    moveEntries,
    deleteCategory,
    exportEntries,
    handleRequestError,
  } = journal
  const journalTimezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei'
  const calendarToday = getJournalDate(journalTimezone)
  const hasActiveFilters = Boolean(filter.query || filter.from || filter.to || filter.categoryId || filter.tag)
  const workspaceEpoch = useRef(0)
  const previousJournalStatus = useRef(status)
  const sessionRestoreRequestId = useRef(0)
  const isRestoringSession = useRef(false)
  const lastSessionRevalidationAt = useRef(0)
  const entryReturnScrollPositionRef = useRef<number | null>(null)
  const dateSelectionReturnScrollPositionRef = useRef<number | null>(null)
  const calendarRequestId = useRef(0)
  const selectedDateRequestId = useRef(0)

  const clearWorkspaceState = useCallback(() => {
    entryReturnScrollPositionRef.current = null
    dateSelectionReturnScrollPositionRef.current = null
    setPage(getInitialPage())
    setCalendarAnchorDate(undefined)
    setCalendarQuery({ status: 'idle' })
    setCalendarReloadToken(0)
    setSelectedDate(undefined)
    setSelectedDateQuery({ status: 'idle' })
    setSelectedDateReloadToken(0)
    setSelectedEntry(undefined)
    setEditingEntry(undefined)
    setIsExporting(undefined)
    setExportError(undefined)
    setIsChangingDataSpace(false)
    setIsStartingDataSpaceChange(false)
    setConnectionStatus(undefined)
    setConnectionStatusError(undefined)
  }, [])

  const invalidateWorkspace = useCallback((): number => {
    workspaceEpoch.current += 1
    return workspaceEpoch.current
  }, [])

  const isCurrentWorkspace = useCallback((expectedEpoch: number): boolean => (
    expectedEpoch === workspaceEpoch.current
  ), [])

  const restoreWorkspaceSession = useCallback(async (): Promise<void> => {
    const restoreRequestId = ++sessionRestoreRequestId.current
    isRestoringSession.current = true
    invalidateWorkspace()
    clearWorkspaceState()
    clearSession()
    try {
      await retry()
    } finally {
      if (restoreRequestId === sessionRestoreRequestId.current) {
        isRestoringSession.current = false
      }
    }
  }, [clearSession, clearWorkspaceState, invalidateWorkspace, retry])

  const handleSignOut = useCallback(async (): Promise<void> => {
    sessionRestoreRequestId.current += 1
    isRestoringSession.current = false
    invalidateWorkspace()
    clearWorkspaceState()
    await signOut()
  }, [clearWorkspaceState, invalidateWorkspace, signOut])

  const handleProvisioningSessionInvalidated = useCallback(() => {
    void restoreWorkspaceSession()
  }, [restoreWorkspaceSession])

  useEffect(() => {
    if (status !== 'ready') return
    setCalendarAnchorDate((current) => current ?? clampCalendarAnchorDate(calendarMode, calendarToday))
  }, [calendarMode, calendarToday, status])

  useEffect(() => {
    const leftReady = previousJournalStatus.current === 'ready' && status !== 'ready'
    previousJournalStatus.current = status
    if (status === 'ready') return
    if (leftReady) invalidateWorkspace()
    clearWorkspaceState()
  }, [clearWorkspaceState, invalidateWorkspace, status])

  const revalidateSession = useCallback(() => {
    if (status !== 'ready') return
    const now = Date.now()
    if (isRestoringSession.current || now - lastSessionRevalidationAt.current < WORKSPACE_REVALIDATION_INTERVAL_MS) {
      return
    }
    lastSessionRevalidationAt.current = now
    void journalClient.restoreSession().then((sessionState) => {
      if (sessionState === 'signed-out') {
        invalidateWorkspace()
        clearWorkspaceState()
        clearSession()
      } else if (sessionState === 'provisioning') {
        void restoreWorkspaceSession()
      }
    }).catch((revalidateError: unknown) => {
      if (revalidateError instanceof AuthenticationError) {
        invalidateWorkspace()
        clearWorkspaceState()
        clearSession()
      }
    })
  }, [clearSession, clearWorkspaceState, invalidateWorkspace, journalClient, restoreWorkspaceSession, status])

  useEffect(() => {
    const handleFocus = () => revalidateSession()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') revalidateSession()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [revalidateSession])

  useEffect(() => {
    if (status !== 'ready' || page !== 'settings' || isChangingDataSpace) return

    let cancelled = false
    const expectedWorkspaceEpoch = workspaceEpoch.current
    setConnectionStatus(undefined)
    setConnectionStatusError(undefined)
    void journalClient.getProvisioningStatus().then((nextStatus) => {
      if (cancelled || !isCurrentWorkspace(expectedWorkspaceEpoch)) return
      setConnectionStatus(nextStatus)
    }).catch((statusError: unknown) => {
      if (cancelled || !isCurrentWorkspace(expectedWorkspaceEpoch)) return
      setConnectionStatusError(toErrorMessage(statusError))
      handleRequestError(statusError)
    })

    return () => {
      cancelled = true
    }
  }, [handleRequestError, isChangingDataSpace, isCurrentWorkspace, journalClient, page, status])

  const calendarRange = calendarAnchorDate
    ? getCalendarDateRange(calendarMode, calendarAnchorDate)
    : undefined
  const calendarRangeFrom = calendarRange?.from ?? ''
  const calendarRangeTo = calendarRange?.to ?? ''
  const {
    query: calendarFilterQuery,
    from: calendarFilterFrom,
    to: calendarFilterTo,
    categoryId: calendarFilterCategoryId,
    tag: calendarFilterTag,
  } = toFilterCriteria(filter)
  const calendarQueryKey = calendarRange ? JSON.stringify({
    from: calendarRange.from,
    to: calendarRange.to,
    query: calendarFilterQuery,
    filterFrom: calendarFilterFrom,
    filterTo: calendarFilterTo,
    categoryId: calendarFilterCategoryId,
    tag: calendarFilterTag,
    revision,
    reload: calendarReloadToken,
  }) : ''

  useEffect(() => {
    if (
      status !== 'ready'
      || page !== 'calendar'
      || !calendarRangeFrom
      || !calendarRangeTo
    ) return

    const requestId = ++calendarRequestId.current
    const expectedWorkspaceEpoch = workspaceEpoch.current
    const key = calendarQueryKey
    setCalendarQuery({ status: 'loading', key })
    void journalClient.run<DailyEntries[]>({
      action: 'getEntriesForRange',
      from: calendarRangeFrom,
      to: calendarRangeTo,
      filter: {
        query: calendarFilterQuery,
        from: calendarFilterFrom,
        to: calendarFilterTo,
        categoryId: calendarFilterCategoryId,
        tag: calendarFilterTag,
      },
    }).then((data) => {
      if (requestId !== calendarRequestId.current || !isCurrentWorkspace(expectedWorkspaceEpoch)) return
      setCalendarQuery((current) => {
        if (current.status === 'idle' || current.key !== key) return current
        return { status: 'ready', key, data }
      })
    }).catch((loadError: unknown) => {
      if (requestId !== calendarRequestId.current || !isCurrentWorkspace(expectedWorkspaceEpoch)) return
      if (loadError instanceof AuthenticationError) {
        handleRequestError(loadError)
        return
      }
      setCalendarQuery((current) => {
        if (current.status === 'idle' || current.key !== key) return current
        return { status: 'error', key, message: toErrorMessage(loadError) }
      })
    })

    return () => {
      if (calendarRequestId.current === requestId) calendarRequestId.current += 1
    }
  }, [
    calendarFilterCategoryId,
    calendarFilterFrom,
    calendarFilterQuery,
    calendarFilterTag,
    calendarFilterTo,
    calendarQueryKey,
    calendarRangeFrom,
    calendarRangeTo,
    handleRequestError,
    isCurrentWorkspace,
    journalClient,
    page,
    status,
  ])

  const selectedDateQueryKey = selectedDate ? JSON.stringify({
    date: selectedDate,
    query: calendarFilterQuery,
    filterFrom: calendarFilterFrom,
    filterTo: calendarFilterTo,
    categoryId: calendarFilterCategoryId,
    tag: calendarFilterTag,
    revision,
    reload: selectedDateReloadToken,
  }) : ''

  useEffect(() => {
    if (status !== 'ready' || page !== 'calendar' || !selectedDate) return

    const requestId = ++selectedDateRequestId.current
    const expectedWorkspaceEpoch = workspaceEpoch.current
    const date = selectedDate
    const key = selectedDateQueryKey
    setSelectedDateQuery({ status: 'loading', key })
    void journalClient.run<DailyEntries[]>({
      action: 'getEntriesForRange',
      from: date,
      to: date,
      filter: {
        query: calendarFilterQuery,
        from: calendarFilterFrom,
        to: calendarFilterTo,
        categoryId: calendarFilterCategoryId,
        tag: calendarFilterTag,
      },
    }).then((days) => {
      if (requestId !== selectedDateRequestId.current || !isCurrentWorkspace(expectedWorkspaceEpoch)) return
      const entries = days.find((day) => day.date === date)?.entries ?? []
      setSelectedDateQuery((current) => {
        if (current.status === 'idle' || current.key !== key) return current
        return { status: 'ready', key, data: entries }
      })
    }).catch((loadError: unknown) => {
      if (requestId !== selectedDateRequestId.current || !isCurrentWorkspace(expectedWorkspaceEpoch)) return
      if (loadError instanceof AuthenticationError) {
        handleRequestError(loadError)
        return
      }
      setSelectedDateQuery((current) => {
        if (current.status === 'idle' || current.key !== key) return current
        return { status: 'error', key, message: toErrorMessage(loadError) }
      })
    })

    return () => {
      if (selectedDateRequestId.current === requestId) selectedDateRequestId.current += 1
    }
  }, [
    calendarFilterCategoryId,
    calendarFilterFrom,
    calendarFilterQuery,
    calendarFilterTag,
    calendarFilterTo,
    handleRequestError,
    isCurrentWorkspace,
    journalClient,
    page,
    selectedDate,
    selectedDateQueryKey,
    status,
  ])

  useEffect(() => {
    if (status === 'ready') {
      writeAuthHint(true)
      if (typeof window !== 'undefined' && window.location.search.includes('setup=')) {
        window.history.replaceState({}, '', window.location.pathname)
      }
    } else if (status === 'signed-out') {
      writeAuthHint(false)
    }
  }, [status])

  useEffect(() => {
    if (!selectedEntry && entryReturnScrollPositionRef.current !== null) {
      const targetScrollY = entryReturnScrollPositionRef.current
      entryReturnScrollPositionRef.current = null
      if (typeof window !== 'undefined') {
        window.scrollTo(0, targetScrollY)
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => {
            window.scrollTo(0, targetScrollY)
          })
        }
      }
    }
  }, [selectedEntry])

  useEffect(() => {
    if (!selectedDate && !selectedEntry && dateSelectionReturnScrollPositionRef.current !== null) {
      const targetScrollY = dateSelectionReturnScrollPositionRef.current
      dateSelectionReturnScrollPositionRef.current = null
      if (typeof window !== 'undefined') {
        window.scrollTo(0, targetScrollY)
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => {
            window.scrollTo(0, targetScrollY)
          })
        }
      }
    }
  }, [selectedDate, selectedEntry])

  const handleDataSpaceComplete = useCallback(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('setup=')) {
      window.history.replaceState({}, '', window.location.pathname)
    }
    void restoreWorkspaceSession()
  }, [restoreWorkspaceSession])

  const handleStartDataSpaceChange = async () => {
    if (isStartingDataSpaceChange) return
    const expectedWorkspaceEpoch = workspaceEpoch.current
    setIsStartingDataSpaceChange(true)
    try {
      await journalClient.startSheetChange()
      if (!isCurrentWorkspace(expectedWorkspaceEpoch)) return
      setIsChangingDataSpace(true)
    } catch (changeError) {
      if (!isCurrentWorkspace(expectedWorkspaceEpoch)) return
      handleRequestError(changeError)
      throw changeError
    } finally {
      if (isCurrentWorkspace(expectedWorkspaceEpoch)) setIsStartingDataSpaceChange(false)
    }
  }

  const clearAfterAccountAction = () => {
    clearWorkspaceState()
    clearSession()
  }

  const runAccountAction = async (action: () => Promise<void>): Promise<void> => {
    sessionRestoreRequestId.current += 1
    isRestoringSession.current = false
    const expectedWorkspaceEpoch = invalidateWorkspace()
    try {
      await action()
      if (!isCurrentWorkspace(expectedWorkspaceEpoch)) return
      clearAfterAccountAction()
    } catch (accountError) {
      if (!isCurrentWorkspace(expectedWorkspaceEpoch)) return
      handleRequestError(accountError)
      throw accountError
    }
  }

  const handleDisconnect = (): Promise<void> => runAccountAction(() => journalClient.disconnect())

  const handleDeleteAccount = (input: DeleteAccountInput): Promise<void> => (
    runAccountAction(() => journalClient.deleteAccount(input))
  )

  if (status === 'provisioning') {
    return (
      <DataSpaceSetup
        client={journalClient}
        mode="initial"
        onComplete={handleDataSpaceComplete}
        onSessionInvalidated={handleProvisioningSessionInvalidated}
        onRestart={() => void handleSignOut()}
      />
    )
  }

  if (isChangingDataSpace && status === 'ready') {
    return (
      <DataSpaceSetup
        client={journalClient}
        mode="change"
        onComplete={handleDataSpaceComplete}
        onCancel={() => setIsChangingDataSpace(false)}
        onSessionInvalidated={handleProvisioningSessionInvalidated}
        onRestart={() => void handleSignOut()}
      />
    )
  }

  const isInitialLoading = status === 'checking-session' || status === 'loading'
  if (isInitialLoading && readAuthHint() && !error) {
    return <AppLoadingScreen />
  }

  if (status !== 'ready') {
    return (
      <ConnectionScreen
        status={status}
        error={error}
        onSignIn={signIn}
        onRetry={() => void restoreWorkspaceSession()}
      />
    )
  }

  const navigate = (nextPage: Page) => {
    if (nextPage === 'timeline' || nextPage === 'calendar') saveViewPreference(nextPage)
    if (nextPage === 'timeline' && page !== 'timeline') {
      void refreshEntries()
    }
    if (nextPage === 'calendar' && page !== 'calendar') {
      setCalendarAnchorDate(clampCalendarAnchorDate(calendarMode, calendarToday))
    }
    entryReturnScrollPositionRef.current = null
    dateSelectionReturnScrollPositionRef.current = null
    setSelectedDate(undefined)
    setSelectedDateQuery({ status: 'idle' })
    setSelectedDateReloadToken(0)
    setSelectedEntry(undefined)
    setPage(nextPage)
  }

  const handleOpenEntry = (entry: Entry) => {
    if (typeof window !== 'undefined') {
      entryReturnScrollPositionRef.current = window.scrollY
    }
    setSelectedEntry(entry)
  }

  const handleSaveEntry = async (input: EntryInput) => {
    const saved = await saveEntry(input)
    setEditingEntry(undefined)
    setSelectedEntry((current) => current?.id === saved.id ? saved : current)
  }

  const handleDeleteEntry = async (id: string) => {
    await deleteEntry(id)
    setSelectedEntry((current) => current?.id === id ? undefined : current)
  }

  const handleSelectDate = (date: string) => {
    if (typeof window !== 'undefined') {
      dateSelectionReturnScrollPositionRef.current = window.scrollY
      window.scrollTo(0, 0)
    }
    setSelectedDateQuery({ status: 'idle' })
    setSelectedDateReloadToken(0)
    setSelectedDate(date)
  }

  const handleCalendarModeChange = (mode: CalendarMode) => {
    saveCalendarModePreference(mode)
    setCalendarMode(mode)
    setCalendarAnchorDate((date) => date ? clampCalendarAnchorDate(mode, date) : date)
  }

  const handleCalendarFocusDate = (date: string) => {
    setCalendarAnchorDate(clampCalendarAnchorDate(calendarMode, date))
  }

  const handleMoveCalendarPeriod = (direction: -1 | 1) => {
    setCalendarAnchorDate((date) => (
      date ? shiftCalendarAnchorDate(calendarMode, date, direction) : date
    ))
  }

  const handleCalendarToday = () => {
    setCalendarAnchorDate(clampCalendarAnchorDate(calendarMode, calendarToday))
  }

  const handleExport = async (scope: 'filtered' | 'all') => {
    const expectedWorkspaceEpoch = workspaceEpoch.current
    setIsExporting(scope)
    setExportError(undefined)
    try {
      const data = await exportEntries(scope)
      if (!isCurrentWorkspace(expectedWorkspaceEpoch)) return
      downloadCsv(createCsvBlob(data.headers, data.rows), `daily-journal-${getLocalDate()}.csv`)
    } catch (downloadError) {
      if (!isCurrentWorkspace(expectedWorkspaceEpoch)) return
      setExportError(toErrorMessage(downloadError))
    } finally {
      if (isCurrentWorkspace(expectedWorkspaceEpoch)) setIsExporting(undefined)
    }
  }

  if (selectedEntry) {
    const selectedCategory = categories.find((category) => category.id === selectedEntry.categoryId)
    return (
      <main className="focused-screen">
        <EntryDetail
          entry={selectedEntry}
          categoryName={selectedCategory?.name ?? zhTW.detail.category}
          categoryColor={selectedCategory?.color ?? null}
          timezone={journalTimezone}
          returnTarget={page === 'timeline' ? 'timeline' : 'calendar'}
          onBack={() => setSelectedEntry(undefined)}
          onEdit={() => setEditingEntry(selectedEntry)}
          onDelete={() => handleDeleteEntry(selectedEntry.id)}
        />
        {error && <section className="page-error" role="alert"><p>{error}</p></section>}
        {editingEntry && renderEditor(editingEntry, categories, tagSuggestions, journalTimezone, handleSaveEntry, () => setEditingEntry(undefined))}
      </main>
    )
  }

  const calendarContentKey = calendarRange ? JSON.stringify({
    from: calendarRange.from,
    to: calendarRange.to,
    query: calendarFilterQuery,
    filterFrom: calendarFilterFrom,
    filterTo: calendarFilterTo,
    categoryId: calendarFilterCategoryId,
    tag: calendarFilterTag,
  }) : ''
  const visibleCalendarDays = calendarQuery.status === 'ready' && calendarQuery.key === calendarQueryKey
    ? calendarQuery.data
    : []
  const calendarEntryCount = calendarQuery.status === 'ready' && calendarQuery.key === calendarQueryKey
    ? visibleCalendarDays.reduce((total, day) => total + day.entries.length, 0)
    : null
  const calendarQueryMatches = calendarQuery.status !== 'idle' && calendarQuery.key === calendarQueryKey
  const isCalendarLoading = Boolean(calendarQueryKey)
    && (!calendarQueryMatches || calendarQuery.status === 'loading')
  const calendarError = calendarQueryMatches && calendarQuery.status === 'error'
    ? calendarQuery.message
    : undefined
  const selectedDateQueryMatches = selectedDateQuery.status !== 'idle'
    && selectedDateQuery.key === selectedDateQueryKey
  const visibleSelectedDateEntries = selectedDateQuery.status === 'ready'
    && selectedDateQuery.key === selectedDateQueryKey
    ? selectedDateQuery.data
    : []
  const isSelectedDateLoading = Boolean(selectedDateQueryKey)
    && (!selectedDateQueryMatches || selectedDateQuery.status === 'loading')
  const selectedDateError = selectedDateQueryMatches && selectedDateQuery.status === 'error'
    ? selectedDateQuery.message
    : undefined
  const dayEntries = visibleCalendarDays.find(({ date }) => date === calendarAnchorDate)?.entries ?? []
  const previousCalendarAnchor = calendarAnchorDate
    ? shiftCalendarAnchorDate(calendarMode, calendarAnchorDate, -1)
    : undefined
  const nextCalendarAnchor = calendarAnchorDate
    ? shiftCalendarAnchorDate(calendarMode, calendarAnchorDate, 1)
    : undefined

  return (
    <div className="app-shell">
      <DesktopNavigation
        page={page}
        onNavigate={navigate}
        onCreate={() => setEditingEntry(null)}
        onSignOut={() => void handleSignOut()}
        onConfigureDataSpace={() => void handleStartDataSpaceChange().catch(() => undefined)}
        isConfiguringDataSpace={isStartingDataSpaceChange}
      />
      <div className="app-shell__workspace">
        <MobileHeader
          page={page}
          isFilterOpen={isFilterOpen}
          hasActiveFilters={hasActiveFilters}
          onToggleFilter={() => setIsFilterOpen((prev) => !prev)}
          onCreate={() => setEditingEntry(null)}
          onSignOut={() => void handleSignOut()}
          onConfigureDataSpace={() => void handleStartDataSpaceChange().catch(() => undefined)}
          isConfiguringDataSpace={isStartingDataSpaceChange}
        />
        <main className="app-main">
          {error && page !== 'categories' && page !== 'settings' && (
            <section className="page-error" role="alert">
              <p>{error}</p>
              <button className="button button--secondary" type="button" onClick={() => void restoreWorkspaceSession()}>{zhTW.connection.retry}</button>
            </section>
          )}
          {(page === 'timeline' || page === 'calendar') && (
            <>
              <header className="page-heading app-main__heading">
                <div>
                  <h1>{page === 'timeline' ? zhTW.navigation.timeline : zhTW.navigation.calendar}</h1>
                  <p>{page === 'timeline' ? zhTW.app.timelineDescription : zhTW.app.tagline}</p>
                </div>
                {((page === 'timeline' && isLoadingEntries)
                  || (page === 'calendar' && !calendarAnchorDate)) && (
                  <p className="loading-note search-loading-note" role="status">
                    <Icon className="loading-note-spinner">progress_activity</Icon>
                    <span>{zhTW.filters.searching}</span>
                  </p>
                )}
                <div className="page-heading__actions">
                  <button
                    className={`search-toggle-btn${isFilterOpen ? ' search-toggle-btn--active' : ''}${hasActiveFilters ? ' search-toggle-btn--has-filters' : ''}`}
                    type="button"
                    aria-label={isFilterOpen ? zhTW.filters.hideSearch : zhTW.filters.showSearch}
                    aria-expanded={isFilterOpen}
                    onClick={() => setIsFilterOpen((prev) => !prev)}
                  >
                    <Icon>{isFilterOpen ? 'search_off' : 'search'}</Icon>
                    <span>{zhTW.filters.toggleSearch}</span>
                    {hasActiveFilters && <span className="active-filter-indicator" aria-hidden="true" />}
                  </button>
                  <ViewToggle page={page} onNavigate={navigate} />
                </div>
              </header>
              {isFilterOpen && (
                <FilterBar
                  filter={filter}
                  categories={categories.filter((category) => category.isActive)}
                  tagSuggestions={tagSuggestions}
                  onChange={(changes) => void updateFilter(changes)}
                  onClose={() => setIsFilterOpen(false)}
                />
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
              onOpen={handleOpenEntry}
              onEdit={setEditingEntry}
              onDelete={handleDeleteEntry}
              onCreate={() => setEditingEntry(null)}
            />
          )}

          {page === 'calendar' && !selectedDate && calendarAnchorDate && (
            <CalendarFrame
              mode={calendarMode}
              anchorDate={calendarAnchorDate}
              entryCount={calendarEntryCount}
              isLoading={isCalendarLoading}
              error={calendarError}
              canMovePrevious={previousCalendarAnchor !== calendarAnchorDate}
              canMoveNext={nextCalendarAnchor !== calendarAnchorDate}
              onModeChange={handleCalendarModeChange}
              onMovePeriod={handleMoveCalendarPeriod}
              onToday={handleCalendarToday}
              onRetry={() => setCalendarReloadToken((value) => value + 1)}
            >
              {calendarMode === 'day' && (
                <CalendarDayView
                  date={calendarAnchorDate}
                  today={calendarToday}
                  entries={dayEntries}
                  categories={categories}
                  timezone={journalTimezone}
                  onOpenEntry={handleOpenEntry}
                  onEditEntry={(entry) => setEditingEntry(entry)}
                  onDeleteEntry={handleDeleteEntry}
                  onCreateEntry={(_date) => setEditingEntry(null)}
                />
              )}
              {calendarMode === 'week' && (
                <CalendarWeekView
                  anchorDate={calendarAnchorDate}
                  today={calendarToday}
                  days={visibleCalendarDays}
                  categories={categories}
                  expansionResetKey={calendarContentKey}
                  onFocusDate={handleCalendarFocusDate}
                  onOpenEntry={handleOpenEntry}
                  onCreateEntry={(_date) => setEditingEntry(null)}
                />
              )}
              {calendarMode === 'month' && (
                <CalendarMonthView
                  anchorDate={calendarAnchorDate}
                  today={calendarToday}
                  days={visibleCalendarDays}
                  categories={categories}
                  onFocusDate={handleCalendarFocusDate}
                  onSelectDate={handleSelectDate}
                  onOpenEntry={handleOpenEntry}
                />
              )}
            </CalendarFrame>
          )}

          {page === 'calendar' && selectedDate && (
            <section className="calendar-selection">
              <header className="calendar-selection__header">
                <button
                  className="button button--text"
                  type="button"
                  onClick={() => {
                    setSelectedDate(undefined)
                    setSelectedDateQuery({ status: 'idle' })
                  }}
                >
                  <Icon>arrow_back</Icon>
                  {zhTW.actions.backToCalendar}
                </button>
                <h2>{zhTW.calendar.selectedDateTitle(selectedDate)}</h2>
              </header>
              {isSelectedDateLoading ? (
                <p className="loading-note" role="status">{zhTW.filters.searching}</p>
              ) : selectedDateError ? (
                <div className="calendar-frame__error" role="alert">
                  <p>{selectedDateError}</p>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => setSelectedDateReloadToken((value) => value + 1)}
                  >
                    {zhTW.actions.reload}
                  </button>
                </div>
              ) : (
                <Timeline
                  entries={visibleSelectedDateEntries}
                  categories={categories}
                  timezone={journalTimezone}
                  nextCursor={null}
                  isLoading={false}
                  onLoadMore={() => undefined}
                  onOpen={handleOpenEntry}
                  onEdit={setEditingEntry}
                  onDelete={handleDeleteEntry}
                  onCreate={() => setEditingEntry(null)}
                />
              )}
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
              savingCategoryColorIds={savingCategoryColorIds}
              onSetColor={setCategoryColor}
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

          {page === 'settings' && (
            <>
              {connectionStatusError && <section className="page-error" role="alert"><p>{connectionStatusError}</p></section>}
              <DataConnectionSettings
                status={connectionStatus}
                onStartChange={handleStartDataSpaceChange}
                onDisconnect={handleDisconnect}
                onDeleteAccount={handleDeleteAccount}
              />
            </>
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

function DesktopNavigation({ page, onNavigate, onCreate, onSignOut, onConfigureDataSpace, isConfiguringDataSpace }: {
  page: Page
  onNavigate: (page: Page) => void
  onCreate: () => void
  onSignOut: () => void
  onConfigureDataSpace: () => void
  isConfiguringDataSpace: boolean
}) {
  const items: Array<{ page: Page; label: string; icon: string }> = [
    { page: 'timeline', label: zhTW.navigation.timeline, icon: 'timeline' },
    { page: 'calendar', label: zhTW.navigation.calendar, icon: 'calendar_month' },
    { page: 'categories', label: zhTW.navigation.categories, icon: 'category' },
    { page: 'export', label: zhTW.navigation.export, icon: 'ios_share' },
    { page: 'settings', label: zhTW.navigation.settings, icon: 'settings' },
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
        <button className="button button--text desktop-nav__data-space" type="button" disabled={isConfiguringDataSpace} onClick={onConfigureDataSpace}>
          <Icon>table_chart</Icon>{isConfiguringDataSpace ? zhTW.provisioning.startingChange : zhTW.provisioning.openSettings}
        </button>
        <button className="button button--text desktop-nav__sign-out" type="button" onClick={onSignOut}>
          <Icon>logout</Icon>{zhTW.actions.signOut}
        </button>
        <small className="desktop-nav__copyright">{zhTW.app.copyright}</small>
      </div>
    </aside>
  )
}

function MobileHeader({
  page,
  isFilterOpen,
  hasActiveFilters,
  onToggleFilter,
  onCreate,
  onSignOut,
  onConfigureDataSpace,
  isConfiguringDataSpace,
}: {
  page: Page
  isFilterOpen: boolean
  hasActiveFilters: boolean
  onToggleFilter: () => void
  onCreate: () => void
  onSignOut: () => void
  onConfigureDataSpace: () => void
  isConfiguringDataSpace: boolean
}) {
  return (
    <header className="mobile-header">
      <div><strong>{zhTW.app.name}</strong></div>
      <div className="mobile-header__actions">
        {(page === 'timeline' || page === 'calendar') && (
          <button
            className={`icon-button mobile-header__filter-btn${isFilterOpen ? ' mobile-header__filter-btn--active' : ''}`}
            type="button"
            aria-label={isFilterOpen ? zhTW.filters.hideSearch : zhTW.filters.showSearch}
            aria-expanded={isFilterOpen}
            onClick={onToggleFilter}
          >
            <Icon>{isFilterOpen ? 'search_off' : 'search'}</Icon>
            {hasActiveFilters && <span className="active-filter-indicator" aria-hidden="true" />}
          </button>
        )}
        <button className="icon-button" type="button" aria-label={zhTW.provisioning.openSettings} disabled={isConfiguringDataSpace} onClick={onConfigureDataSpace}><Icon>table_chart</Icon></button>
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
    { page: 'settings', label: zhTW.navigation.settings, icon: 'settings' },
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
