import { useEffect, useRef, useState } from 'react'
import type { ApiRequest, Category, Entry, EntryFilter, EntryInput } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'

export type JournalStatus = 'checking-config' | 'signed-out' | 'loading' | 'ready' | 'error'

export type JournalBootstrap = {
  timezone: string
  categories: Category[]
  tagSuggestions: string[]
}

export type JournalClient = {
  signIn: () => Promise<void>
  run: <T>(request: ApiRequest) => Promise<T>
}

export type EntryPage = {
  entries: Entry[]
  nextCursor: string | null
}

type JournalState = {
  status: JournalStatus
  bootstrap: JournalBootstrap | undefined
  categories: Category[]
  tagSuggestions: string[]
  entries: Entry[]
  filter: EntryFilter
  nextCursor: string | null
  isLoadingEntries: boolean
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
  error: undefined,
}

function defaultFilter(): EntryFilter {
  return { query: '', from: null, to: null, categoryId: null, tag: null, cursor: null, limit: 20 }
}

export function useJournal(client: JournalClient) {
  const [state, setState] = useState<JournalState>(signedOutState)
  const latestEntryRequest = useRef(0)

  async function connect(requestSignIn: boolean) {
    if (state.status === 'loading') return

    setState({ ...signedOutState, status: 'loading' })
    try {
      if (requestSignIn) await client.signIn()
       const bootstrap = await client.run<JournalBootstrap>({ action: 'bootstrap' })
       setState({
         status: 'ready',
         bootstrap,
         categories: bootstrap.categories.filter((category) => category.isActive),
         tagSuggestions: bootstrap.tagSuggestions,
         entries: [],
         filter: defaultFilter(),
         nextCursor: null,
         isLoadingEntries: false,
         error: undefined,
      })
    } catch (error) {
      setState({
        ...signedOutState,
        status: 'error',
        error: error instanceof Error ? error.message : zhTW.api.requestFailed,
      })
    }
  }

  async function loadEntries(filter: EntryFilter, append = false) {
    const requestId = ++latestEntryRequest.current
    setState((current) => ({ ...current, isLoadingEntries: true, error: undefined }))
    try {
      const page = await client.run<EntryPage>({ action: 'listEntries', filter })
      if (requestId !== latestEntryRequest.current) return
      setState((current) => ({
        ...current,
        entries: append ? [...current.entries, ...page.entries] : page.entries,
        filter,
        nextCursor: page.nextCursor,
        isLoadingEntries: false,
      }))
    } catch (error) {
      if (requestId !== latestEntryRequest.current) return
      setState((current) => ({ ...current, isLoadingEntries: false, error: error instanceof Error ? error.message : zhTW.api.requestFailed }))
    }
  }

  async function saveEntry(input: EntryInput) {
    const saved = await client.run<Entry>({ action: 'saveEntry', entry: input })
    setState((current) => ({
      ...current,
      entries: input.id
        ? current.entries.map((entry) => entry.id === saved.id ? saved : entry)
        : [saved, ...current.entries],
      tagSuggestions: [...new Set([...current.tagSuggestions, ...saved.tags])],
    }))
  }

  async function deleteEntry(id: string) {
    await client.run<void>({ action: 'deleteEntry', id })
    setState((current) => ({ ...current, entries: current.entries.filter((entry) => entry.id !== id) }))
  }

  function setFilter(filter: EntryFilter) {
    const initialFilter = { ...filter, cursor: null }
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
    retry: () => connect(false),
    saveEntry,
    loadEntries,
    deleteEntry,
    setFilter,
  }
}
