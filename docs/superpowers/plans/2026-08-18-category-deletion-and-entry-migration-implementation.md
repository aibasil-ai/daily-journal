# 類別刪除與記事搬移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者可安全永久刪除空類別，並能在類別管理頁面單筆或跨頁多筆搬移記事至另一個啟用類別。

**Architecture:** 後端以類別管理摘要提供完整記事數，並在同一把 Apps Script 寫入鎖內驗證及執行搬移／刪除。前端將搬移面板與主時間軸狀態分離，以記事 ID 保留跨頁選取；所有寫入完成後重新取得摘要與主記事資料。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、Testing Library、Google Apps Script、Google Sheets、Vercel API proxy。

**Spec:** `docs/superpowers/specs/2026-08-18-category-deletion-and-entry-migration-design.md`

## Global Constraints

- 不新增第三方套件；維持 Node.js `>=20.19.0`、React、Vite、Vitest 與 Apps Script 現有架構。
- 所有新增使用者文案集中於 `src/i18n/zh-TW.ts`，介面維持繁體中文。
- 有任何記事的類別不得永久刪除；伺服器必須在寫入鎖中重新驗證，而非相信前端計數。
- 搬移目的地必須是不同且啟用中的類別；搬移不刪除記事，並更新每筆記事的 `updatedAt`。
- 不提供「全選整個類別」、拖放、搬移歷史、撤銷或軟刪除。
- 單筆與批次搬移均需確認；跨已載入頁面的勾選必須保留。
- 搬移面板重用既有 `listEntries` 分頁 API，且不得改變主時間軸／月曆篩選狀態。
- 每一項工作採先寫失敗測試、最小實作、通過測試、只暫存列出的檔案後提交的順序。

---

## 檔案結構與責任分配

| 檔案 | 變更 | 責任 |
| --- | --- | --- |
| `gas/src/domain/journal.ts` | 修改 | 宣告類別管理摘要與搬移 API 的 JSON 型別。 |
| `gas/src/domain/validation.ts` | 修改 | 將未知搬移請求解析為受信任的輸入。 |
| `gas/src/repositories/journal-store.ts` | 修改 | 宣告批次儲存記事與刪除類別的持久層介面。 |
| `gas/src/repositories/apps-script-journal-store.ts` | 修改 | 以單次工作表資料寫入更新選取記事，並刪除類別列。 |
| `gas/src/test/fake-journal-store.ts` | 修改 | 使 Node 領域測試能模擬批次更新與類別刪除。 |
| `gas/src/services/journal-service.ts` | 修改 | 實作完整計數、搬移驗證與空類別刪除規則。 |
| `gas/src/services/journal-service.test.ts` | 修改 | 驗證核心資料規則及全有或全無的驗證行為。 |
| `gas/src/api/dispatcher.ts` | 修改 | 分派新 API 動作。 |
| `gas/src/api/dispatcher.test.ts` | 修改 | 驗證 API 成功／輸入錯誤／衝突回應。 |
| `gas/src/setup.test.ts` | 修改 | 驗證 Google Sheets 批次寫入與類別資料列刪除。 |
| `src/domain/journal.ts` | 修改 | 與 GAS API 型別同步。 |
| `src/features/journal/use-journal.ts` | 修改 | 保存類別管理摘要，提供讀取搬移清單、搬移與刪除操作。 |
| `src/features/journal/use-journal.test.tsx` | 修改 | 驗證摘要刷新、搬移刷新與失敗狀態。 |
| `src/App.tsx` | 修改 | 將後端完整計數與類別操作傳入管理元件，不再由已載入時間軸推算。 |
| `src/App.test.tsx` | 修改 | 將假 API 更新為類別管理摘要契約。 |
| `src/features/categories/category-entry-move-panel.tsx` | 建立 | 呈現來源記事、跨頁選取、單筆與批次確認流程。 |
| `src/features/categories/category-entry-move-panel.test.tsx` | 建立 | 驗證面板的單筆、跨頁多筆、無目的地與錯誤流程。 |
| `src/features/categories/category-manager.tsx` | 修改 | 增加搬移入口、空類別永久刪除及確認對話框。 |
| `src/features/categories/category-manager.test.tsx` | 修改 | 驗證非空類別限制、搬移入口與永久刪除。 |
| `src/i18n/zh-TW.ts` | 修改 | 集中類別搬移與永久刪除文案。 |
| `src/styles/global.css` | 修改 | 定義搬移面板、批次工具列、記事列與行動裝置版面。 |
| `docs/acceptance-checklist.md` | 修改 | 新增實際 Google Sheets 的搬移與刪除驗收步驟。 |

## 共用介面契約

後端與前端的 `journal.ts` 必須使用相同的 JSON 形狀：

