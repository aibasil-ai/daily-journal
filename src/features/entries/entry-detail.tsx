import { useState } from 'react'
import type { CategoryColor, Entry } from '../../domain/journal'
import { Icon } from '../../components/icon'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { zhTW } from '../../i18n/zh-TW'
import { formatEntryDate, formatEntryTime } from '../../utils/date'
import { categoryColorStyle } from '../../utils/category-color'

type EntryDetailProps = {
  entry: Entry
  categoryName: string
  categoryColor: CategoryColor | null
  timezone: string
  onBack: () => void
  onEdit: () => void
  onDelete: () => Promise<void>
}

export function EntryDetail({ entry, categoryName, categoryColor, timezone, onBack, onEdit, onDelete }: EntryDetailProps) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string>()
  const title = entry.title || entry.content.slice(0, 80) || zhTW.timeline.untitled

  const handleDelete = async () => {
    setIsDeleting(true)
    setError(undefined)
    try {
      await onDelete()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : zhTW.errors.delete)
      setIsDeleting(false)
    }
  }

  return (
    <section className="entry-detail" aria-labelledby="entry-detail-title">
      <header className="entry-detail__actions">
        <button className="button button--text" type="button" onClick={onBack}>
          <Icon>arrow_back</Icon>
          {zhTW.actions.backToCalendar}
        </button>
        <div>
          <button className="button button--secondary" type="button" onClick={onEdit}>
            <Icon>edit</Icon>
            {zhTW.actions.edit}
          </button>
          <button className="icon-button icon-button--danger" type="button" onClick={() => setIsConfirming(true)} aria-label={zhTW.actions.deleteEntry}>
            <Icon>delete</Icon>
          </button>
        </div>
      </header>
      <article className="entry-detail__card">
        <header className="entry-detail__header">
          <div className="entry-detail__metadata">
            <span
              className={`category-badge${categoryColor ? ' category-badge--custom-color' : ''}`}
              style={categoryColorStyle(categoryColor)}
            ><Icon>folder</Icon>{categoryName}</span>
            <time><Icon>schedule</Icon>{formatEntryDate(entry.entryDate)} {formatEntryTime(entry.createdAt, timezone)}</time>
          </div>
          <h1 id="entry-detail-title">{title}</h1>
          {entry.tags.length > 0 && (
            <div className="entry-detail__tags">
              {entry.tags.map((tag) => <span className="tag-chip" key={tag}>#{tag}</span>)}
            </div>
          )}
        </header>
        <div className="entry-detail__content">{entry.content}</div>
        {entry.links.length > 0 && (
          <section className="entry-detail__links" aria-labelledby="entry-links-title">
            <h2 id="entry-links-title"><Icon>link</Icon>{zhTW.detail.links}</h2>
            {entry.links.map((link) => (
              <a href={link.url} target="_blank" rel="noreferrer noopener" key={`${link.label}-${link.url}`}>
                <span><Icon>description</Icon></span>
                <span>
                  <strong>{link.label}</strong>
                  <small>{link.url}</small>
                </span>
                <Icon>open_in_new</Icon>
              </a>
            ))}
          </section>
        )}
      </article>
      {isConfirming && (
        <ConfirmDialog labelledBy="detail-delete-title" onCancel={() => setIsConfirming(false)}>
          <div>
            <header className="confirm-dialog__header">
              <span className="confirm-dialog__icon"><Icon filled>delete</Icon></span>
              <div>
                <h2 id="detail-delete-title">{zhTW.deleteDialog.title}</h2>
                <p>{zhTW.deleteDialog.description}</p>
              </div>
            </header>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="confirm-dialog__actions">
              <button className="button button--secondary" type="button" data-dialog-initial-focus disabled={isDeleting} onClick={() => setIsConfirming(false)}>{zhTW.actions.cancel}</button>
              <button className="button button--danger" type="button" disabled={isDeleting} onClick={handleDelete}>
                {isDeleting ? zhTW.actions.deleting : zhTW.deleteDialog.confirm}
              </button>
            </div>
          </div>
        </ConfirmDialog>
      )}
    </section>
  )
}
