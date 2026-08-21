import {
  GoogleUpstreamError,
  toGoogleApiError,
} from './google-drive.js'

const SPREADSHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets'

export type GoogleSheetCell = {
  userEnteredValue?: Record<string, unknown>
  userEnteredFormat?: Record<string, unknown>
  note?: string
  dataValidation?: Record<string, unknown>
  textFormatRuns?: unknown[]
  pivotTable?: Record<string, unknown>
  dataSourceTable?: Record<string, unknown>
  dataSourceFormula?: Record<string, unknown>
  chipRuns?: unknown[]
}

export type GoogleSheetData = {
  startRow?: number
  startColumn?: number
  rowData?: Array<{
    values?: GoogleSheetCell[]
  }>
}

export type GoogleSheetProperties = {
  sheetId: number
  title: string
  sheetType?: string
  gridProperties?: GoogleGridProperties
}

export type GoogleGridProperties = {
  frozenRowCount?: number
  frozenColumnCount?: number
  hideGridlines?: boolean
  rowGroupControlAfter?: boolean
  columnGroupControlAfter?: boolean
}

export type GoogleSheetMetadata = {
  properties: GoogleSheetProperties
  data?: GoogleSheetData[]
  merges?: unknown[]
  conditionalFormats?: unknown[]
  filterViews?: unknown[]
  protectedRanges?: unknown[]
  basicFilter?: unknown
  charts?: unknown[]
  bandedRanges?: unknown[]
  developerMetadata?: unknown[]
  rowGroups?: unknown[]
  columnGroups?: unknown[]
  slicers?: unknown[]
  tables?: unknown[]
  commentAnchors?: unknown[]
}

export type SpreadsheetMetadata = {
  spreadsheetId: string
  properties: {
    title?: string
    timeZone?: string
  }
  sheets: GoogleSheetMetadata[]
  namedRanges?: unknown[]
  developerMetadata?: unknown[]
  dataSources?: unknown[]
  dataSourceSchedules?: unknown[]
}

export type GoogleValueRange = {
  range: string
  values?: unknown[][]
}

export type GetSpreadsheetOptions = {
  includeGridData?: boolean
}