```ts
export type CategoryManagementData = {
  categories: Category[]
  entryCounts: Record<string, number>
}

export type MoveEntriesInput = {
  sourceCategoryId: string
  targetCategoryId: string
  entryIds: string[]
}

export type MoveEntriesResult = {
  movedCount: number
}

// ApiRequest 的新增成員
| { action: 'moveEntries'; sourceCategoryId: string; targetCategoryId: string; entryIds: string[] }
| { action: 'deleteCategory'; id: string }
```

`JournalStore` 的新增介面如下；服務層負責商業規則，store 只處理已驗證的資料列：

```ts
saveEntries(entries: Entry[]): Entry[]
deleteCategory(id: string): void
```

前端搬移面板使用下列 props，讓元件不直接依賴 `JournalApiClient`：

```ts
type CategoryEntryMovePanelProps = {
  source: Category
  entryCount: number
  categories: Category[]
  onLoadPage: (sourceCategoryId: string, cursor: string | null) => Promise<EntryListData>
  onMoveEntries: (sourceCategoryId: string, targetCategoryId: string, entryIds: string[]) => Promise<void>
  onClose: () => void
}
```

### Task 1: 領域規則、類別摘要與記憶體儲存庫

**Files:**

- Modify: `gas/src/domain/journal.ts:1-91`
- Modify: `gas/src/repositories/journal-store.ts:1-14`
- Modify: `gas/src/test/fake-journal-store.ts:1-76`
- Modify: `gas/src/services/journal-service.ts:1-302`
- Test: `gas/src/services/journal-service.test.ts:1-284`

**Interfaces:**

- Consumes: 既有 `Category`、`Entry`、`JournalError`、`withWriteLock` 與 `now()`。
- Produces: `CategoryManagementData`、`MoveEntriesInput`、`MoveEntriesResult`、`JournalService.moveEntries()`、`JournalService.deleteCategory()`，供 dispatcher 與前端 API 契約使用。

- [ ] **Step 1: 先寫服務層失敗測試，固定摘要、搬移及刪除結果。**

在 `gas/src/services/journal-service.test.ts` 的類別測試附近新增案例。使用 `work`、`life`、停用的 `old` 三個類別，以及 `one`、`two` 兩則屬於 `work` 的記事；斷言摘要計數是完整資料而非分頁結果。

```ts
it('提供完整類別記事數，且只允許刪除空類別', () => {
  const service = createService({
    categories: [category({ id: 'work' }), category({ id: 'life', name: '生活' })],
    entries: [entry({ id: 'one', categoryId: 'work' }), entry({ id: 'two', categoryId: 'work' })],
  })

  expect(service.listCategories()).toMatchObject({
    categories: [expect.objectContaining({ id: 'life' }), expect.objectContaining({ id: 'work' })],
    entryCounts: { work: 2, life: 0 },
  })
  expect(() => service.deleteCategory('work')).toThrow('類別仍有記事，請先搬移所有記事後再刪除。')
  service.deleteCategory('life')
  expect(service.listCategories().categories).not.toContainEqual(expect.objectContaining({ id: 'life' }))
})

it('搬移前驗證整批選取，成功時同時更新分類與 updatedAt', () => {
  const store = new FakeJournalStore({
    categories: [category({ id: 'work' }), category({ id: 'life', name: '生活' })],
    entries: [entry({ id: 'one', categoryId: 'work' }), entry({ id: 'two', categoryId: 'work' })],
  })
  const service = new JournalService(store, () => '2026-08-18T10:00:00+08:00', () => 'unused')

  expect(service.moveEntries({ sourceCategoryId: 'work', targetCategoryId: 'life', entryIds: ['one', 'two'] }))
    .toEqual({ movedCount: 2 })
  expect(store.getEntry('one')).toMatchObject({ categoryId: 'life', updatedAt: '2026-08-18T10:00:00+08:00' })
  expect(store.getEntry('two')).toMatchObject({ categoryId: 'life', updatedAt: '2026-08-18T10:00:00+08:00' })
})

it('遇到停用目的地或非來源記事時不搬移任何記事', () => {
  const store = new FakeJournalStore({
    categories: [category({ id: 'work' }), category({ id: 'life', name: '生活' }), category({ id: 'old', isActive: false })],
    entries: [entry({ id: 'work-entry', categoryId: 'work' }), entry({ id: 'life-entry', categoryId: 'life' })],
  })
  const service = new JournalService(store, () => timestamp, () => 'unused')

  expect(() => service.moveEntries({ sourceCategoryId: 'work', targetCategoryId: 'old', entryIds: ['work-entry'] }))
    .toThrow('搬移目的地必須是啟用中的類別。')
  expect(() => service.moveEntries({ sourceCategoryId: 'work', targetCategoryId: 'life', entryIds: ['work-entry', 'life-entry'] }))
    .toThrow('其中一則記事已不屬於來源類別，請重新整理後再試。')
  expect(store.getEntry('work-entry')?.categoryId).toBe('work')
})
```

