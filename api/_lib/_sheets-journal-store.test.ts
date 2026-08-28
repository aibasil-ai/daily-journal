import { describe, expect, test, vi } from 'vitest'
import { JournalError } from '../../shared/journal/errors'
import { InMemoryJournalStore } from '../../shared/journal/in-memory-store'
import type { SpreadsheetMetadata, GoogleSheetsClient } from './google-sheets'
import {
  CATEGORY_HEADERS,
  CATEGORY_SHEET_NAME,
  ENTRY_HEADERS,
  ENTRY_SHEET_NAME,
  SCHEMA_VERSION,
  SETTINGS_HEADERS,
  SETTINGS_SHEET_NAME,
  SheetsJournalStore,
} from './sheets-journal-store'

describe('SheetsJournalStore', () => {
  test('建立試算表後，以單一 batchUpdate 初始化固定 schema', async () => {
    const client = fakeClient({
      metadata: blankMetadata(),
      createdSpreadsheet: {
        spreadsheetId: 'sheet-ref-new',
        properties: { title: 'Sheet A', timeZone: 'Asia/Taipei' },
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1', sheetType: 'GRID' } }],
      },
    })

    const store = await SheetsJournalStore.create({ client, accessToken: 'test-token', title: 'Sheet A' })

    expect(store.spreadsheetId).toBe('sheet-ref-new')
    expect(client.createSpreadsheet).toHaveBeenCalledWith('test-token', 'Sheet A')
    expect(client.batchUpdate).toHaveBeenCalledTimes(1)
    const [, , requests] = client.batchUpdate.mock.calls[0] as [string, string, unknown[]]
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ addSheet: expect.objectContaining({ properties: expect.objectContaining({ title: ENTRY_SHEET_NAME }) }) }),
      expect.objectContaining({ addSheet: expect.objectContaining({ properties: expect.objectContaining({ title: CATEGORY_SHEET_NAME }) }) }),
      expect.objectContaining({ addSheet: expect.objectContaining({ properties: expect.objectContaining({ title: SETTINGS_SHEET_NAME }) }) }),
      expect.objectContaining({ updateCells: expect.objectContaining({ rows: [{ values: expect.any(Array) }] }) }),
    ]))
    const serializedRequests = JSON.stringify(requests)
    expect(ENTRY_HEADERS.every((header) => serializedRequests.includes(`"stringValue":"${header}"`))).toBe(true)
    expect(CATEGORY_HEADERS.every((header) => serializedRequests.includes(`"stringValue":"${header}"`))).toBe(true)
    expect(serializedRequests).toContain(SCHEMA_VERSION)
  })

  test('拒絕非空且不相容的 Sheet，且絕不寫入或清除資料', async () => {
    const metadata = blankMetadata()
    metadata.sheets[0].data = [{
      rowData: [{ values: [{ userEnteredValue: { stringValue: 'existing' } }] }],
    }]
    const client = fakeClient({ metadata })

    await expect(SheetsJournalStore.initialize({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })).rejects.toMatchObject({ code: 'DATA_ERROR' })
    expect(client.batchUpdate).not.toHaveBeenCalled()
  })

  test.each([
    ['無效 tags JSON', [[...entryRow('entry-a').slice(0, 5), '{', '[]', ...entryRow('entry-a').slice(7)]], [categoryRow('category-a')]],
    ['無效 links JSON', [[...entryRow('entry-a').slice(0, 6), '{', ...entryRow('entry-a').slice(7)]], [categoryRow('category-a')]],
    ['重複記事 ID', [entryRow('entry-a'), entryRow('entry-a')], [categoryRow('category-a')]],
    ['無效分類 boolean', [entryRow('entry-a')], [[...categoryRow('category-a').slice(0, 2), 'yes', ...categoryRow('category-a').slice(3)]]],
  ])('既有相容 schema 的 Sheet 在啟用前完整唯讀驗證%s', async (_name, entries, categories) => {
    const client = fakeClient({
      metadata: compatibleMetadata(),
      schemaRanges: compatibleSchemaRanges(),
      dataRanges: [
        { range: `${ENTRY_SHEET_NAME}!A2:I`, values: entries },
        { range: `${CATEGORY_SHEET_NAME}!A2:E`, values: categories },
      ],
    })

    await expect(SheetsJournalStore.initialize({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })).rejects.toMatchObject({ code: 'DATA_ERROR' })
    expect(client.batchUpdate).not.toHaveBeenCalled()
  })

  test('load 在驗證 schema 後將 JSON tags 與 links 解析至 InMemoryJournalStore', async () => {
    const client = fakeClient({
      metadata: compatibleMetadata(),
      schemaRanges: compatibleSchemaRanges(),
      dataRanges: [
        {
          range: `${ENTRY_SHEET_NAME}!A2:I`,
          values: [[
            'entry-a',
            '2026-08-20',
            '',
            '',
            'category-a',
            '["tag-a"]',
            '[{"label":"link-a","url":"https://example.test/a"}]',
            '2026-08-20T00:00:00.000+08:00',
            '2026-08-20T00:00:00.000+08:00',
          ]],
        },
        {
          range: `${CATEGORY_SHEET_NAME}!A2:E`,
          values: [['category-a', 'Category A', 'TRUE', '2026-08-20T00:00:00.000+08:00', '2026-08-20T00:00:00.000+08:00']],
        },
      ],
    })

    const store = await SheetsJournalStore.load({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })

    expect(store.toInMemoryStore()).toBeInstanceOf(InMemoryJournalStore)
    expect(store.getEntry('entry-a')).toMatchObject({
      tags: ['tag-a'],
      links: [{ label: 'link-a', url: 'https://example.test/a' }],
    })
    expect(store.getTimezone()).toBe('Asia/Taipei')
  })

  test('v2 會解析空白與自訂色並將改色寫回第六欄', async () => {
    expect(CATEGORY_HEADERS).toEqual(['id', 'name', 'isActive', 'createdAt', 'updatedAt', 'color'])
    expect(SCHEMA_VERSION).toBe('2')
    const client = fakeClient({
      metadata: compatibleMetadata(),
      schemaRanges: compatibleSchemaRanges(),
      dataRanges: [
        { range: `${ENTRY_SHEET_NAME}!A2:I`, values: [] },
        {
          range: `${CATEGORY_SHEET_NAME}!A2:F`,
          values: [categoryRow('default'), categoryRow('custom', '#B97C66')],
        },
      ],
    })
    const store = await SheetsJournalStore.load({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })

    expect(store.listCategories().find(({ id }) => id === 'default')?.color).toBeNull()
    expect(store.listCategories().find(({ id }) => id === 'custom')?.color).toBe('#b97c66')
    await store.execute({ action: 'setCategoryColor', id: 'default', color: '#ffe784' })
    expect(JSON.stringify(client.batchUpdate.mock.calls)).toContain('#ffe784')
  })

  test.each(['initialize', 'load', 'verifySchema'] as const)(
    '%s 會把精確 v1 原子升級為 v2',
    async (method) => {
      const client = fakeClient({
        metadata: compatibleMetadata(),
        schemaRanges: legacySchemaRanges(),
        schemaRangesAfterUpdate: compatibleSchemaRanges(),
        dataRanges: [
          { range: `${ENTRY_SHEET_NAME}!A2:I`, values: [] },
          { range: `${CATEGORY_SHEET_NAME}!A2:E`, values: [categoryRow('work').slice(0, 5)] },
        ],
      })
      const options = { client, accessToken: 'test-token', spreadsheetId: 'sheet-ref-a' }
      if (method === 'initialize') await SheetsJournalStore.initialize(options)
      else if (method === 'load') await SheetsJournalStore.load(options)
      else await SheetsJournalStore.verifySchema(options)

      expect(client.batchUpdate).toHaveBeenCalledTimes(1)
      const requests = client.batchUpdate.mock.calls[0]?.[2] as Array<Record<string, unknown>>
      expect(requests).toHaveLength(2)
      const serialized = JSON.stringify(requests)
      expect(serialized).toContain('color')
      expect(serialized).toContain('2')
      expect(serialized).not.toContain('Category A')
    },
  )

  test('v1 的第六欄已有內容時，在任何寫入前拒絕遷移', async () => {
    const metadata = compatibleMetadata()
    requiredSheet(metadata, CATEGORY_SHEET_NAME).data = [{
      startColumn: 5,
      rowData: [{ values: [{ userEnteredValue: { stringValue: 'do-not-overwrite' } }] }],
    }]
    const client = fakeClient({
      metadata,
      schemaRanges: legacySchemaRanges(),
      dataRanges: [
        { range: `${ENTRY_SHEET_NAME}!A2:I`, values: [] },
        { range: `${CATEGORY_SHEET_NAME}!A2:E`, values: [categoryRow('work').slice(0, 5)] },
      ],
    })

    await expect(SheetsJournalStore.load({
      client, accessToken: 'test-token', spreadsheetId: 'sheet-ref-a',
    })).rejects.toMatchObject({ code: 'DATA_ERROR' })
    expect(client.batchUpdate).not.toHaveBeenCalled()
  })

  test('v1 資料列無法完整解析時，在任何寫入前拒絕遷移', async () => {
    const badCategory = categoryRow('work').slice(0, 5)
    badCategory[2] = 'yes'
    const client = fakeClient({
      metadata: compatibleMetadata(),
      schemaRanges: legacySchemaRanges(),
      dataRanges: [
        { range: `${ENTRY_SHEET_NAME}!A2:I`, values: [] },
        { range: `${CATEGORY_SHEET_NAME}!A2:E`, values: [badCategory] },
      ],
    })

    await expect(SheetsJournalStore.verifySchema({
      client, accessToken: 'test-token', spreadsheetId: 'sheet-ref-a',
    })).rejects.toMatchObject({ code: 'DATA_ERROR' })
    expect(client.batchUpdate).not.toHaveBeenCalled()
  })

  test('execute 使用共用 dispatcher，僅在有變更時以一個 batchUpdate 寫入', async () => {
    const client = fakeClient({
      metadata: compatibleMetadata(),
      schemaRanges: compatibleSchemaRanges(),
      dataRanges: emptyDataRanges(),
    })
    const store = await SheetsJournalStore.load({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
      now: () => new Date('2026-08-20T00:00:00.000Z'),
      uuid: () => 'category-new',
    })

    await expect(store.execute({ action: 'saveCategory', category: { name: 'Category A' } })).resolves.toMatchObject({
      ok: true,
      data: { id: 'category-new', name: 'Category A' },
    })
    expect(client.batchUpdate).toHaveBeenCalledTimes(1)
    const [, , requests] = client.batchUpdate.mock.calls[0] as [string, string, Array<Record<string, unknown>>]
    expect(requests.filter((request) => 'updateCells' in request || 'insertDimension' in request)).not.toHaveLength(0)

    await expect(store.execute({ action: 'bootstrap' })).resolves.toMatchObject({ ok: true })
    expect(client.batchUpdate).toHaveBeenCalledTimes(1)
  })

  test('更新記事時以 JSON 寫入 tags 與 links，且不另送值寫入請求', async () => {
    const client = fakeClient({
      metadata: compatibleMetadata(),
      schemaRanges: compatibleSchemaRanges(),
      dataRanges: [
        { range: `${ENTRY_SHEET_NAME}!A2:I`, values: [entryRow('entry-a')] },
        { range: `${CATEGORY_SHEET_NAME}!A2:E`, values: [categoryRow('category-a')] },
      ],
    })
    const store = await SheetsJournalStore.load({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
      now: () => new Date('2026-08-20T00:00:00.000Z'),
      uuid: () => 'unused-id',
    })

    await expect(store.execute({
      action: 'saveEntry',
      entry: {
        id: 'entry-a',
        entryDate: '2026-08-20',
        title: '',
        content: 'x',
        categoryId: 'category-a',
        tags: ['tag-new'],
        links: [{ label: 'link-new', url: 'https://example.test/new' }],
      },
    })).resolves.toMatchObject({ ok: true, data: { id: 'entry-a' } })

    expect(client.batchUpdate).toHaveBeenCalledTimes(1)
    const [, , requests] = client.batchUpdate.mock.calls[0] as [string, string, Array<Record<string, unknown>>]
    const update = requests.find((request) => 'updateCells' in request) as {
      updateCells: {
        rows: Array<{ values: Array<{ userEnteredValue: { stringValue?: string } }> }>
      }
    }
    const values = update.updateCells.rows[0].values.map((cell) => cell.userEnteredValue.stringValue)
    expect(values).toContain('["tag-new"]')
    expect(values).toContain('[{"label":"link-new","url":"https://example.test/new"}]')
  })

  test('寫入前 schema 改為不符時絕不送出 batchUpdate', async () => {
    const schemaRanges = compatibleSchemaRanges()
    const client = fakeClient({
      metadata: compatibleMetadata(),
      schemaRanges,
      dataRanges: emptyDataRanges(),
    })
    const store = await SheetsJournalStore.load({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })
    schemaRanges[0] = incompatibleSchemaRanges()[0]
    store.saveCategory({
      id: 'category-new',
      name: 'Category A',
      color: null,
      isActive: true,
      createdAt: '2026-08-20T00:00:00.000+08:00',
      updatedAt: '2026-08-20T00:00:00.000+08:00',
    })

    await expect(store.flush()).rejects.toBeInstanceOf(JournalError)
    expect(client.batchUpdate).not.toHaveBeenCalled()
  })

  test('更新資料列前偵測遠端任一欄位被人工修改，並拒絕覆寫', async () => {
    const dataRanges = [
      { range: `${ENTRY_SHEET_NAME}!A2:I`, values: [entryRow('entry-a')] },
      { range: `${CATEGORY_SHEET_NAME}!A2:E`, values: [categoryRow('category-a')] },
    ]
    const client = fakeClient({
      metadata: compatibleMetadata(),
      schemaRanges: compatibleSchemaRanges(),
      dataRanges,
    })
    const store = await SheetsJournalStore.load({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })
    const entry = store.getEntry('entry-a')!
    store.saveEntry({ ...entry, content: 'local edit' })
    dataRanges[0].values![0][2] = 'manual title edit'

    await expect(store.flush()).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(client.batchUpdate).not.toHaveBeenCalled()
  })

  test('刪除資料列前偵測遠端任一欄位被人工修改，並拒絕刪除', async () => {
    const dataRanges = [
      { range: `${ENTRY_SHEET_NAME}!A2:I`, values: [entryRow('entry-a')] },
      { range: `${CATEGORY_SHEET_NAME}!A2:E`, values: [categoryRow('category-a')] },
    ]
    const client = fakeClient({
      metadata: compatibleMetadata(),
      schemaRanges: compatibleSchemaRanges(),
      dataRanges,
    })
    const store = await SheetsJournalStore.load({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })
    store.deleteEntry('entry-a')
    dataRanges[0].values![0][3] = 'manual content edit'

    await expect(store.flush()).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(client.batchUpdate).not.toHaveBeenCalled()
  })

  test('初始化與 load 拒絕公式的 formatted value 資料列，絕不覆寫 Sheet', async () => {
    const metadata = compatibleMetadata()
    addFormulaEntryCell(metadata)
    const client = fakeClient({
      metadata,
      schemaRanges: compatibleSchemaRanges(),
      dataRanges: formattedFormulaDataRanges(),
    })

    await expect(SheetsJournalStore.initialize({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })).rejects.toMatchObject({ code: 'DATA_ERROR' })
    await expect(SheetsJournalStore.load({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })).rejects.toMatchObject({ code: 'DATA_ERROR' })
    expect(client.batchUpdate).not.toHaveBeenCalled()
  })

  test('flush 在 formatted value 資料列被公式取代後拒絕寫入', async () => {
    const metadata = compatibleMetadata()
    const dataRanges = formattedFormulaDataRanges()
    const client = fakeClient({
      metadata,
      schemaRanges: compatibleSchemaRanges(),
      dataRanges,
    })
    const store = await SheetsJournalStore.load({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })
    store.saveCategory({
      ...store.listCategories()[0]!,
      name: '已編輯分類',
    })
    addFormulaEntryCell(metadata)

    await expect(store.flush()).rejects.toMatchObject({ code: 'DATA_ERROR' })
    expect(client.batchUpdate).not.toHaveBeenCalled()
  })

  test.each(unsafeMetadataFixtures)('初始化時拒絕%s，且不覆寫既有 Sheet', async (_name, applyUnsafeMetadata) => {
    const metadata = compatibleMetadata()
    applyUnsafeMetadata(metadata)
    const client = fakeClient({ metadata, schemaRanges: compatibleSchemaRanges() })

    await expect(SheetsJournalStore.initialize({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })).rejects.toMatchObject({ code: 'DATA_ERROR' })
    expect(client.batchUpdate).not.toHaveBeenCalled()
  })

  test.each(unsafeMetadataFixtures)('load 時拒絕%s', async (_name, applyUnsafeMetadata) => {
    const metadata = compatibleMetadata()
    applyUnsafeMetadata(metadata)
    const client = fakeClient({ metadata, schemaRanges: compatibleSchemaRanges() })

    await expect(SheetsJournalStore.load({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })).rejects.toMatchObject({ code: 'DATA_ERROR' })
    expect(client.batchUpdate).not.toHaveBeenCalled()
  })

  test.each(unsafeMetadataFixtures)('flush 時拒絕%s，且不送出 batchUpdate', async (_name, applyUnsafeMetadata) => {
    const metadata = compatibleMetadata()
    const client = fakeClient({
      metadata,
      schemaRanges: compatibleSchemaRanges(),
      dataRanges: emptyDataRanges(),
    })
    const store = await SheetsJournalStore.load({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })
    store.saveCategory({
      id: 'category-new',
      name: 'Category A',
      color: null,
      isActive: true,
      createdAt: '2026-08-20T00:00:00.000+08:00',
      updatedAt: '2026-08-20T00:00:00.000+08:00',
    })
    applyUnsafeMetadata(metadata)

    await expect(store.flush()).rejects.toMatchObject({ code: 'DATA_ERROR' })
    expect(client.batchUpdate).not.toHaveBeenCalled()
  })

  test('flush 由高列號到低列號刪除資料列', async () => {
    const client = fakeClient({
      metadata: compatibleMetadata(),
      schemaRanges: compatibleSchemaRanges(),
      dataRanges: [
        {
          range: `${ENTRY_SHEET_NAME}!A2:I`,
          values: [entryRow('entry-a'), entryRow('entry-b'), entryRow('entry-c')],
        },
        {
          range: `${CATEGORY_SHEET_NAME}!A2:E`,
          values: [categoryRow('category-a')],
        },
      ],
    })
    const store = await SheetsJournalStore.load({
      client,
      accessToken: 'test-token',
      spreadsheetId: 'sheet-ref-a',
    })
    store.deleteEntry('entry-a')
    store.deleteEntry('entry-c')

    await store.flush()

    const [, , requests] = client.batchUpdate.mock.calls[0] as [string, string, Array<Record<string, unknown>>]
    const deletes = requests
      .filter((request) => 'deleteDimension' in request)
      .map((request) => (request.deleteDimension as { range: { startIndex: number } }).range.startIndex)
    expect(deletes).toEqual([3, 1])
  })
})

