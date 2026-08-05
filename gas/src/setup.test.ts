// @vitest-environment node

import { afterEach, describe, expect, test, vi } from 'vitest'
import { AppsScriptJournalStore } from './repositories/apps-script-journal-store'
import { CATEGORY_HEADERS, ENTRY_HEADERS, initializeJournal } from './setup'

afterEach(() => vi.unstubAllGlobals())

describe('initializeJournal', () => {
  test('以 Script Properties 的既有 ID 冪等初始化且不改寫屬性', () => {
    const properties = new Map([['SPREADSHEET_ID', 'spreadsheet-id']])
    const sheets = new Map<string, ReturnType<typeof createSheet>>()
    let propertyWrites = 0

    installAppsScriptGlobals(properties, sheets, () => { propertyWrites += 1 })

    expect(initializeJournal).toHaveLength(0)
    initializeJournal()
    initializeJournal()

    expect(properties.get('SPREADSHEET_ID')).toBe('spreadsheet-id')
    expect(propertyWrites).toBe(0)
    expect(sheets.get('entries')?.headers).toEqual(ENTRY_HEADERS)
    expect(sheets.get('categories')?.headers).toEqual(CATEGORY_HEADERS)
    expect(sheets.get('settings')?.headers).toEqual(['key', 'value'])
  })

  test('缺少或空白 Script Properties 時顯示部署者設定指引', () => {
    installAppsScriptGlobals(new Map([['SPREADSHEET_ID', '  ']]), new Map(), () => {})

    expect(() => initializeJournal()).toThrow(
      '找不到 SPREADSHEET_ID。請在 Apps Script「專案設定」>「指令碼屬性」新增 SPREADSHEET_ID，填入 Google Sheets ID 後再執行 initializeJournal。',
    )
  })
})

describe('工作表欄位', () => {
  test('定義記事與分類的儲存欄位', () => {
    expect(ENTRY_HEADERS).toEqual(['id', 'entryDate', 'title', 'content', 'categoryId', 'tags', 'links', 'createdAt', 'updatedAt'])
    expect(CATEGORY_HEADERS).toEqual(['id', 'name', 'isActive', 'createdAt', 'updatedAt'])
  })
})

