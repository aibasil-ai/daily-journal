import { useEffect, useRef, useState, type JSX } from 'react'
import type { Category, Entry, EntryInput } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { EntryForm } from './entry-form'

export type EntryEditorDialogProps = {
  entry?: Entry
  open: boolean
  categories: Category[]
  tagSuggestions: string[]
  timezone?: string
  onSave: (input: EntryInput) => Promise<void>
  onRequestClose: () => void
}

export function EntryEditorDialog({ entry, open, categories, tagSuggestions, timezone, onSave, onRequestClose }: EntryEditorDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function requestClose() {
    if (!isSaving) onRequestClose()
  }

  return (
    <dialog ref={dialogRef} className="entry-editor-dialog" aria-labelledby="entry-editor-title" onCancel={(event) => { event.preventDefault(); requestClose() }}>
      <header className="entry-editor-dialog__header">
        <h2 id="entry-editor-title">{entry ? zhTW.entries.edit : zhTW.entries.add}</h2>
        <button type="button" className="icon-button" aria-label={zhTW.journal.close} onClick={requestClose} disabled={isSaving}>×</button>
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
    </dialog>
  )
}