type FakeClient = {
  createSpreadsheet: ReturnType<typeof vi.fn>
  getSpreadsheet: ReturnType<typeof vi.fn>
  batchGet: ReturnType<typeof vi.fn>
  batchUpdate: ReturnType<typeof vi.fn>
}

type UnsafeMetadataFixture = [
  string,
  (metadata: SpreadsheetMetadata) => void,
]

const unsafeMetadataFixtures: UnsafeMetadataFixture[] = [
  ['必要工作表支援欄位外的資料', (metadata) => {
    const entries = requiredSheet(metadata, ENTRY_SHEET_NAME)
    entries.data = [{
      startRow: 1,
      startColumn: ENTRY_HEADERS.length,
      rowData: [{ values: [{ userEnteredValue: { stringValue: 'outside-schema' } }] }],
    }]
  }],
  ['非空額外工作表', (metadata) => {
    metadata.sheets.push({
      properties: { sheetId: 4, title: 'unrelated', sheetType: 'GRID' },
      data: [{
        rowData: [{ values: [{ userEnteredValue: { stringValue: 'do-not-overwrite' } }] }],
      }],
    })
  }],
  ['凍結列', (metadata) => {
    requiredSheet(metadata, ENTRY_SHEET_NAME).properties.gridProperties = { frozenRowCount: 1 }
  }],
  ['樞紐分析表', (metadata) => {
    requiredSheet(metadata, ENTRY_SHEET_NAME).data = [{
      rowData: [{ values: [{ pivotTable: {} }] }],
    }]
  }],
  ['支援欄位中的公式', addFormulaEntryCell],
  ['合併儲存格', (metadata) => {
    requiredSheet(metadata, ENTRY_SHEET_NAME).merges = [{}]
  }],
  ['圖表', (metadata) => {
    requiredSheet(metadata, ENTRY_SHEET_NAME).charts = [{}]
  }],
  ['條件格式', (metadata) => {
    requiredSheet(metadata, ENTRY_SHEET_NAME).conditionalFormats = [{}]
  }],
  ['保護範圍', (metadata) => {
    requiredSheet(metadata, ENTRY_SHEET_NAME).protectedRanges = [{}]
  }],
  ['基本篩選', (metadata) => {
    requiredSheet(metadata, ENTRY_SHEET_NAME).basicFilter = {}
  }],
  ['篩選檢視', (metadata) => {
    requiredSheet(metadata, ENTRY_SHEET_NAME).filterViews = [{}]
  }],
]

