import { useEffect, useRef, useState } from 'react'
import type { ApiRequest, Category, Entry, EntryFilter, EntryInput, EntryListResult } from '../../domain/journal'
import type { CsvExport } from '../entries/csv-download'
import { zhTW } from '../../i18n/zh-TW'
import type { MonthlyEntryCount } from '../entries/calendar-view'

export type JournalStatus = 'checking-config' | 'signed-out' | 'loading' | 'ready' | 'error'

export type JournalBootstrap = {
  timezone: string
  categories: Category[]
  tagSuggestions: string[]
}

export type JournalClient = {
  signIn: () => Promise<void>
  signOut: () => void
  run: <T>(request: ApiRequest) => Promise<T>
}

export class SessionEndedError extends Error {}

type JournalState = {
  status: JournalStatus
  bootstrap: JournalBootstrap | undefined
  categories: Category[]
  tagSuggestions: string[]
  entries: Entry[]
  filter: EntryFilter
  nextCursor: string | null
  isLoadingEntries: boolean
  monthlyEntryCounts: MonthlyEntryCount[]
  isLoadingMonthlyEntryCounts: boolean
  monthlyEntryCountsRevision: number
  error: string | undefined
}

const signedOutState: JournalState = {
  status: 'signed-out',
  bootstrap: undefined,
  categories: [],
  tagSuggestions: [],
  entries: [],
  filter: defaultFilter(),
  nextCursor: null,
  isLoadingEntries: false,
  monthlyEntryCounts: [],
  isLoadingMonthlyEntryCounts: false,
  monthlyEntryCountsRevision: 0,
  error: undefined,
}

function defaultFilter(): EntryFilter {
  return { query: '', from: null, to: null, categoryId: null, tag: null, cursor: null, limit: 20 }
}

