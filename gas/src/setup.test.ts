// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { AppsScriptJournalStore } from './repositories/apps-script-journal-store'
import { CATEGORY_HEADERS, ENTRY_HEADERS, initializeJournal } from './setup'

describe('initializeJournal', () => {
  test('拒絕空白的 Google Sheets ID', () => {
    expect(() => initializeJournal('  ')).toThrow('請提供 Google Sheets ID。')
  })
})

describe('工作表欄位', () => {
  test('定義記事與分類的儲存欄位', () => {
    expect(ENTRY_HEADERS).toEqual(['id', 'entryDate', 'title', 'content', 'categoryId', 'tags', 'links', 'createdAt', 'updatedAt'])
    expect(CATEGORY_HEADERS).toEqual(['id', 'name', 'isActive', 'createdAt', 'updatedAt'])
  })
})

describe('AppsScriptJournalStore', () => {
  test('初始化儲存 Sheets ID，建立工作表，並以試算表時區格式化時間', () => {
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

    store.initialize('spreadsheet-id')

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
})

function createSheet(headers: string[] = []) {
  const sheet = {
    headers,
    getLastRow: () => sheet.headers.length === 0 ? 0 : 1,
    getRange: (..._args: [number, number, number, number]) => {
      void _args
      return {
      getValues: () => [sheet.headers],
      setValues: (values: unknown[][]) => { sheet.headers = values[0].map(String) },
      }
    },
  }
  return sheet
}