- [ ] **Step 2: 執行服務測試，確認新測試在 API 尚未存在時失敗。**

Run: `npm run test:run -- gas/src/services/journal-service.test.ts`

Expected: FAIL，顯示 `deleteCategory` 與 `moveEntries` 尚未定義，或 `listCategories()` 回傳陣列而非摘要物件。

- [ ] **Step 3: 加入後端型別、store 契約與 FakeJournalStore 的最小實作。**

在 `gas/src/domain/journal.ts` 新增共用介面契約中的三個型別與兩個 `ApiRequest` 成員。在 `JournalStore` 加入 `saveEntries`、`deleteCategory`；`FakeJournalStore` 以複製值實作兩者，且找不到類別時沿用現有 `NOT_FOUND` 風格。

```ts
saveEntries(entries: Entry[]): Entry[] {
  return entries.map((entry) => this.saveEntry(entry))
}

deleteCategory(id: string): void {
  const index = this.categories.findIndex((category) => category.id === id)
  if (index === -1) throw new JournalError('NOT_FOUND', '找不到要刪除的分類。')
  this.categories.splice(index, 1)
}
```

- [ ] **Step 4: 實作 `JournalService` 的摘要、搬移及刪除規則。**

將 `listCategories()` 改為回傳排序後類別與完整計數。新增 `moveEntries(input)` 和 `deleteCategory(id)`，各自以 `this.store.withWriteLock()` 包住讀取、驗證和寫入。每個 ID 先 `trim()`；空陣列、重複 ID、缺少來源／目的地、相同類別、停用目的地及不屬來源的記事都拋出指定中文 `JournalError`。先完成所有選取記事的檢查，再呼叫一次 `this.store.saveEntries()`。

```ts
listCategories(): CategoryManagementData {
  const categories = [...this.store.listCategories()].sort((left, right) => {
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  const entryCounts = Object.fromEntries(categories.map((category) => [category.id, 0])) as Record<string, number>
  for (const entry of this.store.listEntries()) {
    if (entryCounts[entry.categoryId] !== undefined) entryCounts[entry.categoryId] += 1
  }
  return { categories, entryCounts }
}

moveEntries(input: MoveEntriesInput): MoveEntriesResult {
  return this.store.withWriteLock(() => {
    const sourceCategoryId = input.sourceCategoryId.trim()
    const targetCategoryId = input.targetCategoryId.trim()
    const entryIds = input.entryIds.map((id) => id.trim())
    if (!entryIds.length || entryIds.some((id) => !id) || new Set(entryIds).size !== entryIds.length) {
      throw new JournalError('VALIDATION_ERROR', '請選擇至少一則不重複的記事進行搬移。')
    }
    if (!sourceCategoryId || !targetCategoryId) throw new JournalError('VALIDATION_ERROR', '請提供來源與目的地分類。')
    if (sourceCategoryId === targetCategoryId) throw new JournalError('VALIDATION_ERROR', '不能將記事移至原本的類別。')
    const categories = this.store.listCategories()
    const source = categories.find((category) => category.id === sourceCategoryId)
    const target = categories.find((category) => category.id === targetCategoryId)
    if (!source) throw new JournalError('NOT_FOUND', '找不到要搬移的來源分類。')
    if (!target) throw new JournalError('NOT_FOUND', '找不到搬移目的地分類。')
    if (!target.isActive) throw new JournalError('VALIDATION_ERROR', '搬移目的地必須是啟用中的類別。')
    const entriesById = new Map(this.store.listEntries().map((entry) => [entry.id, entry]))
    const selectedEntries = entryIds.map((id) => {
      const entry = entriesById.get(id)
      if (!entry || entry.categoryId !== source.id) {
        throw new JournalError('CONFLICT', '其中一則記事已不屬於來源類別，請重新整理後再試。')
      }
      return entry
    })
    const movedAt = this.now()
    const movedEntries = selectedEntries.map((entry) => ({ ...entry, categoryId: target.id, updatedAt: movedAt }))
    this.store.saveEntries(movedEntries)
    return { movedCount: movedEntries.length }
  })
}

deleteCategory(id: string): void {
  this.store.withWriteLock(() => {
    const categoryId = id.trim()
    const category = this.store.listCategories().find((item) => item.id === categoryId)
    if (!category) throw new JournalError('NOT_FOUND', '找不到要刪除的分類。')
    if (this.store.listEntries().some((entry) => entry.categoryId === categoryId)) {
      throw new JournalError('CONFLICT', '類別仍有記事，請先搬移所有記事後再刪除。')
    }
    this.store.deleteCategory(categoryId)
  })
}
```

