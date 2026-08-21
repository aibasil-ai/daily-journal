import { randomUUID } from 'node:crypto'
import {
  executeJournalRequest,
  isJournalMutation,
} from '../../shared/journal/dispatcher.js'
import { JournalError } from '../../shared/journal/errors.js'
import { InMemoryJournalStore } from '../../shared/journal/in-memory-store.js'
import { JournalService } from '../../shared/journal/service.js'
import type { JournalStore } from '../../shared/journal/store.js'
import type {
  ApiResponse,
  Category,
  Entry,
  EntryFilter,
  JournalLink,
} from '../../shared/journal/types.js'
import type {
  GoogleSheetCell,
  GoogleSheetsClient,
  GoogleValueRange,
  SpreadsheetMetadata,
} from './google-sheets.js'
import { formatZonedTimestamp } from './zoned-time.js'

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

const REQUIRED_SHEET_NAMES = [ENTRY_SHEET_NAME, CATEGORY_SHEET_NAME, SETTINGS_SHEET_NAME] as const
const SUPPORTED_COLUMN_COUNTS: Record<(typeof REQUIRED_SHEET_NAMES)[number], number> = {
  [ENTRY_SHEET_NAME]: ENTRY_HEADERS.length,
  [CATEGORY_SHEET_NAME]: CATEGORY_HEADERS.length,
  [SETTINGS_SHEET_NAME]: SETTINGS_HEADERS.length,
}

export type SheetsJournalStoreOptions = {
  client: GoogleSheetsClient
  accessToken: string
  spreadsheetId: string
  now?: () => Date
  uuid?: () => string
}

export type CreateSheetsJournalStoreOptions = Omit<SheetsJournalStoreOptions, 'spreadsheetId'> & {
  title?: string
}

type JournalSnapshot = {
  entries: Entry[]
  categories: Category[]
  timezone: string
}

type Row<T> = {
  rowIndex: number
  item: T
}

type SheetRows<T> = {
  rows: Row<T>[]
  lastOccupiedRow: number
}

type LoadedRows = {
  entries: SheetRows<Entry>
  categories: SheetRows<Category>
}

type ValidatedSchema = {
  timezone: string
  sheetIds: Record<(typeof REQUIRED_SHEET_NAMES)[number], number>
}

type Changes<T> = {
  updates: Row<T>[]
  inserts: T[]
  deletes: number[]
}

/**
 * 將 Google Sheets 的資料列映射到共用 JournalStore，並只在狀態有差異時批次寫回。
 */
export class SheetsJournalStore implements JournalStore {
  private constructor(
    private readonly client: GoogleSheetsClient,
    private readonly accessToken: string,
    readonly spreadsheetId: string,
    private readonly journal: InMemoryJournalStore,
    private original: JournalSnapshot,
    private readonly now: () => Date,
    private readonly uuid: () => string,
  ) {}

  static async create(options: CreateSheetsJournalStoreOptions): Promise<SheetsJournalStore> {
    const title = options.title?.trim() || '每日記事'
    const created = await options.client.createSpreadsheet(options.accessToken, title)
    const spreadsheetId = created.spreadsheetId
    await SheetsJournalStore.initialize({
      ...options,
      spreadsheetId,
    })

    const journal = new InMemoryJournalStore({
      timezone: created.properties.timeZone?.trim() || 'UTC',
    })
    return new SheetsJournalStore(
      options.client,
      options.accessToken,
      spreadsheetId,
      journal,
      cloneSnapshot(journal.snapshot()),
      options.now ?? (() => new Date()),
      options.uuid ?? randomUUID,
    )
  }

