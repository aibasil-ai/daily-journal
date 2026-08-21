import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'
import {
  AuthenticationError,
  ProvisioningApiError,
  toProvisioningErrorMessage,
  type CandidateSheet,
  type ProvisioningClient,
  type ProvisioningStatus,
} from '../../services/journal-api-client'

type DataSpaceSetupProps = {
  client: ProvisioningClient
  mode: 'initial' | 'change'
  onComplete: () => void
  onCancel?: () => void
  onSessionInvalidated?: () => void
  onRestart?: () => void
}

type ActionType = 'create' | 'search' | 'search_more' | 'url' | 'select' | 'confirm'

export function DataSpaceSetup({
  client,
  mode,
  onComplete,
  onCancel,
  onSessionInvalidated,
  onRestart,
}: DataSpaceSetupProps) {
  const [status, setStatus] = useState<ProvisioningStatus>()
  const [currentSheetName, setCurrentSheetName] = useState<string>()
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<CandidateSheet[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [sheetUrl, setSheetUrl] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [activeAction, setActiveAction] = useState<ActionType | null>(null)
  const [selectingCode, setSelectingCode] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [requiresSessionRecovery, setRequiresSessionRecovery] = useState(false)
  const busyRef = useRef(false)
  const statusRequestId = useRef(0)
  const componentEpoch = useRef(0)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const isReadyToConfirm = mode === 'change' && status?.phase === 'ready_to_confirm'
  const statusError = status?.errorCode
    ? toProvisioningErrorMessage(status.errorCode)
    : status?.phase === 'failed'
      ? zhTW.errors.provisioning
      : undefined
  const needsRecovery = requiresSessionRecovery
    || status?.phase === 'failed'
    || isSessionRecoveryCode(status?.errorCode)

  useEffect(() => {
    headingRef.current?.focus()
  }, [isReadyToConfirm, mode, needsRecovery])

  useEffect(() => () => {
    componentEpoch.current += 1
  }, [])

  useEffect(() => {
    let cancelled = false
    const requestId = ++statusRequestId.current
    void client.getProvisioningStatus().then((nextStatus) => {
      if (cancelled || requestId !== statusRequestId.current) return
      setStatus(nextStatus)
      if (mode === 'change') setCurrentSheetName(nextStatus.sheetName ?? undefined)
    }).catch((statusError: unknown) => {
      if (cancelled || requestId !== statusRequestId.current) return
      if (statusError instanceof AuthenticationError) {
        onSessionInvalidated?.()
        return
      }
      setError(toErrorMessage(statusError))
      setRequiresSessionRecovery(isSessionRecoveryRequired(statusError))
    })
    return () => {
      cancelled = true
    }
  }, [client, mode, onSessionInvalidated])

  const beginBusy = (): boolean => {
    if (busyRef.current) return false
    busyRef.current = true
    setIsBusy(true)
    return true
  }

  const finishBusy = (): void => {
    busyRef.current = false
    setIsBusy(false)
  }

  const handleProvisioningResult = (nextStatus: ProvisioningStatus): void => {
    setStatus(nextStatus)
    setRequiresSessionRecovery(nextStatus.phase === 'failed')
    if (nextStatus.phase === 'completed') onComplete()
  }

  const runProvisioningAction = async (
    actionType: ActionType,
    action: () => Promise<ProvisioningStatus>,
    targetCandidateCode?: string,
  ): Promise<void> => {
    if (!beginBusy()) return
    setActiveAction(actionType)
    if (targetCandidateCode) setSelectingCode(targetCandidateCode)
    const expectedComponentEpoch = componentEpoch.current
    statusRequestId.current += 1
    setError(undefined)
    setRequiresSessionRecovery(false)
    try {
      const nextStatus = await action()
      if (expectedComponentEpoch !== componentEpoch.current) return
      handleProvisioningResult(nextStatus)
    } catch (actionError) {
      if (expectedComponentEpoch !== componentEpoch.current) return
      if (actionError instanceof AuthenticationError) {
        onSessionInvalidated?.()
        return
      }
      setError(toErrorMessage(actionError))
      setRequiresSessionRecovery(isSessionRecoveryRequired(actionError))
    } finally {
      if (expectedComponentEpoch === componentEpoch.current) {
        setActiveAction(null)
        setSelectingCode(null)
        finishBusy()
      } else {
        busyRef.current = false
      }
    }
  }

  const searchCandidates = async (append: boolean): Promise<void> => {
    const normalizedQuery = query.trim()
    if (normalizedQuery.length < 2) {
      setError(zhTW.provisioning.searchTooShort)
      return
    }
    if (!beginBusy()) return
    setActiveAction(append ? 'search_more' : 'search')
    const expectedComponentEpoch = componentEpoch.current
    setError(undefined)
    setRequiresSessionRecovery(false)
    if (!append) {
      setCandidates([])
      setNextCursor(null)
    }
    try {
      const page = await client.listCandidateSheets(normalizedQuery, append ? nextCursor : null)
      if (expectedComponentEpoch !== componentEpoch.current) return
      setCandidates((current) => append ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
      setHasSearched(true)
    } catch (searchError) {
      if (expectedComponentEpoch !== componentEpoch.current) return
      if (searchError instanceof AuthenticationError) {
        onSessionInvalidated?.()
        return
      }
      setError(toErrorMessage(searchError))
      setRequiresSessionRecovery(isSessionRecoveryRequired(searchError))
    } finally {
      if (expectedComponentEpoch === componentEpoch.current) {
        setActiveAction(null)
        finishBusy()
      } else {
        busyRef.current = false
      }
    }
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void searchCandidates(false)
  }

  const handleUrlSubmission = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = sheetUrl.trim()
    if (!value) {
      setError(zhTW.errors.provisioning)
      return
    }
    void runProvisioningAction('url', () => client.submitSheetUrl(value))
  }

  const handleRecovery = () => {
    if (mode === 'initial') onRestart?.()
    else onSessionInvalidated?.()
  }

  return (
    <main className="data-space-setup">
      <section className="data-space-setup__card" aria-labelledby="data-space-setup-title">
        <header className="data-space-setup__header">
          <span className="data-space-setup__icon" aria-hidden="true"><Icon filled>table_chart</Icon></span>
          <p>{zhTW.provisioning.status}</p>
          <h1 ref={headingRef} id="data-space-setup-title" tabIndex={-1}>{zhTW.provisioning.title}</h1>
          <span>{mode === 'initial' ? zhTW.provisioning.initialDescription : zhTW.provisioning.changeDescription}</span>
        </header>

        {(error ?? statusError) && <p className="form-error data-space-setup__error" role="alert">{error ?? statusError}</p>}

        {needsRecovery ? (
          <section className="data-space-setup__recovery" aria-labelledby="data-space-recovery-title">
            <span className="data-space-setup__confirmation-icon" aria-hidden="true"><Icon>refresh</Icon></span>
            <h2 id="data-space-recovery-title">{zhTW.provisioning.recoveryTitle}</h2>
            <p>{zhTW.provisioning.recoveryDescription}</p>
            <div className="data-space-setup__actions">
              {mode === 'change' && onCancel && (
                <button className="button button--secondary" type="button" disabled={isBusy} onClick={onCancel}>
                  {zhTW.provisioning.cancelChange}
                </button>
              )}
              {mode === 'change' && onSessionInvalidated && (
                <button className="button button--primary" type="button" disabled={isBusy} onClick={handleRecovery}>
                  <Icon>refresh</Icon>
                  {zhTW.provisioning.reloadOriginal}
                </button>
              )}
              {onRestart && (
                <button className={`button ${mode === 'initial' ? 'button--primary' : 'button--secondary'}`} type="button" disabled={isBusy} onClick={onRestart}>
                  <Icon>{mode === 'initial' ? 'login' : 'restart_alt'}</Icon>
                  {zhTW.provisioning.restartSetup}
                </button>
              )}
            </div>
          </section>
        ) : isReadyToConfirm ? (
          <section className="data-space-setup__confirmation" aria-labelledby="data-space-confirmation-title">
            <span className="data-space-setup__confirmation-icon" aria-hidden="true"><Icon>swap_horiz</Icon></span>
            <h2 id="data-space-confirmation-title">{zhTW.provisioning.confirmTitle}</h2>
            <dl>
              <div>
                <dt>{zhTW.provisioning.currentSheet}</dt>
                <dd>{currentSheetName ?? zhTW.provisioning.unknownSheet}</dd>
              </div>
              <div>
                <dt>{zhTW.provisioning.targetSheet}</dt>
                <dd>{status.sheetName ?? zhTW.provisioning.unknownSheet}</dd>
              </div>
            </dl>
            <p>{zhTW.provisioning.confirmDescription}</p>
            <div className="data-space-setup__actions">
              {onCancel && (
                <button className="button button--secondary" type="button" disabled={isBusy} onClick={onCancel}>
                  {zhTW.provisioning.cancelChange}
                </button>
              )}
              <button className="button button--primary" type="button" disabled={isBusy} onClick={() => void runProvisioningAction('confirm', () => client.confirmProvisioning())}>
                <Icon className={activeAction === 'confirm' ? 'loading-note-spinner' : ''}>
                  {activeAction === 'confirm' ? 'progress_activity' : 'check'}
                </Icon>
                {activeAction === 'confirm' ? zhTW.provisioning.confirming : zhTW.provisioning.confirmAction}
              </button>
            </div>
          </section>
        ) : (
          <div className="data-space-setup__options">
            <section className="data-space-option">
              <span className="data-space-option__icon" aria-hidden="true"><Icon>note_add</Icon></span>
              <h2>{zhTW.provisioning.createTitle}</h2>
              <p>{zhTW.provisioning.createDescription}</p>
              <button
                className="button button--primary"
                type="button"
                disabled={isBusy}
                onClick={() => void runProvisioningAction('create', () => client.createSheet())}
              >
                <Icon className={activeAction === 'create' ? 'loading-note-spinner' : ''}>
                  {activeAction === 'create' ? 'progress_activity' : 'add'}
                </Icon>
                {activeAction === 'create' ? zhTW.provisioning.creating : zhTW.provisioning.createAction}
              </button>
            </section>

            <section className="data-space-option">
              <span className="data-space-option__icon" aria-hidden="true"><Icon>search</Icon></span>
              <h2>{zhTW.provisioning.searchTitle}</h2>
              <p>{zhTW.provisioning.searchDescription}</p>
              <form className="data-space-option__form" onSubmit={handleSearch}>
                <label className="field-group" htmlFor="candidate-sheet-query">
                  <span>{zhTW.provisioning.searchLabel}</span>
                  <input
                    id="candidate-sheet-query"
                    value={query}
                    placeholder={zhTW.provisioning.searchPlaceholder}
                    disabled={isBusy}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <button className="button button--secondary" type="submit" disabled={isBusy}>
                  {activeAction === 'search' && <Icon className="loading-note-spinner">progress_activity</Icon>}
                  {activeAction === 'search' ? zhTW.provisioning.searching : zhTW.provisioning.searchAction}
                </button>
              </form>
              {hasSearched && candidates.length === 0 && !isBusy && <p className="form-note">{zhTW.provisioning.noCandidates}</p>}
              {candidates.length > 0 && (
                <ul className="data-space-candidates">
                  {candidates.map((candidate) => (
                    <li key={candidate.selectionCode}>
                      <div>
                        <strong>{candidate.name}</strong>
                        <time dateTime={candidate.modifiedTime}>{zhTW.provisioning.modifiedTime(formatModifiedTime(candidate.modifiedTime))}</time>
                      </div>
                      <button
                        className="button button--secondary"
                        type="button"
                        disabled={isBusy}
                        aria-label={zhTW.provisioning.selectCandidate(candidate.name)}
                        onClick={() => void runProvisioningAction('select', () => client.selectCandidate(candidate.selectionCode), candidate.selectionCode)}
                      >
                        {selectingCode === candidate.selectionCode && <Icon className="loading-note-spinner">progress_activity</Icon>}
                        {selectingCode === candidate.selectionCode ? zhTW.provisioning.selecting(candidate.name) : zhTW.provisioning.selectCandidate(candidate.name)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {nextCursor !== null && (
                <button className="button button--text" type="button" disabled={isBusy} onClick={() => void searchCandidates(true)}>
                  {activeAction === 'search_more' && <Icon className="loading-note-spinner">progress_activity</Icon>}
                  {zhTW.provisioning.loadMore}
                </button>
              )}
            </section>

            <section className="data-space-option">
              <span className="data-space-option__icon" aria-hidden="true"><Icon>link</Icon></span>
              <h2>{zhTW.provisioning.urlTitle}</h2>
              <p>{zhTW.provisioning.urlDescription}</p>
              <form className="data-space-option__form" onSubmit={handleUrlSubmission}>
                <label className="field-group" htmlFor="candidate-sheet-url">
                  <span>{zhTW.provisioning.urlLabel}</span>
                  <input
                    id="candidate-sheet-url"
                    type="url"
                    value={sheetUrl}
                    placeholder={zhTW.provisioning.urlPlaceholder}
                    disabled={isBusy}
                    onChange={(event) => setSheetUrl(event.target.value)}
                  />
                </label>
                <button className="button button--secondary" type="submit" disabled={isBusy}>
                  {activeAction === 'url' && <Icon className="loading-note-spinner">progress_activity</Icon>}
                  {activeAction === 'url' ? zhTW.provisioning.linking : zhTW.provisioning.urlAction}
                </button>
              </form>
            </section>
          </div>
        )}

        {!needsRecovery && !isReadyToConfirm && onCancel && (
          <div className="data-space-setup__cancel">
            <button className="button button--text" type="button" disabled={isBusy} onClick={onCancel}>{zhTW.provisioning.cancelChange}</button>
          </div>
        )}
      </section>
    </main>
  )
}

function formatModifiedTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : zhTW.errors.provisioning
}

function isSessionRecoveryRequired(error: unknown): boolean {
  return error instanceof ProvisioningApiError && isSessionRecoveryCode(error.code)
}

function isSessionRecoveryCode(code: string | null | undefined): boolean {
  return code === 'connection_conflict' || code === 'provisioning_failed'
}