此流程不可停用後自動刪除；只有明確 `deleteCategory` 請求能移除空類別。

- [ ] **Step 5: 執行服務測試，確認規則與無部分搬移行為通過。**

Run: `npm run test:run -- gas/src/services/journal-service.test.ts`

Expected: PASS，包含既有停用、匯出與分頁測試。

- [ ] **Step 6: 提交服務層的可測試成果。**

```bash
git add gas/src/domain/journal.ts gas/src/repositories/journal-store.ts gas/src/test/fake-journal-store.ts gas/src/services/journal-service.ts gas/src/services/journal-service.test.ts
git commit -m "feat: add category migration domain rules"
```

### Task 2: Apps Script 儲存實作與請求分派

**Files:**

- Modify: `gas/src/domain/validation.ts:1-153`
- Modify: `gas/src/repositories/apps-script-journal-store.ts:1-360`
- Modify: `gas/src/api/dispatcher.ts:1-149`
- Test: `gas/src/setup.test.ts:1-168`
- Test: `gas/src/api/dispatcher.test.ts:1-130`

**Interfaces:**

- Consumes: Task 1 的 `MoveEntriesInput`、`JournalService.moveEntries()`、`JournalService.deleteCategory()`、`JournalStore.saveEntries()` 與 `JournalStore.deleteCategory()`。
- Produces: 可從 Vercel proxy 呼叫的 `moveEntries`／`deleteCategory` API，以及 Google Sheets 的單鎖批次更新。

- [ ] **Step 1: 寫 dispatcher 與 Apps Script store 的失敗測試。**

在 dispatcher 測試中將既有 `listCategories` 斷言改為 `{ categories, entryCounts }` 摘要，並驗證完整搬移請求會得到 `{ ok: true, data: { movedCount: 1 } }`，空 `entryIds` 請求會得到 `VALIDATION_ERROR`，且非空類別的 `deleteCategory` 回傳 `CONFLICT`。在 `setup.test.ts` 先用 `saveEntry()` 建立兩個類別和兩則記事，再斷言 `saveEntries()` 同時更新兩列的第五欄及第九欄，`deleteCategory()` 會移除正確類別列。

```ts
expect(executeAppRequest({
  action: 'moveEntries',
  sourceCategoryId: 'work',
  targetCategoryId: 'life',
  entryIds: ['entry-1'],
}, service())).toEqual({ ok: true, data: { movedCount: 1 } })

expect(executeAppRequest({
  action: 'moveEntries', sourceCategoryId: 'work', targetCategoryId: 'life', entryIds: [],
}, service())).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
```

- [ ] **Step 2: 執行這兩個測試檔，確認路由與 store 方法尚未可用。**

Run: `npm run test:run -- gas/src/api/dispatcher.test.ts gas/src/setup.test.ts`

Expected: FAIL，顯示不支援 `moveEntries`／`deleteCategory` 或 `saveEntries`／`deleteCategory` 不存在。

- [ ] **Step 3: 解析輸入並分派兩個 API 動作。**

在 `gas/src/domain/validation.ts` 增加下列解析器，讓空陣列保留給服務層產生領域錯誤，非陣列與非字串元素則維持既有 `INVALID_REQUEST`。

```ts
export function parseMoveEntriesInput(value: unknown): MoveEntriesInput {
  if (!isRecord(value)) throwInvalidRequest()
  return {
    sourceCategoryId: readString(value, 'sourceCategoryId'),
    targetCategoryId: readString(value, 'targetCategoryId'),
    entryIds: readStringArray(value.entryIds),
  }
}
```

在 `dispatcher.ts` 匯入解析器、將兩個 action 加入 `isSupportedAction()`，並新增：

```ts
case 'moveEntries': {
  const input = parseMoveEntriesInput(request)
  return { ok: true, data: getService().moveEntries(input) }
}
case 'deleteCategory': {
  getService().deleteCategory(readString(request, 'id'))
  return { ok: true, data: null }
}
```

- [ ] **Step 4: 以一次工作表範圍寫入實作批次儲存，並實作類別列刪除。**

在 `AppsScriptJournalStore` 新增 `saveEntries(entries)`。取得 entries 工作表和所有資料列後，先以 `findRowById()` 找到每個既有 ID（保留重複 ID 的資料錯誤檢查），把指定列改為序列化後的 `Entry` 值，再以一次 `getRange(2, 1, rowCount, ENTRY_HEADERS.length).setValues(...)` 寫回。空陣列直接回傳空陣列，避免建立 0 列範圍。`deleteCategory(id)` 使用 `requireSheet()`、`findRowById()` 與 `sheet.deleteRow(rowIndex)`；找不到時拋出 `NOT_FOUND`。