function fakeClient(options: {
  metadata: SpreadsheetMetadata
  createdSpreadsheet?: SpreadsheetMetadata
  schemaRanges?: Array<{ range: string; values?: unknown[][] }>
  schemaRangesAfterUpdate?: Array<{ range: string; values?: unknown[][] }>
  dataRanges?: Array<{ range: string; values?: unknown[][] }>
}): FakeClient & GoogleSheetsClient {
  const schemaRanges = options.schemaRanges ?? compatibleSchemaRanges()
  const dataRanges = options.dataRanges ?? emptyDataRanges()
  let didUpdate = false
  const client = {
    createSpreadsheet: vi.fn(async () => options.createdSpreadsheet ?? options.metadata),
    getSpreadsheet: vi.fn(async () => options.createdSpreadsheet ?? options.metadata),
    batchGet: vi.fn(async (_token: string, _spreadsheetId: string, ranges: string[]) => {
      return ranges.some((range) => range.startsWith(`${SETTINGS_SHEET_NAME}!`))
        ? didUpdate && options.schemaRangesAfterUpdate ? options.schemaRangesAfterUpdate : schemaRanges
        : dataRanges
      }),
    batchUpdate: vi.fn(async () => {
      didUpdate = true
    }),
  }
  return client as FakeClient & GoogleSheetsClient
}

