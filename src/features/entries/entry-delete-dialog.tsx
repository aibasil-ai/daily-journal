import { useEffect, useRef, useState } from 'react'
import type { Entry } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'

type EntryDeleteDialogProps = {
  entry: Entry
  onDelete: (id: string) => Promise<void>
  onRequestClose: () => void
  returnFocusRef?: { current: HTMLElement | null }
  fallbackFocusRef?: { current: HTMLElement | null }
}

export function EntryDeleteDialog({ entry, onDelete, onRequestClose, returnFocusRef, fallbackFocusRef }: EntryDeleteDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const isDeletingRef = useRef(false)
  const [error, setError] = useState<string>()
  const [isDeleting, setIsDeleting] = useState(false)
  const titleId = `delete-entry-title-${entry.id}`

  useEffect(() => {
    confirmButtonRef.current?.focus()
  }, [])

  async function confirmDelete() {
    isDeletingRef.current = true
    setIsDeleting(true)
    setError(undefined)
    try {
      await onDelete(entry.id)
      onRequestClose()
      restoreFocus(returnFocusRef, fallbackFocusRef)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : zhTW.api.requestFailed)
    } finally {
      isDeletingRef.current = false
      setIsDeleting(false)
    }
  }

  function closeDialog() {
    if (isDeletingRef.current) return
    onRequestClose()
    restoreFocus(returnFocusRef, fallbackFocusRef)
  }

  return (
    <dialog open aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); closeDialog() }}>
      <h2 id={titleId}>{zhTW.entries.deleteTitle}</h2>
      <p>{zhTW.entries.deleteDescription}</p>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="button--secondary" onClick={closeDialog} disabled={isDeleting}>{zhTW.entries.cancel}</button>
        <button ref={confirmButtonRef} type="button" className="button--danger" onClick={() => void confirmDelete()} disabled={isDeleting}>{isDeleting ? zhTW.entries.deleting : zhTW.entries.confirmDelete}</button>
      </div>
    </dialog>
  )
}

function restoreFocus(returnFocusRef: { current: HTMLElement | null } | undefined, fallbackFocusRef: { current: HTMLElement | null } | undefined) {
  requestAnimationFrame(() => {
    if (focus(returnFocusRef)) return
    focus(fallbackFocusRef)
  })
}

function focus(ref: { current: HTMLElement | null } | undefined): boolean {
  const element = ref?.current
  if (!element || !element.isConnected || element.matches(':disabled')) return false
  element.focus()
  return true
}