  /** 只會初始化完全空白的試算表；非空且不相容的資料絕不覆寫。 */
  static async initialize(
    options: Pick<SheetsJournalStoreOptions, 'client' | 'accessToken' | 'spreadsheetId'>,
  ): Promise<void> {
    const metadata = await options.client.getSpreadsheet(
      options.accessToken,
      options.spreadsheetId,
      { includeGridData: true },
    )
    validateMetadataSafety(metadata)
    const required = findRequiredSheets(metadata)

    if (required) {
      try {
        await validateSchema(options.client, options.accessToken, options.spreadsheetId, metadata)
      } catch (error) {
        if (!(error instanceof JournalError) || !isSpreadsheetBlank(metadata)) throw error
        const requests = buildInitializationRequests(metadata)
        await options.client.batchUpdate(options.accessToken, options.spreadsheetId, requests)
        return
      }
      // 已有 schema 的資料表不可只驗證 headers；先完整唯讀解析所有資料列才可啟用。
      await readRows(options.client, options.accessToken, options.spreadsheetId)
      return
    } else if (!isSpreadsheetBlank(metadata)) {
      throw schemaMismatch('Google Sheet 非空且缺少必要工作表，無法安全初始化。')
    }

    const requests = buildInitializationRequests(metadata)
    await options.client.batchUpdate(options.accessToken, options.spreadsheetId, requests)
  }

  static async verifySchema(
    options: Pick<SheetsJournalStoreOptions, 'client' | 'accessToken' | 'spreadsheetId'>,
  ): Promise<void> {
    await validateSchema(options.client, options.accessToken, options.spreadsheetId)
  }

  static async load(options: SheetsJournalStoreOptions): Promise<SheetsJournalStore> {
    const schema = await validateSchema(options.client, options.accessToken, options.spreadsheetId)
    const rows = await readRows(options.client, options.accessToken, options.spreadsheetId)
    const journal = new InMemoryJournalStore({
      timezone: schema.timezone,
      entries: rows.entries.rows.map(({ item }) => item),
      categories: rows.categories.rows.map(({ item }) => item),
    })
    return new SheetsJournalStore(
      options.client,
      options.accessToken,
      options.spreadsheetId,
      journal,
      cloneSnapshot(journal.snapshot()),
      options.now ?? (() => new Date()),
      options.uuid ?? randomUUID,
    )
  }

  /** 供需要領域儲存庫實體的伺服器端整合使用的安全快照。 */
  toInMemoryStore(): InMemoryJournalStore {
    return new InMemoryJournalStore(cloneSnapshot(this.journal.snapshot()))
  }

  async execute(request: unknown): Promise<ApiResponse<unknown>> {
    const before = cloneSnapshot(this.journal.snapshot())
    const service = new JournalService(
      this,
      () => formatZonedTimestamp(this.now(), this.getTimezone()),
      this.uuid,
    )
    const response = executeJournalRequest(request, service)
    if (response.ok && isJournalMutation(request) && !snapshotsEqual(before, this.journal.snapshot())) {
      await this.flush()
    }
    return response
  }

  /** 將自上次載入或成功寫入後的變更，以單一 spreadsheets.batchUpdate 寫回。 */
  async flush(): Promise<void> {
    const desired = this.journal.snapshot()
    if (snapshotsEqual(this.original, desired)) return

    // 寫入前重新驗證所有工作表與 schema，避免在不相容資料上進行任何變更。
    const schema = await validateSchema(this.client, this.accessToken, this.spreadsheetId)
    const current = await readRows(this.client, this.accessToken, this.spreadsheetId)
    const requests = buildWriteRequests(schema, current, this.original, desired)
    if (!requests.length) {
      this.original = cloneSnapshot(desired)
      return
    }

    await this.client.batchUpdate(this.accessToken, this.spreadsheetId, requests)
    this.original = cloneSnapshot(desired)
  }

  withWriteLock<T>(operation: () => T): T {
    return this.journal.withWriteLock(operation)
  }

  listCategories(): Category[] {
    return this.journal.listCategories()
  }

  saveCategory(category: Category): Category {
    return this.journal.saveCategory(category)
  }

  listEntries(filter?: EntryFilter): Entry[] {
    return this.journal.listEntries(filter)
  }

