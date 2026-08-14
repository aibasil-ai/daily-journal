import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

type ConfirmDialogProps = {
  labelledBy: string
  onCancel: () => void
  children: ReactNode
}

/** 使用原生 modal dialog，並將初始焦點放在安全的取消操作。 */
export function ConfirmDialog({ labelledBy, onCancel, children }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const handleCancel = (event: Event) => {
      event.preventDefault()
      onCancelRef.current()
    }
    dialog.addEventListener('cancel', handleCancel)
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } catch {
      dialog.setAttribute('open', '')
    }
    const initialFocus = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')
    initialFocus?.focus()

    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
    }
  }, [])

  return <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby={labelledBy}>{children}</dialog>
}