/** Google Sheets v4 REST API 的最小伺服器端封裝。 */
export class GoogleSheetsClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async createSpreadsheet(accessToken: string, title: string): Promise<SpreadsheetMetadata> {
    const response = await this.request(SPREADSHEETS_URL, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ properties: { title } }),
    })
    return parseMetadata(await readRecord(response))
  }

  async getSpreadsheet(
    accessToken: string,
    spreadsheetId: string,
    options: GetSpreadsheetOptions = {},
  ): Promise<SpreadsheetMetadata> {
    const sheetFields = [
      'properties(sheetId,title,sheetType,gridProperties(frozenRowCount,frozenColumnCount,hideGridlines,rowGroupControlAfter,columnGroupControlAfter))',
      'merges',
      'conditionalFormats',
      'filterViews',
      'protectedRanges',
      'basicFilter',
      'charts',
      'bandedRanges',
      'developerMetadata',
      'rowGroups',
      'columnGroups',
      'slicers',
      'tables',
      'commentAnchors',
      ...(options.includeGridData
        ? ['data(startRow,startColumn,rowData(values(userEnteredValue,userEnteredFormat,note,dataValidation,textFormatRuns,pivotTable,dataSourceTable,dataSourceFormula,chipRuns)))']
        : []),
    ]
    const params = new URLSearchParams({
      fields: `spreadsheetId,properties(title,timeZone),namedRanges,developerMetadata,dataSources,dataSourceSchedules,sheets(${sheetFields.join(',')})`,
    })
    if (options.includeGridData) params.set('includeGridData', 'true')
    const response = await this.request(
      `${SPREADSHEETS_URL}/${encodeURIComponent(spreadsheetId)}?${params.toString()}`,
      { headers: bearerHeaders(accessToken) },
    )
    return parseMetadata(await readRecord(response))
  }

  async batchGet(
    accessToken: string,
    spreadsheetId: string,
    ranges: string[],
  ): Promise<GoogleValueRange[]> {
    if (!ranges.length) return []
    const params = new URLSearchParams({
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    })
    for (const range of ranges) params.append('ranges', range)

    const response = await this.request(
      `${SPREADSHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params.toString()}`,
      { headers: bearerHeaders(accessToken) },
    )
    const payload = await readRecord(response)
    if (payload.valueRanges !== undefined && !Array.isArray(payload.valueRanges)) {
      throw new GoogleUpstreamError()
    }
    return (payload.valueRanges ?? []).map(parseValueRange)
  }

  async batchUpdate(accessToken: string, spreadsheetId: string, requests: unknown[]): Promise<void> {
    if (!requests.length) return
    await this.request(
      `${SPREADSHEETS_URL}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify({ requests }),
      },
    )
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    let response: Response
    try {
      response = await this.fetchImpl(url, init)
    } catch {
      throw new GoogleUpstreamError()
    }
    if (!response.ok) throw toGoogleApiError(response.status)
    return response
  }
}

function bearerHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

function jsonHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

async function readRecord(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json() as unknown
    if (isRecord(value)) return value
  } catch {
    // Malformed upstream payloads are retried without revealing their content.
  }
  throw new GoogleUpstreamError()
}

function parseMetadata(value: Record<string, unknown>): SpreadsheetMetadata {
  if (typeof value.spreadsheetId !== 'string' || !value.spreadsheetId || !Array.isArray(value.sheets)) {
    throw new GoogleUpstreamError()
  }
  const properties = isRecord(value.properties) ? value.properties : {}
  const sheets = value.sheets.map((sheet) => {
    if (!isRecord(sheet) || !isRecord(sheet.properties)) throw new GoogleUpstreamError()
    const rawProperties = sheet.properties
    if (typeof rawProperties.sheetId !== 'number' || typeof rawProperties.title !== 'string') {
      throw new GoogleUpstreamError()
    }
    const gridProperties = parseGridProperties(rawProperties.gridProperties)
    if (sheet.data !== undefined && !Array.isArray(sheet.data)) throw new GoogleUpstreamError()
    const data = Array.isArray(sheet.data) ? sheet.data.map(parseSheetData) : undefined
    const merges = parseOptionalArray(sheet.merges)
    const conditionalFormats = parseOptionalArray(sheet.conditionalFormats)
    const filterViews = parseOptionalArray(sheet.filterViews)
    const protectedRanges = parseOptionalArray(sheet.protectedRanges)
    const charts = parseOptionalArray(sheet.charts)
    const bandedRanges = parseOptionalArray(sheet.bandedRanges)
    const developerMetadata = parseOptionalArray(sheet.developerMetadata)
    const rowGroups = parseOptionalArray(sheet.rowGroups)
    const columnGroups = parseOptionalArray(sheet.columnGroups)
    const slicers = parseOptionalArray(sheet.slicers)
    const tables = parseOptionalArray(sheet.tables)
    const commentAnchors = parseOptionalArray(sheet.commentAnchors)
    return {
      properties: {
        sheetId: rawProperties.sheetId,
        title: rawProperties.title,
        ...(typeof rawProperties.sheetType === 'string' ? { sheetType: rawProperties.sheetType } : {}),
        ...(gridProperties !== undefined ? { gridProperties } : {}),
      },
      ...(data ? { data } : {}),
      ...(merges !== undefined ? { merges } : {}),
      ...(conditionalFormats !== undefined ? { conditionalFormats } : {}),
      ...(filterViews !== undefined ? { filterViews } : {}),
      ...(protectedRanges !== undefined ? { protectedRanges } : {}),
      ...(sheet.basicFilter !== undefined ? { basicFilter: sheet.basicFilter } : {}),
      ...(charts !== undefined ? { charts } : {}),
      ...(bandedRanges !== undefined ? { bandedRanges } : {}),
      ...(developerMetadata !== undefined ? { developerMetadata } : {}),
      ...(rowGroups !== undefined ? { rowGroups } : {}),
      ...(columnGroups !== undefined ? { columnGroups } : {}),
      ...(slicers !== undefined ? { slicers } : {}),
      ...(tables !== undefined ? { tables } : {}),
      ...(commentAnchors !== undefined ? { commentAnchors } : {}),
    }
  })
  const namedRanges = parseOptionalArray(value.namedRanges)
  const developerMetadata = parseOptionalArray(value.developerMetadata)
  const dataSources = parseOptionalArray(value.dataSources)
  const dataSourceSchedules = parseOptionalArray(value.dataSourceSchedules)
  return {
    spreadsheetId: value.spreadsheetId,
    properties: {
      ...(typeof properties.title === 'string' ? { title: properties.title } : {}),
      ...(typeof properties.timeZone === 'string' ? { timeZone: properties.timeZone } : {}),
    },
    sheets,
    ...(namedRanges !== undefined ? { namedRanges } : {}),
    ...(developerMetadata !== undefined ? { developerMetadata } : {}),
    ...(dataSources !== undefined ? { dataSources } : {}),
    ...(dataSourceSchedules !== undefined ? { dataSourceSchedules } : {}),
  }
}

function parseSheetData(value: unknown): GoogleSheetData {
  if (!isRecord(value)) throw new GoogleUpstreamError()
  if (value.rowData !== undefined && !Array.isArray(value.rowData)) throw new GoogleUpstreamError()
  const startRow = parseGridIndex(value.startRow)
  const startColumn = parseGridIndex(value.startColumn)
  return {
    ...(startRow !== undefined ? { startRow } : {}),
    ...(startColumn !== undefined ? { startColumn } : {}),
    ...(Array.isArray(value.rowData)
      ? {
          rowData: value.rowData.map((row) => {
            if (!isRecord(row) || (row.values !== undefined && !Array.isArray(row.values))) {
              throw new GoogleUpstreamError()
            }
            return {
              ...(Array.isArray(row.values)
                ? {
                    values: row.values.map((cell) => {
                      return parseSheetCell(cell)
                    }),
                  }
                : {}),
            }
          }),
        }
      : {}),
  }
}

function parseSheetCell(value: unknown): GoogleSheetCell {
  if (!isRecord(value)) throw new GoogleUpstreamError()
  const userEnteredValue = parseOptionalRecord(value.userEnteredValue)
  const userEnteredFormat = parseOptionalRecord(value.userEnteredFormat)
  const note = parseOptionalString(value.note)
  const dataValidation = parseOptionalRecord(value.dataValidation)
  const textFormatRuns = parseOptionalArray(value.textFormatRuns)
  const pivotTable = parseOptionalRecord(value.pivotTable)
  const dataSourceTable = parseOptionalRecord(value.dataSourceTable)
  const dataSourceFormula = parseOptionalRecord(value.dataSourceFormula)
  const chipRuns = parseOptionalArray(value.chipRuns)
  return {
    ...(userEnteredValue !== undefined ? { userEnteredValue } : {}),
    ...(userEnteredFormat !== undefined ? { userEnteredFormat } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(dataValidation !== undefined ? { dataValidation } : {}),
    ...(textFormatRuns !== undefined ? { textFormatRuns } : {}),
    ...(pivotTable !== undefined ? { pivotTable } : {}),
    ...(dataSourceTable !== undefined ? { dataSourceTable } : {}),
    ...(dataSourceFormula !== undefined ? { dataSourceFormula } : {}),
    ...(chipRuns !== undefined ? { chipRuns } : {}),
  }
}

function parseOptionalArray(value: unknown): unknown[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new GoogleUpstreamError()
  return value
}

function parseOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new GoogleUpstreamError()
  return value
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new GoogleUpstreamError()
  return value
}

function parseGridIndex(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new GoogleUpstreamError()
  }
  return value
}

function parseGridProperties(value: unknown): GoogleGridProperties | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new GoogleUpstreamError()
  const frozenRowCount = parseGridIndex(value.frozenRowCount)
  const frozenColumnCount = parseGridIndex(value.frozenColumnCount)
  const hideGridlines = parseBoolean(value.hideGridlines)
  const rowGroupControlAfter = parseBoolean(value.rowGroupControlAfter)
  const columnGroupControlAfter = parseBoolean(value.columnGroupControlAfter)
  return {
    ...(frozenRowCount !== undefined ? { frozenRowCount } : {}),
    ...(frozenColumnCount !== undefined ? { frozenColumnCount } : {}),
    ...(hideGridlines !== undefined ? { hideGridlines } : {}),
    ...(rowGroupControlAfter !== undefined ? { rowGroupControlAfter } : {}),
    ...(columnGroupControlAfter !== undefined ? { columnGroupControlAfter } : {}),
  }
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new GoogleUpstreamError()
  return value
}

function parseValueRange(value: unknown): GoogleValueRange {
  if (!isRecord(value) || typeof value.range !== 'string') throw new GoogleUpstreamError()
  if (value.values !== undefined && (!Array.isArray(value.values) || value.values.some((row) => !Array.isArray(row)))) {
    throw new GoogleUpstreamError()
  }
  return {
    range: value.range,
    ...(Array.isArray(value.values) ? { values: value.values as unknown[][] } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
