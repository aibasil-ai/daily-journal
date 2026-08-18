import type { JournalStatus } from './use-journal'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'

type ConnectionScreenProps = {
  status: JournalStatus
  error?: string
  onSignIn: () => void
  onRetry: () => void
}

export function ConnectionScreen({ status, error, onSignIn, onRetry }: ConnectionScreenProps) {
  const isLoading = status === 'loading' || status === 'checking-session'

  return (
    <main className="connection-screen">
      <section className="connection-card">
        <span className="connection-card__mark"><Icon filled>edit_note</Icon></span>
        <p className="connection-card__eyebrow">{zhTW.app.tagline}</p>
        <h1>{zhTW.app.name}</h1>
        <h2>{zhTW.connection.title}</h2>
        <p>{error ?? zhTW.connection.description}</p>
        <div className="connection-card__actions">
          {status === 'error' && (
            <button className="button button--secondary" type="button" onClick={onRetry} disabled={isLoading}>
              <Icon>refresh</Icon>
              {zhTW.connection.retry}
            </button>
          )}
          <button className="button button--primary" type="button" onClick={onSignIn} disabled={isLoading}>
            <Icon filled>login</Icon>
            {isLoading ? zhTW.connection.connecting : status === 'error' ? zhTW.connection.reconnect : zhTW.connection.signIn}
          </button>
        </div>
      </section>
    </main>
  )
}