  getEntry(id: string): Entry | undefined {
    return this.journal.getEntry(id)
  }

  saveEntry(entry: Entry): Entry {
    return this.journal.saveEntry(entry)
  }

  saveEntries(entries: Entry[]): Entry[] {
    return this.journal.saveEntries(entries)
  }

  deleteEntry(id: string): void {
    this.journal.deleteEntry(id)
  }

  deleteCategory(id: string): void {
    this.journal.deleteCategory(id)
  }

  getTimezone(): string {
    return this.journal.getTimezone()
  }
}

async function validateSchema(
  client: GoogleSheetsClient,
  accessToken: string,
  spreadsheetId: string,
  existingMetadata?: SpreadsheetMetadata,
): Promise<ValidatedSchema> {
  const metadata = existingMetadata ?? await client.getSpreadsheet(
    accessToken,
    spreadsheetId,
    { includeGridData: true },
  )
  validateMetadataSafety(metadata)
  const required = findRequiredSheets(metadata)
  if (!required) throw schemaMismatch('Google Sheet 缺少必要工作表。')

  const ranges = await client.batchGet(accessToken, spreadsheetId, [
    `${ENTRY_SHEET_NAME}!1:1`,
    `${CATEGORY_SHEET_NAME}!1:1`,
    `${SETTINGS_SHEET_NAME}!1:1`,
    `${SETTINGS_SHEET_NAME}!A:B`,
  ])
  const entryHeaders = ranges[0]?.values?.[0] ?? []
  const categoryHeaders = ranges[1]?.values?.[0] ?? []
  const settingsHeaders = ranges[2]?.values?.[0] ?? []
  const settingsRows = ranges[3]?.values ?? []

  if (!headersMatch(entryHeaders, ENTRY_HEADERS)) {
    throw schemaMismatch('Google Sheet entries 工作表欄位不符預期。')
  }
  if (!headersMatch(categoryHeaders, CATEGORY_HEADERS)) {
    throw schemaMismatch('Google Sheet categories 工作表欄位不符預期。')
  }
  if (!headersMatch(settingsHeaders, SETTINGS_HEADERS)) {
    throw schemaMismatch('Google Sheet settings 工作表欄位不符預期。')
  }

  const versionRows = settingsRows.slice(1).filter((row) => text(row[0]).trim() === 'schemaVersion')
  if (versionRows.length !== 1 || text(versionRows[0][1]).trim() !== SCHEMA_VERSION) {
    throw schemaMismatch('Google Sheet settings 的 schemaVersion 不支援。')
  }

  return {
    timezone: metadata.properties.timeZone?.trim() || 'UTC',
    sheetIds: required,
  }
}

async function readRows(
  client: GoogleSheetsClient,
  accessToken: string,
  spreadsheetId: string,
): Promise<LoadedRows> {
  const ranges = await client.batchGet(accessToken, spreadsheetId, [
    `${ENTRY_SHEET_NAME}!A2:I`,
    `${CATEGORY_SHEET_NAME}!A2:E`,
  ])
  return {
    entries: parseSheetRows(ranges[0], toEntry),
    categories: parseSheetRows(ranges[1], toCategory),
  }
}

function findRequiredSheets(
  metadata: SpreadsheetMetadata,
): Record<(typeof REQUIRED_SHEET_NAMES)[number], number> | undefined {
  const result = {} as Record<(typeof REQUIRED_SHEET_NAMES)[number], number>
  for (const name of REQUIRED_SHEET_NAMES) {
    const matches = metadata.sheets.filter((sheet) => sheet.properties.title === name)
    if (
      matches.length !== 1
      || (matches[0].properties.sheetType !== undefined && matches[0].properties.sheetType !== 'GRID')
    ) {
      return undefined
    }
    result[name] = matches[0].properties.sheetId
  }
  return result
}

