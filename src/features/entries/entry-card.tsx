import { useState } from 'react'
import type { CategoryColor, Entry } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { Icon } from '../../components/icon'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { formatEntryTime } from '../../utils/date'
import { categoryColorStyle } from '../../utils/category-color'

type EntryCardProps = {
  entry: Entry
  categoryName: string
  categoryColor: CategoryColor | null
  timezone: string
  onOpen: () => void
  onEdit: () => void
  onDelete: () => Promise<void>
}

export function EntryCard({ entry, categoryName, categoryColor, timezone, onOpen, onEdit, onDelete }: EntryCardProps) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string>()
  const title = entry.title || entry.content.slice(0, 80) || zhTW.timeline.untitled

  const handleDelete = async () => {
    setIsDeleting(true)
    setDeleteError(undefined)
    try {
      await onDelete()
      setIsConfirming(false)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : zhTW.errors.delete)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <article className="entry-card">
      <span className="entry-card__time">{formatEntryTime(entry.createdAt, timezone)}</span>
      <span className="entry-card__dot" aria-hidden="true" />
      <div className="entry-card__body">
        <button className="entry-card__read" type="button" onClick={onOpen} aria-label={`${zhTW.timeline.readEntry}：${title}`}>
          <span
            className={`category-badge${categoryColor ? ' category-badge--custom-color' : ''}`}
            style={categoryColorStyle(categoryColor)}
          >
            {categoryName}
          </span>
          <h4>{title}</h4>
          <p>{entry.content}</p>
          {entry.tags.length > 0 && (
            <span className="entry-card__tags">
              {entry.tags.map((tag) => <span className="tag-chip" key={tag}>#{tag}</span>)}
            </span>
          )}
        </button>
        <div className="entry-card__actions">
          <button className="icon-button" type="button" onClick={onEdit} aria-label={`${zhTW.actions.edit} ${title}`}>
            <Icon>edit</Icon>
          </button>
          <button className="icon-button icon-button--danger" type="button" onClick={() => setIsConfirming(true)} aria-label={zhTW.actions.deleteEntry}>
            <Icon>delete</Icon>
          </button>
        </div>
      </div>

      {isConfirming && (
        <ConfirmDialog labelledBy={`delete-title-${entry.id}`} onCancel={() => setIsConfirming(false)}>
          <div>
            <header className="confirm-dialog__header">
              <span className="confirm-dialog__icon"><Icon filled>delete</Icon></span>
              <div>
                <h2 id={`delete-title-${entry.id}`}>{zhTW.deleteDialog.title}</h2>
                <p>{zhTW.deleteDialog.description}</p>
              </div>
            </header>
            {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
            <div className="confirm-dialog__actions">
              <button className="button button--secondary" type="button" data-dialog-initial-focus disabled={isDeleting} onClick={() => setIsConfirming(false)}>
                {zhTW.actions.cancel}
              </button>
              <button className="button button--danger" type="button" disabled={isDeleting} onClick={handleDelete}>
                {isDeleting ? zhTW.actions.deleting : zhTW.deleteDialog.confirm}
              </button>
            </div>
          </div>
        </ConfirmDialog>
      )}
    </article>
  )
}
