import { useState } from 'react'
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
  const [isSigningIn, setIsSigningIn] = useState(false)
  const isLoading = status === 'loading' || status === 'checking-session'
  const needsReconnect = status === 'error' || Boolean(error)

  const handleSignIn = () => {
    setIsSigningIn(true)
    onSignIn()
  }

  return (
    <main className="connection-screen">
      <div className="connection-screen__orbits" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <header className="connection-brand" aria-label={zhTW.accessibility.connectionBrand}>
        <JournalMark variant="brand" />
        <span className="connection-brand__text">
          <span>{zhTW.connection.eyebrow}</span>
          <strong>{zhTW.app.name}</strong>
        </span>
      </header>

      <div className="connection-card-shell">
        <span className="connection-card-shell__flare" aria-hidden="true" />
        <section className="connection-card" aria-labelledby="connection-title">
          <JournalMark variant="card" />
          <p className="connection-card__identity">
            <span>{zhTW.connection.eyebrow}</span>
            <strong>{zhTW.app.name}</strong>
          </p>
          <h1 id="connection-title">
            <span>{zhTW.connection.title}</span>
            <span className="connection-title-flare" aria-hidden="true" />
          </h1>
          <p className={`connection-card__description${error ? ' connection-card__description--error' : ''}`} role={error ? 'alert' : undefined}>
            {error ?? zhTW.connection.description}
          </p>
          {needsReconnect && <p className="connection-card__hint">{zhTW.connection.reconnectHint}</p>}
          <div className="connection-card__actions">
            {status === 'error' && (
              <button className="button connection-card__retry" type="button" onClick={onRetry} disabled={isLoading || isSigningIn}>
                <Icon>refresh</Icon>
                {zhTW.connection.retry}
              </button>
            )}
            <button
              className={`button connection-card__google-button${isSigningIn ? ' connection-card__google-button--loading' : ''}`}
              type="button"
              onClick={handleSignIn}
              disabled={isLoading || isSigningIn}
            >
              {isSigningIn ? (
                <>
                  <span className="app-loading-spinner app-loading-spinner--button" aria-hidden="true" />
                  <span>{zhTW.connection.redirecting}</span>
                </>
              ) : (
                <>
                  <GoogleMark />
                  <span>{isLoading ? zhTW.connection.connecting : status === 'error' ? zhTW.connection.reconnect : zhTW.connection.signIn}</span>
                </>
              )}
            </button>
          </div>
          <p style={{ marginTop: '1.25rem', color: '#adb4c0', fontSize: '0.75rem', lineHeight: 1.6, textAlign: 'center' }}>
            <a href="/privacy-policy.html">{zhTW.connection.privacyPolicy}</a>
            <span aria-hidden="true"> | </span>
            <a href="/terms-of-service.html">{zhTW.connection.termsOfService}</a>
          </p>
          <p className="connection-card__copyright">{zhTW.app.copyright}</p>
        </section>
      </div>
    </main>
  )
}

function JournalMark({ variant }: { variant: 'brand' | 'card' }) {
  return (
    <span className={`journal-mark journal-mark--${variant}`} aria-hidden="true">
      <Icon>description</Icon>
      <Icon filled className="journal-mark__sparkle">auto_awesome</Icon>
    </span>
  )
}

function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20H24v8h11.3c-1.7 4.8-6.2 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.6 6.2 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-4Z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.6 6.2 29.6 4 24 4c-7.7 0-14.3 4.3-17.7 10.7Z" />
      <path fill="#4CAF50" d="M24 44c5.4 0 10.2-2 13.8-5.3l-6.1-5.2C29.7 35.1 27 36 24 36c-5.1 0-9.4-3.2-11.1-7.7l-6.5 5C9.8 39.6 16.3 44 24 44Z" />
      <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.3 4.1-4.3 5.5l6.1 5.2C40.7 35.3 44 30.3 44 24c0-1.3-.1-2.7-.4-4Z" />
    </svg>
  )
}
