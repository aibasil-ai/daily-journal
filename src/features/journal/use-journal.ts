import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ApiRequest,
  BootstrapData,
  Category,
  CsvExportData,
  DailyEntryCount,
  Entry,
  EntryFilter,
  EntryInput,
  EntryListData,
} from '../../domain/journal'
import { DEFAULT_ENTRY_FILTER, toFilterCriteria } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { AuthenticationError } from '../../services/execution-client'

export type JournalStatus = 'checking-config' | 'signed-out' | 'loading' | 'ready' | 'error'

export interface JournalClient {
  run<T>(request: ApiRequest): Promise<T>
}

export type JournalConnection = {
  client: JournalClient
  authorize: (prompt: '' | 'consent') => Promise<void>
}

export function useJournal(connection: JournalConnection | null) {
  const [status, setStatus] = useState<JournalStatus>(connection ? 'signed-out' : 'checking-config')
  const [error, setError] = useState<string>()
  const [timezone, setTimezone] = useState<string>()
  const [categories, setCategories] = useState<Category[]>([])
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [filter, setFilter] = useState<EntryFilter>(DEFAULT_ENTRY_FILTER)
  const [isLoadingEntries, setIsLoadingEntries] = useState(false)
  const [revision, setRevision] = useState(0)
  const listRequestId = useRef(0)

  const handleRequestError = useCallback((requestError: unknown) => {
    setError(toErrorMessage(requestError))
    if (requestError instanceof AuthenticationError) setStatus('error')
  }, [])

  useEffect(() => {
    if (!connection) {
      setStatus('checking-config')
      return
    }
    setStatus('signed-out')
  }, [connection])

  const loadEntries = async (requestedFilter: EntryFilter, append = false): Promise<void> => {
    if (!connection) return
    const requestId = ++listRequestId.current
    setIsLoadingEntries(true)
    try {
      const response = await connection.client.run<unknown>({
        action: 'listEntries',
        filter: requestedFilter,
      })
      const result = toEntryListData(response)
      if (requestId !== listRequestId.current) return
      setEntries((current) => append ? [...current, ...result.items] : result.items)
      setNextCursor(result.nextCursor)
      setError(undefined)
    } finally {
      if (requestId === listRequestId.current) setIsLoadingEntries(false)
    }
  }

  const signIn = async (prompt: '' | 'consent' = 'consent'): Promise<void> => {
    if (!connection) return
    setStatus('loading')
    setError(undefined)
    try {
      await connection.authorize(prompt)
      const bootstrap = await connection.client.run<BootstrapData>({ action: 'bootstrap' })
      setTimezone(bootstrap.timezone)
      setCategories(bootstrap.categories)
      setTagSuggestions(bootstrap.tagSuggestions)
      // bootstrap 保持只回傳可用於新記事的分類；管理畫面另外補齊停用分類。
      void connection.client.run<Category[]>({ action: 'listCategories' })
        .then((allCategories) => setCategories(allCategories))
        .catch(handleRequestError)
      const initialFilter = { ...DEFAULT_ENTRY_FILTER }
      setFilter(initialFilter)
      setStatus('ready')
      void loadEntries(initialFilter).catch(handleRequestError)
    } catch (signInError) {
      setStatus('error')
      setError(toErrorMessage(signInError))
    }
  }

  const retry = async (): Promise<void> => signIn('consent')

  const updateFilter = async (changes: Partial<EntryFilter>): Promise<void> => {
    const nextFilter = { ...filter, ...changes, cursor: null }
    setFilter(nextFilter)
    try {
      await loadEntries(nextFilter)
    } catch (loadError) {
      handleRequestError(loadError)
    }
  }

  const loadMore = async (): Promise<void> => {
    if (nextCursor === null) return
    try {
      await loadEntries({ ...filter, cursor: nextCursor }, true)
    } catch (loadError) {
      handleRequestError(loadError)
    }
  }

  const saveEntry = async (input: EntryInput): Promise<Entry> => {
    if (!connection) throw new Error(zhTW.errors.save)
    try {
      const saved = await connection.client.run<Entry>({ action: 'saveEntry', entry: input })
      setTagSuggestions((current) => [...new Set([...current, ...saved.tags])].sort())
      await loadEntries({ ...filter, cursor: null })
      setRevision((current) => current + 1)
      return saved
    } catch (saveError) {
      handleRequestError(saveError)
      throw saveError
    }
  }

  const deleteEntry = async (id: string): Promise<void> => {
    if (!connection) throw new Error(zhTW.errors.delete)
    try {
      await connection.client.run<null>({ action: 'deleteEntry', id })
      await loadEntries({ ...filter, cursor: null })
      setRevision((current) => current + 1)
    } catch (deleteError) {
      handleRequestError(deleteError)
      throw deleteError
    }
  }

  const saveCategory = async (name: string, id?: string): Promise<Category> => {
    if (!connection) throw new Error(zhTW.errors.category)
    try {
      const category = await connection.client.run<Category>({
        action: 'saveCategory',
        category: { id, name },
      })
      setCategories((current) => {
        const currentIndex = current.findIndex((item) => item.id === category.id)
        if (currentIndex === -1) return [...current, category].sort((left, right) => left.name.localeCompare(right.name))
        return current.map((item) => item.id === category.id ? category : item)
      })
      setRevision((current) => current + 1)
      return category
    } catch (categoryError) {
      handleRequestError(categoryError)
      throw categoryError
    }
  }

  const deactivateCategory = async (id: string): Promise<Category> => {
    if (!connection) throw new Error(zhTW.errors.category)
    try {
      const category = await connection.client.run<Category>({ action: 'deactivateCategory', id })
      setCategories((current) => current.map((item) => item.id === id ? category : item))
      setRevision((current) => current + 1)
      return category
    } catch (categoryError) {
      handleRequestError(categoryError)
      throw categoryError
    }
  }

  const getMonthlyEntryCounts = async (year: number, month: number): Promise<DailyEntryCount[]> => {
    if (!connection) return []
    return connection.client.run<DailyEntryCount[]>({
      action: 'getMonthlyEntryCounts',
      year,
      month,
      filter: toFilterCriteria(filter),
    })
  }

  const getEntriesForDate = async (date: string): Promise<Entry[]> => {
    if (!connection) return []
    return connection.client.run<Entry[]>({
      action: 'getEntriesForDate',
      date,
      filter: toFilterCriteria(filter),
    })
  }

  const exportEntries = async (scope: 'filtered' | 'all'): Promise<CsvExportData> => {
    if (!connection) throw new Error(zhTW.errors.export)
    try {
      return await connection.client.run<CsvExportData>({
        action: 'exportEntries',
        filter: scope === 'filtered' ? toFilterCriteria(filter) : toFilterCriteria(DEFAULT_ENTRY_FILTER),
      })
    } catch (exportError) {
      handleRequestError(exportError)
      throw exportError
    }
  }

  return {
    status,
    error,
    timezone,
    categories,
    tagSuggestions,
    entries,
    nextCursor,
    filter,
    isLoadingEntries,
    revision,
    signIn,
    retry,
    updateFilter,
    loadMore,
    saveEntry,
    deleteEntry,
    saveCategory,
    deactivateCategory,
    getMonthlyEntryCounts,
    getEntriesForDate,
    exportEntries,
    handleRequestError,
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : zhTW.errors.generic
}

function toEntryListData(value: unknown): EntryListData {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error(zhTW.errors.invalidServiceResponse)
  }

  const nextCursor = value.nextCursor
  if (nextCursor !== undefined && nextCursor !== null && typeof nextCursor !== 'string') {
    throw new Error(zhTW.errors.invalidServiceResponse)
  }

  // Apps Script API 可能省略值為 null 的物件欄位；缺少游標等同沒有下一頁。
  return {
    items: value.items as Entry[],
    nextCursor: typeof nextCursor === 'string' ? nextCursor : null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
