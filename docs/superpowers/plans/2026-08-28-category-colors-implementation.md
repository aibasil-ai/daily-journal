# 類別顏色與記事視覺同步實作計畫

> **給代理工作者：** 必須使用 `superpowers:subagent-driven-development`（建議）或 `superpowers:executing-plans` 逐項執行本計畫。每個步驟使用 checkbox（`- [ ]`）追蹤。

**目標：** 新增可持久化的固定類別色票，支援類別卡片右鍵與調色盤按鈕選色，並將自訂色同步到時間軸、記事詳情及月曆。

**架構：** 在 shared 層集中定義安全色票與 `CategoryColor`，以專用 `setCategoryColor` action 修改類別，並將 Google Sheet schema 從 v1 原子升級為 v2。前端由 `useJournal` 正規化類別顏色並保存改色中的類別 ID；UI 使用單一 `CategoryColorMenu` 與 CSS custom property，未設定自訂色時保留各畫面既有預設背景。

**技術棧：** React 19、TypeScript 5.9、Vite 8、Vitest 4、React Testing Library、Google Sheets API v4、Google Apps Script。

**設計規格：** `docs/superpowers/specs/2026-08-28-category-colors-design.md`

---

## 執行原則

- 所有 production 變更先寫失敗測試，再寫最小實作。
- 不把顏色複製到 `Entry`、`DailyEntries` 或 CSV。
- 不因改色增加記事 `revision`，也不重新讀取記事、類別摘要或月份資料。
- 不導入 UI 套件、通用 popup framework、長按手勢或任意選色器。
- 每個 commit 步驟都必須先向使用者出示本計畫列出的繁體中文提交訊息；只有取得明確確認後才可執行 `git commit`。
- 工作區若有非本計畫變更，只暫存本任務列出的檔案，不修改或納入其他檔案。

## 檔案責任圖

### 新增檔案

- `shared/journal/category-colors.ts`：固定色票、預設預覽色、`CategoryColor` 與正規化。
- `shared/journal/category-colors.test.ts`：色票數量、唯一性、格式與對比度測試。
- `src/features/categories/category-color-menu.tsx`：可存取色票、定位、鍵盤操作、外部點擊與焦點回復。
- `src/features/categories/category-color-menu.test.tsx`：色票元件互動測試。
- `src/utils/category-color.ts`：將 nullable 類別色轉為受型別保護的 CSS custom property。
- `src/features/entries/entry-detail.test.tsx`：詳情標籤預設色與自訂色測試。
- `src/features/entries/timeline.test.tsx`：依 `categoryId` 傳遞名稱與色彩的測試。

### 共用領域與 API

- `shared/journal/types.ts`：`Category.color` 與 `setCategoryColor` request。
- `shared/journal/index.ts`、`src/domain/journal.ts`：重新匯出色票常數及型別。
- `shared/journal/validation.ts`：解析 nullable 白名單色碼。
- `shared/journal/service.ts`：新類別預設 `null`、改名保色、專用改色方法。
- `shared/journal/dispatcher.ts`：分派並標記 `setCategoryColor` 為 mutation。
- `shared/journal/service.test.ts`、`shared/journal/dispatcher.test.ts`、`shared/journal/in-memory-store.test.ts`、`api/_journal.test.ts`：領域與 route 契約測試。

### 儲存層

- `api/_lib/sheets-journal-store.ts`：schema v2、六欄類別讀寫、v1 安全辨識與原子遷移。
- `api/_lib/_sheets-journal-store.test.ts`：v2 round-trip、v1 遷移與不相容資料拒絕。
- `api/_lib/legacy-migration.ts`：修正「完全唯讀」註解，明確允許 schema-only 遷移。
- `gas/src/repositories/apps-script-journal-store.ts`：只支援 v2 初始化與讀寫，v1 明確拒絕。
- `gas/src/setup.test.ts`、`gas/src/api/dispatcher.test.ts`：GAS v2 與拒絕 v1 測試。

### 前端狀態與類別管理

- `src/features/journal/use-journal.ts`：類別回應正規化、`setCategoryColor`、跨頁 busy IDs。
- `src/features/journal/use-journal.test.tsx`：回應相容、去重、成功／失敗與不增加 revision。
- `src/features/categories/category-manager.tsx`：右鍵與按鈕入口、preview、rollback、busy 與 status。
- `src/features/categories/category-manager.test.tsx`：入口、焦點、停用類別、preview、rollback 與 busy 測試。
- `src/i18n/zh-TW.ts`：色票名稱、操作、儲存與錯誤文案。
- `src/styles/global.css`：色票與自訂色 CSS custom property 樣式。

### 記事與月曆顯示

- `src/features/entries/timeline.tsx`：建立完整類別 lookup。
- `src/features/entries/entry-card.tsx`、`src/features/entries/entry-card.test.tsx`：時間軸標籤色。
- `src/features/entries/entry-detail.tsx`、`src/features/entries/entry-detail.test.tsx`：詳情標籤色。
- `src/features/entries/calendar-view.tsx`、`src/features/entries/calendar-view.test.tsx`：日期格及「更多」清單色。
- `src/App.tsx`、`src/App.test.tsx`：串接改色、busy IDs、詳情與月曆 categories，並顯示跨頁錯誤。

### 只需補 `color: null` 的既有 typed fixtures

- `shared/journal/service.test.ts`
- `shared/journal/dispatcher.test.ts`
- `shared/journal/in-memory-store.test.ts`
- `gas/src/setup.test.ts`
- `src/features/categories/category-entry-move-panel.test.tsx`
- `src/features/entries/entry-form.test.tsx`
- 以及本計畫修改的 `src/App.test.tsx`、`src/features/categories/category-manager.test.tsx`、`src/features/journal/use-journal.test.tsx`。

---

### Task 1：建立固定色票與類別型別

**Files:**
- Create: `shared/journal/category-colors.ts`
- Create: `shared/journal/category-colors.test.ts`
- Modify: `shared/journal/types.ts`
- Modify: `shared/journal/index.ts`
- Modify: `src/domain/journal.ts`
- Modify: `shared/journal/service.ts`
- Modify: `api/_lib/sheets-journal-store.ts`
- Modify: `gas/src/repositories/apps-script-journal-store.ts`
- Modify typed Category fixtures listed above

- [ ] **Step 1：先寫固定色票的失敗測試**

建立 `shared/journal/category-colors.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_COLORS,
  DEFAULT_CATEGORY_COLOR,
  normalizeCategoryColor,
} from './category-colors.js'

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
  const linear = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(left: string, right: string): number {
  const first = relativeLuminance(left)
  const second = relativeLuminance(right)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

describe('類別色票', () => {
  it('只提供 23 個唯一且安全的自訂色', () => {
    expect(CATEGORY_COLORS).toHaveLength(23)
    expect(new Set(CATEGORY_COLORS).size).toBe(23)
    expect(CATEGORY_COLORS).not.toContain('#414646')
    for (const color of CATEGORY_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrastRatio(color, '#191c1e')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('保留既有淺藍作為預設色票預覽', () => {
    expect(DEFAULT_CATEGORY_COLOR).toBe('#d0e1fb')
  })

  it('只正規化白名單中的色碼', () => {
    expect(normalizeCategoryColor(' #B97C66 ')).toBe('#b97c66')
    expect(normalizeCategoryColor('#414646')).toBeUndefined()
    expect(normalizeCategoryColor('#ffffff')).toBeUndefined()
  })
})
```

- [ ] **Step 2：執行測試並確認紅燈**

Run: `npm run test:run -- shared/journal/category-colors.test.ts`

