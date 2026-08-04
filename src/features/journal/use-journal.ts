import { useState } from 'react'
import type { Category } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'

export type JournalStatus = 'checking-config' | 'signed-out' | 'loading' | 'ready' | 'error'

export type JournalBootstrap = {
  timezone: string
  categories: Category[]
  tagSuggestions: string[]
}

export type JournalClient = {
  signIn: () => Promise<void>
  run: (request: { action: 'bootstrap' }) => Promise<JournalBootstrap>
}

type JournalState = {
  status: JournalStatus
  bootstrap: JournalBootstrap | undefined
  categories: Category[]
  tagSuggestions: string[]
  error: string | undefined
}

const signedOutState: JournalState = {
  status: 'signed-out',
  bootstrap: undefined,
  categories: [],
  tagSuggestions: [],
  error: undefined,
}

export function useJournal(client: JournalClient) {
  const [state, setState] = useState<JournalState>(signedOutState)

  async function connect(requestSignIn: boolean) {
    if (state.status === 'loading') return

    setState({ ...signedOutState, status: 'loading' })
    try {
      if (requestSignIn) await client.signIn()
      const bootstrap = await client.run({ action: 'bootstrap' })
      setState({
        status: 'ready',
        bootstrap,
        categories: bootstrap.categories.filter((category) => category.isActive),
        tagSuggestions: bootstrap.tagSuggestions,
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

  return {
    ...state,
    signIn: () => connect(true),
    retry: () => connect(false),
  }
}