describe('AppsScriptJournalStore', () => {
  test('以既有 Sheets ID 建立工作表，且不改寫 Script Properties', () => {
    const properties = new Map<string, string>()
    const lock = { waitLock: (timeoutInMillis: number) => lockTimeouts.push(timeoutInMillis), releaseLock: () => { releases += 1 } }
    const lockTimeouts: number[] = []
    let releases = 0
    const sheets = new Map<string, ReturnType<typeof createSheet>>()
    const store = new AppsScriptJournalStore({
      getScriptLock: () => lock,
      getScriptProperties: () => ({
        getProperty: (key) => properties.get(key) ?? null,
        setProperty: (key, value) => properties.set(key, value),
      }),
      openById: (id) => {
        expect(id).toBe('spreadsheet-id')
        return {
          getSheetByName: (name) => sheets.get(name) ?? null,
          insertSheet: (name) => {
            const sheet = createSheet()
            sheets.set(name, sheet)
            return sheet
          },
          getSpreadsheetTimeZone: () => 'Asia/Taipei',
        }
      },
      formatDate: (_date, timezone, format) => `${timezone} ${format}`,
    })

    properties.set('SPREADSHEET_ID', 'spreadsheet-id')
    store.ensureSchema()

    expect(properties.get('SPREADSHEET_ID')).toBe('spreadsheet-id')
    expect(sheets.get('entries')?.headers).toEqual(ENTRY_HEADERS)
    expect(sheets.get('categories')?.headers).toEqual(CATEGORY_HEADERS)
    expect(sheets.get('settings')?.headers).toEqual(['key', 'value'])
    expect(lockTimeouts).toEqual([10_000])
    expect(releases).toBe(1)
    expect(store.formatTimestamp(new Date('2026-08-04T00:00:00Z'))).toBe("Asia/Taipei yyyy-MM-dd'T'HH:mm:ssXXX")
  })

  test('schema 驗證失敗時仍釋放 ScriptLock', () => {
    const properties = new Map([['SPREADSHEET_ID', 'spreadsheet-id']])
    let releases = 0
    const sheet = createSheet(['錯誤欄位'])
    const store = new AppsScriptJournalStore({
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => { releases += 1 } }),
      getScriptProperties: () => ({
        getProperty: (key) => properties.get(key) ?? null,
        setProperty: (key, value) => properties.set(key, value),
      }),
      openById: () => ({
        getSheetByName: () => sheet,
        insertSheet: () => sheet,
        getSpreadsheetTimeZone: () => 'Asia/Taipei',
      }),
      formatDate: () => '',
    })

    expect(() => store.ensureSchema()).toThrow('工作表「entries」欄位不符合預期。')
    expect(releases).toBe(1)
  })

  test('交易內所有實際寫入只取得一次 ScriptLock 並保留 JSON 欄位', () => {
    const properties = new Map([['SPREADSHEET_ID', 'spreadsheet-id']])
    const lockTimeouts: number[] = []
    let releases = 0
    const sheets = new Map([
      ['entries', createSheet(ENTRY_HEADERS)],
      ['categories', createSheet(CATEGORY_HEADERS)],
      ['settings', createSheet(['key', 'value'])],
    ])
    const store = new AppsScriptJournalStore({
      getScriptLock: () => ({ waitLock: (timeoutInMillis) => lockTimeouts.push(timeoutInMillis), releaseLock: () => { releases += 1 } }),
      getScriptProperties: () => ({ getProperty: (key) => properties.get(key) ?? null, setProperty: (key, value) => properties.set(key, value) }),
      openById: () => ({ getSheetByName: (name) => sheets.get(name) ?? null, insertSheet: (name) => { const sheet = createSheet(); sheets.set(name, sheet); return sheet }, getSpreadsheetTimeZone: () => 'Asia/Taipei' }),
      formatDate: () => '',
    })

    store.withWriteLock(() => {
      store.saveCategory({ id: 'work', name: '工作', isActive: true, createdAt: '2026-08-04T09:00:00+08:00', updatedAt: '2026-08-04T09:00:00+08:00' })
      store.saveEntry({ id: 'entry-1', entryDate: '2026-08-04', title: '每日記事', content: '內容', categoryId: 'work', tags: ['工作'], links: [{ label: '文件', url: 'https://example.com' }], createdAt: '2026-08-04T09:00:00+08:00', updatedAt: '2026-08-04T09:00:00+08:00' })
      expect(store.getEntry('entry-1')).toMatchObject({ id: 'entry-1', tags: ['工作'], links: [{ label: '文件', url: 'https://example.com' }] })
      store.deleteEntry('entry-1')
    })

    expect(store.getEntry('entry-1')).toBeUndefined()
    expect(lockTimeouts).toEqual([10_000])
    expect(releases).toBe(1)
  })

  test('交易內寫入拋出錯誤時仍釋放 ScriptLock', () => {
    const properties = new Map([['SPREADSHEET_ID', 'spreadsheet-id']])
    const lockTimeouts: number[] = []
    let releases = 0
    const store = new AppsScriptJournalStore({
      getScriptLock: () => ({ waitLock: (timeoutInMillis) => lockTimeouts.push(timeoutInMillis), releaseLock: () => { releases += 1 } }),
      getScriptProperties: () => ({ getProperty: (key) => properties.get(key) ?? null, setProperty: (key, value) => properties.set(key, value) }),
      openById: () => ({ getSheetByName: () => null, insertSheet: () => { throw new Error('不應建立工作表。') }, getSpreadsheetTimeZone: () => 'Asia/Taipei' }),
      formatDate: () => '',
    })

    expect(() => store.withWriteLock(() => store.saveEntry({ id: 'entry-1', entryDate: '2026-08-04', title: '', content: '內容', categoryId: 'work', tags: [], links: [], createdAt: '', updatedAt: '' }))).toThrow('找不到工作表「entries」，請先執行 initializeJournal。')
    expect(lockTimeouts).toEqual([10_000])
    expect(releases).toBe(1)
  })

  test('讀取損壞的 JSON 欄位時回報資料列 ID', () => {
    const properties = new Map([['SPREADSHEET_ID', 'spreadsheet-id']])
    const sheets = new Map([
      ['entries', createSheet(ENTRY_HEADERS, [['entry-1', '2026-08-04', '每日記事', '內容', 'work', '{錯誤 JSON', '[]', '2026-08-04T09:00:00+08:00', '2026-08-04T09:00:00+08:00']])],
      ['categories', createSheet(CATEGORY_HEADERS)],
      ['settings', createSheet(['key', 'value'])],
    ])
    const store = new AppsScriptJournalStore({
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
      getScriptProperties: () => ({ getProperty: (key) => properties.get(key) ?? null, setProperty: () => {} }),
      openById: () => ({ getSheetByName: (name) => sheets.get(name) ?? null, insertSheet: () => { throw new Error('不應建立工作表。') }, getSpreadsheetTimeZone: () => 'Asia/Taipei' }),
      formatDate: () => '',
    })

    expect(() => store.getEntry('entry-1')).toThrow('資料列「entry-1」的標籤 JSON 格式錯誤。')
  })

  test('讀取損壞的連結 JSON 欄位時回報資料列 ID', () => {
    const properties = new Map([['SPREADSHEET_ID', 'spreadsheet-id']])
    const sheets = new Map([
      ['entries', createSheet(ENTRY_HEADERS, [['entry-1', '2026-08-04', '每日記事', '內容', 'work', '[]', '{錯誤 JSON', '2026-08-04T09:00:00+08:00', '2026-08-04T09:00:00+08:00']])],
      ['categories', createSheet(CATEGORY_HEADERS)],
      ['settings', createSheet(['key', 'value'])],
    ])
    const store = new AppsScriptJournalStore({
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
      getScriptProperties: () => ({ getProperty: (key) => properties.get(key) ?? null, setProperty: () => {} }),
      openById: () => ({ getSheetByName: (name) => sheets.get(name) ?? null, insertSheet: () => { throw new Error('不應建立工作表。') }, getSpreadsheetTimeZone: () => 'Asia/Taipei' }),
      formatDate: () => '',
    })

    expect(() => store.getEntry('entry-1')).toThrow('資料列「entry-1」的連結 JSON 格式錯誤。')
  })
})