Expected: FAIL，訊息包含找不到 `./category-colors.js`。

- [ ] **Step 3：實作色票常數與正規化**

建立 `shared/journal/category-colors.ts`：

```ts
export const DEFAULT_CATEGORY_COLOR = '#d0e1fb'

export const CATEGORY_COLORS = [
  '#b97c66', '#d26865', '#fe382f', '#fe4f3c', '#ff703d',
  '#ffa84b', '#ffcb65', '#ffe784', '#b0da64', '#60c844',
  '#19a76a', '#46cc9b', '#93d5bb', '#93d4d9', '#a6c9e4',
  '#4b86df', '#8f91f1', '#b091ef', '#9b70d8', '#ca64db',
  '#eb7c9c', '#c6a6a7', '#c7c3c2',
] as const

export type CategoryColor = (typeof CATEGORY_COLORS)[number]

const categoryColorSet = new Set<string>(CATEGORY_COLORS)

export function normalizeCategoryColor(value: string): CategoryColor | undefined {
  const normalized = value.trim().toLowerCase()
  return categoryColorSet.has(normalized) ? normalized as CategoryColor : undefined
}
```

- [ ] **Step 4：擴充共用型別與匯出點**

在 `shared/journal/types.ts` 匯入 `CategoryColor`，並只修改下列型別；`CategoryInput` 保持不變：

```ts
import type { CategoryColor } from './category-colors.js'

export type Category = {
  id: string
  name: string
  color: CategoryColor | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ApiRequest =
  | { action: 'setCategoryColor'; id: string; color: CategoryColor | null }
```

上列 action 插入現有 `ApiRequest` union，原有每個 action 逐字保留。

在 `shared/journal/index.ts` 加入：

```ts
export * from './category-colors.js'
```

在 `src/domain/journal.ts` 加入：

```ts
export type { CategoryColor } from '../../shared/journal/category-colors'
export { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR, normalizeCategoryColor } from '../../shared/journal/category-colors'
```

在 `JournalService.saveCategory()` 的新類別 literal、Vercel `toCategory()` 與 GAS `toCategory()` 暫時補上 `color: null`，讓 v1 資料在 schema v2 實作前仍能產生完整 `Category`。Task 3 與 Task 5 再分別把兩個 store 改成實際解析第六欄。

所有現有 typed `Category` fixture 都明確補上 `color: null`；刻意模擬舊 API 回應的 `unknown` fixture 才可省略欄位。優先修改各測試既有的 `category(overrides)` helper：

```ts
function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 'work',
    name: '工作',
    color: null,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}
```

- [ ] **Step 5：執行色票測試與完整基線檢查**

Run: `npm run test:run -- shared/journal/category-colors.test.ts && npm run check`

Expected: PASS；所有現有測試維持通過，build 不再回報任何 `Category` fixture 缺少 `color`。

- [ ] **Step 6：取得使用者核准後提交**

先出示提交訊息：`feat: 建立類別顏色色票與資料型別`

使用者確認後執行：

```bash
git add shared/journal/category-colors.ts shared/journal/category-colors.test.ts shared/journal/types.ts shared/journal/index.ts shared/journal/service.ts shared/journal/service.test.ts shared/journal/dispatcher.test.ts shared/journal/in-memory-store.test.ts api/_lib/sheets-journal-store.ts gas/src/repositories/apps-script-journal-store.ts gas/src/setup.test.ts src/domain/journal.ts src/App.test.tsx src/features/categories/category-manager.test.tsx src/features/categories/category-entry-move-panel.test.tsx src/features/entries/entry-form.test.tsx src/features/journal/use-journal.test.tsx
git commit -m "feat: 建立類別顏色色票與資料型別"
```

---

### Task 2：新增類別顏色領域操作與 API action

**Files:**
- Modify: `shared/journal/validation.ts`
- Modify: `shared/journal/service.ts`
- Modify: `shared/journal/dispatcher.ts`
- Modify: `shared/journal/service.test.ts`
- Modify: `shared/journal/dispatcher.test.ts`
- Modify: `shared/journal/in-memory-store.test.ts`
- Modify: `api/_journal.test.ts`

- [ ] **Step 1：先寫 service 與 dispatcher 的失敗測試**

在 `shared/journal/service.test.ts` 加入設定、重設、停用類別與 no-op 案例：

```ts
it('只更新類別顏色與 updatedAt', () => {
  const store = new InMemoryJournalStore({
    categories: [{
      id: 'work', name: '工作', color: null, isActive: false,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    }],
  })
  const service = new JournalService(store, () => '2026-08-28T12:00:00.000Z', () => 'unused')

  expect(service.setCategoryColor('work', '#ffe784')).toEqual({
    id: 'work', name: '工作', color: '#ffe784', isActive: false,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-28T12:00:00.000Z',
  })
})

it('相同顏色不更新時間', () => {
  const existing = category({ color: '#ffe784' })
  const service = createService({ categories: [existing] })
  expect(service.setCategoryColor(existing.id, '#ffe784').updatedAt).toBe(existing.updatedAt)
})
```

在 `shared/journal/dispatcher.test.ts` 加入：

```ts
it('正規化並分派 setCategoryColor', () => {
  const response = executeJournalRequest(
    { action: 'setCategoryColor', id: 'work', color: ' #FFE784 ' },
    service(),
  )
  expect(response).toMatchObject({ ok: true, data: { id: 'work', color: '#ffe784' } })
  expect(isJournalMutation({ action: 'setCategoryColor', id: 'work', color: null })).toBe(true)
})

it('拒絕不在白名單的顏色', () => {
  expect(executeJournalRequest(
    { action: 'setCategoryColor', id: 'work', color: '#414646' },
    service(),
  )).toEqual({ ok: false, code: 'VALIDATION_ERROR', message: '請選擇有效的類別顏色。' })
})
```

同時在 `api/_journal.test.ts` 驗證 `setCategoryColor` 套用 mutation 的 Origin、限流與 write lease 路徑。

- [ ] **Step 2：執行測試並確認紅燈**

Run: `npm run test:run -- shared/journal/service.test.ts shared/journal/dispatcher.test.ts api/_journal.test.ts`

Expected: FAIL，`JournalService.setCategoryColor` 不存在或 action 回傳 `INVALID_ACTION`。

- [ ] **Step 3：實作 nullable 色碼解析**

在 `shared/journal/validation.ts` 加入：

```ts
import { normalizeCategoryColor } from './category-colors.js'
import type { CategoryColor } from './category-colors.js'

export function parseCategoryColor(value: unknown): CategoryColor | null {
  if (value === null) return null
  if (typeof value !== 'string') throwInvalidRequest()
  const color = normalizeCategoryColor(value)
  if (!color) throw new JournalError('VALIDATION_ERROR', '請選擇有效的類別顏色。')
  return color
}
```

- [ ] **Step 4：實作 service 與 dispatcher**

在 `service.ts` 從 `./category-colors.js` 匯入 `CategoryColor` 型別。確認 Task 1 已在 `JournalService.saveCategory()` 的新類別分支加入 `color: null`，既有類別分支繼續 spread `current` 以保留顏色。新增：

```ts
setCategoryColor(id: string, color: CategoryColor | null): Category {
  return this.store.withWriteLock(() => {
    const categoryId = id.trim()
    const current = this.store.listCategories().find((category) => category.id === categoryId)
    if (!current) {
      throw new JournalError('NOT_FOUND', '找不到要更新顏色的分類。')
    }
    if (current.color === color) return { ...current }
    return this.store.saveCategory({
      ...current,
      color,
      updatedAt: this.now(),
    })
  })
}
```

