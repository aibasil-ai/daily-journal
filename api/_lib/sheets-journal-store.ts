import { JournalError } from '../../shared/journal/errors'
import type { Category, Entry, EntryFilter, JournalLink } from '../../shared/journal/types'
import type { JournalStore } from '../../shared/journal/store'
import type { SheetsClient } from './sheets-client'

export const ENTRY_SHEET_NAME = 'entries'
export const CATEGORY_SHEET_NAME = 'categories'
export const SETTINGS_SHEET_NAME = 'settings'

export const ENTRY_HEADERS = [
  'id',
  'entryDate',
  'title',
  'content',
  'categoryId',
  'tags',
  'links',
  'createdAt',
  'updatedAt',
]

export const CATEGORY_HEADERS = ['id', 'name', 'isActive', 'createdAt', 'updatedAt']
export const SETTINGS_HEADERS = ['key', 'value']

export const SCHEMA_VERSION = '1'

export class SheetsJournalStore implements JournalStore {
  private categories: Category[] = []
  private entries: Entry[] = []
  private timezone: string = 'Asia/Taipei'
  private isDirty = false

  constructor(options: {
    categories?: Category[]
    entries?: Entry[]
    timezone?: string
  } = {}) {
    this.categories = options.categories ? options.categories.map((c) => ({ ...c })) : []
    this.entries = options.entries ? options.entries.map((e) => cloneEntry(e)) : []
    if (options.timezone) this.timezone = options.timezone
  }

