import { JournalError } from './errors.js'
import { normalizeCategoryColor } from './category-colors.js'
import type { CategoryColor } from './category-colors.js'
import type {
  CategoryInput,
  EntryFilter,
  EntryFilterCriteria,
  EntryInput,
  JournalLink,
  MoveEntriesInput,
} from './types.js'

export type ValidationIssue = {
  field: 'entryDate' | 'content' | 'categoryId' | 'links'
  message: string
}

type UnknownRecord = Record<string, unknown>

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const HTTP_URL_PATTERN = /^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i

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

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false

  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

export function isHttpUrl(value: string): boolean {
  return HTTP_URL_PATTERN.test(value)
}

export function validateEntryInput(input: EntryInput, activeCategoryIds: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!isIsoDate(input.entryDate)) {
    issues.push({ field: 'entryDate', message: '請選擇記錄日期。' })
  }
  if (!input.content.trim()) {
    issues.push({ field: 'content', message: '請輸入記事內容。' })
  }
  if (!activeCategoryIds.has(input.categoryId)) {
    issues.push({ field: 'categoryId', message: '請選擇啟用中的分類。' })
  }
  for (const link of input.links) {
    if (!link.label.trim() || !isHttpUrl(link.url.trim())) {
      issues.push({ field: 'links', message: '每個連結都需要名稱與有效的 http 或 https 網址。' })
    }
  }

  return issues
}

export function assertValidEntry(input: EntryInput, activeCategoryIds: Set<string>): void {
  const issue = validateEntryInput(input, activeCategoryIds)[0]
  if (issue) throw new JournalError('VALIDATION_ERROR', issue.message)
}

export function assertValidEntryDate(value: string): void {
  if (!isIsoDate(value)) {
    throw new JournalError('VALIDATION_ERROR', '請選擇記錄日期。')
  }
}

export function assertEntryFilterCriteria(filter: EntryFilterCriteria): void {
  if (filter.from && !isIsoDate(filter.from)) {
    throw new JournalError('VALIDATION_ERROR', '起始日期格式錯誤，請重新選擇日期。')
  }
  if (filter.to && !isIsoDate(filter.to)) {
    throw new JournalError('VALIDATION_ERROR', '結束日期格式錯誤，請重新選擇日期。')
  }
  if (filter.from && filter.to && filter.from > filter.to) {
    throw new JournalError('VALIDATION_ERROR', '起始日期不可晚於結束日期。')
  }
}

export function assertEntryFilter(filter: EntryFilter): void {
  assertEntryFilterCriteria(filter)
  if (!Number.isInteger(filter.limit) || filter.limit < 1) {
    throw new JournalError('VALIDATION_ERROR', '每頁筆數必須是大於 0 的整數。')
  }
  if (filter.cursor !== null && !filter.cursor.trim()) {
    throw new JournalError('VALIDATION_ERROR', '分頁游標格式錯誤，請重新載入資料。')
  }
}

/** 將未知 API 資料轉為受信任的記事輸入。 */
export function parseEntryInput(value: unknown): EntryInput {
  if (!isRecord(value)) throwInvalidRequest()

  const input: EntryInput = {
    entryDate: readString(value, 'entryDate'),
    title: readString(value, 'title'),
    content: readString(value, 'content'),
    categoryId: readString(value, 'categoryId'),
    tags: readStringArray(value.tags),
    links: readLinks(value.links),
  }

  if (value.id !== undefined) input.id = readString(value, 'id')
  return input
}

export function parseCategoryInput(value: unknown): CategoryInput {
  if (!isRecord(value)) throwInvalidRequest()

  const input: CategoryInput = { name: readString(value, 'name') }
  if (value.id !== undefined) input.id = readString(value, 'id')
  return input
}

export function parseCategoryColor(value: unknown): CategoryColor | null {
  if (value === null) return null
  if (typeof value !== 'string') throwInvalidRequest()
  const color = normalizeCategoryColor(value)
  if (!color) throw new JournalError('VALIDATION_ERROR', '請選擇有效的類別顏色。')
  return color
}

export function parseMoveEntriesInput(value: unknown): MoveEntriesInput {
  if (!isRecord(value)) throwInvalidRequest()

  return {
    sourceCategoryId: readString(value, 'sourceCategoryId'),
    targetCategoryId: readString(value, 'targetCategoryId'),
    entryIds: readStringArray(value.entryIds),
  }
}

export function parseEntryFilter(value: unknown): EntryFilter {
  if (!isRecord(value)) throwInvalidRequest()

  const filter: EntryFilter = {
    ...parseEntryFilterCriteriaRecord(value),
    cursor: readNullableString(value, 'cursor'),
    limit: readNumber(value, 'limit'),
  }
  assertEntryFilter(filter)
  return filter
}

export function parseEntryFilterCriteria(value: unknown): EntryFilterCriteria {
  if (!isRecord(value)) throwInvalidRequest()

  const filter = parseEntryFilterCriteriaRecord(value)
  assertEntryFilterCriteria(filter)
  return filter
}

function parseEntryFilterCriteriaRecord(value: UnknownRecord): EntryFilterCriteria {
  return {
    query: readString(value, 'query'),
    from: readNullableString(value, 'from'),
    to: readNullableString(value, 'to'),
    categoryId: readNullableString(value, 'categoryId'),
    tag: readNullableString(value, 'tag'),
  }
}

function readLinks(value: unknown): JournalLink[] {
  if (!Array.isArray(value)) throwInvalidRequest()

  return value.map((link) => {
    if (!isRecord(link)) throwInvalidRequest()
    return {
      label: readString(link, 'label'),
      url: readString(link, 'url'),
    }
  })
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throwInvalidRequest()
  }
  return [...value]
}

function readString(value: UnknownRecord, key: string): string {
  if (typeof value[key] !== 'string') throwInvalidRequest()
  return value[key] as string
}

function readNullableString(value: UnknownRecord, key: string): string | null {
  const item = value[key]
  if (item !== null && typeof item !== 'string') throwInvalidRequest()
  return item
}

function readNumber(value: UnknownRecord, key: string): number {
  if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) throwInvalidRequest()
  return value[key] as number
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function throwInvalidRequest(): never {
  throw new JournalError('INVALID_REQUEST', '請檢查送出的資料格式後再試。')
}