```ts
saveEntries(entries: Entry[]): Entry[] {
  if (!entries.length) return []
  return this.withWriteLock(() => {
    const sheet = this.requireSheet(ENTRY_SHEET_NAME, ENTRY_HEADERS)
    const rows = this.readRows(ENTRY_SHEET_NAME, ENTRY_HEADERS)
    const rowsByIndex = new Map(rows.map((row) => [row.rowIndex, row]))
    for (const entry of entries) {
      const rowIndex = this.findRowById(sheet, entry.id, ENTRY_SHEET_NAME)
      if (!rowIndex) throw new JournalError('NOT_FOUND', '找不到要更新的記事。')
      rowsByIndex.get(rowIndex)!.values = this.entryValues(entry)
    }
    sheet.getRange(2, 1, rows.length, ENTRY_HEADERS.length)
      .setNumberFormat('@')
      .setValues(rows.map((row) => row.values))
    return entries.map(cloneEntry)
  })
}

deleteCategory(id: string): void {
  this.withWriteLock(() => {
    const sheet = this.requireSheet(CATEGORY_SHEET_NAME, CATEGORY_HEADERS)
    const rowIndex = this.findRowById(sheet, id, CATEGORY_SHEET_NAME)
    if (!rowIndex) throw new JournalError('NOT_FOUND', '找不到要刪除的分類。')
    sheet.deleteRow(rowIndex)
  })
}
```

抽出 `entryValues(entry)` 供 `saveEntry()` 與 `saveEntries()` 使用，避免兩個序列化格式漂移。外層服務鎖與 store 鎖巢狀時必須沿用既有 `writeLockDepth`，不得再取得第二把 Script Lock。

- [ ] **Step 5: 執行 API 與 store 測試，確認 JSON 契約和工作表資料列正確。**

Run: `npm run test:run -- gas/src/api/dispatcher.test.ts gas/src/setup.test.ts`

Expected: PASS，且既有 `initializeJournal()`／Script Lock 測試均通過。

- [ ] **Step 6: 提交 API 與 Google Sheets 持久層成果。**

```bash
git add gas/src/domain/validation.ts gas/src/repositories/apps-script-journal-store.ts gas/src/api/dispatcher.ts gas/src/setup.test.ts gas/src/api/dispatcher.test.ts
git commit -m "feat: expose category migration API"
```

### Task 3: 前端 API 型別、Journal 狀態與 App 串接

**Files:**

- Modify: `src/domain/journal.ts:1-104`
- Modify: `src/features/journal/use-journal.ts:1-319`
- Modify: `src/features/journal/use-journal.test.tsx:1-92`
- Modify: `src/App.tsx:1-423`
- Test: `src/App.test.tsx:1-129`

**Interfaces:**

- Consumes: Task 2 的 JSON API、`CategoryManagementData`、`MoveEntriesResult` 與既有 `JournalClient.run()`。
- Produces: `categoryEntryCounts`、`loadCategoryEntryPage()`、`moveEntries()`、`deleteCategory()`，供 Task 4 的類別管理 UI 使用。

- [ ] **Step 1: 寫 hook 與 App 的失敗測試，描述摘要與刷新行為。**

把既有假 `listCategories` 回應改成 `{ categories: [], entryCounts: {} }`，再新增 hook 測試：啟動時會先取得管理摘要；搬移成功後會送出指定 `moveEntries` 請求、重新讀取 `listCategories`，並重新讀取目前主記事清單；搬移失敗時 `moveEntries()` 會 reject 且不清除呼叫者的選取狀態。

```ts
await act(async () => {
  await result.current.moveEntries('work', 'life', ['one', 'two'])
})

expect(run).toHaveBeenCalledWith({
  action: 'moveEntries', sourceCategoryId: 'work', targetCategoryId: 'life', entryIds: ['one', 'two'],
})
expect(run).toHaveBeenCalledWith({ action: 'listCategories' })
expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'listEntries' }))
```

- [ ] **Step 2: 執行前端 hook 與 App 測試，確認新 API 尚未被識別。**

Run: `npm run test:run -- src/features/journal/use-journal.test.tsx src/App.test.tsx`

Expected: FAIL，顯示 `moveEntries`／`categoryEntryCounts` 不存在，或 `listCategories` 新回應尚未被解析。

- [ ] **Step 3: 同步前端 API 型別並抽出類別管理摘要刷新。**

