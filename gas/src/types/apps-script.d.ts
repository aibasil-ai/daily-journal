declare namespace GoogleAppsScript {
  namespace Properties {
    interface Properties {
      getProperty(key: string): string | null
      setProperty(key: string, value: string): Properties
    }

    interface PropertiesService {
      getScriptProperties(): Properties
    }
  }

  namespace Spreadsheet {
    interface SpreadsheetApp {
      openById(id: string): Spreadsheet
    }

    interface Spreadsheet {
      getSheetByName(name: string): Sheet | null
      insertSheet(name: string): Sheet
      getSpreadsheetTimeZone(): string
    }

    interface Sheet {
      deleteRow(rowPosition: number): void
      getLastColumn(): number
      getLastRow(): number
      getRange(row: number, column: number, numRows?: number, numColumns?: number): Range
    }

    interface Range {
      getValues(): unknown[][]
      setNumberFormat(numberFormat: string): Range
      setValues(values: unknown[][]): Range
    }
  }

  namespace Lock {
    interface Lock {
      releaseLock(): void
      waitLock(timeoutInMillis: number): void
    }

    interface LockService {
      getScriptLock(): Lock
    }
  }

  namespace Utilities {
    interface Utilities {
      formatDate(date: Date, timeZone: string, format: string): string
      getUuid(): string
    }
  }
}

declare const LockService: GoogleAppsScript.Lock.LockService
declare const PropertiesService: GoogleAppsScript.Properties.PropertiesService
declare const SpreadsheetApp: GoogleAppsScript.Spreadsheet.SpreadsheetApp
declare const Utilities: GoogleAppsScript.Utilities.Utilities

interface Console {
  error(...data: unknown[]): void
}

declare var console: Console