export function useJournal(client: JournalClient) {
  const [state, setState] = useState<JournalState>(signedOutState)
  const sessionEpoch = useRef(0)
  const entryEpoch = useRef(0)
  const monthlyCountEpoch = useRef(0)
  const filterRef = useRef(defaultFilter())

  async function connect(requestSignIn: boolean) {
    if (state.status === 'loading') return

    const requestSession = sessionEpoch.current
    setState({ ...signedOutState, status: 'loading' })
    try {
      if (requestSignIn) {
        await client.signIn()
        if (requestSession !== sessionEpoch.current) return
      }
      const bootstrap = await client.run<JournalBootstrap>({ action: 'bootstrap' })
      if (requestSession !== sessionEpoch.current) return
      filterRef.current = defaultFilter()
      setState({
        status: 'ready',
        bootstrap,
        categories: bootstrap.categories,
        tagSuggestions: bootstrap.tagSuggestions,
        entries: [],
        filter: defaultFilter(),
        nextCursor: null,
        isLoadingEntries: false,
        monthlyEntryCounts: [],
        isLoadingMonthlyEntryCounts: false,
        monthlyEntryCountsRevision: 0,
        error: undefined,
      })
    } catch (error) {
      if (requestSession !== sessionEpoch.current) return
      setState({
        ...signedOutState,
        status: 'error',
        error: error instanceof Error ? error.message : zhTW.api.requestFailed,
      })
    }
  }

  async function loadEntries(filter: EntryFilter, append = false) {
    const requestSession = sessionEpoch.current
    const requestEpoch = ++entryEpoch.current
    setState((current) => ({ ...current, isLoadingEntries: true, error: undefined }))
    try {
      const page = await client.run<EntryListResult>({ action: 'listEntries', filter })
      if (requestSession !== sessionEpoch.current || requestEpoch !== entryEpoch.current) return
      setState((current) => ({
        ...current,
        entries: append ? [...current.entries, ...page.items] : page.items,
        filter,
        nextCursor: page.nextCursor,
        isLoadingEntries: false,
      }))
    } catch (error) {
      if (requestSession !== sessionEpoch.current || requestEpoch !== entryEpoch.current) return
      setState((current) => ({ ...current, isLoadingEntries: false, error: error instanceof Error ? error.message : zhTW.api.requestFailed }))
    }
  }

  async function getEntriesForDate(date: string) {
    const requestSession = sessionEpoch.current
    const requestEpoch = ++entryEpoch.current
    const filter = queryFilter(state.filter)
    setState((current) => ({ ...current, isLoadingEntries: true, error: undefined }))
    try {
      const entries = await client.run<Entry[]>({ action: 'getEntriesForDate', date, filter })
      if (requestSession !== sessionEpoch.current || requestEpoch !== entryEpoch.current) return
      setState((current) => ({ ...current, entries, nextCursor: null, isLoadingEntries: false }))
    } catch (error) {
      if (requestSession !== sessionEpoch.current || requestEpoch !== entryEpoch.current) return
      setState((current) => ({ ...current, isLoadingEntries: false, error: error instanceof Error ? error.message : zhTW.api.requestFailed }))
    }
  }

  async function loadMonthlyEntryCounts(month: string) {
    const matched = /^(\d{4})-(\d{2})$/.exec(month)
    if (!matched) return

    const requestSession = sessionEpoch.current
    const requestEpoch = ++monthlyCountEpoch.current
    const filter = queryFilter(state.filter)
    setState((current) => ({ ...current, isLoadingMonthlyEntryCounts: true, error: undefined }))
    try {
      const monthlyEntryCounts = await client.run<MonthlyEntryCount[]>({
        action: 'getMonthlyEntryCounts',
        year: Number(matched[1]),
        month: Number(matched[2]),
        filter,
      })
      if (requestSession !== sessionEpoch.current || requestEpoch !== monthlyCountEpoch.current) return
      setState((current) => ({ ...current, monthlyEntryCounts: Array.isArray(monthlyEntryCounts) ? monthlyEntryCounts : [], isLoadingMonthlyEntryCounts: false }))
    } catch (error) {
      if (requestSession !== sessionEpoch.current || requestEpoch !== monthlyCountEpoch.current) return
      setState((current) => ({ ...current, isLoadingMonthlyEntryCounts: false, error: error instanceof Error ? error.message : zhTW.api.requestFailed }))
    }
  }

  async function saveEntry(input: EntryInput) {
    const requestSession = sessionEpoch.current
    const saved = await client.run<Entry>({ action: 'saveEntry', entry: input })
    if (requestSession !== sessionEpoch.current) return
    entryEpoch.current += 1
    monthlyCountEpoch.current += 1
    setState((current) => ({
      ...current,
      tagSuggestions: [...new Set([...current.tagSuggestions, ...saved.tags])],
      monthlyEntryCountsRevision: current.monthlyEntryCountsRevision + 1,
    }))
    await loadEntries({ ...filterRef.current, cursor: null })
  }

  async function deleteEntry(id: string) {
    const requestSession = sessionEpoch.current
    await client.run<void>({ action: 'deleteEntry', id })
    if (requestSession !== sessionEpoch.current) return
    entryEpoch.current += 1
    monthlyCountEpoch.current += 1
    setState((current) => ({
      ...current,
      entries: current.entries.filter((entry) => entry.id !== id),
      isLoadingEntries: false,
      monthlyEntryCountsRevision: current.monthlyEntryCountsRevision + 1,
    }))
  }

  async function saveCategory(name: string, id?: string) {
    const requestSession = sessionEpoch.current
    const saved = await client.run<Category>({ action: 'saveCategory', category: { name, ...(id ? { id } : {}) } })
    if (requestSession !== sessionEpoch.current) return
    setState((current) => ({
      ...current,
      categories: current.categories.some((category) => category.id === saved.id)
        ? current.categories.map((category) => category.id === saved.id ? saved : category)
        : [...current.categories, saved],
    }))
  }

  async function deactivateCategory(id: string) {
    const requestSession = sessionEpoch.current
    const saved = await client.run<Category>({ action: 'deactivateCategory', id })
    if (requestSession !== sessionEpoch.current) return
    const currentFilter = filterRef.current
    const nextFilter = currentFilter.categoryId === saved.id ? { ...currentFilter, categoryId: null, cursor: null } : currentFilter
    filterRef.current = nextFilter
    setState((current) => ({
      ...current,
      categories: current.categories.map((category) => category.id === saved.id ? saved : category),
      filter: nextFilter,
    }))
    if (nextFilter !== currentFilter) await loadEntries(nextFilter)
  }

  async function exportEntries(scope: 'filtered' | 'all'): Promise<CsvExport> {
    const requestSession = sessionEpoch.current
    try {
      const result = await client.run<CsvExport>({ action: 'exportEntries', filter: scope === 'filtered' ? queryFilter(state.filter) : queryFilter(defaultFilter()) })
      if (requestSession !== sessionEpoch.current) throw new SessionEndedError()
      return result
    } catch (error) {
      if (requestSession !== sessionEpoch.current) throw new SessionEndedError()
      throw error
    }
  }

  function signOut(): void {
    sessionEpoch.current += 1
    entryEpoch.current += 1
    monthlyCountEpoch.current += 1
    filterRef.current = defaultFilter()
    client.signOut()
    setState(signedOutState)
  }

  function setFilter(filter: EntryFilter) {
    const initialFilter = { ...filter, cursor: null }
    filterRef.current = initialFilter
    setState((current) => ({ ...current, filter: initialFilter }))
    void loadEntries(initialFilter)
  }

  useEffect(() => {
    if (state.status === 'ready' && state.entries.length === 0 && !state.isLoadingEntries && state.nextCursor === null) {
      void loadEntries(state.filter)
    }
  }, [state.status])

  return {
    ...state,
    signIn: () => connect(true),
    signOut,
    retry: () => connect(false),
    saveEntry,
    loadEntries,
    deleteEntry,
    saveCategory,
    deactivateCategory,
    exportEntries,
    setFilter,
    getEntriesForDate,
    loadMonthlyEntryCounts,
  }
}

function queryFilter(filter: EntryFilter): Omit<EntryFilter, 'cursor' | 'limit'> {
  return {
    query: filter.query,
    from: filter.from,
    to: filter.to,
    categoryId: filter.categoryId,
    tag: filter.tag,
  }
}
