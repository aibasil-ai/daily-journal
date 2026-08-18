import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AppsScriptJournalStore,
  CATEGORY_HEADERS,
  ENTRY_HEADERS,
  SETTINGS_HEADERS,
} from './repositories/apps-script-journal-store'
import { initializeJournal } from './setup'

describe('initializeJournal', () => {
  let environment: MockAppsScriptEnvironment

  beforeEach(() => {
    environment = installAppsScriptMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('將試算表 ID 存進 Script Properties 並建立完整資料表結構', () => {
    initializeJournal('  spreadsheet-id  ')

    expect(environment.properties.get('SPREADSHEET_ID')).toBe('spreadsheet-id')
    expect(environment.spreadsheet.getSheet('entries')?.values).toEqual([ENTRY_HEADERS])
    expect(environment.spreadsheet.getSheet('categories')?.values).toEqual([CATEGORY_HEADERS])
    expect(environment.spreadsheet.getSheet('settings')?.values).toEqual([
      SETTINGS_HEADERS,
      ['schemaVersion', '1'],
    ])
    expect(environment.waitLock).toHaveBeenCalledWith(10_000)
    expect(environment.releaseLock).toHaveBeenCalledTimes(1)
  })

  it('拒絕空白 Google Sheets ID', () => {
    expect(() => initializeJournal('   ')).toThrow('請提供 Google Sheets ID。')
  })

  it('讀取壞掉的 JSON 欄位時保留記事 ID 並明確失敗', () => {
    initializeJournal('spreadsheet-id')
    environment.spreadsheet.getSheet('entries')?.values.push([
      'entry-1',
      '2026-08-04',
      '',
      '內容',
      'work',
      '{not-json',
      '[]',
      '2026-08-04T12:00:00+08:00',
      '2026-08-04T12:00:00+08:00',
    ])

    expect(() => new AppsScriptJournalStore().listEntries()).toThrow(
      '記事資料列「entry-1」的 tags 欄位不是有效 JSON。',
    )
  })

  it('所有工作表寫入均取得並釋放 Script Lock', () => {
    initializeJournal('spreadsheet-id')
    environment.waitLock.mockClear()
    environment.releaseLock.mockClear()

    new AppsScriptJournalStore().saveCategory({
      id: 'work',
      name: '工作',
      isActive: true,
      createdAt: '2026-08-04T12:00:00+08:00',
      updatedAt: '2026-08-04T12:00:00+08:00',
    })

    expect(environment.waitLock).toHaveBeenCalledWith(10_000)
    expect(environment.releaseLock).toHaveBeenCalledTimes(1)
  })

  it('可批次更新記事資料列並永久刪除指定類別資料列', () => {
    initializeJournal('spreadsheet-id')
    const store = new AppsScriptJournalStore()
    const createdAt = '2026-08-04T12:00:00+08:00'
    const updatedAt = '2026-08-18T10:00:00+08:00'
    store.saveCategory({ id: 'work', name: '工作', isActive: true, createdAt, updatedAt: createdAt })
    store.saveCategory({ id: 'life', name: '生活', isActive: true, createdAt, updatedAt: createdAt })
    store.saveEntry({
      id: 'entry-1', entryDate: '2026-08-04', title: '', content: '第一則', categoryId: 'work',
      tags: [], links: [], createdAt, updatedAt: createdAt,
    })
    store.saveEntry({
      id: 'entry-2', entryDate: '2026-08-05', title: '', content: '第二則', categoryId: 'work',
      tags: [], links: [], createdAt, updatedAt: createdAt,
    })

    store.saveEntries([
      {
        id: 'entry-1', entryDate: '2026-08-04', title: '', content: '第一則', categoryId: 'life',
        tags: [], links: [], createdAt, updatedAt,
      },
      {
        id: 'entry-2', entryDate: '2026-08-05', title: '', content: '第二則', categoryId: 'life',
        tags: [], links: [], createdAt, updatedAt,
      },
    ])
    store.deleteCategory('work')

    expect(environment.spreadsheet.getSheet('entries')?.values.slice(1)).toEqual([
      ['entry-1', '2026-08-04', '', '第一則', 'life', '[]', '[]', createdAt, updatedAt],
      ['entry-2', '2026-08-05', '', '第二則', 'life', '[]', '[]', createdAt, updatedAt],
    ])
    expect(environment.spreadsheet.getSheet('categories')?.values).toEqual([
      CATEGORY_HEADERS,
      ['life', '生活', true, createdAt, createdAt],
    ])
  })
})

type MockAppsScriptEnvironment = {
  properties: Map<string, string>
  spreadsheet: MemorySpreadsheet
  waitLock: ReturnType<typeof vi.fn>
  releaseLock: ReturnType<typeof vi.fn>
}

function installAppsScriptMocks(): MockAppsScriptEnvironment {
  const properties = new Map<string, string>()
  const spreadsheet = new MemorySpreadsheet()
  const waitLock = vi.fn()
  const releaseLock = vi.fn()

  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({
      getProperty: (key: string) => properties.get(key) ?? null,
      setProperty: (key: string, value: string) => {
        properties.set(key, value)
        return undefined
      },
    }),
  })
  vi.stubGlobal('SpreadsheetApp', {
    openById: (id: string) => {
      if (id !== 'spreadsheet-id') throw new Error('missing spreadsheet')
      return spreadsheet
    },
  })
  vi.stubGlobal('LockService', {
    getScriptLock: () => ({ waitLock, releaseLock }),
  })
  vi.stubGlobal('Utilities', {
    formatDate: () => '2026-08-04T12:00:00',
    getUuid: () => 'generated-id',
  })

  return { properties, spreadsheet, waitLock, releaseLock }
}

class MemorySpreadsheet {
  private readonly sheets = new Map<string, MemorySheet>()

  getSheetByName(name: string): MemorySheet | null {
    return this.sheets.get(name) ?? null
  }

  insertSheet(name: string): MemorySheet {
    const sheet = new MemorySheet()
    this.sheets.set(name, sheet)
    return sheet
  }

  getSpreadsheetTimeZone(): string {
    return 'Asia/Taipei'
  }

  getSheet(name: string): MemorySheet | undefined {
    return this.sheets.get(name)
  }
}

class MemorySheet {
  readonly values: unknown[][] = []

  deleteRow(rowPosition: number): void {
    this.values.splice(rowPosition - 1, 1)
  }

  getLastColumn(): number {
    return this.values.reduce((maximum, row) => Math.max(maximum, row.length), 0)
  }

  getLastRow(): number {
    return this.values.length
  }

  getRange(row: number, column: number, numRows = 1, numColumns = 1): {
    getValues(): unknown[][]
    setNumberFormat(_numberFormat: string): unknown
    setValues(values: unknown[][]): unknown
  } {
    const range = {
      getValues: () => Array.from({ length: numRows }, (_, rowOffset) => Array.from(
        { length: numColumns },
        (_, columnOffset) => this.values[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? '',
      )),
      setNumberFormat: (_numberFormat: string) => range,
      setValues: (newValues: unknown[][]) => {
        for (let rowOffset = 0; rowOffset < numRows; rowOffset += 1) {
          const targetRow = row - 1 + rowOffset
          if (!this.values[targetRow]) this.values[targetRow] = []
          for (let columnOffset = 0; columnOffset < numColumns; columnOffset += 1) {
            this.values[targetRow][column - 1 + columnOffset] = newValues[rowOffset][columnOffset]
          }
        }
        return range
      },
    }
    return range
  }
}
