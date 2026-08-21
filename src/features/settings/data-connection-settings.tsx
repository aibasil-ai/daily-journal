import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'
import type {
  DeleteAccountInput,
  ProvisioningStatus,
} from '../../services/journal-api-client'

type DataConnectionSettingsProps = {
  status: ProvisioningStatus | undefined
  onStartChange: () => Promise<void> | void
  onDisconnect: () => Promise<void> | void
  onDeleteAccount: (input: DeleteAccountInput) => Promise<void> | void
}

type SettingsDialog = 'disconnect' | 'delete-account' | undefined

export function DataConnectionSettings({
  status,
  onStartChange,
  onDisconnect,
  onDeleteAccount,
}: DataConnectionSettingsProps) {
  const [dialog, setDialog] = useState<SettingsDialog>()
  const [isWorking, setIsWorking] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteSystemCreatedSheet, setDeleteSystemCreatedSheet] = useState(false)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const isWorkingRef = useRef(false)
  const canDeleteSystemSheet = status?.canDeleteActiveSystemSheet === true
  const isDeleteConfirmationExact = deleteConfirmation === zhTW.settings.deleteAccount.confirmation

  useEffect(() => {
    isWorkingRef.current = isWorking
  }, [isWorking])

  useEffect(() => {
    if (!dialog) return

    const dialogElement = dialogRef.current
    const focusInitialControl = () => {
      cancelButtonRef.current?.focus()
    }
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isWorkingRef.current) setDialog(undefined)
    }
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialogElement) return
      const focusable = getFocusableElements(dialogElement)
      if (!focusable.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement
      if (!dialogElement.contains(activeElement)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const keepFocusInDialog = (event: FocusEvent) => {
      if (!dialogElement || (event.target instanceof Node && dialogElement.contains(event.target))) return
      focusInitialControl()
    }

    focusInitialControl()
    window.addEventListener('keydown', closeWithEscape)
    document.addEventListener('keydown', trapFocus)
    document.addEventListener('focusin', keepFocusInDialog)
    return () => {
      window.removeEventListener('keydown', closeWithEscape)
      document.removeEventListener('keydown', trapFocus)
      document.removeEventListener('focusin', keepFocusInDialog)
      if (triggerRef.current?.isConnected) triggerRef.current.focus()
    }
  }, [dialog])

  const openDialog = (nextDialog: Exclude<SettingsDialog, undefined>, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger
    setActionError(undefined)
    setDeleteConfirmation('')
    setDeleteSystemCreatedSheet(false)
    setDialog(nextDialog)
  }

  const closeDialog = () => {
    if (isWorking) return
    setDialog(undefined)
  }

  const runAction = async (action: () => Promise<void> | void) => {
    if (isWorking) return
    setActionError(undefined)
    setIsWorking(true)
    try {
      await action()
    } catch (error) {
      setActionError(toErrorMessage(error))
    } finally {
      setIsWorking(false)
    }
  }

  const handleDeleteAccount = () => {
    if (!isDeleteConfirmationExact) return
    const input: DeleteAccountInput = {
      deleteSystemCreatedSheet: canDeleteSystemSheet && deleteSystemCreatedSheet,
      confirmation: deleteConfirmation,
    }
    void runAction(() => onDeleteAccount(input))
  }

  return (
    <section className="data-connection-settings" aria-labelledby="data-connection-settings-title">
      <header className="page-heading data-connection-settings__heading">
        <div>
          <h1 id="data-connection-settings-title">{zhTW.settings.title}</h1>
          <p>{zhTW.settings.description}</p>
        </div>
      </header>
      {!dialog && actionError && <p className="form-error" role="alert">{actionError}</p>}

      <section className="settings-section" aria-labelledby="data-connection-title">
        <div className="settings-section__heading">
          <span className="settings-section__icon" aria-hidden="true"><Icon>table_chart</Icon></span>
          <div>
            <h2 id="data-connection-title">{zhTW.settings.connectionTitle}</h2>
            <p>{zhTW.settings.connectionDescription}</p>
          </div>
        </div>

        {status ? (
          <dl className="settings-connection-summary">
            <div>
              <dt>{zhTW.settings.sheetName}</dt>
              <dd>{status.sheetName ?? zhTW.settings.unknownSheet}</dd>
            </div>
            <div>
              <dt>{zhTW.settings.connectionStatus}</dt>
              <dd>{zhTW.settings.status[status.phase]}</dd>
            </div>
            <div>
              <dt>{zhTW.settings.lastUpdated}</dt>
              <dd>{formatLastUpdated(status.lastUpdatedAt)}</dd>
            </div>
          </dl>
        ) : (
          <p className="loading-note" role="status">{zhTW.settings.loadingConnection}</p>
        )}

        <div className="settings-section__actions">
          <button
            className="button button--secondary"
            type="button"
            disabled={!status || isWorking}
            onClick={() => void runAction(onStartChange)}
          >
            <Icon>swap_horiz</Icon>
            {zhTW.settings.changeSheet}
          </button>
        </div>
      </section>

      <section className="settings-section settings-section--danger" aria-labelledby="account-settings-title">
        <div className="settings-section__heading">
          <span className="settings-section__icon settings-section__icon--danger" aria-hidden="true"><Icon>manage_accounts</Icon></span>
          <div>
            <h2 id="account-settings-title">{zhTW.settings.accountTitle}</h2>
            <p>{zhTW.settings.accountDescription}</p>
          </div>
        </div>
        <div className="settings-section__actions">
          <button className="button button--secondary" type="button" disabled={!status || isWorking} onClick={(event) => openDialog('disconnect', event.currentTarget)}>
            <Icon>link_off</Icon>
            {zhTW.settings.disconnect}
          </button>
          <button className="button button--danger" type="button" disabled={!status || isWorking} onClick={(event) => openDialog('delete-account', event.currentTarget)}>
            <Icon>delete_forever</Icon>
            {zhTW.settings.deleteAccount.action}
          </button>
        </div>
      </section>

      {dialog === 'disconnect' && (
        <SettingsDialog
          titleId="disconnect-data-connection-title"
          descriptionId="disconnect-data-connection-description"
          title={zhTW.settings.disconnectDialog.title}
          description={zhTW.settings.disconnectDialog.description}
          error={actionError}
          isWorking={isWorking}
          cancelButtonRef={cancelButtonRef}
          dialogRef={dialogRef}
          onCancel={closeDialog}
          confirmLabel={zhTW.settings.disconnectDialog.confirm}
          onConfirm={() => void runAction(onDisconnect)}
        />
      )}

      {dialog === 'delete-account' && (
        <SettingsDialog
          titleId="delete-account-title"
          descriptionId="delete-account-description"
          title={zhTW.settings.deleteAccount.title}
          description={zhTW.settings.deleteAccount.description}
          error={actionError}
          isWorking={isWorking}
          cancelButtonRef={cancelButtonRef}
          dialogRef={dialogRef}
          onCancel={closeDialog}
          confirmLabel={zhTW.settings.deleteAccount.confirm}
          confirmDisabled={!isDeleteConfirmationExact}
          onConfirm={handleDeleteAccount}
        >
          <label className="settings-dialog__checkbox" htmlFor="delete-system-created-sheet">
            <input
              id="delete-system-created-sheet"
              type="checkbox"
              checked={deleteSystemCreatedSheet}
              disabled={!canDeleteSystemSheet || isWorking}
              onChange={(event) => setDeleteSystemCreatedSheet(event.target.checked)}
            />
            <span>{zhTW.settings.deleteAccount.deleteSystemCreatedSheet}</span>
          </label>
          {!canDeleteSystemSheet && <p className="form-note">{zhTW.settings.deleteAccount.systemSheetUnavailable}</p>}
          <label className="field-group" htmlFor="delete-account-confirmation">
            <span>{zhTW.settings.deleteAccount.confirmationLabel}</span>
            <input
              id="delete-account-confirmation"
              value={deleteConfirmation}
              placeholder={zhTW.settings.deleteAccount.confirmationPlaceholder}
              disabled={isWorking}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
          </label>
          <p className="settings-dialog__hint">{zhTW.settings.deleteAccount.confirmationHint}</p>
        </SettingsDialog>
      )}
    </section>
  )
}

