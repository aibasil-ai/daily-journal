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
  const deactivateButtonRefs = useRef(new Map<string, HTMLButtonElement>())
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
    dialogRef.current?.showModal()
    confirmButtonRef.current?.focus()
  }

  function closeDeactivateDialog() {
    dialogRef.current?.close()
    setDeactivatingCategory(undefined)
    if (deactivatingCategory) deactivateButtonRefs.current.get(deactivatingCategory.id)?.focus()
  }

  async function confirmDeactivation() {
    if (!deactivatingCategory) return

    setIsDeactivating(true)
    setError(undefined)
    try {
      await onDeactivate(deactivatingCategory.id)
      closeDeactivateDialog()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : zhTW.api.requestFailed)
    } finally {
      setIsDeactivating(false)
    }
  }

  return (
    <section className="category-manager" aria-labelledby="category-manager-title">
      <h2 id="category-manager-title">{zhTW.categories.title}</h2>
      {error && <p className="category-manager__error" role="alert">{error}</p>}
      <form className="category-manager__form" onSubmit={saveCategory}>
        <label>
          {zhTW.categories.newName}
          <input value={newName} onChange={(event) => setNewName(event.target.value)} />
        </label>
        <button type="submit" disabled={isSaving}>{isSaving ? zhTW.categories.saving : zhTW.categories.add}</button>
      </form>
      <ul className="category-manager__list" aria-label={zhTW.categories.list}>
        {categories.map((category) => (
          <li key={category.id} className="category-manager__item">
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
                <span>{category.name}</span>
                {!category.isActive && <span className="category-manager__inactive">{zhTW.categories.inactive}</span>}
                {category.isActive && (
                  <div className="category-manager__actions">
                    <button type="button" className="button--secondary" onClick={() => startEditing(category)}>{zhTW.categories.rename(category.name)}</button>
                    <button ref={(element) => {
                      if (element) deactivateButtonRefs.current.set(category.id, element)
                      else deactivateButtonRefs.current.delete(category.id)
                    }} type="button" className="button--danger" onClick={() => openDeactivateDialog(category)}>{zhTW.categories.deactivate(category.name)}</button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <dialog ref={dialogRef} aria-labelledby="deactivate-category-title" onClose={() => setDeactivatingCategory(undefined)}>
        <h2 id="deactivate-category-title">{zhTW.categories.deactivateTitle}</h2>
        <p>{zhTW.categories.deactivateDescription}</p>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="button--secondary" onClick={closeDeactivateDialog} disabled={isDeactivating}>{zhTW.categories.cancel}</button>
          <button ref={confirmButtonRef} type="button" className="button--danger" onClick={confirmDeactivation} disabled={isDeactivating}>{isDeactivating ? zhTW.categories.deactivating : zhTW.categories.confirmDeactivate}</button>
        </div>
      </dialog>
    </section>
  )
}
