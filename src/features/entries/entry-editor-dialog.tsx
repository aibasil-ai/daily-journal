import { useEffect, useRef, useState, type JSX } from 'react'
import type { Category, Entry, EntryInput } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { EntryDeleteDialog } from './entry-delete-dialog'
import { EntryForm } from './entry-form'

export type EntryEditorDialogProps = {
  entry?: Entry
  open: boolean
  categories: Category[]
  tagSuggestions: string[]
  timezone?: string
  onSave: (input: EntryInput) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  onRequestClose: () => void
}

export function EntryEditorDialog({ entry, open, categories, tagSuggestions, timezone, onSave, onDelete, onRequestClose }: EntryEditorDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) setIsDeleteDialogOpen(false)
  }, [open])

  function requestClose() {
    if (!isSaving) onRequestClose()
  }

  return (
    <dialog ref={dialogRef} className={`entry-editor-dialog ${entry ? 'entry-editor-dialog--edit' : 'entry-editor-dialog--create'}`} aria-labelledby="entry-editor-title" onCancel={(event) => { event.preventDefault(); requestClose() }}>
      <header className="entry-editor-dialog__header">
        <h2 ref={titleRef} id="entry-editor-title">{entry ? zhTW.entries.edit : zhTW.entries.add}</h2>
        <div className="entry-editor-dialog__header-actions">
          {entry && onDelete && <button ref={deleteButtonRef} type="button" className="button--text entry-editor-dialog__delete" onClick={() => setIsDeleteDialogOpen(true)} disabled={isSaving}>
            <span className="material-symbols-outlined" aria-hidden="true">delete</span>
            {zhTW.entries.deleteEntry}
          </button>}
          <button type="button" className="icon-button" aria-label={zhTW.journal.close} onClick={requestClose} disabled={isSaving}>×</button>
        </div>
      </header>
      <EntryForm
        key={`${open}-${entry?.id ?? 'new'}`}
        entry={entry}
        categories={categories}
        tagSuggestions={tagSuggestions}
        timezone={timezone}
        onCancel={requestClose}
        onSave={onSave}
        onSaveSuccess={onRequestClose}
        onSavingChange={setIsSaving}
      />
      {entry && onDelete && isDeleteDialogOpen && <EntryDeleteDialog entry={entry} onDelete={onDelete} onRequestClose={() => setIsDeleteDialogOpen(false)} onDeleted={onRequestClose} returnFocusRef={deleteButtonRef} fallbackFocusRef={titleRef} />}
    </dialog>
  )
}
