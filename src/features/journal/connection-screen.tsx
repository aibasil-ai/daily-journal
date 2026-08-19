import { useState } from 'react'
import type { JournalStatus } from './use-journal'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'
import type { CandidateSpreadsheet, UserProfile } from '../../services/journal-api-client'

type ConnectionScreenProps = {
  status: JournalStatus
  error?: string
  user?: UserProfile
  candidates?: CandidateSpreadsheet[]
  isLoadingCandidates?: boolean
  onSignIn: () => void
  onRetry: () => void
  onSelectSheet?: (spreadsheetId: string, spreadsheetName?: string) => Promise<void>
  onCreateSheet?: (name?: string) => Promise<void>
}

export function ConnectionScreen({
  status,
  error,
  user,
  candidates = [],
  isLoadingCandidates = false,
  onSignIn,
  onRetry,
  onSelectSheet,
  onCreateSheet,
}: ConnectionScreenProps) {
  const isLoading = status === 'loading' || status === 'checking-session'
  const isProvisioning = status === 'provisioning'

  const [mode, setMode] = useState<'candidates' | 'create' | 'manual'>('candidates')
  const [newSheetName, setNewSheetName] = useState('每日記事')
  const [manualSheetId, setManualSheetId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string>()

  const handleSelect = async (id: string, name?: string) => {
    if (!onSelectSheet) return
    setIsSubmitting(true)
    setActionError(undefined)
    try {
      await onSelectSheet(id, name)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : zhTW.errors.generic)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!onCreateSheet) return
    setIsSubmitting(true)
    setActionError(undefined)
    try {
      await onCreateSheet(newSheetName.trim() || '每日記事')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : zhTW.errors.generic)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleManualSelect = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualSheetId.trim()) return
    await handleSelect(manualSheetId.trim(), '自訂試算表')
  }

  if (isProvisioning) {
    return (
      <main className="connection-screen">
        <header className="connection-brand" aria-label={zhTW.accessibility.connectionBrand}>
          <JournalMark variant="brand" />
          <span className="connection-brand__text">
            <span>{user?.email ?? zhTW.connection.eyebrow}</span>
            <strong>{zhTW.app.name}</strong>
          </span>
        </header>

        <div className="connection-card-shell" style={{ maxWidth: 540 }}>
          <section className="connection-card" aria-labelledby="onboarding-title">
            <h1 id="onboarding-title" style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
              <span>{zhTW.onboarding.title}</span>
            </h1>
            <p className="connection-card__description">
              {zhTW.onboarding.description}
            </p>

            {(error || actionError) && (
              <p className="connection-card__description connection-card__description--error" role="alert">
                {actionError || error}
              </p>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0', width: '100%' }}>
              <button
                type="button"
                className={`button ${mode === 'candidates' ? 'button--primary' : 'button--secondary'}`}
                style={{ flex: 1, fontSize: '0.85rem' }}
                onClick={() => setMode('candidates')}
              >
                {zhTW.onboarding.chooseExisting}
              </button>
              <button
                type="button"
                className={`button ${mode === 'create' ? 'button--primary' : 'button--secondary'}`}
                style={{ flex: 1, fontSize: '0.85rem' }}
                onClick={() => setMode('create')}
              >
                {zhTW.onboarding.createNew}
              </button>
              <button
                type="button"
                className={`button ${mode === 'manual' ? 'button--primary' : 'button--secondary'}`}
                style={{ flex: 1, fontSize: '0.85rem' }}
                onClick={() => setMode('manual')}
              >
                {zhTW.onboarding.enterId}
              </button>
            </div>

            {mode === 'candidates' && (
              <div style={{ width: '100%', maxHeight: 240, overflowY: 'auto' }}>
                {isLoadingCandidates && (
                  <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    {zhTW.onboarding.loadingCandidates}
                  </p>
                )}
                {!isLoadingCandidates && candidates.length === 0 && (
                  <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    {zhTW.onboarding.noCandidates}
                  </p>
                )}
                {candidates.map((sheet) => (
                  <div
                    key={sheet.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.5rem 0.75rem',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.9rem' }}>{sheet.name}</strong>
                      <small style={{ color: 'var(--color-text-secondary)' }}>{sheet.id}</small>
                    </div>
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={isSubmitting}
                      onClick={() => void handleSelect(sheet.id, sheet.name)}
                    >
                      {zhTW.onboarding.selectButton}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {mode === 'create' && (
              <form onSubmit={handleCreate} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <label>
                  <span style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>{zhTW.onboarding.sheetName}</span>
                  <input
                    type="text"
                    value={newSheetName}
                    onChange={(e) => setNewSheetName(e.target.value)}
                    placeholder={zhTW.onboarding.sheetNamePlaceholder}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 4, border: '1px solid var(--color-border)' }}
                    required
                  />
                </label>
                <button type="submit" className="button button--primary" disabled={isSubmitting} style={{ marginTop: '0.5rem' }}>
                  {isSubmitting ? zhTW.connection.connecting : zhTW.onboarding.createButton}
                </button>
              </form>
            )}

            {mode === 'manual' && (
              <form onSubmit={handleManualSelect} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <label>
                  <span style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>{zhTW.onboarding.sheetId}</span>
                  <input
                    type="text"
                    value={manualSheetId}
                    onChange={(e) => setManualSheetId(e.target.value)}
                    placeholder={zhTW.onboarding.sheetIdPlaceholder}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 4, border: '1px solid var(--color-border)' }}
                    required
                  />
                </label>
                <button type="submit" className="button button--primary" disabled={isSubmitting} style={{ marginTop: '0.5rem' }}>
                  {isSubmitting ? zhTW.connection.connecting : zhTW.onboarding.selectButton}
                </button>
              </form>
            )}
          </section>
        </div>
      </main>
    )
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
          <div className="connection-card__actions">
            {status === 'error' && (
              <button className="button connection-card__retry" type="button" onClick={onRetry} disabled={isLoading}>
                <Icon>refresh</Icon>
                {zhTW.connection.retry}
              </button>
            )}
            <button className="button connection-card__google-button" type="button" onClick={onSignIn} disabled={isLoading}>
              <GoogleMark />
              {isLoading ? zhTW.connection.connecting : status === 'error' ? zhTW.connection.reconnect : zhTW.connection.signIn}
            </button>
          </div>
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