function blankMetadata(): SpreadsheetMetadata {
  return {
    spreadsheetId: 'sheet-ref-a',
    properties: { title: 'Sheet A', timeZone: 'Asia/Taipei' },
    sheets: [{ properties: { sheetId: 0, title: 'Sheet1', sheetType: 'GRID' }, data: [] }],
  }
}

function compatibleMetadata(): SpreadsheetMetadata {
  return {
    spreadsheetId: 'sheet-ref-a',
    properties: { title: 'Sheet A', timeZone: 'Asia/Taipei' },
    sheets: [
      { properties: { sheetId: 1, title: ENTRY_SHEET_NAME, sheetType: 'GRID' } },
      { properties: { sheetId: 2, title: CATEGORY_SHEET_NAME, sheetType: 'GRID' } },
      { properties: { sheetId: 3, title: SETTINGS_SHEET_NAME, sheetType: 'GRID' } },
    ],
  }
}

function requiredSheet(
  metadata: SpreadsheetMetadata,
  title: typeof ENTRY_SHEET_NAME | typeof CATEGORY_SHEET_NAME | typeof SETTINGS_SHEET_NAME,
): SpreadsheetMetadata['sheets'][number] {
  const sheet = metadata.sheets.find((candidate) => candidate.properties.title === title)
  if (!sheet) throw new Error('missing required sheet fixture')
  return sheet
}