function validateMetadataSafety(metadata: SpreadsheetMetadata): void {
  if (hasUnsupportedSheetStructure(metadata)) {
    throw schemaMismatch('Google Sheet 包含不支援的工作表結構。')
  }
  if (hasUnsupportedRequiredSheetData(metadata)) {
    throw schemaMismatch('Google Sheet 的必要工作表包含支援欄位外的資料。')
  }
  if (hasNonBlankExtraSheet(metadata)) {
    throw schemaMismatch('Google Sheet 包含不相容的非空工作表。')
  }
}

function hasUnsupportedSheetStructure(metadata: SpreadsheetMetadata): boolean {
  if (hasItems(metadata.namedRanges)
    || hasItems(metadata.developerMetadata)
    || hasItems(metadata.dataSources)
    || hasItems(metadata.dataSourceSchedules)) {
    return true
  }
  return metadata.sheets.some((sheet) => (
    (sheet.properties.sheetType !== undefined && sheet.properties.sheetType !== 'GRID')
    || hasUnsupportedGridProperties(sheet.properties.gridProperties)
    || hasItems(sheet.merges)
    || hasItems(sheet.conditionalFormats)
    || hasItems(sheet.filterViews)
    || hasItems(sheet.protectedRanges)
    || sheet.basicFilter !== undefined
    || hasItems(sheet.charts)
    || hasItems(sheet.bandedRanges)
    || hasItems(sheet.developerMetadata)
    || hasItems(sheet.rowGroups)
    || hasItems(sheet.columnGroups)
    || hasItems(sheet.slicers)
    || hasItems(sheet.tables)
    || hasItems(sheet.commentAnchors)
  ))
}

function hasUnsupportedRequiredSheetData(metadata: SpreadsheetMetadata): boolean {
  return metadata.sheets.some((sheet) => {
    const title = sheet.properties.title as (typeof REQUIRED_SHEET_NAMES)[number]
    const columnCount = SUPPORTED_COLUMN_COUNTS[title]
    if (columnCount === undefined) return false
    return sheet.data?.some((grid) => grid.rowData?.some((row) => (
      row.values?.some((cell, index) => (
        hasUnsupportedCellStructure(cell)
        || (index + (grid.startColumn ?? 0) >= columnCount && !isBlankCell(cell))
      )) ?? false
    )) ?? false) ?? false
  })
}

function hasUnsupportedGridProperties(
  gridProperties: SpreadsheetMetadata['sheets'][number]['properties']['gridProperties'],
): boolean {
  return (gridProperties?.frozenRowCount ?? 0) > 0
    || (gridProperties?.frozenColumnCount ?? 0) > 0
    || gridProperties?.hideGridlines === true
    || gridProperties?.rowGroupControlAfter === true
    || gridProperties?.columnGroupControlAfter === true
}

function hasUnsupportedCellStructure(cell: GoogleSheetCell): boolean {
  return hasFormulaUserEnteredValue(cell.userEnteredValue)
    || hasItems(cell.textFormatRuns)
    || cell.pivotTable !== undefined
    || cell.dataSourceTable !== undefined
    || cell.dataSourceFormula !== undefined
    || hasItems(cell.chipRuns)
}

function hasFormulaUserEnteredValue(value: GoogleSheetCell['userEnteredValue']): boolean {
  return value !== undefined && Object.keys(value).some((field) => field.toLowerCase().includes('formula'))
}

function hasNonBlankExtraSheet(metadata: SpreadsheetMetadata): boolean {
  return metadata.sheets.some((sheet) => (
    !REQUIRED_SHEET_NAMES.includes(sheet.properties.title as (typeof REQUIRED_SHEET_NAMES)[number])
    && !isSheetBlank(sheet)
  ))
}

function hasItems(values: unknown[] | undefined): boolean {
  return values !== undefined && values.length > 0
}

