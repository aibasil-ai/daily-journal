import { useEffect, useState } from 'react'
import { loadRuntimeConfig } from './config/runtime-config'
import { EntryForm } from './features/entries/entry-form'
import { FilterBar } from './features/entries/filter-bar'
import { Timeline } from './features/entries/timeline'
import { ConnectionScreen } from './features/journal/connection-screen'
import { type JournalClient, useJournal } from './features/journal/use-journal'
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

  if (journal.status === 'ready') {
    return (
      <div className="journal-application">
        <p>{zhTW.journal.ready}</p>
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
        <FilterBar
          categories={journal.categories}
          tagSuggestions={journal.tagSuggestions}
          filter={journal.filter}
          onChange={journal.setFilter}
        />
        {journal.error && <p className="journal-error" role="alert">{journal.error}</p>}
        <Timeline
          entries={journal.entries}
          nextCursor={journal.nextCursor}
          isLoadingMore={journal.isLoadingEntries}
          onEdit={setEditingEntry}
          onDelete={journal.deleteEntry}
          onLoadMore={() => journal.loadEntries({ ...journal.filter, cursor: journal.nextCursor }, true)}
        />
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
