import { useRef, useState } from 'react'
import type { Entry } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { EntryDeleteDialog } from './entry-delete-dialog'

type EntryCardProps = {
  entry: Entry
  categoryName: string
  onOpen?: (entry: Entry) => void
  onEdit: (entry: Entry) => void
  onDelete: (id: string) => Promise<void>
}

export function EntryCard({ entry, categoryName, onOpen, onEdit, onDelete }: EntryCardProps) {
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const title = entry.title.trim() || entry.content.slice(0, 80)

  return (
    <article className="entry-card">
      <header className="entry-card__header">
        <h3>{onOpen ? <button type="button" className="entry-card__open" onClick={() => onOpen(entry)}>{title}</button> : title}</h3>
        <div className="entry-card__actions">
          <button type="button" className="button--secondary" onClick={() => onEdit(entry)}>{zhTW.entries.editEntry}</button>
          <button ref={deleteButtonRef} type="button" className="button--danger" onClick={() => setIsDeleteDialogOpen(true)}>{zhTW.entries.deleteEntry}</button>
        </div>
      </header>
      <p>{onOpen ? <button type="button" className="entry-card__open" onClick={() => onOpen(entry)}>{entry.content}</button> : entry.content}</p>
      <p className="entry-card__category">{zhTW.entries.categoryName(categoryName)}</p>
      {entry.tags.length > 0 && <p className="entry-card__tags">{zhTW.entries.tagsPrefix}{entry.tags.join('、')}</p>}
      {entry.links.length > 0 && (
        <ul className="entry-card__links" aria-label={zhTW.entries.links}>
          {entry.links.map((link) => <li key={`${link.label}-${link.url}`}>{isSafeHttpUrl(link.url) ? <a href={link.url} target="_blank" rel="noreferrer noopener">{link.label}</a> : link.label}</li>)}
        </ul>
      )}
      {isDeleteDialogOpen && <EntryDeleteDialog entry={entry} onDelete={onDelete} onRequestClose={() => setIsDeleteDialogOpen(false)} returnFocusRef={deleteButtonRef} />}
    </article>
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