function buildInitializationRequests(metadata: SpreadsheetMetadata): unknown[] {
  const existingIds = new Set(metadata.sheets.map((sheet) => sheet.properties.sheetId))
  let nextSheetId = Math.max(-1, ...existingIds) + 1
  const sheetIds = new Map(metadata.sheets.map((sheet) => [sheet.properties.title, sheet.properties.sheetId]))
  const requests: unknown[] = []

  for (const name of REQUIRED_SHEET_NAMES) {
    if (sheetIds.has(name)) continue
    while (existingIds.has(nextSheetId)) nextSheetId += 1
    sheetIds.set(name, nextSheetId)
    existingIds.add(nextSheetId)
    requests.push({ addSheet: { properties: { sheetId: nextSheetId, title: name } } })
    nextSheetId += 1
  }

  requests.push(
    updateCellsRequest(sheetIds.get(ENTRY_SHEET_NAME)!, 0, [ENTRY_HEADERS]),
    updateCellsRequest(sheetIds.get(CATEGORY_SHEET_NAME)!, 0, [CATEGORY_HEADERS]),
    updateCellsRequest(sheetIds.get(SETTINGS_SHEET_NAME)!, 0, [
      SETTINGS_HEADERS,
      ['schemaVersion', SCHEMA_VERSION],
    ]),
  )
  return requests
}

function isSpreadsheetBlank(metadata: SpreadsheetMetadata): boolean {
  return metadata.sheets.every(isSheetBlank)
}

function isSheetBlank(sheet: SpreadsheetMetadata['sheets'][number]): boolean {
  return sheet.data?.every((grid) => (
    grid.rowData?.every((row) => row.values?.every(isBlankCell) ?? true) ?? true
  )) ?? true
}

function isBlankCell(cell: GoogleSheetCell): boolean {
  return cell.userEnteredValue === undefined
    && cell.userEnteredFormat === undefined
    && cell.note === undefined
    && cell.dataValidation === undefined
    && !hasUnsupportedCellStructure(cell)
}

function parseSheetRows<T extends { id: string }>(
  range: GoogleValueRange | undefined,
  parser: (values: unknown[], rowIndex: number) => T,
): SheetRows<T> {
  const values = range?.values ?? []
  const rows: Row<T>[] = []
  let lastOccupiedRow = 1

  for (const [index, row] of values.entries()) {
    const rowIndex = index + 2
    if (hasCellValue(row)) lastOccupiedRow = rowIndex
    if (!hasCellValue(row)) continue
    rows.push({ rowIndex, item: parser(row, rowIndex) })
  }
  assertUniqueIds(rows)
  return { rows, lastOccupiedRow }
}

function toCategory(values: unknown[], rowIndex: number): Category {
  const id = requiredText(values[0], '分類 ID', rowIndex)
  return {
    id,
    name: text(values[1]),
    isActive: parseBoolean(values[2], rowIndex),
    createdAt: text(values[3]),
    updatedAt: text(values[4]),
  }
}

function toEntry(values: unknown[], rowIndex: number): Entry {
  const id = requiredText(values[0], '記事 ID', rowIndex)
  return {
    id,
    entryDate: text(values[1]),
    title: text(values[2]),
    content: text(values[3]),
    categoryId: text(values[4]),
    tags: parseTags(text(values[5]), rowIndex),
    links: parseLinks(text(values[6]), rowIndex),
    createdAt: text(values[7]),
    updatedAt: text(values[8]),
  }
}

function parseTags(value: string, rowIndex: number): string[] {
  const parsed = parseJson(value, 'tags', rowIndex)
  if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== 'string')) {
    throw dataError(`第 ${rowIndex} 列的 tags 欄位不是有效 JSON。`)
  }
  return [...parsed]
}

function parseLinks(value: string, rowIndex: number): JournalLink[] {
  const parsed = parseJson(value, 'links', rowIndex)
  if (
    !Array.isArray(parsed)
    || parsed.some((link) => !isRecord(link) || typeof link.label !== 'string' || typeof link.url !== 'string')
  ) {
    throw dataError(`第 ${rowIndex} 列的 links 欄位不是有效 JSON。`)
  }
  return parsed.map((link) => ({ label: link.label, url: link.url }))
}

