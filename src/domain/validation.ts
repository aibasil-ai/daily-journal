import type { EntryInput } from './journal'
import { zhTW } from '../i18n/zh-TW'

export type ValidationIssue = {
  field: 'entryDate' | 'content' | 'categoryId' | 'links'
  message: string
}

export function normalizeEntryInput(input: EntryInput): EntryInput {
  return {
    ...input,
    title: input.title.trim(),
    content: input.content.trim(),
    tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
    links: input.links
      .map(({ label, url }) => ({ label: label.trim(), url: url.trim() }))
      .filter(({ label, url }) => label || url),
  }
}

export function validateEntryInput(input: EntryInput, activeCategoryIds: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) {
    issues.push({ field: 'entryDate', message: zhTW.validation.entryDate })
  }
  if (!input.content.trim()) {
    issues.push({ field: 'content', message: zhTW.validation.content })
  }
  if (!activeCategoryIds.has(input.categoryId)) {
    issues.push({ field: 'categoryId', message: zhTW.validation.categoryId })
  }
  for (const link of input.links) {
    if (!link.label || !isHttpUrl(link.url)) {
      issues.push({ field: 'links', message: zhTW.validation.links })
    }
  }

  return issues
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
