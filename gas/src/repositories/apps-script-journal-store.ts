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
  deleteRow(rowPosition: number): void
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
    this.withScriptLock(() => this.saveRow(this.getRequiredSheet('categories'), CATEGORY_HEADERS, category.id, [
      category.id, category.name, category.isActive, category.createdAt, category.updatedAt,
    ]))
    return category
  }

  listEntries(filter: EntryFilter): Entry[] {
    void filter
    const sheet = this.getRequiredSheet('entries')
    if (sheet.getLastRow() <= 1) return []

    return sheet.getRange(2, 1, sheet.getLastRow() - 1, ENTRY_HEADERS.length).getValues()
      .map((row) => this.entryFromRow(row))
  }

  getEntry(id: string): Entry | undefined {
    return this.listEntries({ query: '', from: null, to: null, categoryId: null, tag: null, cursor: null, limit: 0 })
      .find((entry) => entry.id === id)
  }

  saveEntry(entry: Entry): Entry {
    this.withScriptLock(() => this.saveRow(this.getRequiredSheet('entries'), ENTRY_HEADERS, entry.id, [
      entry.id, entry.entryDate, entry.title, entry.content, entry.categoryId,
      JSON.stringify(entry.tags), JSON.stringify(entry.links), entry.createdAt, entry.updatedAt,
    ]))
    return entry
  }

  deleteEntry(id: string): void {
    this.withScriptLock(() => {
      const sheet = this.getRequiredSheet('entries')
      const row = this.findRow(sheet, id)
      if (row) sheet.deleteRow(row)
    })
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

  private saveRow(sheet: Sheet, headers: string[], id: string, values: unknown[]): void {
    const row = this.findRow(sheet, id) ?? sheet.getLastRow() + 1
    sheet.getRange(row, 1, 1, headers.length).setValues([values])
  }

  private findRow(sheet: Sheet, id: string): number | undefined {
    if (sheet.getLastRow() <= 1) return undefined
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
    const index = ids.findIndex(([current]) => String(current) === id)
    return index === -1 ? undefined : index + 2
  }

  private entryFromRow(row: unknown[]): Entry {
    const [id, entryDate, title, content, categoryId, tags, links, createdAt, updatedAt] = row
    const rowId = String(id)
    return {
      id: rowId,
      entryDate: String(entryDate),
      title: String(title),
      content: String(content),
      categoryId: String(categoryId),
      tags: this.parseTags(tags, rowId),
      links: this.parseLinks(links, rowId),
      createdAt: String(createdAt),
      updatedAt: String(updatedAt),
    }
  }

  private parseTags(value: unknown, rowId: string): string[] {
    try {
      const tags: unknown = JSON.parse(String(value))
      if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) throw new Error()
      return tags
    } catch {
      throw new Error(`資料列「${rowId}」的標籤 JSON 格式錯誤。`)
    }
  }

  private parseLinks(value: unknown, rowId: string): Entry['links'] {
    try {
      const links: unknown = JSON.parse(String(value))
      if (!Array.isArray(links) || !links.every((link) => this.isJournalLink(link))) throw new Error()
      return links
    } catch {
      throw new Error(`資料列「${rowId}」的連結 JSON 格式錯誤。`)
    }
  }

  private isJournalLink(value: unknown): value is Entry['links'][number] {
    return typeof value === 'object' && value !== null
      && typeof (value as { label?: unknown }).label === 'string'
      && typeof (value as { url?: unknown }).url === 'string'
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
