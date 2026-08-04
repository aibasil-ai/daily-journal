import { useEffect, useRef, useState } from 'react'
import type { ApiRequest, Category, Entry, EntryFilter, EntryInput, EntryListResult } from '../../domain/journal'
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
  const entryEpoch = useRef(0)

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
    const requestEpoch = ++entryEpoch.current
    setState((current) => ({ ...current, isLoadingEntries: true, error: undefined }))
    try {
      const page = await client.run<EntryListResult>({ action: 'listEntries', filter })
      if (requestEpoch !== entryEpoch.current) return
      setState((current) => ({
        ...current,
        entries: append ? [...current.entries, ...page.items] : page.items,
        filter,
        nextCursor: page.nextCursor,
        isLoadingEntries: false,
      }))
    } catch (error) {
      if (requestEpoch !== entryEpoch.current) return
      setState((current) => ({ ...current, isLoadingEntries: false, error: error instanceof Error ? error.message : zhTW.api.requestFailed }))
    }
  }

  async function saveEntry(input: EntryInput) {
    const saved = await client.run<Entry>({ action: 'saveEntry', entry: input })
    entryEpoch.current += 1
    setState((current) => ({
      ...current,
      entries: input.id
        ? current.entries.map((entry) => entry.id === saved.id ? saved : entry)
        : [saved, ...current.entries],
      tagSuggestions: [...new Set([...current.tagSuggestions, ...saved.tags])],
      isLoadingEntries: false,
    }))
  }

  async function deleteEntry(id: string) {
    await client.run<void>({ action: 'deleteEntry', id })
    entryEpoch.current += 1
    setState((current) => ({ ...current, entries: current.entries.filter((entry) => entry.id !== id), isLoadingEntries: false }))
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
