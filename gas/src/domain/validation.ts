import type { EntryInput } from './journal'

declare const URL: {
  new (value: string): { protocol: string }
}

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
    issues.push({ field: 'entryDate', message: '請選擇記錄日期。' })
  }
  if (!input.content.trim()) {
    issues.push({ field: 'content', message: '請輸入記事內容。' })
  }
  if (!activeCategoryIds.has(input.categoryId)) {
    issues.push({ field: 'categoryId', message: '請選擇啟用中的分類。' })
  }
  for (const link of input.links) {
    if (!link.label || !isHttpUrl(link.url)) {
      issues.push({ field: 'links', message: '每個連結都需要名稱與有效的 http 或 https 網址。' })
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
