import { useEffect, useId, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { Category, Entry, EntryInput, JournalLink } from '../../domain/journal'
import { normalizeEntryInput, validateEntryInput, type ValidationIssue } from '../../domain/validation'
import { zhTW } from '../../i18n/zh-TW'
import { Icon } from '../../components/icon'
import { getJournalDate } from '../../utils/date'

type EntryFormProps = {
  entry?: Entry
  categories: Category[]
  tagSuggestions: string[]
  timezone: string
  onSave: (entry: EntryInput) => Promise<void>
  onCancel: () => void
}

type DraftLink = JournalLink

export function EntryForm({ entry, categories, tagSuggestions, timezone, onSave, onCancel }: EntryFormProps) {
  const formId = useId()
  const defaultCategoryId = categories.find((category) => category.isActive)?.id ?? ''
  const [draft, setDraft] = useState<EntryInput>(() => createDraft(entry, defaultCategoryId, timezone))
  const [tagInput, setTagInput] = useState('')
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [submitError, setSubmitError] = useState<string>()
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setDraft(createDraft(entry, defaultCategoryId, timezone))
    setTagInput('')
    setIssues([])
    setSubmitError(undefined)
  }, [defaultCategoryId, entry, timezone])

  const addTag = (value = tagInput) => {
    const nextTags = value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
    if (nextTags.length) {
      setDraft((current) => ({
        ...current,
        tags: [...new Set([...current.tags, ...nextTags])],
      }))
    }
    setTagInput('')
  }

  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag()
    }
  }

  const updateLink = (index: number, changes: Partial<DraftLink>) => {
    setDraft((current) => ({
      ...current,
      links: current.links.map((link, linkIndex) => (
        linkIndex === index ? { ...link, ...changes } : link
      )),
    }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const withPendingTag = tagInput.trim()
      ? { ...draft, tags: [...draft.tags, tagInput] }
      : draft
    const normalized = normalizeEntryInput(withPendingTag)
    const validationIssues = validateEntryInput(
      normalized,
      new Set(categories.filter((category) => category.isActive).map((category) => category.id)),
    )
    setIssues(validationIssues)
    setSubmitError(undefined)
    if (validationIssues.length) return

    setIsSaving(true)
    try {
      await onSave(normalized)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : zhTW.errors.save)
    } finally {
      setIsSaving(false)
    }
  }

  const fieldError = (field: ValidationIssue['field']) => issues.find((issue) => issue.field === field)?.message

  return (
    <form className="entry-form" onSubmit={handleSubmit} noValidate>
      <div className="entry-form__top-grid">
        <label className="field-group" htmlFor={`${formId}-date`}>
          <span>{zhTW.form.date}</span>
          <span className="field-with-icon">
            <Icon>calendar_month</Icon>
            <input
              id={`${formId}-date`}
              type="date"
              value={draft.entryDate}
              aria-label={zhTW.form.date}
              onChange={(event) => setDraft((current) => ({ ...current, entryDate: event.target.value }))}
              aria-invalid={Boolean(fieldError('entryDate'))}
            />
          </span>
          {fieldError('entryDate') && <small className="field-error">{fieldError('entryDate')}</small>}
        </label>
        <label className="field-group" htmlFor={`${formId}-category`}>
          <span>{zhTW.form.category}</span>
          <span className="field-with-icon">
            <Icon>category</Icon>
            <select
              id={`${formId}-category`}
              value={draft.categoryId}
              aria-label={zhTW.form.category}
              onChange={(event) => setDraft((current) => ({ ...current, categoryId: event.target.value }))}
              aria-invalid={Boolean(fieldError('categoryId'))}
            >
              <option value="" disabled>{zhTW.form.chooseCategory}</option>
              {categories.filter((category) => category.isActive).map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </span>
          {fieldError('categoryId') && <small className="field-error">{fieldError('categoryId')}</small>}
        </label>
      </div>

      <label className="field-group" htmlFor={`${formId}-title`}>
        <span>{zhTW.form.title}</span>
        <input
          id={`${formId}-title`}
          type="text"
          value={draft.title}
          placeholder={zhTW.form.titlePlaceholder}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
        />
      </label>

      <div className="field-group">
        <label htmlFor={`${formId}-tags`}>{zhTW.form.tags}</label>
        <div className="tag-editor">
          {draft.tags.map((tag) => (
            <span className="tag-chip tag-chip--editable" key={tag}>
              #{tag}
              <button
                type="button"
                aria-label={zhTW.form.removeTag(tag)}
                onClick={() => setDraft((current) => ({
                  ...current,
                  tags: current.tags.filter((currentTag) => currentTag !== tag),
                }))}
              >
                <Icon>close</Icon>
              </button>
            </span>
          ))}
          <input
            id={`${formId}-tags`}
            list={`${formId}-tag-suggestions`}
            value={tagInput}
            placeholder={zhTW.form.tagsPlaceholder}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={() => addTag()}
          />
          <datalist id={`${formId}-tag-suggestions`}>
            {tagSuggestions.map((tag) => <option key={tag} value={tag} />)}
          </datalist>
        </div>
      </div>

      <label className="field-group" htmlFor={`${formId}-content`}>
        <span>{zhTW.form.content}</span>
        <textarea
          id={`${formId}-content`}
          value={draft.content}
          placeholder={zhTW.form.contentPlaceholder}
          onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
          aria-invalid={Boolean(fieldError('content'))}
          rows={10}
        />
        {fieldError('content') && <small className="field-error">{fieldError('content')}</small>}
      </label>

      <section className="entry-form__links" aria-labelledby={`${formId}-links-title`}>
        <div className="entry-form__links-heading">
          <h2 id={`${formId}-links-title`}>{zhTW.form.links}</h2>
          <button
            className="button button--text"
            type="button"
            onClick={() => setDraft((current) => ({
              ...current,
              links: [...current.links, { label: '', url: '' }],
            }))}
          >
            <Icon>add</Icon>
            {zhTW.actions.addLink}
          </button>
        </div>
        {draft.links.map((link, index) => (
          <div className="entry-form__link-row" key={`link-${index}`}>
            <label>
              <span className="sr-only">{zhTW.form.linkLabel(index + 1)}</span>
              <input
                type="text"
                value={link.label}
                placeholder={zhTW.form.linkLabelPlaceholder}
                aria-label={zhTW.form.linkLabel(index + 1)}
                onChange={(event) => updateLink(index, { label: event.target.value })}
              />
            </label>
            <label>
              <span className="sr-only">{zhTW.form.linkUrl(index + 1)}</span>
              <input
                type="url"
                value={link.url}
                placeholder={zhTW.form.linkUrlPlaceholder}
                aria-label={zhTW.form.linkUrl(index + 1)}
                onChange={(event) => updateLink(index, { url: event.target.value })}
              />
            </label>
            <button
              className="icon-button icon-button--danger"
              type="button"
              aria-label={zhTW.form.removeLink(index + 1)}
              onClick={() => setDraft((current) => ({
                ...current,
                links: current.links.filter((_, linkIndex) => linkIndex !== index),
              }))}
            >
              <Icon>close</Icon>
            </button>
          </div>
        ))}
        {fieldError('links') && <small className="field-error">{fieldError('links')}</small>}
      </section>

      {!categories.some((category) => category.isActive) && (
        <p className="form-note">{zhTW.form.noCategories}</p>
      )}
      {submitError && <p className="form-error" role="alert">{submitError}</p>}

      <footer className="entry-form__actions">
        <button className="button button--secondary" type="button" onClick={onCancel} disabled={isSaving}>
          {zhTW.actions.cancel}
        </button>
        <button className="button button--primary" type="submit" disabled={isSaving}>
          <Icon filled>save</Icon>
          {isSaving ? zhTW.connection.connecting : entry ? zhTW.actions.saveChanges : zhTW.actions.saveEntry}
        </button>
      </footer>
    </form>
  )
}

function createDraft(entry: Entry | undefined, defaultCategoryId: string, timezone: string): EntryInput {
  if (entry) {
    const { id, entryDate, title, content, categoryId, tags, links } = entry
    return {
      id,
      entryDate,
      title,
      content,
      categoryId,
      tags: [...tags],
      links: links.map((link) => ({ ...link })),
    }
  }

  return {
    entryDate: getJournalDate(timezone),
    title: '',
    content: '',
    categoryId: defaultCategoryId,
    tags: [],
    links: [],
  }
}
