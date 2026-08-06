import { useEffect, useRef } from 'react'
import { zhTW } from '../../i18n/zh-TW'

export type ExportDialogProps = {
  open: boolean
  isExporting: boolean
  error?: string
  onExport: (scope: 'filtered' | 'all') => Promise<void>
  onRequestClose: () => void
}

export function ExportDialog({ open, isExporting, error, onExport, onRequestClose }: ExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog ref={dialogRef} className="export-dialog" aria-labelledby="csv-export-title" onCancel={(event) => { event.preventDefault(); onRequestClose() }}>
      <header className="export-dialog__header">
        <h2 id="csv-export-title">{zhTW.exports.title}</h2>
        <button type="button" className="icon-button" aria-label={zhTW.journal.close} onClick={onRequestClose}>×</button>
      </header>
      {isExporting && <p>{zhTW.exports.exporting}</p>}
      {error && <p className="csv-export__error" role="alert">{error}</p>}
      <div className="csv-export__actions">
        <button type="button" onClick={() => void onExport('filtered')} disabled={isExporting}>{zhTW.exports.filtered}</button>
        <button type="button" className="button--secondary" onClick={() => void onExport('all')} disabled={isExporting}>{zhTW.exports.all}</button>
      </div>
    </dialog>
  )
}
