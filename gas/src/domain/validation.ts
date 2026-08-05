import type { EntryInput } from './journal'

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

  if (!isValidGregorianDate(input.entryDate)) {
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

function isValidGregorianDate(value: string): boolean {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!matched) return false

  const [, yearText, monthText, dayText] = matched
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function isHttpUrl(value: string): boolean {
  const match = /^https?:\/\/([^\s/?#]+)(?:[/?#][^\s]*)?$/i.exec(value)
  if (!match) return false

  const authority = match[1].replace(/^.*@/, '')
  const hostAndPort = /^(\[[a-f0-9:]+\]|[a-z0-9.-]+)(?::(\d+))?$/i.exec(authority)
  if (!hostAndPort) return false

  const [, host, port] = hostAndPort
  if (!(/^[a-z0-9.-]+$/i.test(host) || /^\[[a-f0-9:]+\]$/i.test(host))) return false
  return port === undefined || Number(port) <= 65_535
}
