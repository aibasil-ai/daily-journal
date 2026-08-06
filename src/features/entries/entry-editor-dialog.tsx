import { useEffect, useRef, type JSX } from 'react'
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

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog ref={dialogRef} className="entry-editor-dialog" aria-labelledby="entry-editor-title" onCancel={(event) => { event.preventDefault(); onRequestClose() }}>
      <header className="entry-editor-dialog__header">
        <h2 id="entry-editor-title">{entry ? zhTW.entries.edit : zhTW.entries.add}</h2>
        <button type="button" className="icon-button" aria-label={zhTW.journal.close} onClick={onRequestClose}>×</button>
      </header>
      <EntryForm
        entry={entry}
        categories={categories}
        tagSuggestions={tagSuggestions}
        timezone={timezone}
        onCancel={onRequestClose}
        onSave={async (input) => {
          await onSave(input)
          onRequestClose()
        }}
      />
    </dialog>
  )
}