function parseJson(value: string, field: 'tags' | 'links', rowIndex: number): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw dataError(`第 ${rowIndex} 列的 ${field} 欄位不是有效 JSON。`)
  }
}

function parseBoolean(value: unknown, rowIndex: number): boolean {
  if (typeof value === 'boolean') return value
  const normalized = text(value).trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw dataError(`第 ${rowIndex} 列的 isActive 欄位不是 true 或 false。`)
}

function requiredText(value: unknown, field: string, rowIndex: number): string {
  const normalized = text(value).trim()
  if (!normalized) throw dataError(`第 ${rowIndex} 列缺少${field}。`)
  return normalized
}

function text(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  throw dataError('Google Sheet 包含無法辨識的資料。')
}

function hasCellValue(values: unknown[]): boolean {
  return values.some((value) => value !== undefined && value !== null && value !== '')
}

function assertUniqueIds<T extends { id: string }>(rows: Row<T>[]): void {
  const ids = new Set<string>()
  for (const row of rows) {
    if (ids.has(row.item.id)) throw dataError('Google Sheet 包含重複 ID。')
    ids.add(row.item.id)
  }
}

function buildWriteRequests(
  schema: ValidatedSchema,
  current: LoadedRows,
  original: JournalSnapshot,
  desired: JournalSnapshot,
): unknown[] {
  const entryChanges = collectChanges(
    original.entries,
    desired.entries,
    current.entries.rows,
    entriesEqual,
  )
  const categoryChanges = collectChanges(
    original.categories,
    desired.categories,
    current.categories.rows,
    categoriesEqual,
  )

  const requests: unknown[] = []
  for (const row of entryChanges.updates) {
    requests.push(updateCellsRequest(schema.sheetIds[ENTRY_SHEET_NAME], row.rowIndex - 1, [entryValues(row.item)]))
  }
  for (const row of categoryChanges.updates) {
    requests.push(updateCellsRequest(schema.sheetIds[CATEGORY_SHEET_NAME], row.rowIndex - 1, [categoryValues(row.item)]))
  }

  appendInsertRequests(
    requests,
    schema.sheetIds[ENTRY_SHEET_NAME],
    current.entries.lastOccupiedRow,
    entryChanges.inserts.map(entryValues),
  )
  appendInsertRequests(
    requests,
    schema.sheetIds[CATEGORY_SHEET_NAME],
    current.categories.lastOccupiedRow,
    categoryChanges.inserts.map(categoryValues),
  )

  appendDeleteRequests(requests, schema.sheetIds[ENTRY_SHEET_NAME], entryChanges.deletes)
  appendDeleteRequests(requests, schema.sheetIds[CATEGORY_SHEET_NAME], categoryChanges.deletes)
  return requests
}

function collectChanges<T extends { id: string }>(
  original: T[],
  desired: T[],
  current: Row<T>[],
  equal: (left: T, right: T) => boolean,
): Changes<T> {
  const originalById = toIdMap(original)
  const desiredById = toIdMap(desired)
  const currentById = new Map(current.map((row) => [row.item.id, row]))
  const updates: Row<T>[] = []
  const inserts: T[] = []
  const deletes: number[] = []

  for (const item of desired) {
    const previous = originalById.get(item.id)
    if (!previous) {
      if (currentById.has(item.id)) throw dataError('Google Sheet 資料已變更，請重新整理後再試。')
      inserts.push(item)
      continue
    }
    if (equal(previous, item)) continue
    const remote = currentById.get(item.id)
    if (!remote || !equal(remote.item, previous)) {
      throw conflict('Google Sheet 資料已變更，請重新整理後再試。')
    }
    updates.push({ rowIndex: remote.rowIndex, item })
  }

  for (const item of original) {
    if (desiredById.has(item.id)) continue
    const remote = currentById.get(item.id)
    if (!remote || !equal(remote.item, item)) {
      throw conflict('Google Sheet 資料已變更，請重新整理後再試。')
    }
    deletes.push(remote.rowIndex)
  }
  return { updates, inserts, deletes }
}

