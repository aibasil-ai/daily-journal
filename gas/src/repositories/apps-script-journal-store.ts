import { JournalError } from '../domain/errors'
import type { Category, Entry, EntryFilter, JournalLink } from '../domain/journal'
import type { JournalStore } from './journal-store'

export const SPREADSHEET_ID_PROPERTY = 'SPREADSHEET_ID'
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

const SCHEMA_VERSION = '1'
const WRITE_LOCK_TIMEOUT_MS = 10_000

type SheetRow = {
  rowIndex: number
  values: unknown[]
}

export type AppsScriptJournalStoreDependencies = {
  propertiesService: GoogleAppsScript.Properties.PropertiesService
  spreadsheetApp: GoogleAppsScript.Spreadsheet.SpreadsheetApp
  lockService: GoogleAppsScript.Lock.LockService
  utilities: GoogleAppsScript.Utilities.Utilities
}

/** Google Sheets 的最薄轉接層，不承擔分類、篩選或分頁規則。 */
export class AppsScriptJournalStore implements JournalStore {
  private spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet | undefined
  private writeLockDepth = 0

  constructor(
    private readonly services: AppsScriptJournalStoreDependencies = getDefaultDependencies(),
  ) {}

  ensureSchema(): void {
    this.withWriteLock(() => this.ensureSchemaWithoutLock())
  }

  /** 在同一把鎖內設定試算表並建立資料結構，避免並行初始化交錯。 */
  initializeSpreadsheet(spreadsheetId: string): void {
    const normalizedId = spreadsheetId.trim()
    if (!normalizedId) {
      throw new JournalError('VALIDATION_ERROR', '請提供 Google Sheets ID。')
    }

    this.withWriteLock(() => {
      this.services.propertiesService
        .getScriptProperties()
        .setProperty(SPREADSHEET_ID_PROPERTY, normalizedId)
      this.spreadsheet = undefined
      this.ensureSchemaWithoutLock()
    })
  }

  listCategories(): Category[] {
    return this.readRows(CATEGORY_SHEET_NAME, CATEGORY_HEADERS).map((row) => this.toCategory(row))
  }

  saveCategory(category: Category): Category {
    return this.withWriteLock(() => {
      const sheet = this.requireSheet(CATEGORY_SHEET_NAME, CATEGORY_HEADERS)
      const rowIndex = this.findRowById(sheet, category.id, CATEGORY_SHEET_NAME)
      const values: unknown[] = [
        category.id,
        category.name,
        category.isActive,
        category.createdAt,
        category.updatedAt,
      ]

      this.writeRow(sheet, rowIndex ?? sheet.getLastRow() + 1, values)
      return { ...category }
    })
  }

  listEntries(_filter?: EntryFilter): Entry[] {
    return this.readRows(ENTRY_SHEET_NAME, ENTRY_HEADERS).map((row) => this.toEntry(row))
  }

  getEntry(id: string): Entry | undefined {
    return this.listEntries().find((entry) => entry.id === id)
  }

  saveEntry(entry: Entry): Entry {
    return this.withWriteLock(() => {
      const sheet = this.requireSheet(ENTRY_SHEET_NAME, ENTRY_HEADERS)
      const rowIndex = this.findRowById(sheet, entry.id, ENTRY_SHEET_NAME)
      const values: unknown[] = [
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

      this.writeRow(sheet, rowIndex ?? sheet.getLastRow() + 1, values)
      return cloneEntry(entry)
    })
  }

  deleteEntry(id: string): void {
    this.withWriteLock(() => {
      const sheet = this.requireSheet(ENTRY_SHEET_NAME, ENTRY_HEADERS)
      const rowIndex = this.findRowById(sheet, id, ENTRY_SHEET_NAME)
      if (!rowIndex) {
        throw new JournalError('NOT_FOUND', '找不到要刪除的記事。')
      }
      sheet.deleteRow(rowIndex)
    })
  }

  getTimezone(): string {
    const timezone = this.getSpreadsheet().getSpreadsheetTimeZone().trim()
    if (!timezone) {
      throw new JournalError('CONFIGURATION_ERROR', '試算表沒有有效時區。請在 Google Sheets 的檔案設定中指定時區。')
    }
    return timezone
  }

  /** 以試算表時區產生可排序的 ISO 8601 時間字串。 */
  createTimestamp(): string {
    return this.formatTimestamp(new Date(), this.getTimezone())
  }

  createUuid(): string {
    return this.services.utilities.getUuid()
  }

  private getSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
    if (this.spreadsheet) return this.spreadsheet

    const spreadsheetId = this.services.propertiesService
      .getScriptProperties()
      .getProperty(SPREADSHEET_ID_PROPERTY)
      ?.trim()
    if (!spreadsheetId) {
      throw new JournalError(
        'CONFIGURATION_ERROR',
        '找不到 SPREADSHEET_ID。請先在 Apps Script 的 Script Properties 設定 Google Sheets ID，再執行 initializeJournal。',
      )
    }

    try {
      this.spreadsheet = this.services.spreadsheetApp.openById(spreadsheetId)
      return this.spreadsheet
    } catch (_error) {
      throw new JournalError(
        'CONFIGURATION_ERROR',
        '無法開啟指定的 Google 試算表。請確認 Google Sheets ID 與 Apps Script 的存取權限。',
      )
    }
  }