  static async ensureSchema(
    client: SheetsClient,
    spreadsheetId: string,
    accessToken: string,
  ): Promise<void> {
    const meta = await client.getSpreadsheet(accessToken, spreadsheetId)
    const existingSheetNames = new Set(meta.sheets.map((s) => s.properties.title))

    const addSheetRequests: unknown[] = []
    const requiredSheets = [ENTRY_SHEET_NAME, CATEGORY_SHEET_NAME, SETTINGS_SHEET_NAME]
    for (const name of requiredSheets) {
      if (!existingSheetNames.has(name)) {
        addSheetRequests.push({
          addSheet: { properties: { title: name } },
        })
      }
    }

    if (addSheetRequests.length > 0) {
      await client.batchUpdate(accessToken, spreadsheetId, addSheetRequests)
    }

    // Freeze header rows and format
    const updatedMeta = await client.getSpreadsheet(accessToken, spreadsheetId)
    const formatRequests: unknown[] = []
    for (const s of updatedMeta.sheets) {
      if (requiredSheets.includes(s.properties.title)) {
        formatRequests.push({
          updateSheetProperties: {
            properties: {
              sheetId: s.properties.sheetId,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: 'gridProperties.frozenRowCount',
          },
        })
      }
    }

    if (formatRequests.length > 0) {
      await client.batchUpdate(accessToken, spreadsheetId, formatRequests)
    }

    // Ensure header rows and settings schemaVersion
    const ranges = await client.batchGet(accessToken, spreadsheetId, [
      `${ENTRY_SHEET_NAME}!A1:I1`,
      `${CATEGORY_SHEET_NAME}!A1:E1`,
      `${SETTINGS_SHEET_NAME}!A1:B`,
    ])

    const updates: Array<{ range: string; values: unknown[][] }> = []

    if (!ranges[0]?.values?.length) {
      updates.push({ range: `${ENTRY_SHEET_NAME}!A1:I1`, values: [ENTRY_HEADERS] })
    }
    if (!ranges[1]?.values?.length) {
      updates.push({ range: `${CATEGORY_SHEET_NAME}!A1:E1`, values: [CATEGORY_HEADERS] })
    }

    const settingsValues = ranges[2]?.values ?? []
    if (!settingsValues.length) {
      updates.push({
        range: `${SETTINGS_SHEET_NAME}!A1:B2`,
        values: [SETTINGS_HEADERS, ['schemaVersion', SCHEMA_VERSION]],
      })
    } else {
      const hasVersion = settingsValues.some((r) => String(r[0]).trim() === 'schemaVersion')
      if (!hasVersion) {
        const nextRow = settingsValues.length + 1
        updates.push({
          range: `${SETTINGS_SHEET_NAME}!A${nextRow}:B${nextRow}`,
          values: [['schemaVersion', SCHEMA_VERSION]],
        })
      }
    }

    if (updates.length > 0) {
      await client.batchUpdateValues(accessToken, spreadsheetId, updates)
    }
  }

  static async verifySchema(
    client: SheetsClient,
    spreadsheetId: string,
    accessToken: string,
  ): Promise<void> {
    const meta = await client.getSpreadsheet(accessToken, spreadsheetId)
    const existingSheetNames = new Set(meta.sheets.map((s) => s.properties.title))

    if (
      !existingSheetNames.has(ENTRY_SHEET_NAME) ||
      !existingSheetNames.has(CATEGORY_SHEET_NAME) ||
      !existingSheetNames.has(SETTINGS_SHEET_NAME)
    ) {
      throw new JournalError('SCHEMA_MISMATCH', 'Google Sheet 缺少必要工作表。')
    }

    const ranges = await client.batchGet(accessToken, spreadsheetId, [
      `${ENTRY_SHEET_NAME}!A1:I1`,
      `${CATEGORY_SHEET_NAME}!A1:E1`,
      `${SETTINGS_SHEET_NAME}!A1:B`,
    ])

    const entryHeaders = ranges[0]?.values?.[0] ?? []
    if (!headersMatch(entryHeaders, ENTRY_HEADERS)) {
      throw new JournalError('SCHEMA_MISMATCH', 'Google Sheet entries 工作表標題列不符。')
    }

    const catHeaders = ranges[1]?.values?.[0] ?? []
    if (!headersMatch(catHeaders, CATEGORY_HEADERS)) {
      throw new JournalError('SCHEMA_MISMATCH', 'Google Sheet categories 工作表標題列不符。')
    }

    const settingsRows = ranges[2]?.values ?? []
    const versionRow = settingsRows.find((r) => String(r[0]).trim() === 'schemaVersion')
    if (!versionRow || String(versionRow[1]).trim() !== SCHEMA_VERSION) {
      throw new JournalError('SCHEMA_MISMATCH', 'Google Sheet settings schemaVersion 不支援。')
    }
  }

  static async load(
    client: SheetsClient,
    spreadsheetId: string,
    accessToken: string,
  ): Promise<SheetsJournalStore> {
    const meta = await client.getSpreadsheet(accessToken, spreadsheetId)
    const timezone = meta.properties.timeZone?.trim() || 'Asia/Taipei'

    await SheetsJournalStore.verifySchema(client, spreadsheetId, accessToken)

    const ranges = await client.batchGet(accessToken, spreadsheetId, [
      `${ENTRY_SHEET_NAME}!A2:I`,
      `${CATEGORY_SHEET_NAME}!A2:E`,
    ])

    const entryRows = ranges[0]?.values ?? []
    const catRows = ranges[1]?.values ?? []

    const categories = catRows
      .filter((r) => r.length > 0 && String(r[0] ?? '').trim())
      .map((r, index) => toCategory(r, index + 2))

    const entries = entryRows
      .filter((r) => r.length > 0 && String(r[0] ?? '').trim())
      .map((r, index) => toEntry(r, index + 2))

    return new SheetsJournalStore({
      categories,
      entries,
      timezone,
    })
  }

  async flush(
    client: SheetsClient,
    spreadsheetId: string,
    accessToken: string,
  ): Promise<void> {
    if (!this.isDirty) return

    const entryValuesData: unknown[][] = [ENTRY_HEADERS, ...this.entries.map(entryValues)]
    const catValuesData: unknown[][] = [CATEGORY_HEADERS, ...this.categories.map(categoryValues)]

    // To prevent leftover deleted rows, write updated table and clear trailing rows if needed
    // or batchUpdateValues over the sheet ranges:
    await client.batchUpdateValues(accessToken, spreadsheetId, [
      {
        range: `${ENTRY_SHEET_NAME}!A1:I${Math.max(entryValuesData.length, 1)}`,
        values: entryValuesData,
      },
      {
        range: `${CATEGORY_SHEET_NAME}!A1:E${Math.max(catValuesData.length, 1)}`,
        values: catValuesData,
      },
    ])

    this.isDirty = false
  }

  withWriteLock<T>(operation: () => T): T {
    return operation()
  }

  listCategories(): Category[] {
    return this.categories.map((c) => ({ ...c }))
  }

  saveCategory(category: Category): Category {
    const index = this.categories.findIndex((c) => c.id === category.id)
    if (index >= 0) {
      this.categories[index] = { ...category }
    } else {
      this.categories.push({ ...category })
    }
    this.isDirty = true
    return { ...category }
  }

  listEntries(_filter?: EntryFilter): Entry[] {
    return this.entries.map(cloneEntry)
  }

  getEntry(id: string): Entry | undefined {
    const found = this.entries.find((e) => e.id === id)
    return found ? cloneEntry(found) : undefined
  }

  saveEntry(entry: Entry): Entry {
    const index = this.entries.findIndex((e) => e.id === entry.id)
    if (index >= 0) {
      this.entries[index] = cloneEntry(entry)
    } else {
      this.entries.push(cloneEntry(entry))
    }
    this.isDirty = true
    return cloneEntry(entry)
  }

  saveEntries(entries: Entry[]): Entry[] {
    for (const e of entries) {
      const index = this.entries.findIndex((existing) => existing.id === e.id)
      if (index === -1) {
        throw new JournalError('NOT_FOUND', '找不到要更新的記事。')
      }
      this.entries[index] = cloneEntry(e)
    }
    this.isDirty = true
    return entries.map(cloneEntry)
  }

  deleteEntry(id: string): void {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) {
      throw new JournalError('NOT_FOUND', '找不到要刪除的記事。')
    }
    this.entries.splice(index, 1)
    this.isDirty = true
  }