function toIdMap<T extends { id: string }>(items: T[]): Map<string, T> {
  const result = new Map<string, T>()
  for (const item of items) {
    if (result.has(item.id)) throw dataError('記事狀態包含重複 ID。')
    result.set(item.id, item)
  }
  return result
}

function appendInsertRequests(
  requests: unknown[],
  sheetId: number,
  lastOccupiedRow: number,
  values: Array<Array<string | boolean>>,
): void {
  if (!values.length) return
  requests.push({
    insertDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: lastOccupiedRow,
        endIndex: lastOccupiedRow + values.length,
      },
      inheritFromBefore: true,
    },
  })
  requests.push(updateCellsRequest(sheetId, lastOccupiedRow, values))
}

function appendDeleteRequests(requests: unknown[], sheetId: number, rowIndexes: number[]): void {
  for (const rowIndex of [...rowIndexes].sort((left, right) => right - left)) {
    requests.push({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: rowIndex - 1,
          endIndex: rowIndex,
        },
      },
    })
  }
}

function updateCellsRequest(
  sheetId: number,
  rowIndex: number,
  rows: Array<Array<string | boolean>>,
): Record<string, unknown> {
  return {
    updateCells: {
      start: { sheetId, rowIndex, columnIndex: 0 },
      rows: rows.map((values) => ({
        values: values.map((value) => ({
          userEnteredValue: typeof value === 'boolean'
            ? { boolValue: value }
            : { stringValue: value },
        })),
      })),
      fields: 'userEnteredValue',
    },
  }
}

function entryValues(entry: Entry): string[] {
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

function categoryValues(category: Category): Array<string | boolean> {
  return [
    category.id,
    category.name,
    category.isActive,
    category.createdAt,
    category.updatedAt,
  ]
}

function headersMatch(actual: unknown[], expected: string[]): boolean {
  return actual.length === expected.length
    && expected.every((header, index) => text(actual[index]).trim() === header)
}

function entriesEqual(left: Entry, right: Entry): boolean {
  return left.id === right.id
    && left.entryDate === right.entryDate
    && left.title === right.title
    && left.content === right.content
    && left.categoryId === right.categoryId
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
    && stringArraysEqual(left.tags, right.tags)
    && linksEqual(left.links, right.links)
}

function categoriesEqual(left: Category, right: Category): boolean {
  return left.id === right.id
    && left.name === right.name
    && left.isActive === right.isActive
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
}

function snapshotsEqual(left: JournalSnapshot, right: JournalSnapshot): boolean {
  return left.timezone === right.timezone
    && left.entries.length === right.entries.length
    && left.categories.length === right.categories.length
    && left.entries.every((entry, index) => entriesEqual(entry, right.entries[index]))
    && left.categories.every((category, index) => categoriesEqual(category, right.categories[index]))
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function linksEqual(left: JournalLink[], right: JournalLink[]): boolean {
  return left.length === right.length
    && left.every((link, index) => link.label === right[index].label && link.url === right[index].url)
}

function cloneSnapshot(snapshot: JournalSnapshot): JournalSnapshot {
  return {
    timezone: snapshot.timezone,
    entries: snapshot.entries.map((entry) => ({
      ...entry,
      tags: [...entry.tags],
      links: entry.links.map((link) => ({ ...link })),
    })),
    categories: snapshot.categories.map((category) => ({ ...category })),
  }
}

function schemaMismatch(message: string): JournalError {
  return new JournalError('DATA_ERROR', message)
}

function dataError(message: string): JournalError {
  return new JournalError('DATA_ERROR', message)
}

function conflict(message: string): JournalError {
  return new JournalError('CONFLICT', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
