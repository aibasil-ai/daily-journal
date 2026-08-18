import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ApiRequest,
  BootstrapData,
  Category,
  CategoryManagementData,
  CsvExportData,
  Entry,
  EntryFilter,
  EntryInput,
  EntryListData,
  MoveEntriesResult,
} from '../../domain/journal'
import { DEFAULT_ENTRY_FILTER, toFilterCriteria } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { AuthenticationError } from '../../services/journal-api-client'

export type JournalStatus = 'checking-session' | 'signed-out' | 'loading' | 'ready' | 'error'

export interface JournalClient {
  restoreSession(): Promise<boolean>
  beginSignIn(): void
  signOut(): void
  run<T>(request: ApiRequest): Promise<T>
}

export function useJournal(client: JournalClient) {
  const [status, setStatus] = useState<JournalStatus>('checking-session')
  const [error, setError] = useState<string>()
  const [timezone, setTimezone] = useState<string>()
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryEntryCounts, setCategoryEntryCounts] = useState<Record<string, number>>({})
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [filter, setFilter] = useState<EntryFilter>(DEFAULT_ENTRY_FILTER)
  const [isLoadingEntries, setIsLoadingEntries] = useState(false)
  const [revision, setRevision] = useState(0)
  const listRequestId = useRef(0)
  const requestEpoch = useRef(0)

  const clearData = useCallback((nextStatus: JournalStatus, nextError?: string) => {
    listRequestId.current += 1
    setTimezone(undefined)
    setCategories([])
    setCategoryEntryCounts({})
    setTagSuggestions([])
    setEntries([])
    setNextCursor(null)
    setFilter({ ...DEFAULT_ENTRY_FILTER })
    setIsLoadingEntries(false)
    setRevision((current) => current + 1)
    setStatus(nextStatus)
    setError(nextError)
  }, [])

  const handleRequestError = useCallback((requestError: unknown) => {
    if (requestError instanceof AuthenticationError) {
      requestEpoch.current += 1
      clearData('signed-out', zhTW.errors.authentication)
      return
    }
    setError(toErrorMessage(requestError))
  }, [clearData])

  const loadEntries = useCallback(async (
    requestedFilter: EntryFilter,
    append = false,
    expectedEpoch: number = requestEpoch.current,
  ): Promise<void> => {
    const requestId = ++listRequestId.current
    setIsLoadingEntries(true)
    try {
      const response = await client.run<unknown>({
        action: 'listEntries',
        filter: requestedFilter,
      })
      const result = toEntryListData(response)
      if (expectedEpoch !== requestEpoch.current || requestId !== listRequestId.current) return
      setEntries((current) => append ? [...current, ...result.items] : result.items)
      setNextCursor(result.nextCursor)
      setError(undefined)
    } finally {
      if (expectedEpoch === requestEpoch.current && requestId === listRequestId.current) {
        setIsLoadingEntries(false)
      }
    }
  }, [client])

  const loadCategoryManagement = useCallback(async (expectedEpoch: number): Promise<void> => {
    const value = await client.run<unknown>({ action: 'listCategories' })
    const data = toCategoryManagementData(value)
    if (expectedEpoch !== requestEpoch.current) return
    setCategories(data.categories)
    setCategoryEntryCounts(data.entryCounts)
  }, [client])

  const loadBootstrap = useCallback(async (expectedEpoch: number): Promise<void> => {
    setStatus('loading')
    setError(undefined)
    try {
      const bootstrap = await client.run<BootstrapData>({ action: 'bootstrap' })
      if (expectedEpoch !== requestEpoch.current) return
      setTimezone(bootstrap.timezone)
      setCategories(bootstrap.categories)
      setTagSuggestions(bootstrap.tagSuggestions)
      await loadCategoryManagement(expectedEpoch)
      if (expectedEpoch !== requestEpoch.current) return
      const initialFilter = { ...DEFAULT_ENTRY_FILTER }
      setFilter(initialFilter)
      setStatus('ready')
      void loadEntries(initialFilter, false, expectedEpoch).catch((requestError: unknown) => {
        if (expectedEpoch === requestEpoch.current) handleRequestError(requestError)
      })
    } catch (bootstrapError) {
      if (expectedEpoch !== requestEpoch.current) return
      if (bootstrapError instanceof AuthenticationError) {
        requestEpoch.current += 1
        clearData('signed-out', zhTW.errors.authentication)
        return
      }
      clearData('error', toErrorMessage(bootstrapError))
    }
  }, [clearData, client, handleRequestError, loadCategoryManagement, loadEntries])

  const restoreSession = useCallback(async (): Promise<void> => {
    const expectedEpoch = ++requestEpoch.current
    clearData('checking-session')
    try {
      const authenticated = await client.restoreSession()
      if (expectedEpoch !== requestEpoch.current) return
      if (!authenticated) {
        clearData('signed-out', consumeOAuthError())
        return
      }
      await loadBootstrap(expectedEpoch)
    } catch (restoreError) {
      if (expectedEpoch !== requestEpoch.current) return
      if (restoreError instanceof AuthenticationError) {
        requestEpoch.current += 1
        clearData('signed-out', zhTW.errors.authentication)
        return
      }
      clearData('error', toErrorMessage(restoreError))
    }
  }, [clearData, client, loadBootstrap])

  useEffect(() => {
    void restoreSession()
    return () => {
      requestEpoch.current += 1
    }
  }, [restoreSession])

  const signIn = useCallback((): void => {
    client.beginSignIn()
  }, [client])

  const retry = restoreSession

  const signOut = useCallback((): void => {
    requestEpoch.current += 1
    clearData('signed-out')
    client.signOut()
  }, [clearData, client])

  const updateFilter = async (changes: Partial<EntryFilter>): Promise<void> => {
    const nextFilter = { ...filter, ...changes, cursor: null }
    setFilter(nextFilter)
    try {
      await loadEntries(nextFilter, false, requestEpoch.current)
    } catch (loadError) {
      handleRequestError(loadError)
    }
  }

  const loadMore = async (): Promise<void> => {
    if (nextCursor === null) return
    try {
      await loadEntries({ ...filter, cursor: nextCursor }, true, requestEpoch.current)
    } catch (loadError) {
      handleRequestError(loadError)
    }
  }

  const saveEntry = async (input: EntryInput): Promise<Entry> => {
    try {
      const expectedEpoch = requestEpoch.current
      const saved = await client.run<Entry>({ action: 'saveEntry', entry: input })
      if (expectedEpoch !== requestEpoch.current) throw new RequestInvalidatedError()
      setTagSuggestions((current) => [...new Set([...current, ...saved.tags])].sort())
      await loadCategoryManagement(expectedEpoch)
      await loadEntries({ ...filter, cursor: null }, false, expectedEpoch)
      setRevision((current) => current + 1)
      return saved
    } catch (saveError) {
      if (!(saveError instanceof RequestInvalidatedError)) handleRequestError(saveError)
      throw saveError
    }
  }

  const deleteEntry = async (id: string): Promise<void> => {
    try {
      const expectedEpoch = requestEpoch.current
      await client.run<null>({ action: 'deleteEntry', id })
      if (expectedEpoch !== requestEpoch.current) return
      await loadCategoryManagement(expectedEpoch)
      await loadEntries({ ...filter, cursor: null }, false, expectedEpoch)
      setRevision((current) => current + 1)
    } catch (deleteError) {
      handleRequestError(deleteError)
      throw deleteError
    }
  }

  const saveCategory = async (name: string, id?: string): Promise<Category> => {
    try {
      const expectedEpoch = requestEpoch.current
      const category = await client.run<Category>({
        action: 'saveCategory',
        category: { id, name },
      })
      if (expectedEpoch !== requestEpoch.current) throw new RequestInvalidatedError()
      setCategories((current) => upsertCategory(current, category))
      setCategoryEntryCounts((current) => ({ ...current, [category.id]: current[category.id] ?? 0 }))
      setRevision((current) => current + 1)
      return category
    } catch (categoryError) {
      if (!(categoryError instanceof RequestInvalidatedError)) handleRequestError(categoryError)
      throw categoryError
    }
  }

  const deactivateCategory = async (id: string): Promise<Category> => {
    try {
      const expectedEpoch = requestEpoch.current
      const category = await client.run<Category>({ action: 'deactivateCategory', id })
      if (expectedEpoch !== requestEpoch.current) throw new RequestInvalidatedError()
      setCategories((current) => upsertCategory(current, category))
      setCategoryEntryCounts((current) => ({ ...current, [category.id]: current[category.id] ?? 0 }))
      setRevision((current) => current + 1)
      return category
    } catch (categoryError) {
      if (!(categoryError instanceof RequestInvalidatedError)) handleRequestError(categoryError)
      throw categoryError
    }
  }

  const activateCategory = async (id: string): Promise<Category> => {
    try {
      const expectedEpoch = requestEpoch.current
      const category = await client.run<Category>({ action: 'activateCategory', id })
      if (expectedEpoch !== requestEpoch.current) throw new RequestInvalidatedError()
      setCategories((current) => upsertCategory(current, category))
      setCategoryEntryCounts((current) => ({ ...current, [category.id]: current[category.id] ?? 0 }))
      setRevision((current) => current + 1)
      return category
    } catch (categoryError) {
      if (!(categoryError instanceof RequestInvalidatedError)) handleRequestError(categoryError)
      throw categoryError
    }
  }

  const exportEntries = async (scope: 'filtered' | 'all'): Promise<CsvExportData> => {
    try {
      const expectedEpoch = requestEpoch.current
      const result = await client.run<CsvExportData>({
        action: 'exportEntries',
        filter: scope === 'filtered' ? toFilterCriteria(filter) : toFilterCriteria(DEFAULT_ENTRY_FILTER),
      })
      if (expectedEpoch !== requestEpoch.current) throw new RequestInvalidatedError()
      return result
    } catch (exportError) {
      if (!(exportError instanceof RequestInvalidatedError)) handleRequestError(exportError)
      throw exportError
    }
  }

  const loadCategoryEntryPage = useCallback(async (
    sourceCategoryId: string,
    cursor: string | null,
  ): Promise<EntryListData> => {
    const value = await client.run<unknown>({
      action: 'listEntries',
      filter: { ...DEFAULT_ENTRY_FILTER, categoryId: sourceCategoryId, cursor },
    })
    return toEntryListData(value)
  }, [client])

  const moveEntries = async (
    sourceCategoryId: string,
    targetCategoryId: string,
    entryIds: string[],
  ): Promise<void> => {
    try {
      const expectedEpoch = requestEpoch.current
      await client.run<MoveEntriesResult>({
        action: 'moveEntries',
        sourceCategoryId,
        targetCategoryId,
        entryIds,
      })
      if (expectedEpoch !== requestEpoch.current) throw new RequestInvalidatedError()
      await loadCategoryManagement(expectedEpoch)
      await loadEntries({ ...filter, cursor: null }, false, expectedEpoch)
      setRevision((current) => current + 1)
    } catch (moveError) {
      if (!(moveError instanceof RequestInvalidatedError)) handleRequestError(moveError)
      throw moveError
    }
  }

  const deleteCategory = async (id: string): Promise<void> => {
    const expectedEpoch = requestEpoch.current
    try {
      await client.run<null>({ action: 'deleteCategory', id })
      if (expectedEpoch !== requestEpoch.current) throw new RequestInvalidatedError()
      await loadCategoryManagement(expectedEpoch)
      await loadEntries({ ...filter, cursor: null }, false, expectedEpoch)
      setRevision((current) => current + 1)
    } catch (deleteError) {
      if (!(deleteError instanceof RequestInvalidatedError)) {
        if (!(deleteError instanceof AuthenticationError) && expectedEpoch === requestEpoch.current) {
          try {
            await loadCategoryManagement(expectedEpoch)
          } catch (refreshError) {
            handleRequestError(refreshError)
          }
        }
        handleRequestError(deleteError)
      }
      throw deleteError
    }
  }

  return {
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
  }
}

class RequestInvalidatedError extends Error {
  constructor() {
    super()
  }
}

function consumeOAuthError(): string | undefined {
  const url = new URL(window.location.href)
  if (url.searchParams.get('auth_error') !== 'oauth') return undefined

  url.searchParams.delete('auth_error')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  return zhTW.errors.googleAuthorization
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

function toCategoryManagementData(value: unknown): CategoryManagementData {
  if (!isRecord(value) || !Array.isArray(value.categories) || !isRecord(value.entryCounts)) {
    throw new Error(zhTW.errors.invalidServiceResponse)
  }
  const entryCounts = Object.fromEntries(Object.entries(value.entryCounts).map(([id, count]) => {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new Error(zhTW.errors.invalidServiceResponse)
    }
    return [id, count]
  })) as Record<string, number>
  return { categories: value.categories as Category[], entryCounts }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function upsertCategory(categories: Category[], category: Category): Category[] {
  const index = categories.findIndex((item) => item.id === category.id)
  const nextCategories = index === -1
    ? [...categories, category]
    : categories.map((item) => item.id === category.id ? category : item)

  return nextCategories.sort((left, right) => {
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}
