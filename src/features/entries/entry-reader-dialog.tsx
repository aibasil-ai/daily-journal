import { useEffect, useRef, useState } from 'react'
import type { Entry } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { EntryDeleteDialog } from './entry-delete-dialog'

export type EntryReaderDialogProps = {
  entry: Entry | undefined
  categoryName: string
  open: boolean
  onEdit: (entry: Entry) => void
  onDelete: (id: string) => Promise<void>
  onRequestClose: () => void
  onDeleted?: () => void
}

export function EntryReaderDialog({ entry, categoryName, open, onEdit, onDelete, onRequestClose, onDeleted }: EntryReaderDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const readerTitleRef = useRef<HTMLHeadingElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const closeActionRef = useRef<(() => void) | undefined>(undefined)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open, entry])

  useEffect(() => {
    if (!open) setIsDeleteDialogOpen(false)
  }, [open])

  if (!entry) return null

  const title = entry.title.trim() || entry.content.slice(0, 80)

  function closeReader(action = onRequestClose) {
    closeActionRef.current = action
    const dialog = dialogRef.current
    if (dialog?.open) dialog.close()
    else handleDialogClose()
  }

  function handleDialogClose() {
    const action = closeActionRef.current ?? onRequestClose
    closeActionRef.current = undefined
    action()
  }

  return (
    <dialog ref={dialogRef} className="entry-reader-dialog" aria-label={zhTW.journal.readEntry} onCancel={(event) => { event.preventDefault(); closeReader() }} onClose={handleDialogClose}>
      <header className="entry-reader-dialog__header">
        <button type="button" className="icon-button" aria-label={zhTW.journal.close} onClick={() => closeReader()}>×</button>
      </header>
      <article className="entry-reader-dialog__content">
        <p className="entry-reader-dialog__metadata">{entry.entryDate} · {categoryName}</p>
        <h2 ref={readerTitleRef} tabIndex={-1}>{title}</h2>
        <p className="entry-reader-dialog__body">{entry.content}</p>
        {entry.tags.length > 0 && <p className="entry-reader-dialog__tags">{entry.tags.map((tag) => <span key={tag} className="tag-chip">#{tag}</span>)}</p>}
        {entry.links.length > 0 && (
          <ul className="entry-reader-dialog__links" aria-label={zhTW.entries.links}>
            {entry.links.map((link) => <li key={`${link.label}-${link.url}`}>{isSafeHttpUrl(link.url) ? <a href={link.url} target="_blank" rel="noreferrer noopener">{link.label}</a> : link.label}</li>)}
          </ul>
        )}
      </article>
      <div className="dialog-actions">
        <button type="button" className="button--secondary" onClick={() => closeReader(() => onEdit(entry))}>{zhTW.entries.editEntry}</button>
        <button ref={deleteButtonRef} type="button" className="button--danger" onClick={() => setIsDeleteDialogOpen(true)}>{zhTW.entries.deleteEntry}</button>
      </div>
      {isDeleteDialogOpen && <EntryDeleteDialog entry={entry} onDelete={onDelete} onRequestClose={() => setIsDeleteDialogOpen(false)} onDeleted={() => closeReader(onDeleted ?? onRequestClose)} returnFocusRef={deleteButtonRef} fallbackFocusRef={readerTitleRef} />}
    </dialog>
  )
}

function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