function compatibleSchemaRanges(): Array<{ range: string; values?: unknown[][] }> {
  return [
    { range: `${ENTRY_SHEET_NAME}!1:1`, values: [ENTRY_HEADERS] },
    { range: `${CATEGORY_SHEET_NAME}!1:1`, values: [CATEGORY_HEADERS] },
    { range: `${SETTINGS_SHEET_NAME}!1:1`, values: [SETTINGS_HEADERS] },
    { range: `${SETTINGS_SHEET_NAME}!A:B`, values: [SETTINGS_HEADERS, ['schemaVersion', SCHEMA_VERSION]] },
  ]
}

function legacySchemaRanges(): Array<{ range: string; values?: unknown[][] }> {
  return [
    { range: `${ENTRY_SHEET_NAME}!1:1`, values: [ENTRY_HEADERS] },
    { range: `${CATEGORY_SHEET_NAME}!1:1`, values: [['id', 'name', 'isActive', 'createdAt', 'updatedAt']] },
    { range: `${SETTINGS_SHEET_NAME}!1:1`, values: [SETTINGS_HEADERS] },
    { range: `${SETTINGS_SHEET_NAME}!A:B`, values: [SETTINGS_HEADERS, ['schemaVersion', '1']] },
  ]
}

function incompatibleSchemaRanges(): Array<{ range: string; values?: unknown[][] }> {
  return [
    { range: `${ENTRY_SHEET_NAME}!1:1`, values: [['wrong']] },
    { range: `${CATEGORY_SHEET_NAME}!1:1`, values: [CATEGORY_HEADERS] },
    { range: `${SETTINGS_SHEET_NAME}!1:1`, values: [SETTINGS_HEADERS] },
    { range: `${SETTINGS_SHEET_NAME}!A:B`, values: [SETTINGS_HEADERS, ['schemaVersion', SCHEMA_VERSION]] },
  ]
}

