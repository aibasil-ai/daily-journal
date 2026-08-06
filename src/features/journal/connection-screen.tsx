import { zhTW } from '../../i18n/zh-TW'
import type { JournalStatus } from './use-journal'

type ConnectionScreenProps = {
  status: Exclude<JournalStatus, 'ready'>
  error?: string
  loginError?: string
  title?: string
  onSignIn: () => void
  onRetry: () => void
}

export function ConnectionScreen({ status, error, loginError, title = zhTW.journal.connectionTitle, onSignIn, onRetry }: ConnectionScreenProps) {
  const loading = status === 'loading'
  const checkingConfig = status === 'checking-config'

  return (
    <section className="connection-screen connection-screen--centered" aria-label={title} aria-live="polite">
      <h2>{title}</h2>
      {checkingConfig && <p>{zhTW.journal.checkingConfig}</p>}
      {status === 'signed-out' && loginError && <p className="connection-screen__error" role="alert">{loginError}</p>}
      {status === 'signed-out' && <p>{zhTW.journal.signedOutDescription}</p>}
      {loading && <p>{zhTW.journal.connectingDescription}</p>}
      {status === 'error' && <p className="connection-screen__error" role="alert">{error}</p>}

      {status === 'signed-out' && (
        <button type="button" onClick={onSignIn}>{zhTW.journal.signIn}</button>
      )}
      {loading && (
        <button type="button" disabled>{zhTW.journal.connecting}</button>
      )}
      {status === 'error' && (
        <div className="connection-screen__actions">
          <button type="button" onClick={onSignIn}>{zhTW.journal.signInAgain}</button>
          <button type="button" onClick={onRetry}>{zhTW.journal.retry}</button>
        </div>
      )}
    </section>
  )
}