在 `dispatcher.ts` 匯入 `parseCategoryColor`，並加入：

```ts
case 'setCategoryColor': {
  const id = readString(request, 'id')
  const color = parseCategoryColor(request.color)
  return { ok: true, data: getService().setCategoryColor(id, color) }
}
```

`isSupportedAction()` 與 `isJournalMutation()` 都加入 `setCategoryColor`。

- [ ] **Step 5：執行領域與 route 測試**

Run: `npm run test:run -- shared/journal/service.test.ts shared/journal/dispatcher.test.ts shared/journal/in-memory-store.test.ts api/_journal.test.ts`

Expected: PASS，包含設定、重設、停用類別、找不到 ID、非法顏色與 no-op。

- [ ] **Step 6：取得使用者核准後提交**

先出示提交訊息：`feat: 新增類別顏色領域操作`

確認後執行：

```bash
git add shared/journal/validation.ts shared/journal/service.ts shared/journal/dispatcher.ts shared/journal/service.test.ts shared/journal/dispatcher.test.ts shared/journal/in-memory-store.test.ts api/_journal.test.ts
git commit -m "feat: 新增類別顏色領域操作"
```

---

### Task 3：升級 Vercel Sheets store 至 schema v2

**Files:**
- Modify: `api/_lib/sheets-journal-store.ts`
- Modify: `api/_lib/_sheets-journal-store.test.ts`

- [ ] **Step 1：先把現有成功路徑測試改成 v2 並新增顏色 round-trip**

現有 helper 的實際簽名是 `categoryRow(id: string)`；將它改成可傳色碼但保留所有舊呼叫：

```ts
function categoryRow(id: string, color: string = ''): unknown[] {
  return [
    id,
    `Category ${id}`,
    'TRUE',
    '2026-08-20T00:00:00.000+08:00',
    '2026-08-20T00:00:00.000+08:00',
    color,
  ]
}
```

新增完整 v2 讀寫測試：

```ts
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
  const serialized = JSON.stringify(client.batchUpdate.mock.calls)
  expect(serialized).toContain('#ffe784')
})
```

- [ ] **Step 2：執行 Sheets store 測試並確認紅燈**

Run: `npm run test:run -- api/_lib/_sheets-journal-store.test.ts`

Expected: FAIL，版本仍為 `1`、categories range 仍為 `A2:E`，且 parser 只會回傳 Task 1 的暫時 `null`，不會解析自訂色。

- [ ] **Step 3：實作 v2 常數、讀寫與差異偵測**

在 `sheets-journal-store.ts` 從 `../../shared/journal/category-colors.js` 匯入 `normalizeCategoryColor`，再修改：

```ts
export const CATEGORY_HEADERS = ['id', 'name', 'isActive', 'createdAt', 'updatedAt', 'color']
export const SCHEMA_VERSION = '2'

function toCategory(values: unknown[], rowIndex: number): Category {
  const id = requiredText(values[0], '分類 ID', rowIndex)
  const rawColor = text(values[5]).trim()
  const color = rawColor ? normalizeCategoryColor(rawColor) : null
  if (rawColor && !color) {
    throw new JournalError('DATA_ERROR', `categories 第 ${rowIndex} 列的顏色不受支援。`)
  }
  return {
    id,
    name: text(values[1]),
    isActive: parseBoolean(values[2], rowIndex),
    createdAt: text(values[3]),
    updatedAt: text(values[4]),
    color,
  }
}

function categoryValues(category: Category): Array<string | boolean> {
  return [
    category.id,
    category.name,
    category.isActive,
    category.createdAt,
    category.updatedAt,
    category.color ?? '',
  ]
}
```

將 category range 改成 `categories!A2:F`；`categoriesEqual()` 加入 `left.color === right.color`。初始化 requests 自然以新的 `CATEGORY_HEADERS` 寫入六欄與版本 2。

- [ ] **Step 4：執行 v2 測試**

Run: `npm run test:run -- api/_lib/_sheets-journal-store.test.ts`

Expected: v2 初始化、空白色、大寫正規化、非法色 `DATA_ERROR`、六欄寫回及只改顏色時 flush 全部 PASS；v1 fixture 暫時仍被拒絕。

- [ ] **Step 5：取得使用者核准後提交**

先出示提交訊息：`feat: 升級類別顏色資料表結構`

確認後執行：

```bash
git add api/_lib/sheets-journal-store.ts api/_lib/_sheets-journal-store.test.ts
git commit -m "feat: 升級類別顏色資料表結構"
```

---

### Task 4：實作 v1 至 v2 的安全原子遷移

**Files:**
- Modify: `api/_lib/sheets-journal-store.ts`
- Modify: `api/_lib/_sheets-journal-store.test.ts`
- Modify: `api/_lib/legacy-migration.ts`

- [ ] **Step 1：先寫 v1 成功遷移與冪等測試**

擴充既有 `fakeClient()` options，讓第一次 `batchUpdate()` 後切換到 v2 headers 與版本，供重新驗證讀取：

```ts
schemaRangesAfterUpdate?: Array<{ range: string; values?: unknown[][] }>

let didUpdate = false
const client = {
  createSpreadsheet: vi.fn(async () => options.createdSpreadsheet ?? options.metadata),
  getSpreadsheet: vi.fn(async () => options.createdSpreadsheet ?? options.metadata),
  batchGet: vi.fn(async (_token: string, _spreadsheetId: string, ranges: string[]) => {
    if (!ranges.some((range) => range.startsWith(`${SETTINGS_SHEET_NAME}!`))) return dataRanges
    return didUpdate && options.schemaRangesAfterUpdate
      ? options.schemaRangesAfterUpdate
      : schemaRanges
  }),
  batchUpdate: vi.fn(async () => {
    didUpdate = true
  }),
}
```

加入明確 helper 與參數化測試：

```ts
function legacySchemaRanges(): Array<{ range: string; values?: unknown[][] }> {
  return [
    { range: `${ENTRY_SHEET_NAME}!1:1`, values: [ENTRY_HEADERS] },
    { range: `${CATEGORY_SHEET_NAME}!1:1`, values: [['id', 'name', 'isActive', 'createdAt', 'updatedAt']] },
    { range: `${SETTINGS_SHEET_NAME}!1:1`, values: [SETTINGS_HEADERS] },
    { range: `${SETTINGS_SHEET_NAME}!A:B`, values: [SETTINGS_HEADERS, ['schemaVersion', '1']] },
  ]
}

async function runSchemaMethod(
  method: 'initialize' | 'load' | 'verifySchema',
  client: FakeClient & GoogleSheetsClient,
): Promise<void> {
  const options = { client, accessToken: 'test-token', spreadsheetId: 'sheet-ref-a' }
  if (method === 'initialize') await SheetsJournalStore.initialize(options)
  else if (method === 'load') await SheetsJournalStore.load(options)
  else await SheetsJournalStore.verifySchema(options)
}

it.each(['initialize', 'load', 'verifySchema'] as const)(
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
    await runSchemaMethod(method, client)
    expect(client.batchUpdate).toHaveBeenCalledTimes(1)
    expect(client.batchUpdate).toHaveBeenCalledWith(
      'test-token',
      'sheet-ref-a',
      expect.arrayContaining([
        expect.objectContaining({ updateCells: expect.any(Object) }),
        expect.objectContaining({ updateCells: expect.any(Object) }),
      ]),
    )
    const serialized = JSON.stringify(client.batchUpdate.mock.calls)
    expect(serialized).toContain('color')
    expect(serialized).toContain('2')
    expect(serialized).not.toContain('Category work')
  },
)
```

