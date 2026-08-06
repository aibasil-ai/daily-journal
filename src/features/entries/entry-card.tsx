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
  const cardRef = useRef<HTMLElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const fallbackFocusRef = useRef<HTMLElement>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const title = entry.title.trim() || entry.content.slice(0, 80)

  function openDeleteDialog() {
    const timeline = cardRef.current?.closest<HTMLElement>('.timeline')
    if (timeline) timeline.tabIndex = -1
    fallbackFocusRef.current = timeline ?? null
    setIsDeleteDialogOpen(true)
  }

  return (
    <article ref={cardRef} className="entry-card">
      <header className="entry-card__header">
        <h3>{onOpen ? <button type="button" className="entry-card__read" aria-label={`${zhTW.entries.read} ${title}`} onClick={() => onOpen(entry)}>{title}</button> : title}</h3>
        <div className="entry-card__actions">
          <button type="button" className="button--secondary" onClick={() => onEdit(entry)}>{zhTW.entries.editEntry}</button>
          <button ref={deleteButtonRef} type="button" className="button--danger" onClick={openDeleteDialog}>{zhTW.entries.deleteEntry}</button>
        </div>
      </header>
      <p>{entry.content}</p>
      <p className="entry-card__category">{zhTW.entries.categoryName(categoryName)}</p>
      {entry.tags.length > 0 && <p className="entry-card__tags">{zhTW.entries.tagsPrefix}{entry.tags.join('、')}</p>}
      {entry.links.length > 0 && (
        <ul className="entry-card__links" aria-label={zhTW.entries.links}>
          {entry.links.map((link) => <li key={`${link.label}-${link.url}`}>{isSafeHttpUrl(link.url) ? <a href={link.url} target="_blank" rel="noreferrer noopener">{link.label}</a> : link.label}</li>)}
        </ul>
      )}
      {isDeleteDialogOpen && <EntryDeleteDialog entry={entry} onDelete={onDelete} onRequestClose={() => setIsDeleteDialogOpen(false)} returnFocusRef={deleteButtonRef} fallbackFocusRef={fallbackFocusRef} />}
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