在 `src/domain/journal.ts` 複製 Task 1 的型別與兩個 `ApiRequest` 成員。`useJournal` 新增 `categoryEntryCounts: Record<string, number>` state，並實作安全的 `toCategoryManagementData(value)`：物件須有 `categories` 陣列、`entryCounts` 物件，且每個計數為非負整數。

```ts
function toCategoryManagementData(value: unknown): CategoryManagementData {
  if (!isRecord(value) || !Array.isArray(value.categories) || !isRecord(value.entryCounts)) {
    throw new Error(zhTW.errors.invalidServiceResponse)
  }
  const entryCounts = Object.fromEntries(Object.entries(value.entryCounts).map(([id, count]) => {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new Error(zhTW.errors.invalidServiceResponse)
    }
    return [id, count]
  })) as Record<string, number>
  return { categories: value.categories as Category[], entryCounts }
}

const loadCategoryManagement = useCallback(async (expectedEpoch: number): Promise<void> => {
  const value = await client.run<unknown>({ action: 'listCategories' })
  const data = toCategoryManagementData(value)
  if (expectedEpoch !== requestEpoch.current) return
  setCategories(data.categories)
  setCategoryEntryCounts(data.entryCounts)
}, [client])
```

在 `loadBootstrap()` 成功後先 `await loadCategoryManagement(expectedEpoch)`，再設為 `ready`，避免尚未取得真實計數時誤啟用永久刪除。`clearData()` 要清空計數。將 `saveEntry()`、`deleteEntry()`、`moveEntries()`、`deleteCategory()` 的成功路徑都接上摘要刷新、主列表重新載入與 `revision` 遞增；既有新增／停用／重新啟用類別仍可本機更新類別清單，但計數物件必須保留已知值並為新類別建立 `0`。

- [ ] **Step 4: 暴露隔離的來源記事分頁讀取與搬移／刪除方法。**

新增 `loadCategoryEntryPage(sourceCategoryId, cursor)`，僅以新物件建立 filter，不修改 `filter` state；呼叫端拿到的資料以既有 `toEntryListData()` 驗證。新增下列方法並在回傳物件中公開：

```ts
const loadCategoryEntryPage = async (sourceCategoryId: string, cursor: string | null): Promise<EntryListData> => {
  const value = await client.run<unknown>({
    action: 'listEntries',
    filter: { ...DEFAULT_ENTRY_FILTER, categoryId: sourceCategoryId, cursor },
  })
  return toEntryListData(value)
}

const deleteCategory = async (id: string): Promise<void> => {
  try {
    const expectedEpoch = requestEpoch.current
    await client.run<null>({ action: 'deleteCategory', id })
    if (expectedEpoch !== requestEpoch.current) throw new RequestInvalidatedError()
    await loadCategoryManagement(expectedEpoch)
    await loadEntries({ ...filter, cursor: null }, false, expectedEpoch)
    setRevision((current) => current + 1)
  } catch (error) {
    if (!(error instanceof RequestInvalidatedError)) handleRequestError(error)
    throw error
  }
}

const moveEntries = async (sourceCategoryId: string, targetCategoryId: string, entryIds: string[]): Promise<void> => {
  try {
    const expectedEpoch = requestEpoch.current
    await client.run<MoveEntriesResult>({ action: 'moveEntries', sourceCategoryId, targetCategoryId, entryIds })
    if (expectedEpoch !== requestEpoch.current) throw new RequestInvalidatedError()
    await loadCategoryManagement(expectedEpoch)
    await loadEntries({ ...filter, cursor: null }, false, expectedEpoch)
    setRevision((current) => current + 1)
  } catch (error) {
    if (!(error instanceof RequestInvalidatedError)) handleRequestError(error)
    throw error
  }
}
```

兩個方法都會將錯誤拋回面板，以保留勾選；`handleRequestError()` 仍處理登入過期及全域錯誤。

- [ ] **Step 5: 將完整計數與新回呼從 App 傳至 CategoryManager。**

移除 `App.tsx` 從 `entries` 建立 `Map` 的區塊；改將 hook 回傳的 `categoryEntryCounts`、`loadCategoryEntryPage`、`moveEntries`、`deleteCategory` 傳入 `CategoryManager`。更新 `src/App.test.tsx` 中全部 `listCategories` 假回應為管理摘要，避免測試默默沿用過期契約。

```tsx
<CategoryManager
  categories={categories}
  entryCounts={categoryEntryCounts}
  onLoadEntryPage={loadCategoryEntryPage}
  onMoveEntries={moveEntries}
  onDelete={deleteCategory}
  onSave={saveCategory}
  onDeactivate={deactivateCategory}
  onActivate={activateCategory}
/>
```

- [ ] **Step 6: 執行前端狀態與 App 測試，確認資料刷新契約通過。**

