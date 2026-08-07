import { useRef, useState, type FormEvent } from 'react'
import type { Category } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'

type CategoryManagerProps = {
  categories: Category[]
  onSave: (name: string, id?: string) => Promise<void>
  onDeactivate: (id: string) => Promise<void>
}

export function CategoryManager({ categories, onSave, onDeactivate }: CategoryManagerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const deactivateButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const restoreTriggerFocus = useRef(true)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | undefined>()
  const [editingName, setEditingName] = useState('')
  const [deactivatingCategory, setDeactivatingCategory] = useState<Category | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [isSaving, setIsSaving] = useState(false)
  const [isDeactivating, setIsDeactivating] = useState(false)

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setError(undefined)
    try {
      await onSave(editingId ? editingName : newName, editingId)
      if (editingId) {
        setEditingId(undefined)
        setEditingName('')
      } else {
        setNewName('')
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : zhTW.api.requestFailed)
    } finally {
      setIsSaving(false)
    }
  }

  function startEditing(category: Category) {
    setEditingId(category.id)
    setEditingName(category.name)
    setError(undefined)
  }

  function openDeactivateDialog(category: Category) {
    setDeactivatingCategory(category)
    setError(undefined)
    restoreTriggerFocus.current = true
    dialogRef.current?.showModal()
    confirmButtonRef.current?.focus()
  }

  function closeDeactivateDialog(restoreFocus = true) {
    restoreTriggerFocus.current = restoreFocus
    dialogRef.current?.close()
    if (!restoreFocus) titleRef.current?.focus()
  }

  function handleDialogClose() {
    if (restoreTriggerFocus.current && deactivatingCategory) {
      deactivateButtonRefs.current.get(deactivatingCategory.id)?.focus()
    }
    setDeactivatingCategory(undefined)
  }

  async function confirmDeactivation() {
    if (!deactivatingCategory) return

    setIsDeactivating(true)
    setError(undefined)
    try {
      await onDeactivate(deactivatingCategory.id)
      closeDeactivateDialog(false)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : zhTW.api.requestFailed)
    } finally {
      setIsDeactivating(false)
    }
  }

  return (
    <section className="category-manager" aria-labelledby="category-manager-title">
      <header className="journal-page-header category-manager__header">
        <div className="journal-page-header__title">
          <h2 ref={titleRef} id="category-manager-title" tabIndex={-1}>{zhTW.categories.title}</h2>
          <p>{zhTW.categories.description}</p>
        </div>
        <button type="submit" form="new-category-form" disabled={isSaving}>
          <span className="material-symbols-outlined" aria-hidden="true">add</span>
          {isSaving ? zhTW.categories.saving : zhTW.categories.add}
        </button>
      </header>
      {error && <p className="category-manager__error" role="alert">{error}</p>}
      <form id="new-category-form" className="category-manager__form" onSubmit={saveCategory}>
        <label>
          {zhTW.categories.newName}
          <input value={newName} onChange={(event) => setNewName(event.target.value)} />
        </label>
      </form>
      <ul className="category-manager__list category-manager__grid" aria-label={zhTW.categories.list}>
        {categories.map((category) => (
          <li key={category.id} className={`category-manager__item category-manager__card${category.isActive ? '' : ' category-manager__item--inactive'}`}>
            {editingId === category.id ? (
              <form className="category-manager__rename" onSubmit={saveCategory}>
                <label>
                  {zhTW.categories.nameLabel(category.name)}
                  <input value={editingName} onChange={(event) => setEditingName(event.target.value)} autoFocus />
                </label>
                <button type="submit" disabled={isSaving}>{isSaving ? zhTW.categories.saving : zhTW.categories.saveName}</button>
                <button type="button" className="button--secondary" onClick={() => setEditingId(undefined)} disabled={isSaving}>{zhTW.categories.cancel}</button>
              </form>
            ) : (
              <>
                <div className="category-manager__card-header">
                  <span className="category-manager__card-icon material-symbols-outlined" aria-hidden="true">category</span>
                  <div>
                    <h3>{category.name}</h3>
                    {!category.isActive && <span className="category-manager__inactive">{zhTW.categories.inactive}</span>}
                  </div>
                </div>
                {category.isActive && (
                  <div className="category-manager__actions">
                    <button type="button" className="button--secondary" aria-label={zhTW.categories.rename(category.name)} onClick={() => startEditing(category)}>
                      <span className="material-symbols-outlined" aria-hidden="true">edit</span>
                    </button>
                    <button ref={(element) => {
                      if (element) deactivateButtonRefs.current.set(category.id, element)
                      else deactivateButtonRefs.current.delete(category.id)
                    }} type="button" className="button--danger" aria-label={zhTW.categories.deactivate(category.name)} onClick={() => openDeactivateDialog(category)}>
                      <span className="material-symbols-outlined" aria-hidden="true">block</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <dialog ref={dialogRef} aria-labelledby="deactivate-category-title" onClose={handleDialogClose}>
        <h2 id="deactivate-category-title">{zhTW.categories.deactivateTitle}</h2>
        <p>{zhTW.categories.deactivateDescription}</p>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="button--secondary" onClick={() => closeDeactivateDialog()} disabled={isDeactivating}>{zhTW.categories.cancel}</button>
          <button ref={confirmButtonRef} type="button" className="button--danger" onClick={confirmDeactivation} disabled={isDeactivating}>{isDeactivating ? zhTW.categories.deactivating : zhTW.categories.confirmDeactivate}</button>
        </div>
      </dialog>
    </section>
  )
}