  private ensureSchemaWithoutLock(): void {
    const spreadsheet = this.getSpreadsheet()
    this.ensureSheet(spreadsheet, ENTRY_SHEET_NAME, ENTRY_HEADERS)
    this.ensureSheet(spreadsheet, CATEGORY_SHEET_NAME, CATEGORY_HEADERS)
    const settings = this.ensureSheet(spreadsheet, SETTINGS_SHEET_NAME, SETTINGS_HEADERS)
    this.ensureSchemaVersion(settings)
  }

  private ensureSheet(
    spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
    name: string,
    headers: string[],
  ): GoogleAppsScript.Spreadsheet.Sheet {
    const sheet = spreadsheet.getSheetByName(name) ?? spreadsheet.insertSheet(name)
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      return sheet
    }

    this.assertHeaders(sheet, name, headers)
    return sheet
  }

  private ensureSchemaVersion(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
    const lastRow = sheet.getLastRow()
    if (lastRow === 1) {
      this.writeRow(sheet, 2, ['schemaVersion', SCHEMA_VERSION])
      return
    }

    const settings = sheet.getRange(2, 1, lastRow - 1, SETTINGS_HEADERS.length).getValues()
    const version = settings.find((row) => String(row[0]).trim() === 'schemaVersion')?.[1]
    if (version === undefined) {
      this.writeRow(sheet, lastRow + 1, ['schemaVersion', SCHEMA_VERSION])
      return
    }
    if (String(version).trim() !== SCHEMA_VERSION) {
      throw new JournalError(
        'DATA_ERROR',
        'settings 工作表的 schemaVersion 不支援。請確認資料結構版本後再試。',
      )
    }
  }

  private requireSheet(
    name: string,
    headers: string[],
  ): GoogleAppsScript.Spreadsheet.Sheet {
    const sheet = this.getSpreadsheet().getSheetByName(name)
    if (!sheet) {
      throw new JournalError(
        'CONFIGURATION_ERROR',
        `找不到「${name}」工作表。請先執行 initializeJournal 初始化資料表。`,
      )
    }
    this.assertHeaders(sheet, name, headers)
    return sheet
  }

  private assertHeaders(
    sheet: GoogleAppsScript.Spreadsheet.Sheet,
    name: string,
    expectedHeaders: string[],
  ): void {
    const actualHeaders = sheet
      .getRange(1, 1, 1, expectedHeaders.length)
      .getValues()[0]
      .map((value) => String(value))
    const hasExpectedHeaders = actualHeaders.length === expectedHeaders.length
      && actualHeaders.every((header, index) => header === expectedHeaders[index])

    if (sheet.getLastColumn() !== expectedHeaders.length || !hasExpectedHeaders) {
      throw new JournalError(
        'DATA_ERROR',
        `資料表「${name}」欄位不符預期。請確認欄位順序為 ${expectedHeaders.join(', ')}。`,
      )
    }
  }

  private readRows(sheetName: string, headers: string[]): SheetRow[] {
    const sheet = this.requireSheet(sheetName, headers)
    const lastRow = sheet.getLastRow()
    if (lastRow <= 1) return []

    return sheet
      .getRange(2, 1, lastRow - 1, headers.length)
      .getValues()
      .map((values, index) => ({ rowIndex: index + 2, values }))
  }

  private toCategory(row: SheetRow): Category {
    const id = this.requiredText(row.values[0], '分類 ID', row.rowIndex)
    return {
      id,
      name: this.text(row.values[1]),
      isActive: this.toBoolean(row.values[2], id),
      createdAt: this.dateTimeText(row.values[3]),
      updatedAt: this.dateTimeText(row.values[4]),
    }
  }

  private toEntry(row: SheetRow): Entry {
    const id = this.requiredText(row.values[0], '記事 ID', row.rowIndex)
    return {
      id,
      entryDate: this.dateText(row.values[1]),
      title: this.text(row.values[2]),
      content: this.text(row.values[3]),
      categoryId: this.text(row.values[4]),
      tags: this.parseTags(this.text(row.values[5]), id),
      links: this.parseLinks(this.text(row.values[6]), id),
      createdAt: this.dateTimeText(row.values[7]),
      updatedAt: this.dateTimeText(row.values[8]),
    }
  }

  private parseTags(value: string, entryId: string): string[] {
    const parsed = this.parseJson(value, entryId, 'tags')
    if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== 'string')) {
      throw this.invalidJsonField(entryId, 'tags')
    }
    return [...parsed]
  }

  private parseLinks(value: string, entryId: string): JournalLink[] {
    const parsed = this.parseJson(value, entryId, 'links')
    if (
      !Array.isArray(parsed)
      || parsed.some(
        (link) => !isRecord(link) || typeof link.label !== 'string' || typeof link.url !== 'string',
      )
    ) {
      throw this.invalidJsonField(entryId, 'links')
    }
    return parsed.map((link) => ({ label: link.label, url: link.url }))
  }

  private parseJson(value: string, entryId: string, field: 'tags' | 'links'): unknown {
    try {
      return JSON.parse(value)
    } catch (_error) {
      throw this.invalidJsonField(entryId, field)
    }
  }

  private invalidJsonField(entryId: string, field: 'tags' | 'links'): JournalError {
    return new JournalError(
      'DATA_ERROR',
      `記事資料列「${entryId}」的 ${field} 欄位不是有效 JSON。請修正 Google Sheets 中的資料後再試。`,
    )
  }

  private toBoolean(value: unknown, categoryId: string): boolean {
    if (typeof value === 'boolean') return value

    const normalized = this.text(value).trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false

    throw new JournalError(
      'DATA_ERROR',
      `分類資料列「${categoryId}」的 isActive 欄位不是 true 或 false。請修正 Google Sheets 中的資料後再試。`,
    )
  }

  private requiredText(value: unknown, field: string, rowIndex: number): string {
    const text = this.text(value).trim()
    if (!text) {
      throw new JournalError(
        'DATA_ERROR',
        `第 ${rowIndex} 列缺少${field}。請修正 Google Sheets 中的資料後再試。`,
      )
    }
    return text
  }

  private text(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
    if (value instanceof Date) return this.dateTimeText(value)
    throw new JournalError('DATA_ERROR', 'Google Sheets 中有無法辨識的欄位資料。請修正後再試。')
  }

  private dateText(value: unknown): string {
    if (value instanceof Date) {
      return this.services.utilities.formatDate(value, this.getTimezone(), 'yyyy-MM-dd')
    }
    return this.text(value)
  }

  private dateTimeText(value: unknown): string {
    if (value instanceof Date) return this.formatTimestamp(value, this.getTimezone())
    return this.text(value)
  }

  private formatTimestamp(date: Date, timezone: string): string {
    const dateTime = this.services.utilities.formatDate(date, timezone, "yyyy-MM-dd'T'HH:mm:ss")
    const rawOffset = this.services.utilities.formatDate(date, timezone, 'Z')
    const offset = /^[+-]\d{4}$/.test(rawOffset)
      ? `${rawOffset.slice(0, 3)}:${rawOffset.slice(3)}`
      : rawOffset
    return `${dateTime}${offset}`
  }

  private findRowById(
    sheet: GoogleAppsScript.Spreadsheet.Sheet,
    id: string,
    sheetName: string,
  ): number | undefined {
    const lastRow = sheet.getLastRow()
    if (lastRow <= 1) return undefined

    const matchingRows = sheet
      .getRange(2, 1, lastRow - 1, 1)
      .getValues()
      .map((row, index) => ({ rowIndex: index + 2, id: String(row[0]).trim() }))
      .filter((row) => row.id === id)

    if (matchingRows.length > 1) {
      throw new JournalError(
        'DATA_ERROR',
        `資料表「${sheetName}」有重複 ID「${id}」。請修正 Google Sheets 中的資料後再試。`,
      )
    }
    return matchingRows[0]?.rowIndex
  }

  private writeRow(
    sheet: GoogleAppsScript.Spreadsheet.Sheet,
    rowIndex: number,
    values: unknown[],
  ): void {
    const range = sheet.getRange(rowIndex, 1, 1, values.length)
    range.setNumberFormat('@')
    range.setValues([values])
  }

  withWriteLock<T>(operation: () => T): T {
    if (this.writeLockDepth > 0) return operation()

    const lock = this.services.lockService.getScriptLock()
    try {
      lock.waitLock(WRITE_LOCK_TIMEOUT_MS)
    } catch (_error) {
      throw new JournalError('LOCK_TIMEOUT', '目前有其他寫入作業進行中，請稍後再試。')
    }

    try {
      this.writeLockDepth += 1
      return operation()
    } finally {
      this.writeLockDepth -= 1
      lock.releaseLock()
    }
  }
}

function cloneEntry(entry: Entry): Entry {
  return {
    ...entry,
    tags: [...entry.tags],
    links: entry.links.map((link) => ({ ...link })),
  }
}

function getDefaultDependencies(): AppsScriptJournalStoreDependencies {
  return {
    propertiesService: PropertiesService,
    spreadsheetApp: SpreadsheetApp,
    lockService: LockService,
    utilities: Utilities,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