另測 v2 載入時 `batchUpdate` 為 0 次。

- [ ] **Step 2：先寫所有寫入前拒絕案例**

為下列每個 fixture 斷言 reject 且 `batchUpdate` 為 0 次：

- v1 category header 順序錯誤或多欄。
- `schemaVersion` 未知、缺少或重複。
- categories F 欄已有值、格式、note、validation 或 unsupported structure。
- 壞 boolean、壞 tags／links JSON、重複記事 ID、重複類別 ID。
- entries／settings headers 不符。

- [ ] **Step 3：執行遷移測試並確認紅燈**

Run: `npm run test:run -- api/_lib/_sheets-journal-store.test.ts`

Expected: FAIL，精確 v1 仍回傳 schema mismatch，沒有 batch request。

- [ ] **Step 4：實作單一 `ensureCurrentSchema()` 流程**

在 store 內新增並讓 `initialize()`、`verifySchema()`、`load()` 共用：

```ts
type SchemaVersion = '1' | '2'
const LEGACY_CATEGORY_HEADERS = ['id', 'name', 'isActive', 'createdAt', 'updatedAt']

type InspectedSchema = ValidatedSchema & {
  version: SchemaVersion
  schemaVersionRowIndex: number
  metadata: SpreadsheetMetadata
}

async function inspectSchema(
  client: GoogleSheetsClient,
  accessToken: string,
  spreadsheetId: string,
  existingMetadata?: SpreadsheetMetadata,
): Promise<InspectedSchema> {
  const metadata = existingMetadata ?? await client.getSpreadsheet(
    accessToken,
    spreadsheetId,
    { includeGridData: true },
  )
  validateMetadataSafety(metadata)
  const sheetIds = findRequiredSheets(metadata)
  if (!sheetIds) throw schemaMismatch('Google Sheet 缺少必要工作表。')

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
  if (!headersMatch(entryHeaders, ENTRY_HEADERS)
    || !headersMatch(settingsHeaders, SETTINGS_HEADERS)) {
    throw schemaMismatch('Google Sheet 欄位不符預期。')
  }
  const versionRows = settingsRows.slice(1).flatMap((row, index) => (
    text(row[0]).trim() === 'schemaVersion'
      ? [{ value: text(row[1]).trim(), rowIndex: index + 2 }]
      : []
  ))
  if (versionRows.length !== 1) {
    throw schemaMismatch('Google Sheet settings 的 schemaVersion 不支援。')
  }
  const version = versionRows[0].value
  const isV1 = version === '1' && headersMatch(categoryHeaders, LEGACY_CATEGORY_HEADERS)
  const isV2 = version === '2' && headersMatch(categoryHeaders, CATEGORY_HEADERS)
  if (!isV1 && !isV2) {
    throw schemaMismatch('Google Sheet categories 工作表欄位或版本不符預期。')
  }
  return {
    timezone: metadata.properties.timeZone?.trim() || 'UTC',
    sheetIds,
    version: isV1 ? '1' : '2',
    schemaVersionRowIndex: versionRows[0].rowIndex,
    metadata,
  }
}

function assertLegacyColorColumnBlank(metadata: SpreadsheetMetadata, categorySheetId: number): void {
  const sheet = metadata.sheets.find(({ properties }) => properties.sheetId === categorySheetId)
  const hasSixthColumnContent = sheet?.data?.some((grid) => (
    grid.rowData?.some((row) => row.values?.some((cell, index) => (
      (grid.startColumn ?? 0) + index >= 5 && !isBlankCell(cell)
    )) ?? false) ?? false
  )) ?? false
  if (hasSixthColumnContent) {
    throw schemaMismatch('舊版 categories 的 color 欄已有資料或格式，無法安全升級。')
  }
}

async function validateCurrentSchema(
  client: GoogleSheetsClient,
  accessToken: string,
  spreadsheetId: string,
): Promise<ValidatedSchema> {
  const inspected = await inspectSchema(client, accessToken, spreadsheetId)
  if (inspected.version !== '2') {
    throw schemaMismatch('Google Sheet settings 的 schemaVersion 不支援。')
  }
  return inspected
}

async function ensureCurrentSchema(
  client: GoogleSheetsClient,
  accessToken: string,
  spreadsheetId: string,
  existingMetadata?: SpreadsheetMetadata,
): Promise<ValidatedSchema> {
  const inspected = await inspectSchema(client, accessToken, spreadsheetId, existingMetadata)
  if (inspected.version === '2') return inspected

  await readRows(client, accessToken, spreadsheetId, '1')
  assertLegacyColorColumnBlank(inspected.metadata, inspected.sheetIds[CATEGORY_SHEET_NAME])
  await client.batchUpdate(accessToken, spreadsheetId, [
    updateCellsRequest(inspected.sheetIds[CATEGORY_SHEET_NAME], 0, [['color']], 5),
    updateCellsRequest(
      inspected.sheetIds[SETTINGS_SHEET_NAME],
      inspected.schemaVersionRowIndex - 1,
      [['2']],
      1,
    ),
  ])
  return validateCurrentSchema(client, accessToken, spreadsheetId)
}
```

`readRows(..., '1')` 讀 `A2:E` 並在記憶體補 `color: null`；v2 讀 `A2:F`。`updateCellsRequest()` 增加預設為 0 的 `columnIndex` 參數。遷移 batch 只能包含 `F1=color` 與實際 schemaVersion 列的 B 欄。

`initialize()` 保留既有空白 Sheet 分支並直接建立 v2；只有已存在必要 sheets 的非空 Sheet 進入 `ensureCurrentSchema()`。`load()` 與 `verifySchema()` 直接呼叫 `ensureCurrentSchema()`。

`flush()` 只呼叫 `validateCurrentSchema()`，若遠端被改回 v1 則拒絕，不在寫回期間觸發遷移。

- [ ] **Step 5：修正 legacy migration 的資料安全註解**

把 `api/_lib/legacy-migration.ts` 中宣稱驗證「完全唯讀」的註解改為：允許 `SheetsJournalStore.load()` 進行 schema-only v1→v2 遷移，但不修改、搬移、清空或重寫任何記事與類別資料列。

- [ ] **Step 6：執行遷移與 provisioning 相關測試**

Run: `npm run test:run -- api/_lib/_sheets-journal-store.test.ts api/_lib/_legacy-migration.test.ts api/_lib/_provisioning-service.test.ts`

Expected: PASS；成功遷移只送一次原子 batch，所有不相容 fixture 在寫入前拒絕。

- [ ] **Step 7：取得使用者核准後提交**

先出示提交訊息：`feat: 自動遷移舊版類別資料表`

確認後執行：

```bash
git add api/_lib/sheets-journal-store.ts api/_lib/_sheets-journal-store.test.ts api/_lib/legacy-migration.ts
git commit -m "feat: 自動遷移舊版類別資料表"
```

---

### Task 5：讓 GAS 明確支援 v2 並拒絕 v1

**Files:**
- Modify: `gas/src/repositories/apps-script-journal-store.ts`
- Modify: `gas/src/setup.test.ts`
- Modify: `gas/src/api/dispatcher.test.ts`

- [ ] **Step 1：先寫 GAS v2 與拒絕 v1 測試**

更新初始化預期：

```ts
expect(environment.spreadsheet.getSheet('categories')?.values).toEqual([
  ['id', 'name', 'isActive', 'createdAt', 'updatedAt', 'color'],
])
expect(environment.spreadsheet.getSheet('settings')?.values).toContainEqual(['schemaVersion', '2'])
```

