import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Category, Entry, EntryInput, JournalLink } from '../../domain/journal'
import { normalizeEntryInput, validateEntryInput, type ValidationIssue } from '../../domain/validation'
import { dateInTimeZone } from '../../domain/time-zone'
import { zhTW } from '../../i18n/zh-TW'

type EntryFormProps = {
  categories: Category[]
  onSave: (input: EntryInput) => Promise<void>
  tagSuggestions: string[]
  entry?: Entry
  onCancel?: () => void
  onSaveSuccess?: () => void
  onSavingChange?: (isSaving: boolean) => void
  timezone?: string
}

type FormValues = Omit<EntryInput, 'id'>

export function EntryForm({ categories, onSave, tagSuggestions, entry, onCancel, onSaveSuccess, onSavingChange, timezone }: EntryFormProps) {
  const [values, setValues] = useState<FormValues>(() => entryValues(entry, timezone))
  const [tagDraft, setTagDraft] = useState('')
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const activeCategories = categories.filter((category) => category.isActive)

  function setSaving(nextIsSaving: boolean) {
    setIsSaving(nextIsSaving)
    onSavingChange?.(nextIsSaving)
  }

  function addTags(value: string) {
    const newTags = value.split(',').map((tag) => tag.trim()).filter(Boolean)
    if (newTags.length) {
      setValues((current) => ({ ...current, tags: [...new Set([...current.tags, ...newTags])] }))
    }
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return

    event.preventDefault()
    addTags(tagDraft)
    setTagDraft('')
  }

  function handleTagChange(value: string) {
    if (!value.includes(',')) {
      setTagDraft(value)
      return
    }

    const parts = value.split(',')
    addTags(parts.slice(0, -1).join(','))
    setTagDraft(parts.at(-1) ?? '')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = normalizeEntryInput(entry ? { ...values, id: entry.id } : values)
    const nextIssues = validateEntryInput(input, new Set(activeCategories.map((category) => category.id)))
    setIssues(nextIssues)
    if (nextIssues.length) return

    setSaving(true)
    try {
      await onSave(input)
      if (!entry) {
        setValues(entryValues(undefined, timezone))
        setTagDraft('')
      }
      onSaveSuccess?.()
    } catch (error) {
      setIssues([{ field: 'content', message: error instanceof Error ? error.message : zhTW.api.requestFailed }])
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="entry-form" onSubmit={handleSubmit} noValidate>
      <FormErrors issues={issues} />
      <label>
        {zhTW.entries.date}
        <input
          type="date"
          value={values.entryDate}
          onChange={(event) => setValues((current) => ({ ...current, entryDate: event.target.value }))}
        />
      </label>
      <label>
        {zhTW.entries.title}
        <input
          type="text"
          value={values.title}
          onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
        />
      </label>
      <label>
        {zhTW.entries.category}
        <select
          value={values.categoryId}
          onChange={(event) => setValues((current) => ({ ...current, categoryId: event.target.value }))}
        >
          <option value="">{zhTW.entries.selectCategory}</option>
          {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      <label>
        {zhTW.entries.content}
        <textarea
          value={values.content}
          onChange={(event) => setValues((current) => ({ ...current, content: event.target.value }))}
        />
      </label>
      <div className="entry-form__tags">
        <label>
          {zhTW.entries.tags}
          <input
            list="tag-suggestions"
            value={tagDraft}
            onChange={(event) => handleTagChange(event.target.value)}
            onKeyDown={handleTagKeyDown}
          />
        </label>
        <datalist id="tag-suggestions">
          {tagSuggestions.map((tag) => <option key={tag} value={tag} />)}
        </datalist>
        {values.tags.length > 0 && (
          <ul className="tag-list" aria-label={zhTW.entries.selectedTags}>
            {values.tags.map((tag) => (
              <li key={tag}>
                {tag}
                <button type="button" className="tag-list__remove" onClick={() => setValues((current) => ({ ...current, tags: current.tags.filter((item) => item !== tag) }))} aria-label={zhTW.entries.removeTag(tag)}>{zhTW.entries.removeTagButton}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <section className="entry-form__links" aria-label={zhTW.entries.links}>
        <h3>{zhTW.entries.links}</h3>
        {values.links.map((link, index) => (
          <LinkFields
            key={index}
            index={index}
            link={link}
            onChange={(nextLink) => setValues((current) => ({ ...current, links: current.links.map((item, itemIndex) => itemIndex === index ? nextLink : item) }))}
            onRemove={() => setValues((current) => ({ ...current, links: current.links.filter((_, itemIndex) => itemIndex !== index) }))}
          />
        ))}
        <button type="button" className="button--secondary" onClick={() => setValues((current) => ({ ...current, links: [...current.links, { label: '', url: '' }] }))}>{zhTW.entries.addLink}</button>
      </section>
      <div className="entry-form__actions">
        <button type="submit" disabled={isSaving}>{isSaving ? zhTW.entries.saving : zhTW.entries.save}</button>
        {onCancel && <button type="button" className="button--secondary" onClick={onCancel} disabled={isSaving}>{zhTW.entries.cancelEdit}</button>}
      </div>
    </form>
  )
}

function FormErrors({ issues }: { issues: ValidationIssue[] }) {
  if (!issues.length) return null

  return (
    <div className="form-errors" role="alert">
      {[...new Set(issues.map((issue) => issue.message))].map((message) => <p key={message}>{message}</p>)}
    </div>
  )
}

function LinkFields({ index, link, onChange, onRemove }: { index: number; link: JournalLink; onChange: (link: JournalLink) => void; onRemove: () => void }) {
  const position = index + 1

  return (
    <div className="link-fields">
      <label>
        {zhTW.entries.linkLabel(position)}
        <input type="text" value={link.label} onChange={(event) => onChange({ ...link, label: event.target.value })} />
      </label>
      <label>
        {zhTW.entries.linkUrl(position)}
        <input type="url" value={link.url} onChange={(event) => onChange({ ...link, url: event.target.value })} />
      </label>
      <button type="button" className="button--text" onClick={onRemove}>{zhTW.entries.removeLink(position)}</button>
    </div>
  )
}

function entryValues(entry: Entry | undefined, timezone: string | undefined): FormValues {
  return entry ? {
    entryDate: entry.entryDate,
    title: entry.title,
    content: entry.content,
    categoryId: entry.categoryId,
    tags: entry.tags,
    links: entry.links,
  } : {
    entryDate: dateInTimeZone(timezone),
    title: '',
    content: '',
    categoryId: '',
    tags: [],
    links: [],
  }
}
