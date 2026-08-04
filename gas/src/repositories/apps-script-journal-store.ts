import type { Category, Entry, EntryFilter } from '../domain/journal'
import type { JournalStore } from './journal-store'

type ScriptLock = {
  waitLock(timeoutInMillis: number): void
  releaseLock(): void
}

type SheetRange = {
  getValues(): unknown[][]
  setValues(values: unknown[][]): void
}

type Sheet = {
  getLastRow(): number
  getRange(row: number, column: number, numRows: number, numColumns: number): SheetRange
}

type Spreadsheet = {
  getSheetByName(name: string): Sheet | null
  insertSheet(name: string): Sheet
  getSpreadsheetTimeZone(): string
}

declare const LockService: {
  getScriptLock(): ScriptLock
}

declare const PropertiesService: {
  getScriptProperties(): {
    getProperty(key: string): string | null
    setProperty(key: string, value: string): void
  }
}

declare const SpreadsheetApp: {
  openById(id: string): Spreadsheet
}

declare const Utilities: {
  formatDate(date: Date, timeZone: string, format: string): string
}

export type AppsScriptJournalStoreApi = {
  getScriptLock(): ScriptLock
  getScriptProperties(): {
    getProperty(key: string): string | null
    setProperty(key: string, value: string): void
  }
  openById(id: string): Spreadsheet
  formatDate(date: Date, timeZone: string, format: string): string
}

const appsScriptApi: AppsScriptJournalStoreApi = {
  getScriptLock: () => LockService.getScriptLock(),
  getScriptProperties: () => PropertiesService.getScriptProperties(),
  openById: (id) => SpreadsheetApp.openById(id),
  formatDate: (date, timeZone, format) => Utilities.formatDate(date, timeZone, format),
}

export const ENTRY_HEADERS = ['id', 'entryDate', 'title', 'content', 'categoryId', 'tags', 'links', 'createdAt', 'updatedAt']
export const CATEGORY_HEADERS = ['id', 'name', 'isActive', 'createdAt', 'updatedAt']
export const SETTINGS_HEADERS = ['key', 'value']

export class AppsScriptJournalStore implements JournalStore {
  constructor(private readonly api: AppsScriptJournalStoreApi = appsScriptApi) {}

  initialize(spreadsheetId: string): void {
    this.withScriptLock(() => {
      this.api.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheetId)
      this.ensureSchemaUnlocked()
    })
  }

  ensureSchema(): void {
    this.withScriptLock(() => this.ensureSchemaUnlocked())
  }

  listCategories(): Category[] {
    const sheet = this.getRequiredSheet('categories')
    if (sheet.getLastRow() <= 1) return []

    return sheet.getRange(2, 1, sheet.getLastRow() - 1, CATEGORY_HEADERS.length).getValues()
      .map(([id, name, isActive, createdAt, updatedAt]) => ({
        id: String(id),
        name: String(name),
        isActive: isActive === true || isActive === 'true',
        createdAt: String(createdAt),
        updatedAt: String(updatedAt),
      }))
  }

  saveCategory(category: Category): Category {
    void category
    throw new Error('分類儲存功能尚未完成。')
  }

  listEntries(filter: EntryFilter): Entry[] {
    void filter
    throw new Error('記事查詢功能尚未完成。')
  }

  saveEntry(entry: Entry): Entry {
    void entry
    throw new Error('記事儲存功能尚未完成。')
  }

  deleteEntry(id: string): void {
    void id
    throw new Error('記事刪除功能尚未完成。')
  }

  getTimezone(): string {
    return this.getSpreadsheet().getSpreadsheetTimeZone()
  }

  formatTimestamp(date: Date): string {
    return this.api.formatDate(date, this.getTimezone(), "yyyy-MM-dd'T'HH:mm:ssXXX")
  }

  private ensureSchemaUnlocked(): void {
    const spreadsheet = this.getSpreadsheet()
    this.ensureSheet(spreadsheet, 'entries', ENTRY_HEADERS)
    this.ensureSheet(spreadsheet, 'categories', CATEGORY_HEADERS)
    this.ensureSheet(spreadsheet, 'settings', SETTINGS_HEADERS)
  }

  private ensureSheet(spreadsheet: Spreadsheet, name: string, headers: string[]): void {
    const sheet = spreadsheet.getSheetByName(name) ?? spreadsheet.insertSheet(name)
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      return
    }

    const actualHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0].map(String)
    if (actualHeaders.join('\u0000') !== headers.join('\u0000')) {
      throw new Error(`工作表「${name}」欄位不符合預期。`)
    }
  }

  private getRequiredSheet(name: string): Sheet {
    const sheet = this.getSpreadsheet().getSheetByName(name)
    if (!sheet) throw new Error(`找不到工作表「${name}」，請先執行 initializeJournal。`)
    return sheet
  }

  private getSpreadsheet(): Spreadsheet {
    const spreadsheetId = this.api.getScriptProperties().getProperty('SPREADSHEET_ID')
    if (!spreadsheetId) throw new Error('找不到 SPREADSHEET_ID，請先執行 initializeJournal。')
    return this.api.openById(spreadsheetId)
  }

  private withScriptLock<T>(operation: () => T): T {
    const lock = this.api.getScriptLock()
    lock.waitLock(10_000)
    try {
      return operation()
    } finally {
      lock.releaseLock()
    }
  }
}