function formattedFormulaDataRanges(): Array<{ range: string; values?: unknown[][] }> {
  const entry = entryRow('entry-a')
  entry[3] = '由公式計算的格式化值'
  return [
    { range: `${ENTRY_SHEET_NAME}!A2:I`, values: [entry] },
    { range: `${CATEGORY_SHEET_NAME}!A2:E`, values: [categoryRow('category-a')] },
  ]
}

function addFormulaEntryCell(metadata: SpreadsheetMetadata): void {
  requiredSheet(metadata, ENTRY_SHEET_NAME).data = [{
    startRow: 1,
    rowData: [{
      values: [
        {},
        {},
        {},
        { userEnteredValue: { formulaValue: '=CONCAT("formula", " result")' } },
      ],
    }],
  }]
}

function emptyDataRanges(): Array<{ range: string; values?: unknown[][] }> {
  return [
    { range: `${ENTRY_SHEET_NAME}!A2:I`, values: [] },
    { range: `${CATEGORY_SHEET_NAME}!A2:E`, values: [] },
  ]
}

function entryRow(id: string): unknown[] {
  return [
    id,
    '2026-08-20',
    '',
    '',
    'category-a',
    '[]',
    '[]',
    '2026-08-20T00:00:00.000+08:00',
    '2026-08-20T00:00:00.000+08:00',
  ]
}

function categoryRow(id: string, color = ''): unknown[] {
  return [
    id,
    'Category A',
    'TRUE',
    '2026-08-20T00:00:00.000+08:00',
    '2026-08-20T00:00:00.000+08:00',
    color,
  ]
}
