import { useRef, useState } from 'react'
import type { Entry } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'

type EntryCardProps = {
  entry: Entry
  onEdit: (entry: Entry) => void
  onDelete: (id: string) => Promise<void>
}

export function EntryCard({ entry, onEdit, onDelete }: EntryCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const [deleteError, setDeleteError] = useState<string | undefined>()
  const [isDeleting, setIsDeleting] = useState(false)

  function openDialog() {
    setDeleteError(undefined)
    dialogRef.current?.showModal()
    confirmButtonRef.current?.focus()
  }

  function closeDialog() {
    dialogRef.current?.close()
  }

  async function confirmDelete() {
    setIsDeleting(true)
    setDeleteError(undefined)
    try {
      await onDelete(entry.id)
      closeDialog()
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : zhTW.api.requestFailed)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <article className="entry-card">
      <header className="entry-card__header">
        <h3>{entry.title.trim() || entry.content.slice(0, 80)}</h3>
        <div className="entry-card__actions">
          <button type="button" className="button--secondary" onClick={() => onEdit(entry)}>{zhTW.entries.editEntry}</button>
          <button type="button" className="button--danger" onClick={openDialog}>{zhTW.entries.deleteEntry}</button>
        </div>
      </header>
      <p>{entry.content}</p>
      {entry.tags.length > 0 && <p className="entry-card__tags">標籤：{entry.tags.join('、')}</p>}
      {entry.links.length > 0 && (
        <ul className="entry-card__links" aria-label={zhTW.entries.links}>
          {entry.links.map((link) => <li key={`${link.label}-${link.url}`}><a href={link.url} target="_blank" rel="noreferrer noopener">{link.label}</a></li>)}
        </ul>
      )}
      <dialog ref={dialogRef} aria-labelledby={`delete-title-${entry.id}`} onClose={() => setDeleteError(undefined)}>
        <h2 id={`delete-title-${entry.id}`}>{zhTW.entries.deleteTitle}</h2>
        <p>{zhTW.entries.deleteDescription}</p>
        {deleteError && <p className="dialog-error" role="alert">{deleteError}</p>}
        <div className="dialog-actions">
          <button type="button" className="button--secondary" onClick={closeDialog} disabled={isDeleting}>{zhTW.entries.cancel}</button>
          <button ref={confirmButtonRef} type="button" className="button--danger" onClick={confirmDelete} disabled={isDeleting}>{isDeleting ? zhTW.entries.deleting : zhTW.entries.confirmDelete}</button>
        </div>
      </dialog>
    </article>
  )
}
