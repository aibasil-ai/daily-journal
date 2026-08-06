import { useEffect, useRef } from 'react'
import type { Entry } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'

export type EntryPickerDialogProps = {
  date: string | undefined
  entries: Entry[]
  open: boolean
  onSelect: (entry: Entry) => void
  onRequestClose: () => void
}

export function EntryPickerDialog({ date, entries, open, onSelect, onRequestClose }: EntryPickerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog ref={dialogRef} className="entry-picker-dialog" aria-labelledby="entry-picker-title" onCancel={(event) => { event.preventDefault(); onRequestClose() }}>
      <header className="entry-picker-dialog__header">
        <h2 id="entry-picker-title">{zhTW.journal.selectEntry}</h2>
        <button type="button" className="icon-button" aria-label={zhTW.journal.close} onClick={onRequestClose}>×</button>
      </header>
      {date && <p className="entry-picker-dialog__date">{date}</p>}
      <div className="entry-picker-dialog__entries">
        {entries.map((entry) => <button key={entry.id} type="button" className="entry-picker-dialog__entry" style={{ width: '100%' }} onClick={() => onSelect(entry)}>{entry.title.trim() || entry.content.slice(0, 80)}</button>)}
      </div>
    </dialog>
  )
}