Run: `npm run test:run -- src/features/journal/use-journal.test.tsx src/App.test.tsx`

Expected: PASS，並確認登入、登出、既有新增記事測試仍通過。

- [ ] **Step 7: 提交前端資料流成果。**

```bash
git add src/domain/journal.ts src/features/journal/use-journal.ts src/features/journal/use-journal.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: wire category migration client state"
```

### Task 4: 類別搬移面板、永久刪除控制與響應式介面

**Files:**

- Create: `src/features/categories/category-entry-move-panel.tsx`
- Create: `src/features/categories/category-entry-move-panel.test.tsx`
- Modify: `src/features/categories/category-manager.tsx:1-153`
- Modify: `src/features/categories/category-manager.test.tsx:1-55`
- Modify: `src/i18n/zh-TW.ts:1-154`
- Modify: `src/styles/global.css:984-1680`

**Interfaces:**

- Consumes: Task 3 的 `onLoadEntryPage`、`onMoveEntries`、`onDelete`，以及現有 `ConfirmDialog`、`Icon`、`EntryListData` 和 `Category`。
- Produces: 由類別管理開啟的可存取搬移面板、單筆／多筆確認，以及空類別的永久刪除互動。

- [ ] **Step 1: 寫搬移面板與類別管理的失敗元件測試。**

建立 `category-entry-move-panel.test.tsx`。假 `onLoadPage` 第一頁回傳 `one` 與 `nextCursor: 'one'`，第二頁回傳 `two`；勾選 `one`、載入更多、勾選 `two` 後，斷言工具列顯示「已選 2 則」，選擇 `life` 並在確認對話框送出時呼叫：

```ts
expect(onMoveEntries).toHaveBeenCalledWith('work', 'life', ['one', 'two'])
```

再加入單筆列操作、沒有其他啟用目的地時批次按鈕停用、API reject 後對話框與已選筆數仍存在的案例。更新 `category-manager.test.tsx`：非空類別的永久刪除按鈕應停用並可開啟「搬移記事」；空類別的永久刪除確認後呼叫 `onDelete('empty')`。

- [ ] **Step 2: 執行元件測試，確認新元件與 props 尚未存在。**

Run: `npm run test:run -- src/features/categories/category-entry-move-panel.test.tsx src/features/categories/category-manager.test.tsx`

Expected: FAIL，顯示 `CategoryEntryMovePanel` 或新類別管理操作不存在。

- [ ] **Step 3: 建立獨立搬移面板，處理分頁、跨頁選取與確認。**

實作 `CategoryEntryMovePanel`，以 `useEffect` 在 `source.id` 改變時清空列表、游標、目的地、錯誤與 `selectedIds` 後載入第一頁，並在「載入更多」時附加資料；以 `Set<string>` 保存勾選 ID，且僅在成功搬移的 ID 集合中刪除。面板使用 `role="dialog"`、`aria-modal="true"` 與標題 ID，關閉按鈕必須有明確名稱。

```ts
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

const toggleSelected = (id: string) => {
  setSelectedIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}

const moveSelected = async (targetCategoryId: string, entryIds: string[]) => {
  await onMoveEntries(source.id, targetCategoryId, entryIds)
  const movedIds = new Set(entryIds)
  setEntries((current) => current.filter((entry) => !movedIds.has(entry.id)))
  setSelectedIds((current) => new Set([...current].filter((id) => !movedIds.has(id))))
}
```

每筆列按「移動」後開啟含目的地 `<select>` 的確認對話框；批次工具列只在已有勾選和已選目的地時開啟確認。確認對話框初始焦點維持在取消；請求中停用關閉、目的地與確認控制項。失敗時保留面板、目標選擇與 `selectedIds`，並在對話框中顯示服務訊息。

- [ ] **Step 4: 擴充 CategoryManager，讓刪除與搬移入口可發現且安全。**

把 `entryCounts` prop 改為 `Record<string, number>`，新增 `onLoadEntryPage`、`onMoveEntries`、`onDelete`。針對每張卡使用 `const entryCount = entryCounts[category.id] ?? 0`；有記事時渲染啟用的「搬移記事」按鈕和停用的「永久刪除」按鈕，並以輔助文字連結到「請先搬移所有記事」。空類別可按永久刪除，使用既有 `ConfirmDialog`，送出時 `await onDelete(category.id)`。

```tsx
<button
  className="icon-button icon-button--danger"
  type="button"
  aria-label={zhTW.categories.deleteCategory(category.name)}
  disabled={entryCount > 0}
  onClick={() => setPendingDelete(category)}
>
  <Icon>delete</Icon>
</button>
```

管理元件保留原有編輯／停用／重新啟用流程；搬移面板在 `movingCategory` 有值時以獨立元件渲染，成功後父層 hook 的新摘要自動更新卡片數字。

