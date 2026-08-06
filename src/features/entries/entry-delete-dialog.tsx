import { useEffect, useRef, useState } from 'react'
import type { Entry } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'

type EntryDeleteDialogProps = {
  entry: Entry
  onDelete: (id: string) => Promise<void>
  onRequestClose: () => void
}

export function EntryDeleteDialog({ entry, onDelete, onRequestClose }: EntryDeleteDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState<string>()
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    confirmButtonRef.current?.focus()
  }, [])

  async function confirmDelete() {
    setIsDeleting(true)
    setError(undefined)
    try {
      await onDelete(entry.id)
      onRequestClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : zhTW.api.requestFailed)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <dialog open aria-labelledby="delete-entry-title" onCancel={(event) => { event.preventDefault(); onRequestClose() }}>
      <h2 id="delete-entry-title">{zhTW.entries.deleteTitle}</h2>
      <p>{zhTW.entries.deleteDescription}</p>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="button--secondary" onClick={onRequestClose} disabled={isDeleting}>{zhTW.entries.cancel}</button>
        <button ref={confirmButtonRef} type="button" className="button--danger" onClick={() => void confirmDelete()} disabled={isDeleting}>{isDeleting ? zhTW.entries.deleting : zhTW.entries.confirmDelete}</button>
      </div>
    </dialog>
  )
}
