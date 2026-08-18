import { useCallback, useEffect, useState } from 'react'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { Icon } from '../../components/icon'
import type { Category, Entry, EntryListData } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'

export type CategoryEntryMovePanelProps = {
  source: Category
  entryCount: number
  categories: Category[]
  onLoadPage: (sourceCategoryId: string, cursor: string | null) => Promise<EntryListData>
  onMoveEntries: (sourceCategoryId: string, targetCategoryId: string, entryIds: string[]) => Promise<void>
  onClose: () => void
}

type PendingMove = {
  entryIds: string[]
  targetCategoryId: string
}

export function CategoryEntryMovePanel({
  source,
  entryCount,
  categories,
  onLoadPage,
  onMoveEntries,
  onClose,
}: CategoryEntryMovePanelProps) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [targetCategoryId, setTargetCategoryId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [pendingMove, setPendingMove] = useState<PendingMove>()
  const [isMoving, setIsMoving] = useState(false)
  const [moveError, setMoveError] = useState<string>()
  const targets = categories.filter((category) => category.isActive && category.id !== source.id)

  const loadFirstPage = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setLoadError(undefined)
    try {
      const page = await onLoadPage(source.id, null)
      setEntries(page.items)
      setNextCursor(page.nextCursor)
    } catch (error) {
      setEntries([])
      setNextCursor(null)
      setLoadError(toErrorMessage(error, zhTW.categories.loadMoveError))
    } finally {
      setIsLoading(false)
    }
  }, [onLoadPage, source.id])

  useEffect(() => {
    setEntries([])
    setNextCursor(null)
    setSelectedIds(new Set())
    setTargetCategoryId('')
    setLoadError(undefined)
    setPendingMove(undefined)
    setMoveError(undefined)
    void loadFirstPage()
  }, [loadFirstPage])

  const loadMore = async () => {
    if (nextCursor === null || isLoading) return

    setIsLoading(true)
    setLoadError(undefined)
    try {
      const page = await onLoadPage(source.id, nextCursor)
      setEntries((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (error) {
      setLoadError(toErrorMessage(error, zhTW.categories.loadMoveError))
    } finally {
      setIsLoading(false)
    }
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openMoveConfirmation = (entryIds: string[], targetId: string) => {
    setMoveError(undefined)
    setPendingMove({ entryIds, targetCategoryId: targetId })
  }

  const confirmMove = async () => {
    if (!pendingMove?.targetCategoryId) return

    setIsMoving(true)
    setMoveError(undefined)
    try {
      await onMoveEntries(source.id, pendingMove.targetCategoryId, pendingMove.entryIds)
      const movedIds = new Set(pendingMove.entryIds)
      setEntries((current) => current.filter((entry) => !movedIds.has(entry.id)))
      setSelectedIds((current) => new Set([...current].filter((id) => !movedIds.has(id))))
      setPendingMove(undefined)
      if (nextCursor !== null && movedIds.has(nextCursor)) void loadFirstPage()
    } catch (error) {
      setMoveError(toErrorMessage(error, zhTW.errors.category))
    } finally {
      setIsMoving(false)
    }
  }

  const pendingTarget = targets.find((category) => category.id === pendingMove?.targetCategoryId)

  return (
    <div className="category-move-overlay" role="presentation">
      <section className="category-move-panel" role="dialog" aria-modal="true" aria-labelledby="category-move-title">
        <header className="category-move-panel__header">
          <div>
            <h2 id="category-move-title">{zhTW.categories.moveTitle(source.name)}</h2>
            <p>{zhTW.categories.entryCount(entryCount)}</p>
          </div>
          <button className="icon-button" type="button" aria-label={zhTW.actions.close} disabled={isMoving} onClick={onClose}>
            <Icon>close</Icon>
          </button>
        </header>

        <div className="category-move-panel__body">
          {!targets.length && <p className="form-note">{zhTW.categories.noMoveTargets}</p>}
          {loadError && <p className="form-error" role="alert">{loadError}</p>}
          {isLoading && !entries.length && <p className="loading-note" role="status">{zhTW.connection.connecting}</p>}

          {!isLoading && !entries.length && !loadError && (
            <p className="category-move-empty">{zhTW.timeline.emptyTitle}</p>
          )}

          {entries.length > 0 && (
            <ul className="category-move-list">
              {entries.map((entry) => {
                const title = entryTitle(entry)
                return (
                  <li className="category-move-row" key={entry.id}>
                    <input
                      type="checkbox"
                      aria-label={zhTW.categories.selectEntry(title)}
                      checked={selectedIds.has(entry.id)}
                      onChange={() => toggleSelected(entry.id)}
                    />
                    <div>
                      <time dateTime={entry.entryDate}>{entry.entryDate}</time>
                      <strong>{title}</strong>
                    </div>
                    <button
                      className="button button--secondary"
                      type="button"
                      aria-label={zhTW.categories.moveEntry(title)}
                      disabled={!targets.length || isMoving}
                      onClick={() => openMoveConfirmation([entry.id], targetCategoryId)}
                    >
                      {zhTW.categories.moveEntries}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {nextCursor !== null && (
            <button className="button button--secondary category-move-load-more" type="button" disabled={isLoading || isMoving} onClick={() => void loadMore()}>
              {isLoading ? zhTW.connection.connecting : zhTW.actions.loadMore}
            </button>
          )}

          {selectedIds.size > 0 && (
            <div className="category-move-toolbar">
              <strong>{zhTW.categories.selectedCount(selectedIds.size)}</strong>
              <label>
                <span>{zhTW.categories.moveTo}</span>
                <select aria-label={zhTW.categories.moveTo} value={targetCategoryId} disabled={!targets.length || isMoving} onChange={(event) => setTargetCategoryId(event.target.value)}>
                  <option value="">{zhTW.categories.moveTo}</option>
                  {targets.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              <button
                className="button button--primary"
                type="button"
                disabled={!targetCategoryId || !targets.length || isMoving}
                onClick={() => openMoveConfirmation([...selectedIds], targetCategoryId)}
              >
                {zhTW.categories.moveSelectedEntries}
              </button>
            </div>
          )}
        </div>
      </section>

      {pendingMove && (
        <ConfirmDialog labelledBy="confirm-move-title" onCancel={() => { if (!isMoving) setPendingMove(undefined) }}>
          <div>
            <span className="confirm-dialog__icon"><Icon>drive_file_move</Icon></span>
            <h2 id="confirm-move-title">
              {zhTW.categories.confirmMove(pendingMove.entryIds.length, source.name, pendingTarget?.name ?? zhTW.categories.moveTo)}
            </h2>
            <label className="field-group">
              <span>{zhTW.categories.moveTo}</span>
              <select
                aria-label={zhTW.categories.moveTo}
                value={pendingMove.targetCategoryId}
                disabled={isMoving}
                onChange={(event) => setPendingMove((current) => current ? { ...current, targetCategoryId: event.target.value } : current)}
              >
                <option value="">{zhTW.categories.moveTo}</option>
                {targets.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            {moveError && <p className="form-error" role="alert">{moveError}</p>}
            <div className="confirm-dialog__actions">
              <button className="button button--secondary" type="button" data-dialog-initial-focus disabled={isMoving} onClick={() => setPendingMove(undefined)}>
                {zhTW.actions.cancel}
              </button>
              <button className="button button--primary" type="button" disabled={isMoving || !pendingMove.targetCategoryId} onClick={() => void confirmMove()}>
                {isMoving ? zhTW.connection.connecting : zhTW.categories.confirmMoveAction}
              </button>
            </div>
          </div>
        </ConfirmDialog>
      )}
    </div>
  )
}

function entryTitle(entry: Entry): string {
  return entry.title || entry.content.slice(0, 80) || zhTW.timeline.untitled
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