- [ ] **Step 5: 新增集中繁中文案與最小響應式樣式。**

在 `zhTW.categories` 加入明確字串／函式：`moveEntries`、`moveEntriesFor(name)`、`deleteCategory(name)`、`deleteBlocked`、`deleteTitle`、`deleteDescription`、`confirmDelete`、`moveTitle(name)`、`selectedCount(count)`、`moveTo`、`confirmMove(count, source, target)`、`noMoveTargets`、`loadMoveError`。使用既有 `zhTW.connection.connecting` 呈現進行中狀態。

```ts
moveEntries: '搬移記事',
moveEntriesFor: (name: string) => `搬移 ${name} 的記事`,
deleteCategory: (name: string) => `永久刪除 ${name}`,
deleteBlocked: '請先搬移所有記事，才能永久刪除此類別。',
deleteTitle: '永久刪除類別確認',
deleteDescription: '刪除後無法復原，確定要永久刪除此空類別嗎？',
confirmDelete: '永久刪除類別',
moveTitle: (name: string) => `搬移「${name}」的記事`,
selectedCount: (count: number) => `已選 ${count} 則`,
moveTo: '移至類別',
confirmMove: (count: number, source: string, target: string) => `將 ${count} 則記事從「${source}」移至「${target}」？`,
noMoveTargets: '請先建立或重新啟用另一個類別，才能搬移記事。',
loadMoveError: '無法載入此類別的記事，請稍後再試。',
```

在 `global.css` 新增 `.category-move-overlay`、`.category-move-panel`、`.category-move-list`、`.category-move-row`、`.category-move-toolbar` 與 `.category-move-empty`。手機版固定滿版並允許內部清單捲動；`min-width: 768px` 時限制面板寬度與高度，工具列改為水平排列。所有按鈕至少維持現有 44px 可點擊高度。

```css
.category-move-overlay {
  position: fixed;
  z-index: 60;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(25 28 30 / 38%);
}

.category-move-panel {
  display: flex;
  width: min(100%, 46rem);
  min-height: 100%;
  flex-direction: column;
  background: var(--surface-card);
}
```

- [ ] **Step 6: 執行類別 UI 測試，確認單筆、多筆跨頁、確認與錯誤狀態通過。**

Run: `npm run test:run -- src/features/categories/category-entry-move-panel.test.tsx src/features/categories/category-manager.test.tsx`

Expected: PASS，且確認對話框中取消按鈕取得初始焦點。

- [ ] **Step 7: 提交完整類別管理介面成果。**

```bash
git add src/features/categories/category-entry-move-panel.tsx src/features/categories/category-entry-move-panel.test.tsx src/features/categories/category-manager.tsx src/features/categories/category-manager.test.tsx src/i18n/zh-TW.ts src/styles/global.css
git commit -m "feat: add category entry migration UI"
```

### Task 5: 整合驗證與手動驗收清單

**Files:**

- Modify: `docs/acceptance-checklist.md:20-34`
- Verify: `package.json:6-14`

**Interfaces:**

- Consumes: Tasks 1–4 的完整 API、Google Sheets store、Hook 與 UI。
- Produces: 可重複執行的全套檢查和部署前人工驗收步驟。

- [ ] **Step 1: 擴充手動驗收清單，列出真實資料流程。**

在「記事與分類」段落新增以下核取項，使用不含真實資料的測試 Sheet：

```markdown
- [ ] 有記事的類別顯示完整記事數、可停用但不可永久刪除。
- [ ] 從類別管理搬移單筆記事至另一個啟用類別；確認時間軸、月曆與兩個類別的計數更新。
- [ ] 載入更多來源記事後跨頁勾選多筆、確認搬移；每筆只搬移一次且勾選在失敗後仍保留。
- [ ] 將來源類別記事全數搬走後永久刪除空類別；Google Sheets 只移除該類別列，不刪除記事。
- [ ] 停用類別不會出現在搬移目的地；確認前停用目的地或改變來源資料時，系統拒絕整批搬移。
```

- [ ] **Step 2: 執行完整靜態檢查與全測試套件。**

Run: `npm run check`

Expected: PASS，依序通過 ESLint、所有 frontend／server Vitest、Vite TypeScript build 與 GAS bundle build。

- [ ] **Step 3: 檢查工作區差異與計畫外檔案。**

Run: `git status --short`

Expected: 只出現本功能的預期修改；不暫存既有的未追蹤設計／計畫文件或 `opencode.json`。

- [ ] **Step 4: 提交驗收文件與最終驗證成果。**

```bash
git add docs/acceptance-checklist.md
git commit -m "docs: add category migration acceptance checks"
```