新增 null 與 custom round-trip，以及完整 v1 Sheet 呼叫 store 時拋出 `DATA_ERROR` 且 values 不變的測試。

- [ ] **Step 2：執行測試並確認紅燈**

Run: `npm run test:run -- gas/src/setup.test.ts gas/src/api/dispatcher.test.ts`

Expected: FAIL，GAS 仍初始化五欄與版本 1。

- [ ] **Step 3：實作 GAS v2 讀寫**

從 shared `category-colors` 匯入 `normalizeCategoryColor`。修改 constants 為六欄與版本 2；`toCategory()` 以第六欄空白解析 `null`，非空使用 `normalizeCategoryColor()`，非法值拋 `DATA_ERROR`。`saveCategory()` 尾端寫入 `category.color ?? ''`。

`ensureSchemaVersion()` 必須確認 `schemaVersion` 恰有一筆且等於 `2`；v1 直接拋錯，不修改 headers 或版本，也不加入 Advanced Sheets service。

- [ ] **Step 4：執行 GAS 測試與 build**

Run: `npm run test:run -- gas/src/setup.test.ts gas/src/api/dispatcher.test.ts && npm run build:gas`

Expected: PASS；v2 可 round-trip，v1 明確拒絕且沒有任何寫入。

- [ ] **Step 5：取得使用者核准後提交**

先出示提交訊息：`feat: 更新 GAS 類別顏色結構`

確認後執行：

```bash
git add gas/src/repositories/apps-script-journal-store.ts gas/src/setup.test.ts gas/src/api/dispatcher.test.ts
git commit -m "feat: 更新 GAS 類別顏色結構"
```

---

### Task 6：正規化前端類別資料並建立改色狀態

**Files:**
- Modify: `src/features/journal/use-journal.ts`
- Modify: `src/features/journal/use-journal.test.tsx`
- Modify: `src/i18n/zh-TW.ts`

- [ ] **Step 1：先寫回應正規化與 setCategoryColor 測試**

測試必須涵蓋：

```ts
expect(result.current.categories[0].color).toBeNull() // 舊回應省略 color
expect(result.current.categories[1].color).toBe('#b97c66') // ' #B97C66 '

await act(() => result.current.setCategoryColor('work', '#ffe784'))
expect(client.run).toHaveBeenCalledWith({
  action: 'setCategoryColor',
  id: 'work',
  color: '#ffe784',
})
expect(result.current.categories.find(({ id }) => id === 'work')?.color).toBe('#ffe784')
expect(result.current.revision).toBe(revisionBefore)
```

使用 deferred promise 驗證 pending 時 `savingCategoryColorIds.has('work')`，同 ID 第二次呼叫不送第二個 request，不同 ID 可繼續；成功與失敗都清除 ID。另驗證資料來源 epoch 更換後，以相同 ID 發出的新請求不會被舊請求的 `finally` 清除 busy 狀態。非法回應色拋出 `zhTW.errors.invalidServiceResponse`。`clearData()` 清除 busy IDs。

- [ ] **Step 2：執行 hook 測試並確認紅燈**

Run: `npm run test:run -- src/features/journal/use-journal.test.tsx`

Expected: FAIL，`setCategoryColor` 與 `savingCategoryColorIds` 不存在，缺少色仍為 `undefined`。

- [ ] **Step 3：實作 Category API 邊界正規化**

在 `use-journal.ts` 從 domain 匯入 `normalizeCategoryColor` 與 `CategoryColor`，再加入：

```ts
function toCategory(value: unknown): Category {
  if (!isRecord(value)) throw new Error(zhTW.errors.invalidServiceResponse)
  const rawColor = value.color
  let color: CategoryColor | null | undefined
  if (rawColor === undefined || rawColor === null) {
    color = null
  } else if (typeof rawColor === 'string') {
    color = normalizeCategoryColor(rawColor)
  }
  if (rawColor !== undefined && rawColor !== null && color === undefined) {
    throw new Error(zhTW.errors.invalidServiceResponse)
  }
  return { ...(value as Category), color: color ?? null }
}

function toCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) throw new Error(zhTW.errors.invalidServiceResponse)
  return value.map(toCategory)
}

function toBootstrapData(value: unknown): BootstrapData {
  if (!isRecord(value)
    || typeof value.timezone !== 'string'
    || !Array.isArray(value.tagSuggestions)
    || value.tagSuggestions.some((tag) => typeof tag !== 'string')) {
    throw new Error(zhTW.errors.invalidServiceResponse)
  }
  return {
    timezone: value.timezone,
    categories: toCategories(value.categories),
    tagSuggestions: [...value.tagSuggestions] as string[],
  }
}
```

`loadBootstrap()`、`toCategoryManagementData()`、`saveCategory()`、activate/deactivate 與新改色回應都走 `toCategory()`。

- [ ] **Step 4：實作跨頁 busy IDs 與專用 mutation**

先在 `zhTW.errors` 加入：

```ts
categoryColorSaving: '此類別的顏色正在儲存，請稍候。',
```

```ts
const [savingCategoryColorIds, setSavingCategoryColorIds] = useState<ReadonlySet<string>>(new Set())
const savingCategoryColorRequestsRef = useRef(new Map<string, symbol>())

const setCategoryColor = async (id: string, color: CategoryColor | null): Promise<Category> => {
  if (savingCategoryColorRequestsRef.current.has(id)) {
    throw new Error(zhTW.errors.categoryColorSaving)
  }
  const current = categories.find((category) => category.id === id)
  if (current?.color === color) return current

  const expectedEpoch = requestEpoch.current
  const requestToken = Symbol(id)
  savingCategoryColorRequestsRef.current.set(id, requestToken)
  setSavingCategoryColorIds(new Set(savingCategoryColorRequestsRef.current.keys()))
  setError(undefined)
  try {
    const category = toCategory(await client.run<unknown>({ action: 'setCategoryColor', id, color }))
    if (expectedEpoch !== requestEpoch.current) throw new RequestInvalidatedError()
    setCategories((items) => upsertCategory(items, category))
    return category
  } catch (categoryError) {
    if (!(categoryError instanceof RequestInvalidatedError)) handleRequestError(categoryError, expectedEpoch)
    throw categoryError
  } finally {
    if (savingCategoryColorRequestsRef.current.get(id) === requestToken) {
      savingCategoryColorRequestsRef.current.delete(id)
      if (expectedEpoch === requestEpoch.current) {
        setSavingCategoryColorIds(new Set(savingCategoryColorRequestsRef.current.keys()))
      }
    }
  }
}
```

`clearData()` 同時 clear request map 與 state；hook return 加入 `setCategoryColor`、`savingCategoryColorIds`。此方法不可呼叫 `setRevision()`、`loadEntries()` 或 `loadCategoryManagement()`。

- [ ] **Step 5：執行 hook 測試**

Run: `npm run test:run -- src/features/journal/use-journal.test.tsx`

Expected: PASS；包含缺欄相容、非法回應拒絕、同 ID 去重、跨頁 busy、rollback 所需 reject 及 revision 不變。

- [ ] **Step 6：取得使用者核准後提交**

先出示提交訊息：`feat: 串接類別顏色前端狀態`

確認後執行：

```bash
git add src/features/journal/use-journal.ts src/features/journal/use-journal.test.tsx src/i18n/zh-TW.ts
git commit -m "feat: 串接類別顏色前端狀態"
```

---

### Task 7：建立可存取的固定色票選單

