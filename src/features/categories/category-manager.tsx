import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Category, CategoryColor, EntryListData } from '../../domain/journal'
import { Icon } from '../../components/icon'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { zhTW } from '../../i18n/zh-TW'
import { CategoryEntryMovePanel } from './category-entry-move-panel'
import { CategoryColorMenu } from './category-color-menu'
import { categoryColorStyle } from '../../utils/category-color'

type CategoryManagerProps = {
  categories: Category[]
  entryCounts: Record<string, number>
  onLoadEntryPage: (sourceCategoryId: string, cursor: string | null) => Promise<EntryListData>
  onMoveEntries: (sourceCategoryId: string, targetCategoryId: string, entryIds: string[]) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onSave: (name: string, id?: string) => Promise<unknown>
  savingCategoryColorIds: ReadonlySet<string>
  onSetColor: (id: string, color: CategoryColor | null) => Promise<Category>
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
  savingCategoryColorIds,
  onSetColor,
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
  const [openColorMenu, setOpenColorMenu] = useState<{
    categoryId: string
    position: Readonly<{ x: number; y: number }>
    restoreFocusTo: HTMLElement
  }>()
  const [colorPreviews, setColorPreviews] = useState<ReadonlyMap<string, CategoryColor | null>>(new Map())
  const [colorStatus, setColorStatus] = useState<string>()

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

  const openColorMenuFromButton = (category: Category, button: HTMLButtonElement) => {
    if (savingCategoryColorIds.has(category.id)) return
    const rect = button.getBoundingClientRect()
    setOpenColorMenu({
      categoryId: category.id,
      position: { x: rect.left, y: rect.bottom + 8 },
      restoreFocusTo: button,
    })
  }

  const handleSetColor = async (category: Category, color: CategoryColor | null) => {
    setOpenColorMenu(undefined)
    if (category.color === color) return
    setError(undefined)
    setColorStatus(undefined)
    setColorPreviews((current) => new Map(current).set(category.id, color))
    try {
      await onSetColor(category.id, color)
      setColorStatus(zhTW.categoryColors.saved(category.name))
    } catch (colorError) {
      setError(colorError instanceof Error ? colorError.message : zhTW.errors.categoryColor)
    } finally {
      setColorPreviews((current) => {
        const next = new Map(current)
        next.delete(category.id)
        return next
      })
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
              {isSaving ? zhTW.actions.saving : zhTW.categories.save}
            </button>
          </div>
        </section>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      {categories.length ? (
        <div className="category-grid">
          {categories.map((category) => {
            const entryCount = entryCounts[category.id] ?? 0
            const editTooltipId = `category-tooltip-edit-${category.id}`
            const colorTooltipId = `category-tooltip-color-${category.id}`
            const statusTooltipId = `category-tooltip-status-${category.id}`
            const deleteTooltipId = `category-tooltip-delete-${category.id}`
            const displayColor = colorPreviews.has(category.id)
              ? colorPreviews.get(category.id) ?? null
              : category.color
            const isColorSaving = savingCategoryColorIds.has(category.id)
            return (
              <article
                className={`category-card${category.isActive ? '' : ' category-card--inactive'}`}
                key={category.id}
                tabIndex={-1}
                aria-label={category.name}
                onContextMenu={(event) => {
                  if (isColorSaving) return
                  event.preventDefault()
                  event.currentTarget.focus()
                  setOpenColorMenu({
                    categoryId: category.id,
                    position: { x: event.clientX, y: event.clientY },
                    restoreFocusTo: event.currentTarget,
                  })
                }}
              >
                <div className="category-card__icon" style={categoryColorStyle(displayColor)}><Icon>{category.isActive ? 'folder' : 'inventory_2'}</Icon></div>
                <div className="category-card__content">
                  <div className="category-card__title-row">
                    <h3>{category.name}</h3>
                    {!category.isActive && <span className="date-badge">{zhTW.categories.deactivated}</span>}
                  </div>
                  <p>{zhTW.categories.entryCount(entryCount)}</p>
                </div>
                <div className="category-card__actions">
                  {entryCount > 0 && (
                    <button className="button button--secondary category-card__move" type="button" aria-label={zhTW.categories.moveEntriesFor(category.name)} onClick={() => setMovingCategory(category)}>
                      <Icon>drive_file_move</Icon>
                      {zhTW.categories.moveEntries}
                    </button>
                  )}
                  <CategoryActionTooltip id={colorTooltipId} content={isColorSaving ? zhTW.categoryColors.saving(category.name) : zhTW.categoryColors.set(category.name)}>
                    <button
                      className={`icon-button${isColorSaving ? ' icon-button--loading' : ''}`}
                      type="button"
                      aria-label={isColorSaving ? zhTW.categoryColors.saving(category.name) : zhTW.categoryColors.set(category.name)}
                      aria-describedby={colorTooltipId}
                      aria-haspopup="menu"
                      aria-busy={isColorSaving}
                      disabled={isColorSaving}
                      onClick={(event) => openColorMenuFromButton(category, event.currentTarget)}
                    >
                      <Icon className={isColorSaving ? 'loading-note-spinner' : ''}>
                        {isColorSaving ? 'progress_activity' : 'palette'}
                      </Icon>
                    </button>
                  </CategoryActionTooltip>
                  <CategoryActionTooltip id={editTooltipId} content={zhTW.categories.editHint(category.name)}>
                    <button className="icon-button" type="button" aria-label={zhTW.categories.editCategory(category.name)} aria-describedby={editTooltipId} onClick={() => startEditing(category)}>
                      <Icon>edit</Icon>
                    </button>
                  </CategoryActionTooltip>
                  {category.isActive ? (
                    <CategoryActionTooltip id={statusTooltipId} content={zhTW.categories.deactivateHint(category.name)}>
                      <button className="icon-button icon-button--danger" type="button" aria-label={zhTW.categories.deactivate(category.name)} aria-describedby={statusTooltipId} onClick={() => setPendingDeactivate(category)}>
                        <Icon>block</Icon>
                      </button>
                    </CategoryActionTooltip>
                  ) : (
                    <CategoryActionTooltip id={statusTooltipId} content={zhTW.categories.activateHint(category.name)}>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={zhTW.categories.activate(category.name)}
                        aria-describedby={statusTooltipId}
                        disabled={activatingCategoryId === category.id}
                        onClick={() => void handleActivate(category.id)}
                      >
                        <Icon>restart_alt</Icon>
                      </button>
                    </CategoryActionTooltip>
                  )}
                  <CategoryActionTooltip id={deleteTooltipId} content={entryCount > 0 ? zhTW.categories.deleteBlocked : zhTW.categories.deleteCategory(category.name)}>
                    <button
                      className="icon-button icon-button--danger"
                      type="button"
                      aria-label={zhTW.categories.deleteCategory(category.name)}
                      aria-describedby={deleteTooltipId}
                      disabled={entryCount > 0}
                      onClick={() => setPendingDelete(category)}
                    >
                      <Icon>delete</Icon>
                    </button>
                  </CategoryActionTooltip>
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
      {openColorMenu && (() => {
        const category = categories.find((item) => item.id === openColorMenu.categoryId)
        if (!category) return null
        const selectedColor = colorPreviews.has(category.id)
          ? colorPreviews.get(category.id) ?? null
          : category.color
        return (
          <CategoryColorMenu
            selectedColor={selectedColor}
            position={openColorMenu.position}
            restoreFocusTo={openColorMenu.restoreFocusTo}
            onSelect={(color) => void handleSetColor(category, color)}
            onClose={() => setOpenColorMenu(undefined)}
          />
        )
      })()}
      <p className="sr-only" role="status">{colorStatus}</p>

      {pendingDeactivate && (
        <ConfirmDialog labelledBy="deactivate-category-title" onCancel={() => setPendingDeactivate(undefined)}>
          <div>
            <header className="confirm-dialog__header">
              <span className="confirm-dialog__icon"><Icon>block</Icon></span>
              <div>
                <h2 id="deactivate-category-title">{zhTW.categories.deactivateTitle}</h2>
                <p>{zhTW.categories.deactivateDescription}</p>
              </div>
            </header>
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
            <header className="confirm-dialog__header">
              <span className="confirm-dialog__icon"><Icon filled>delete</Icon></span>
              <div>
                <h2 id="delete-category-title">{zhTW.categories.deleteTitle}</h2>
                <p>{zhTW.categories.deleteDescription}</p>
              </div>
            </header>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="confirm-dialog__actions">
              <button className="button button--secondary" type="button" data-dialog-initial-focus disabled={isDeleting} onClick={() => setPendingDelete(undefined)}>{zhTW.actions.cancel}</button>
              <button className="button button--danger" type="button" disabled={isDeleting} onClick={() => void handleDelete()}>
                {isDeleting ? zhTW.actions.deleting : zhTW.categories.confirmDelete}
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

function CategoryActionTooltip({ id, content, children }: {
  id: string
  content: string
  children: ReactNode
}) {
  return (
    <span className="category-action-tooltip">
      {children}
      <span className="category-action-tooltip__content" id={id} role="tooltip">{content}</span>
    </span>
  )
}