type SettingsDialogProps = {
  titleId: string
  descriptionId: string
  title: string
  description: string
  error: string | undefined
  isWorking: boolean
  cancelButtonRef: RefObject<HTMLButtonElement | null>
  dialogRef: RefObject<HTMLElement | null>
  onCancel: () => void
  confirmLabel: string
  confirmDisabled?: boolean
  onConfirm: () => void
  children?: ReactNode
}

function SettingsDialog({
  titleId,
  descriptionId,
  title,
  description,
  error,
  isWorking,
  cancelButtonRef,
  dialogRef,
  onCancel,
  confirmLabel,
  confirmDisabled = false,
  onConfirm,
  children,
}: SettingsDialogProps) {
  return (
    <div className="settings-dialog-overlay" role="presentation">
      <section
        className="settings-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <span className="settings-dialog__icon" aria-hidden="true"><Icon>warning</Icon></span>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        {children}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="settings-dialog__actions">
          <button ref={cancelButtonRef} className="button button--secondary" type="button" disabled={isWorking} onClick={onCancel}>
            {zhTW.actions.cancel}
          </button>
          <button className="button button--danger" type="button" disabled={isWorking || confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

function formatLastUpdated(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return zhTW.settings.unknownLastUpdated
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return zhTW.settings.unknownLastUpdated
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : zhTW.errors.accountAction
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>([
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')))
}