**Files:**
- Create: `src/features/categories/category-color-menu.tsx`
- Create: `src/features/categories/category-color-menu.test.tsx`
- Modify: `src/i18n/zh-TW.ts`
- Modify: `src/styles/global.css`

- [ ] **Step 1：先寫色票元件失敗測試**

測試 24 個 `menuitemradio`、null 選中預設、自訂色選中、初始 focus、Arrow 左右與上下、Home／End、Enter／Space、Escape、外部 `pointerdown`、焦點回復及 viewport clamp：

```tsx
render(
  <CategoryColorMenu
    selectedColor={null}
    position={{ x: 100, y: 100 }}
    restoreFocusTo={trigger}
    onSelect={onSelect}
    onClose={onClose}
  />,
)

expect(screen.getAllByRole('menuitemradio')).toHaveLength(24)
expect(screen.getByRole('menuitemradio', { name: '預設' })).toHaveAttribute('aria-checked', 'true')
await user.keyboard('{End}{Enter}')
expect(onSelect).toHaveBeenCalledWith('#c7c3c2')
```

- [ ] **Step 2：執行測試並確認紅燈**

Run: `npm run test:run -- src/features/categories/category-color-menu.test.tsx`

Expected: FAIL，找不到 `category-color-menu`。

- [ ] **Step 3：新增完整 i18n 色名與操作文案**

在 `zhTW` 加入：

```ts
categoryColors: {
  title: '類別顏色',
  set: (name: string) => `設定「${name}」的類別顏色`,
  saving: (name: string) => `正在儲存「${name}」的類別顏色`,
  saved: (name: string) => `「${name}」的類別顏色已更新。`,
  names: {
    default: '預設',
    '#b97c66': '陶土', '#d26865': '灰紅', '#fe382f': '亮紅',
    '#fe4f3c': '珊瑚紅', '#ff703d': '橘紅', '#ffa84b': '橘',
    '#ffcb65': '琥珀', '#ffe784': '黃', '#b0da64': '黃綠',
    '#60c844': '草綠', '#19a76a': '綠', '#46cc9b': '翠綠',
    '#93d5bb': '薄荷', '#93d4d9': '水藍', '#a6c9e4': '淺藍',
    '#4b86df': '藍', '#8f91f1': '長春花藍', '#b091ef': '薰衣草',
    '#9b70d8': '紫', '#ca64db': '洋紅', '#eb7c9c': '粉紅',
    '#c6a6a7': '灰粉', '#c7c3c2': '淺灰',
  },
},
```

`errors` 加入 `categoryColor: '無法更新類別顏色，請稍後再試。'`；`categoryColorSaving` 已由 Task 6 建立。

- [ ] **Step 4：實作 `CategoryColorMenu`**

元件 props 固定為：

```ts
export type CategoryColorMenuProps = {
  selectedColor: CategoryColor | null
  position: Readonly<{ x: number; y: number }>
  restoreFocusTo: HTMLElement | null
  onSelect: (color: CategoryColor | null) => void
  onClose: () => void
}
```

核心資料與鍵盤邏輯：

```ts
const options: ReadonlyArray<CategoryColor | null> = [null, ...CATEGORY_COLORS]
const selectedIndex = Math.max(0, options.findIndex((color) => color === selectedColor))

function columnCount(): number {
  if (window.innerWidth < 360) return 5
  if (window.innerWidth < 520) return 6
  return 8
}

function nextIndex(current: number, key: string): number {
  const columns = columnCount()
  const delta = key === 'ArrowRight' ? 1
    : key === 'ArrowLeft' ? -1
      : key === 'ArrowDown' ? columns
        : key === 'ArrowUp' ? -columns
          : 0
  return (current + delta + options.length) % options.length
}
```

根節點使用 `role="menu"` 與 `aria-labelledby`；按鈕使用 `role="menuitemradio"`、`aria-checked`、roving `tabIndex`、`aria-label`、`title`。`useLayoutEffect` 量測 menu rect，位置 clamp 到 8px viewport margin；`useEffect` 綁定 document `pointerdown` 與初始 focus。cleanup 時只在 `restoreFocusTo.isConnected` 才回復焦點。

每個色塊用 inline custom property 顯示實際顏色，預設選項只用預覽色而仍傳回 `null`：

```tsx
type ColorOptionStyle = CSSProperties & { '--color-option': string }

const optionStyle = {
  '--color-option': color ?? DEFAULT_CATEGORY_COLOR,
} as ColorOptionStyle

<button
  role="menuitemradio"
  aria-checked={isSelected}
  aria-label={label}
  title={label}
  style={optionStyle}
>
  {isSelected && <Icon className="category-color-menu__check">check</Icon>}
</button>
```

- [ ] **Step 5：加入色票樣式**

```css
.category-color-menu {
  position: fixed;
  z-index: 70;
  max-width: calc(100vw - 1rem);
  max-height: calc(100vh - 1rem);
  overflow: auto;
  padding: 0.75rem;
  border: 1px solid var(--outline-variant);
  border-radius: 0.75rem;
  background: var(--surface-card);
  box-shadow: 0 0.75rem 2rem rgb(25 28 30 / 0.18);
}

.category-color-menu__grid {
  display: grid;
  grid-template-columns: repeat(8, 2.5rem);
  gap: 0.5rem;
}

.category-color-menu__option {
  position: relative;
  width: 2.5rem;
  height: 2.5rem;
  border: 2px solid transparent;
  border-radius: 50%;
  background: var(--color-option);
}

.category-color-menu__option--selected {
  border-color: var(--ink);
  box-shadow: 0 0 0 2px var(--surface-card);
}

@media (max-width: 32.5rem) {
  .category-color-menu__grid { grid-template-columns: repeat(6, 2.5rem); }
}

@media (max-width: 22.5rem) {
  .category-color-menu__grid { grid-template-columns: repeat(5, 2.5rem); }
}
```

- [ ] **Step 6：執行色票元件測試**

Run: `npm run test:run -- src/features/categories/category-color-menu.test.tsx`

Expected: PASS，所有滑鼠、鍵盤、焦點與定位案例通過。

- [ ] **Step 7：取得使用者核准後提交**

先出示提交訊息：`feat: 新增可存取類別色票`

確認後執行：

```bash
git add src/features/categories/category-color-menu.tsx src/features/categories/category-color-menu.test.tsx src/i18n/zh-TW.ts src/styles/global.css
git commit -m "feat: 新增可存取類別色票"
```

---

### Task 8：把色票接到類別卡片

**Files:**
- Create: `src/utils/category-color.ts`
- Modify: `src/features/categories/category-manager.tsx`
- Modify: `src/features/categories/category-manager.test.tsx`
- Modify: `src/styles/global.css`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1：先寫類別管理入口、preview 與 rollback 測試**

加入案例：

```tsx
expect(screen.getByRole('button', { name: '設定「工作」的類別顏色' }))
  .toHaveAttribute('aria-haspopup', 'menu')

fireEvent.contextMenu(screen.getByRole('article', { name: /工作/ }), {
  clientX: 120,
  clientY: 160,
})
expect(screen.getByRole('menu', { name: '類別顏色' })).toBeInTheDocument()

await user.click(screen.getByRole('menuitemradio', { name: '黃' }))
expect(categoryIcon).toHaveStyle({ '--category-color': '#ffe784' })
expect(onSetColor).toHaveBeenCalledWith('work', '#ffe784')
```

使用 deferred success／failure 驗證 busy、`aria-busy`、status、rollback；停用類別仍有入口；busy 類別右鍵不開 menu，其他類別可開；重選目前顏色不呼叫 `onSetColor`。