function createSheet(headers: string[] = [], rows: unknown[][] = []) {
  const data = headers.length === 0 ? [] : [headers, ...rows]
  const sheet = {
    get headers() {
      return (data[0] ?? []).map(String)
    },
    getLastRow: () => data.length,
    getRange: (row: number, column: number, numRows: number, numColumns: number) => ({
      getValues: () => Array.from({ length: numRows }, (_unused, rowOffset) => Array.from(
        { length: numColumns },
        (_otherUnused, columnOffset) => data[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? '',
      )),
      setValues: (values: unknown[][]) => {
        values.forEach((valuesRow, rowOffset) => {
          const target = data[row - 1 + rowOffset] ?? []
          data[row - 1 + rowOffset] = target
          valuesRow.forEach((value, columnOffset) => { target[column - 1 + columnOffset] = value })
        })
      },
    }),
    deleteRow: (row: number) => { data.splice(row - 1, 1) },
  }
  return sheet
}

function installAppsScriptGlobals(
  properties: Map<string, string>,
  sheets: Map<string, ReturnType<typeof createSheet>>,
  onSetProperty: () => void,
) {
  vi.stubGlobal('LockService', {
    getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
  })
  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({
      getProperty: (key: string) => properties.get(key) ?? null,
      setProperty: () => onSetProperty(),
    }),
  })
  vi.stubGlobal('SpreadsheetApp', {
    openById: (id: string) => {
      expect(id).toBe('spreadsheet-id')
      return {
        getSheetByName: (name: string) => sheets.get(name) ?? null,
        insertSheet: (name: string) => {
          const sheet = createSheet()
          sheets.set(name, sheet)
          return sheet
        },
        getSpreadsheetTimeZone: () => 'Asia/Taipei',
      }
    },
  })
  vi.stubGlobal('Utilities', {
    formatDate: (_date: Date, timezone: string, format: string) => `${timezone} ${format}`,
  })
}