  deleteCategory(id: string): void {
    const index = this.categories.findIndex((c) => c.id === id)
    if (index === -1) {
      throw new JournalError('NOT_FOUND', '找不到要刪除的分類。')
    }
    this.categories.splice(index, 1)
    this.isDirty = true
  }

  getTimezone(): string {
    return this.timezone
  }
}

function headersMatch(actual: unknown[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false
  return expected.every((exp, i) => String(actual[i] ?? '').trim() === exp)
}

function toCategory(row: unknown[], rowIndex: number): Category {
  const id = String(row[0] ?? '').trim()
  if (!id) {
    throw new JournalError('DATA_ERROR', `第 ${rowIndex} 列缺少分類 ID。請修正 Google Sheets 中的資料後再試。`)
  }
  const name = String(row[1] ?? '')
  const rawActive = row[2]
  let isActive = true
  if (typeof rawActive === 'boolean') isActive = rawActive
  else if (String(rawActive).trim().toLowerCase() === 'false') isActive = false
  else if (String(rawActive).trim().toLowerCase() === 'true') isActive = true
  else {
    throw new JournalError('DATA_ERROR', `分類資料列「${id}」的 isActive 欄位不是 true 或 false。請修正 Google Sheets 中的資料後再試。`)
  }
  const createdAt = String(row[3] ?? '')
  const updatedAt = String(row[4] ?? '')
  return { id, name, isActive, createdAt, updatedAt }
}

function toEntry(row: unknown[], rowIndex: number): Entry {
  const id = String(row[0] ?? '').trim()
  if (!id) {
    throw new JournalError('DATA_ERROR', `第 ${rowIndex} 列缺少記事 ID。請修正 Google Sheets 中的資料後再試。`)
  }
  const entryDate = String(row[1] ?? '')
  const title = String(row[2] ?? '')
  const content = String(row[3] ?? '')
  const categoryId = String(row[4] ?? '')
  const tags = parseTags(String(row[5] ?? '[]'), id)
  const links = parseLinks(String(row[6] ?? '[]'), id)
  const createdAt = String(row[7] ?? '')
  const updatedAt = String(row[8] ?? '')
  return { id, entryDate, title, content, categoryId, tags, links, createdAt, updatedAt }
}

function parseTags(value: string, entryId: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]') as unknown
    if (!Array.isArray(parsed) || parsed.some((t) => typeof t !== 'string')) {
      throw new Error()
    }
    return parsed as string[]
  } catch {
    throw new JournalError('DATA_ERROR', `記事資料列「${entryId}」的 tags 欄位不是有效 JSON。請修正 Google Sheets 中的資料後再試。`)
  }
}

function parseLinks(value: string, entryId: string): JournalLink[] {
  try {
    const parsed = JSON.parse(value || '[]') as unknown
    if (!Array.isArray(parsed) || parsed.some((l) => !l || typeof (l as Record<string, unknown>).label !== 'string' || typeof (l as Record<string, unknown>).url !== 'string')) {
      throw new Error()
    }
    return (parsed as Array<{ label: string; url: string }>).map((l) => ({ label: l.label, url: l.url }))
  } catch {
    throw new JournalError('DATA_ERROR', `記事資料列「${entryId}」的 links 欄位不是有效 JSON。請修正 Google Sheets 中的資料後再試。`)
  }
}

function entryValues(entry: Entry): unknown[] {
  return [
    entry.id,
    entry.entryDate,
    entry.title,
    entry.content,
    entry.categoryId,
    JSON.stringify(entry.tags),
    JSON.stringify(entry.links),
    entry.createdAt,
    entry.updatedAt,
  ]
}

function categoryValues(category: Category): unknown[] {
  return [
    category.id,
    category.name,
    category.isActive,
    category.createdAt,
    category.updatedAt,
  ]
}

function cloneEntry(entry: Entry): Entry {
  return {
    ...entry,
    tags: [...entry.tags],
    links: entry.links.map((l) => ({ ...l })),
  }
}