- [ ] **Step 2：執行測試並確認紅燈**

Run: `npm run test:run -- src/features/categories/category-manager.test.tsx src/App.test.tsx`

Expected: FAIL，沒有色票入口、preview 或新 props。

- [ ] **Step 3：建立受型別保護的 CSS custom property helper**

建立 `src/utils/category-color.ts`：

```ts
import type { CSSProperties } from 'react'
import type { CategoryColor } from '../domain/journal'

export type CategoryColorStyle = CSSProperties & {
  '--category-color': CategoryColor
}

export function categoryColorStyle(color: CategoryColor | null): CategoryColorStyle | undefined {
  return color === null ? undefined : { '--category-color': color }
}
```

- [ ] **Step 4：實作 CategoryManager 狀態與入口**

擴充 props：

```ts
savingCategoryColorIds: ReadonlySet<string>
onSetColor: (id: string, color: CategoryColor | null) => Promise<Category>
```

新增：

```ts
type OpenColorMenu = {
  categoryId: string
  position: Readonly<{ x: number; y: number }>
  restoreFocusTo: HTMLElement
}

const [openColorMenu, setOpenColorMenu] = useState<OpenColorMenu>()
const [colorPreviews, setColorPreviews] = useState<ReadonlyMap<string, CategoryColor | null>>(new Map())
const [colorStatus, setColorStatus] = useState<string>()
```

card 設 `tabIndex={-1}` 及 `aria-label={category.name}`。右鍵使用 `clientX/clientY`；調色盤按鈕使用 `getBoundingClientRect().left` 與 `bottom + 8`。menu render 在 `.category-grid` 外、`CategoryManager` root 尾端，避免卡片 transform 影響 fixed positioning。

調色盤入口沿用現有 tooltip，不新增另一套 tooltip 元件：

```tsx
<CategoryActionTooltip id={`category-tooltip-color-${category.id}`} content={zhTW.categoryColors.set(category.name)}>
  <button
    className="icon-button"
    type="button"
    aria-label={zhTW.categoryColors.set(category.name)}
    aria-describedby={`category-tooltip-color-${category.id}`}
    aria-haspopup="menu"
    aria-busy={isColorSaving}
    disabled={isColorSaving}
    onClick={(event) => openColorMenuFromButton(category, event.currentTarget)}
  >
    <Icon>palette</Icon>
  </button>
</CategoryActionTooltip>
```

card 的 `onContextMenu` 必須先檢查 busy ID；可開啟時呼叫 `event.preventDefault()` 並以 `event.currentTarget` 作為焦點回復目標。

preview 必須用 `colorPreviews.has(category.id)` 判斷，因為 `null` 是有效的「重設預設」preview。

- [ ] **Step 5：實作選色成功／失敗處理與樣式**

```ts
const handleSetColor = async (category: Category, color: CategoryColor | null) => {
  setOpenColorMenu(undefined)
  if (category.color === color) return
  setError(undefined)
  setColorStatus(undefined)
  setColorPreviews((current) => new Map(current).set(category.id, color))
  try {
    await onSetColor(category.id, color)
    setColorStatus(zhTW.categoryColors.saved(category.name))
  } catch (colorError) {
    setError(colorError instanceof Error ? colorError.message : zhTW.errors.categoryColor)
  } finally {
    setColorPreviews((current) => {
      const next = new Map(current)
      next.delete(category.id)
      return next
    })
  }
}
```

圖示改為：

```tsx
<div className="category-card__icon" style={categoryColorStyle(displayColor)}>
  <Icon>{category.isActive ? 'folder' : 'inventory_2'}</Icon>
</div>
```

CSS：

```css
.category-card__icon {
  background: var(--category-color, var(--secondary-container));
}

.category-card:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: 3px;
}
```

加入 `<p className="sr-only" role="status">{colorStatus}</p>`。

- [ ] **Step 6：串接 App 並讓跨頁錯誤可見**

從 hook 解構 `setCategoryColor` 與 `savingCategoryColorIds`，傳給 `CategoryManager`。把共用 `error` 區塊移到 `.app-main` 的頁面條件外，並在 `page === 'categories'` 時避免與 manager local alert 重複；focused `EntryDetail` 畫面也補全域錯誤區。

- [ ] **Step 7：執行類別管理與 App 測試**

Run: `npm run test:run -- src/features/categories/category-manager.test.tsx src/App.test.tsx`

Expected: PASS，右鍵、按鈕、焦點、停用類別、busy、preview、rollback、跨頁錯誤全部通過。

- [ ] **Step 8：取得使用者核准後提交**

先出示提交訊息：`feat: 在類別卡片設定顏色`

確認後執行：

```bash
git add src/utils/category-color.ts src/features/categories/category-manager.tsx src/features/categories/category-manager.test.tsx src/styles/global.css src/App.tsx src/App.test.tsx
git commit -m "feat: 在類別卡片設定顏色"
```

---

### Task 9：同步時間軸與記事詳情標籤顏色

**Files:**
- Modify: `src/features/entries/timeline.tsx`
- Create: `src/features/entries/timeline.test.tsx`
- Modify: `src/features/entries/entry-card.tsx`
- Modify: `src/features/entries/entry-card.test.tsx`
- Modify: `src/features/entries/entry-detail.tsx`
- Create: `src/features/entries/entry-detail.test.tsx`
- Modify: `src/styles/global.css`
- Modify: `src/App.tsx`

- [ ] **Step 1：先寫 EntryCard 與 EntryDetail 標籤測試**

兩個元件都驗證：

```tsx
expect(renderBadge({ categoryColor: null })).not.toHaveStyle('--category-color: #b97c66')
expect(renderBadge({ categoryColor: '#b97c66' })).toHaveStyle('--category-color: #b97c66')
expect(renderBadge({ categoryColor: '#b97c66' })).toHaveClass('category-badge--custom-color')
```

- [ ] **Step 2：先寫 Timeline lookup 測試**

已知類別傳名稱與顏色；`color: null` 不設定 property；未知類別使用 `zhTW.detail.category` 且不設定 property；停用類別照常套色。

- [ ] **Step 3：執行測試並確認紅燈**

Run: `npm run test:run -- src/features/entries/entry-card.test.tsx src/features/entries/entry-detail.test.tsx src/features/entries/timeline.test.tsx`

Expected: FAIL，元件沒有 `categoryColor` prop，Timeline 只傳名稱。

- [ ] **Step 4：實作 props 與 lookup**

`EntryCardProps`、`EntryDetailProps` 加入必要的 `categoryColor: CategoryColor | null`，並從 `src/utils/category-color.ts` 匯入 `categoryColorStyle`。badge 使用：

```tsx
<span
  className={`category-badge${categoryColor ? ' category-badge--custom-color' : ''}`}
  style={categoryColorStyle(categoryColor)}
>
  {categoryName}
</span>
```

`EntryDetail` 保留 badge 內既有的 `<Icon>folder</Icon>`，只在外層 span 增加 class 與 style，不移除資料夾圖示。

Timeline 改成：

```ts
const categoriesById = new Map(categories.map((category) => [category.id, category]))
const category = categoriesById.get(entry.categoryId)
```

傳 `category?.name ?? zhTW.detail.category` 與 `category?.color ?? null`。

App 的 selected detail 先取得 `selectedCategory`，再傳名稱與顏色；不要把顏色存進 `selectedEntry`。

- [ ] **Step 5：實作 badge CSS fallback**

```css
.category-badge {
  background: var(--category-color, var(--secondary-container));
}

.category-badge--custom-color {
  color: var(--ink);
}
```

