import { useState } from 'react'
import type { Category, EntryListData } from '../../domain/journal'
import { Icon } from '../../components/icon'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { zhTW } from '../../i18n/zh-TW'
import { CategoryEntryMovePanel } from './category-entry-move-panel'

type CategoryManagerProps = {
  categories: Category[]
  entryCounts: Record<string, number>
  onLoadEntryPage: (sourceCategoryId: string, cursor: string | null) => Promise<EntryListData>
  onMoveEntries: (sourceCategoryId: string, targetCategoryId: string, entryIds: string[]) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onSave: (name: string, id?: string) => Promise<unknown>
  onDeactivate: (id: string) => Promise<unknown>
  onActivate: (id: string) => Promise<unknown>
}

export function CategoryManager({
  categories,
  entryCounts,
  onLoadEntryPage,
  onMoveEntries,
  onDelete,
  onSave,
  onDeactivate,
  onActivate,
}: CategoryManagerProps) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<Category | null>()
  const [pendingDeactivate, setPendingDeactivate] = useState<Category>()
  const [pendingDelete, setPendingDelete] = useState<Category>()
  const [movingCategory, setMovingCategory] = useState<Category>()
  const [isSaving, setIsSaving] = useState(false)
  const [isDeactivating, setIsDeactivating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [activatingCategoryId, setActivatingCategoryId] = useState<string>()
  const [error, setError] = useState<string>()

  const startEditing = (category: Category | null) => {
    setEditing(category)
    setName(category?.name ?? '')
    setError(undefined)
  }

  const closeEditor = () => {
    setEditing(undefined)
    setName('')
    setError(undefined)
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setIsSaving(true)
    setError(undefined)
    try {
      await onSave(name, editing?.id)
      closeEditor()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : zhTW.errors.category)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeactivate = async () => {
    if (!pendingDeactivate) return
    setIsDeactivating(true)
    setError(undefined)
    try {
      await onDeactivate(pendingDeactivate.id)
      setPendingDeactivate(undefined)
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : zhTW.errors.category)
    } finally {
      setIsDeactivating(false)
    }
  }

  const handleActivate = async (id: string) => {
    setActivatingCategoryId(id)
    setError(undefined)
    try {
      await onActivate(id)
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : zhTW.errors.category)
    } finally {
      setActivatingCategoryId(undefined)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setIsDeleting(true)
    setError(undefined)
    try {
      await onDelete(pendingDelete.id)
      setPendingDelete(undefined)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : zhTW.errors.category)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <section className="category-manager" aria-labelledby="category-manager-title">
      <header className="page-heading category-manager__heading">
        <div>
          <h2 id="category-manager-title">{zhTW.navigation.categories}</h2>
          <p>{zhTW.app.categoryDescription}</p>
        </div>
        <button className="button button--primary" type="button" onClick={() => startEditing(null)}>
          <Icon filled>add</Icon>
          {zhTW.actions.addCategory}
        </button>
      </header>

      {(editing !== undefined || !categories.length) && (
        <section className="category-editor" aria-label={editing ? zhTW.categories.editTitle : zhTW.categories.addTitle}>
          <label className="field-group" htmlFor="category-name">
            <span>{zhTW.categories.categoryName}</span>
            <input
              id="category-name"
              aria-label={zhTW.categories.categoryName}
              value={name}
              placeholder={zhTW.categories.categoryNamePlaceholder}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleSave()
              }}
              autoFocus
            />
          </label>
          <div className="category-editor__actions">
            {editing !== undefined && <button className="button button--secondary" type="button" disabled={isSaving} onClick={closeEditor}>{zhTW.actions.cancel}</button>}
            <button className="button button--primary" type="button" disabled={isSaving || !name.trim()} onClick={() => void handleSave()}>
              {isSaving ? zhTW.connection.connecting : zhTW.categories.save}
            </button>
          </div>
        </section>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      {categories.length ? (
        <div className="category-grid">
          {categories.map((category) => {
            const entryCount = entryCounts[category.id] ?? 0
            return (
              <article className={`category-card${category.isActive ? '' : ' category-card--inactive'}`} key={category.id}>
                <div className="category-card__icon"><Icon>{category.isActive ? 'folder' : 'inventory_2'}</Icon></div>
                <div className="category-card__content">
                  <div className="category-card__title-row">
                    <h3>{category.name}</h3>
                    {!category.isActive && <span className="date-badge">{zhTW.categories.deactivated}</span>}
                  </div>
                  <p>{zhTW.categories.entryCount(entryCount)}</p>
                  {entryCount > 0 && <p className="category-card__delete-blocked" id={`delete-blocked-${category.id}`}>{zhTW.categories.deleteBlocked}</p>}
                </div>
                <div className="category-card__actions">
                  {entryCount > 0 && (
                    <button className="button button--secondary category-card__move" type="button" aria-label={zhTW.categories.moveEntriesFor(category.name)} onClick={() => setMovingCategory(category)}>
                      <Icon>drive_file_move</Icon>
                      {zhTW.categories.moveEntries}
                    </button>
                  )}
                  <button className="icon-button" type="button" aria-label={zhTW.categories.editCategory(category.name)} onClick={() => startEditing(category)}>
                    <Icon>edit</Icon>
                  </button>
                  {category.isActive ? (
                    <button className="icon-button icon-button--danger" type="button" aria-label={zhTW.categories.deactivate(category.name)} onClick={() => setPendingDeactivate(category)}>
                      <Icon>block</Icon>
                    </button>
                  ) : (
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={zhTW.categories.activate(category.name)}
                      disabled={activatingCategoryId === category.id}
                      onClick={() => void handleActivate(category.id)}
                    >
                      <Icon>restart_alt</Icon>
                    </button>
                  )}
                  <button
                    className="icon-button icon-button--danger"
                    type="button"
                    aria-label={zhTW.categories.deleteCategory(category.name)}
                    aria-describedby={entryCount > 0 ? `delete-blocked-${category.id}` : undefined}
                    disabled={entryCount > 0}
                    onClick={() => setPendingDelete(category)}
                  >
                    <Icon>delete</Icon>
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      ) : !editing && (
        <section className="empty-state">
          <span className="empty-state__icon material-symbols-outlined" aria-hidden="true">category</span>
          <h3>{zhTW.categories.noCategories}</h3>
          <p>{zhTW.categories.noCategoriesDescription}</p>
        </section>
      )}

      {pendingDeactivate && (
        <ConfirmDialog labelledBy="deactivate-category-title" onCancel={() => setPendingDeactivate(undefined)}>
          <div>
            <span className="confirm-dialog__icon"><Icon>block</Icon></span>
            <h2 id="deactivate-category-title">{zhTW.categories.deactivateTitle}</h2>
            <p>{zhTW.categories.deactivateDescription}</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="confirm-dialog__actions">
              <button className="button button--secondary" type="button" data-dialog-initial-focus disabled={isDeactivating} onClick={() => setPendingDeactivate(undefined)}>{zhTW.actions.cancel}</button>
              <button className="button button--danger" type="button" disabled={isDeactivating} onClick={() => void handleDeactivate()}>
                {isDeactivating ? zhTW.connection.connecting : zhTW.categories.confirmDeactivate}
              </button>
            </div>
          </div>
        </ConfirmDialog>
      )}

      {pendingDelete && (
        <ConfirmDialog labelledBy="delete-category-title" onCancel={() => { if (!isDeleting) setPendingDelete(undefined) }}>
          <div>
            <span className="confirm-dialog__icon"><Icon filled>delete</Icon></span>
            <h2 id="delete-category-title">{zhTW.categories.deleteTitle}</h2>
            <p>{zhTW.categories.deleteDescription}</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="confirm-dialog__actions">
              <button className="button button--secondary" type="button" data-dialog-initial-focus disabled={isDeleting} onClick={() => setPendingDelete(undefined)}>{zhTW.actions.cancel}</button>
              <button className="button button--danger" type="button" disabled={isDeleting} onClick={() => void handleDelete()}>
                {isDeleting ? zhTW.connection.connecting : zhTW.categories.confirmDelete}
              </button>
            </div>
          </div>
        </ConfirmDialog>
      )}

      {movingCategory && (
        <CategoryEntryMovePanel
          source={movingCategory}
          entryCount={entryCounts[movingCategory.id] ?? 0}
          categories={categories}
          onLoadPage={onLoadEntryPage}
          onMoveEntries={onMoveEntries}
          onClose={() => setMovingCategory(undefined)}
        />
      )}
    </section>
  )
}