- [ ] **Step 6：執行標籤與 App 測試**

Run: `npm run test:run -- src/features/entries/entry-card.test.tsx src/features/entries/entry-detail.test.tsx src/features/entries/timeline.test.tsx src/App.test.tsx`

Expected: PASS，預設標籤仍使用原 token，自訂色完全一致，未知類別 fallback 正常。

- [ ] **Step 7：取得使用者核准後提交**

先出示提交訊息：`feat: 同步記事類別標籤顏色`

確認後執行：

```bash
git add src/features/entries/timeline.tsx src/features/entries/timeline.test.tsx src/features/entries/entry-card.tsx src/features/entries/entry-card.test.tsx src/features/entries/entry-detail.tsx src/features/entries/entry-detail.test.tsx src/styles/global.css src/App.tsx src/App.test.tsx
git commit -m "feat: 同步記事類別標籤顏色"
```

---

### Task 10：同步月曆日期格與「更多」清單顏色

**Files:**
- Modify: `src/features/entries/calendar-view.tsx`
- Modify: `src/features/entries/calendar-view.test.tsx`
- Modify: `src/styles/global.css`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1：先寫 CalendarView 色彩測試**

傳入 `categories` 後驗證：

```tsx
expect(screen.getByRole('button', { name: /自訂色記事/ }))
  .toHaveStyle('--category-color: #b97c66')
expect(screen.getByRole('button', { name: /預設色記事/ }))
  .not.toHaveAttribute('style')
expect(screen.getByRole('button', { name: /還有 1 則記事/ }))
  .not.toHaveStyle('--category-color: #b97c66')
```

開啟「更多」後，逐筆驗證 custom、null、未知類別與停用類別；「更多」按鈕本身維持 `.calendar-entry--more` 且沒有 custom property。

- [ ] **Step 2：執行測試並確認紅燈**

Run: `npm run test:run -- src/features/entries/calendar-view.test.tsx src/App.test.tsx`

Expected: FAIL，`CalendarViewProps` 沒有 categories，記事與 picker 都不解析類別。

- [ ] **Step 3：實作 CalendarView lookup 與樣式傳遞**

Props 加入 `categories: Category[]`，render 起點建立：

```ts
const categoriesById = new Map(categories.map((category) => [category.id, category]))
```

日期格與 picker 內每筆記事都以 `categoriesById.get(entry.categoryId)?.color ?? null` 取得顏色並套 `categoryColorStyle()`。「更多」按鈕不查類別、不設定 property。

App 傳入目前 `categories`；月曆 effect 不加入 categories dependency，改色也不增加 revision。

- [ ] **Step 4：修改月曆 CSS 以保留自訂色 hover／focus**

```css
.calendar-entry {
  background: var(--category-color, var(--surface-container));
}

.calendar-entry:hover,
.calendar-entry:focus-visible {
  border-color: var(--primary);
  background: var(--category-color, var(--surface-card));
}

.calendar-entry-picker__item {
  background: var(--category-color, var(--surface-low));
}

.calendar-entry-picker__item:hover,
.calendar-entry-picker__item:focus-visible {
  border-color: var(--primary);
  background: var(--category-color, var(--primary-fixed));
}
```

`.calendar-entry--more` 保留既有規則且不設定 `--category-color`。

- [ ] **Step 5：加入 App 不重抓月份的整合測試**

以 deferred `setCategoryColor`：在類別頁開始改色，切到月曆，完成 request 後確認日期格改色，且 `getMonthlyEntries` 呼叫次數沒有因改色完成而增加。重設 `null` 後，badge 回到淺藍 token、月曆回到各自灰色 token，而不是把所有預設背景統一成 `#d0e1fb`。

- [ ] **Step 6：執行月曆與 App 測試**

Run: `npm run test:run -- src/features/entries/calendar-view.test.tsx src/App.test.tsx`

Expected: PASS，日期格、picker、未知類別、停用類別、更多按鈕及不重抓月份都符合規格。

- [ ] **Step 7：取得使用者核准後提交**

先出示提交訊息：`feat: 同步月曆記事類別顏色`

確認後執行：

```bash
git add src/features/entries/calendar-view.tsx src/features/entries/calendar-view.test.tsx src/styles/global.css src/App.tsx src/App.test.tsx
git commit -m "feat: 同步月曆記事類別顏色"
```

---

### Task 11：完整驗證與手動驗收準備

**Files:**
- Verify all files changed by Tasks 1-10
- Modify only files required to fix verification failures caused by this feature

- [ ] **Step 1：執行各層重點測試**

Run:

```bash
npm run test:run -- shared/journal/category-colors.test.ts shared/journal/service.test.ts shared/journal/dispatcher.test.ts api/_lib/_sheets-journal-store.test.ts gas/src/setup.test.ts src/features/journal/use-journal.test.tsx src/features/categories/category-color-menu.test.tsx src/features/categories/category-manager.test.tsx src/features/entries/timeline.test.tsx src/features/entries/entry-card.test.tsx src/features/entries/entry-detail.test.tsx src/features/entries/calendar-view.test.tsx src/App.test.tsx
```

Expected: PASS，沒有 skipped 或只更新 snapshot 的替代處理。

- [ ] **Step 2：執行完整品質檢查**

Run: `npm run check`

Expected: lint、全部 Vitest、TypeScript/Vite build 與 GAS build 全部成功，exit code 0。

- [ ] **Step 3：檢查 diff 與 migration 安全性**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

確認：

- v1 migration batch 只有 `categories!F1` 與 schemaVersion B 欄。
- Category 資料 range 是 `A2:F`，Entry 仍是 `A2:I`。
- `setCategoryColor` 出現在 `isJournalMutation()`。
- 改色不呼叫 `setRevision()`。
- 預設狀態不設定 `--category-color`。
- `.calendar-entry--more` 沒有類別色。
- 未納入工作區中其他人的檔案。

- [ ] **Step 4：準備手動驗收清單**

依規格執行或交付下列驗收：v1 首次登入遷移、桌面右鍵、調色盤按鈕、純鍵盤、手機 viewport、停用類別、預設背景差異、時間軸、詳情、日期格、「更多」清單、重新整理持久化、失敗 rollback。

- [ ] **Step 5：遇到驗證失敗時回到責任 Task**

若 Step 1-4 發現問題，不在本 Task 建立籠統修正 commit。回到負責該檔案的 Task，新增能重現問題的失敗測試、完成最小修正、重跑該 Task 與 `npm run check`，再依該 Task 的繁體中文提交訊息審核流程建立 commit。若沒有失敗，直接進入程式碼審查，不建立空 commit。

- [ ] **Step 6：請求程式碼審查**

使用 `superpowers:requesting-code-review`，依嚴重度檢查資料遷移、mutation 安全性、非同步競態、無障礙操作、預設色 fallback 與測試缺口。修正任何阻斷問題後重新執行 `npm run check`。

---

## 完成條件

- 核准規格的每一項產品規則都有 production code 與對應測試。
- 精確 v1 Sheet 可無感原子升級；任何不相容資料都在寫入前拒絕。
- GAS v2 可建置與讀寫，GAS v1 明確拒絕且不改資料。
- 類別色可從右鍵與調色盤按鈕操作，鍵盤與焦點行為完整。
- 自訂色同步到類別圖示、時間軸、詳情、月曆日期格與 picker。
- 未選自訂色時，各畫面保留原有預設背景。
- `npm run check` 在最終工作樹通過。
- 所有 commit 都只包含本功能檔案，且提交訊息已事先取得使用者確認。
