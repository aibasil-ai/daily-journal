# 每日記事 App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可跨手機、平板與桌面使用的個人每日記事靜態網頁，透過 Google OAuth、GAS Execution API 與個人的 Google Sheets 安全儲存及查詢資料。

**Architecture:** 專案根目錄是 React + TypeScript + Vite 靜態前端，所有資料操作都透過單一 `executeAppRequest` GAS Execution API 端點。`gas/` 內的 TypeScript 以 esbuild 打包為可由 clasp 推送的 Apps Script 程式碼；GAS 將資料邏輯與 Apps Script 的 Sheets 存取分離，以便在 Node 環境中測試核心規則。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、React Testing Library、Google Identity Services、Google Apps Script、Google Sheets、esbuild、clasp。

## Global Constraints

- 介面預設使用繁體中文；所有使用者可見文字集中於 `src/i18n/zh-TW.ts`。
- 靜態網站必須可部署於 Vercel、Cloudflare Pages、Netlify、GitHub Pages 及一般靜態主機，不得依賴 Vercel 專屬 API 或函式。
- 建置設定使用 `APP_GOOGLE_CLIENT_ID` 與 `APP_GAS_SCRIPT_ID`；靜態主機可用未追蹤的 `public/app-config.js` 覆寫。
- 前端不得直接存取 Google Sheets 或保存存取權杖；存取權杖只保存在記憶體。
- GAS 的 `SPREADSHEET_ID` 只可儲存在 Script Properties，且所有日期和時間必須使用 Google Sheets 時區。
- 每則記事只有一個啟用分類，分類與內文必填；標題選填；標籤及連結可有多筆。
- 已使用的分類只能停用，不能刪除；停用分類保留於歷史記事，但不可用於新增或編輯。
- 第一版不提供離線寫入、提醒、檔案上傳或集中式多使用者資料服務。
- 每次 Git 提交前，必須先向使用者提出繁體中文提交訊息並獲得核可。

---

## 預定檔案結構

| 路徑 | 職責 |
| --- | --- |
| `package.json` | 前端、測試與 GAS 打包指令及相依套件。 |
| `vite.config.ts` | 讀取 `APP_*` 建置設定並注入前端常數。 |
| `src/config/runtime-config.ts` | 合併靜態 `app-config.js` 與建置設定，驗證部署設定。 |
| `src/domain/journal.ts` | 前端與 GAS 共用語意的資料型別、篩選條件與操作要求。 |
| `src/domain/validation.ts` | 前端快速驗證與純函式正規化。 |
| `src/services/google-oauth.ts` | Google Identity Services 存取權杖生命週期。 |
| `src/services/execution-client.ts` | 呼叫 `scripts.run` 與轉換 API 錯誤。 |
| `src/features/journal/use-journal.ts` | 首頁資料載入、篩選、儲存與刪除的 React 狀態協調。 |
| `src/features/entries/` | 時間軸、月曆、搜尋列、記事表單與 CSV 下載元件。 |
| `src/features/categories/` | 分類管理元件。 |
| `src/i18n/zh-TW.ts` | 所有繁體中文文案。 |
| `src/styles/` | 全域 Token、響應式版面與元件樣式。 |
| `gas/src/` | GAS 領域邏輯、Sheet 儲存庫、請求分派與 Apps Script 進入點。 |
| `gas/appsscript.json` | V8、Sheets 權限與 API Executable `MYSELF` 設定。 |
| `scripts/build-gas.mjs` | 打包 GAS 進 `gas-dist/` 並複製 manifest。 |
| `.clasp.json.example` | 提供部署者設定 Script ID 與 `gas-dist` 來源目錄的範本。 |
| `README.md`、`docs/deployment.md` | 本機開發、GAS、Google Cloud、各靜態主機部署與疑難排解。 |

## 共享介面契約

前端 `src/domain/journal.ts` 與 GAS `gas/src/domain/journal.ts` 定義等價結構。兩端不得交換 `Date`、`Map`、`Set` 或函式，只傳送 JSON 可序列化資料。

```ts
export type JournalLink = { label: string; url: string }

export type Category = {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type Entry = {
  id: string
  entryDate: string
  title: string
  content: string
  categoryId: string
  tags: string[]
  links: JournalLink[]
  createdAt: string
  updatedAt: string
}

export type EntryInput = Omit<Entry, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
}

export type EntryFilter = {
  query: string
  from: string | null
  to: string | null
  categoryId: string | null
  tag: string | null
  cursor: string | null
  limit: number
}

export type ApiRequest =
  | { action: 'bootstrap' }
  | { action: 'listEntries'; filter: EntryFilter }
  | { action: 'getEntriesForDate'; date: string; filter: Omit<EntryFilter, 'cursor' | 'limit'> }
  | { action: 'getMonthlyEntryCounts'; year: number; month: number; filter: Omit<EntryFilter, 'cursor' | 'limit'> }
  | { action: 'saveEntry'; entry: EntryInput }
  | { action: 'deleteEntry'; id: string }
  | { action: 'saveCategory'; category: Pick<Category, 'id' | 'name'> & { id?: string } }
  | { action: 'deactivateCategory'; id: string }
  | { action: 'exportEntries'; filter: Omit<EntryFilter, 'cursor' | 'limit'> }

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; code: string; message: string }
```

### Task 1: 建立前端、測試與 GAS 打包基礎

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.gas.json`
- Create: `eslint.config.js`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles/global.css`
- Create: `src/i18n/zh-TW.ts`
- Create: `src/vite-env.d.ts`
- Create: `src/types/google-identity.d.ts`
- Create: `public/app-config.example.js`
- Create: `.env.example`
- Create: `.clasp.json.example`
- Create: `scripts/build-gas.mjs`
- Create: `gas/src/index.ts`
- Create: `gas/appsscript.json`
- Modify: `.gitignore`
- Test: `src/App.test.tsx`

**Interfaces:**
- Produces: `npm run dev`、`npm run build`、`npm run test`、`npm run lint`、`npm run build:gas` 五個可執行指令。
- Produces: `window.__JOURNAL_CONFIG__` 的全域型別與空白安全預設值。

- [ ] **Step 1: 寫入會失敗的 App 煙霧測試**

```tsx
import { render, screen } from '@testing-library/react'
import { App } from './App'

test('顯示每日記事標題', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: '每日記事' })).toBeInTheDocument()
})
```

- [ ] **Step 2: 執行測試確認尚未建立 App**

Run: `npm test -- --run src/App.test.tsx`

Expected: FAIL，指出找不到 `./App` 或 Vite/Vitest 尚未設定。

- [ ] **Step 3: 建立 Vite React 專案設定與最小 App**

建立 `package.json`，至少包含下列指令與相依套件：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "build:gas": "node scripts/build-gas.mjs",
    "test": "vitest",
    "test:run": "vitest run",
    "lint": "eslint .",
    "check": "npm run lint && npm run test:run && npm run build && npm run build:gas"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.0.0",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "esbuild": "^0.25.0",
    "eslint": "^9.0.0",
    "jsdom": "^26.0.0",
    "typescript": "^5.0.0",
    "vite": "^8.0.0",
    "vitest": "^4.0.0"
  }
}
```

以 React `createRoot` 掛載下列最小元件；同時在 `index.html` 載入 Google Identity Services 與可選的 `/app-config.js`：

```tsx
export function App() {
  return <main><h1>每日記事</h1></main>
}
```

`vite.config.ts` 必須以 `loadEnv(mode, process.cwd(), '')` 讀取 `APP_GOOGLE_CLIENT_ID`、`APP_GAS_SCRIPT_ID`，並注入 `__BUILD_JOURNAL_CONFIG__`。`public/app-config.example.js` 使用：

```js
window.__JOURNAL_CONFIG__ = {
  googleClientId: '請填入 Google OAuth Client ID',
  gasScriptId: '請填入 GAS Script ID',
}
```

`scripts/build-gas.mjs` 以 esbuild 將 `gas/src/index.ts` 打包到 `gas-dist/Code.js`，格式為 IIFE、目標 `es2019`，並將 `gas/appsscript.json` 複製至 `gas-dist/appsscript.json`。在 `.gitignore` 加入 `gas-dist/`、`.clasp.json` 與 `public/app-config.js`。

Task 1 須先建立可打包的 GAS 佔位入口與 manifest，避免 `npm run build:gas` 依賴後續任務。入口只匯出一個會提示尚未初始化的函式；Task 3 再替換為實際入口：

```ts
export function initializeJournal(): never {
  throw new Error('GAS 尚未完成初始化。')
}
```

初始 `gas/appsscript.json` 使用下列正式設定：

```json
{
  "timeZone": "Asia/Taipei",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/spreadsheets"
  ],
  "executionApi": { "access": "MYSELF" }
}
```

- [ ] **Step 4: 安裝套件並確認煙霧測試通過**

Run: `npm install && npm test -- --run src/App.test.tsx`

Expected: PASS，輸出 1 個通過測試。

- [ ] **Step 5: 確認開發、建置、lint 與 GAS 打包可執行**

Run: `npm run lint && npm run build && npm run build:gas`

Expected: PASS，產生 `dist/` 與未追蹤的 `gas-dist/`；兩者不會被 Git 納入。

- [ ] **Step 6: 提出並核可提交訊息後提交**

向使用者提出：`建立前端與 GAS 開發基礎`。獲核可後執行：

```bash
git add package.json package-lock.json vite.config.ts vitest.config.ts tsconfig.json tsconfig.app.json tsconfig.gas.json eslint.config.js index.html src public gas/appsscript.json gas/src/index.ts .env.example .clasp.json.example scripts/build-gas.mjs .gitignore
git commit -m "建立前端與 GAS 開發基礎"
```

### Task 2: 定義前端領域型別、驗證與執行期設定

**Files:**
- Create: `src/domain/journal.ts`
- Create: `src/domain/validation.ts`
- Create: `src/config/runtime-config.ts`
- Create: `src/config/runtime-config.test.ts`
- Create: `src/domain/validation.test.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `src/types/google-identity.d.ts`

**Interfaces:**
- Produces: `loadRuntimeConfig(): RuntimeConfig`，失敗時拋出含繁中處理指引的 `ConfigError`。
- Produces: `normalizeEntryInput(input: EntryInput): EntryInput` 與 `validateEntryInput(input: EntryInput, activeCategoryIds: Set<string>): ValidationIssue[]`。
- Consumes: Task 1 的 `__BUILD_JOURNAL_CONFIG__` 及 `window.__JOURNAL_CONFIG__`。

- [ ] **Step 1: 寫入設定覆寫與記事驗證的失敗測試**

```ts
import { loadRuntimeConfig } from './runtime-config'
import { validateEntryInput } from '../domain/validation'

test('優先使用靜態 app-config 設定', () => {
  window.__JOURNAL_CONFIG__ = { googleClientId: 'runtime-id', gasScriptId: 'runtime-script' }
  expect(loadRuntimeConfig()).toEqual({ googleClientId: 'runtime-id', gasScriptId: 'runtime-script' })
})

test('拒絕空白內文與停用分類', () => {
  const issues = validateEntryInput(
    { entryDate: '2026-08-04', title: '', content: ' ', categoryId: 'old', tags: [], links: [] },
    new Set(['work']),
  )
  expect(issues.map((issue) => issue.field)).toEqual(['content', 'categoryId'])
})
```

- [ ] **Step 2: 執行測試確認模組尚不存在**

Run: `npm test -- --run src/config/runtime-config.test.ts src/domain/validation.test.ts`

Expected: FAIL，指出找不到設定及驗證模組。

- [ ] **Step 3: 實作領域型別、設定讀取與純驗證**

實作前述「共享介面契約」中的前端型別，並採用以下規則：

```ts
export function normalizeEntryInput(input: EntryInput): EntryInput {
  return {
    ...input,
    title: input.title.trim(),
    content: input.content.trim(),
    tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
    links: input.links
      .map(({ label, url }) => ({ label: label.trim(), url: url.trim() }))
      .filter(({ label, url }) => label || url),
  }
}

export function validateEntryInput(input: EntryInput, activeCategoryIds: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) issues.push({ field: 'entryDate', message: '請選擇記錄日期。' })
  if (!input.content.trim()) issues.push({ field: 'content', message: '請輸入記事內容。' })
  if (!activeCategoryIds.has(input.categoryId)) issues.push({ field: 'categoryId', message: '請選擇啟用中的分類。' })
  for (const link of input.links) {
    if (!link.label || !isHttpUrl(link.url)) issues.push({ field: 'links', message: '每個連結都需要名稱與有效的 http 或 https 網址。' })
  }
  return issues
}
```

`loadRuntimeConfig()` 先讀取非空的 `window.__JOURNAL_CONFIG__`，再讀取編譯期設定；缺少任一值時拋出：`找不到部署設定。請設定 APP_GOOGLE_CLIENT_ID 與 APP_GAS_SCRIPT_ID，或建立 public/app-config.js。`。

- [ ] **Step 4: 執行設定與驗證測試**

Run: `npm test -- --run src/config/runtime-config.test.ts src/domain/validation.test.ts`

Expected: PASS，設定覆寫、缺少設定、標籤去重、網址驗證與停用分類案例皆通過。

- [ ] **Step 5: 提出並核可提交訊息後提交**

向使用者提出：`新增記事資料模型與部署設定驗證`。獲核可後執行：

```bash
git add src/domain src/config src/vite-env.d.ts src/types/google-identity.d.ts
git commit -m "新增記事資料模型與部署設定驗證"
```

### Task 3: 建立可測試的 GAS 領域服務與資料庫初始化

**Files:**
- Create: `gas/src/domain/journal.ts`
- Create: `gas/src/domain/validation.ts`
- Create: `gas/src/services/journal-service.ts`
- Create: `gas/src/repositories/journal-store.ts`
- Create: `gas/src/repositories/apps-script-journal-store.ts`
- Create: `gas/src/setup.ts`
- Modify: `gas/src/index.ts`
- Modify: `gas/appsscript.json`
- Test: `gas/src/services/journal-service.test.ts`
- Test: `gas/src/setup.test.ts`

**Interfaces:**
- Produces: `JournalStore`，其方法為 `listCategories()`、`saveCategory()`、`listEntries()`、`saveEntry()`、`deleteEntry()` 及 `getTimezone()`。
- Produces: `JournalService`，其方法為 `bootstrap()`、`saveEntry(input)`、`saveCategory(input)`、`deactivateCategory(id)`。
- Produces: 只供 Apps Script 編輯器手動執行的 `initializeJournal(spreadsheetId: string): void`。
- Consumes: Task 2 相同規則的 JSON 資料結構；GAS 版本不得依賴前端檔案。

- [ ] **Step 1: 寫入領域服務的失敗測試**

```ts
import { JournalService } from './journal-service'
import { FakeJournalStore } from '../test/fake-journal-store'

test('初始化回傳試算表時區與啟用分類', () => {
  const store = new FakeJournalStore({ timezone: 'Asia/Taipei', categories: [
    { id: 'work', name: '工作', isActive: true, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00' },
    { id: 'old', name: '舊分類', isActive: false, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00' },
  ] })
  expect(new JournalService(store, () => '2026-08-04T00:00:00+08:00', () => 'uuid').bootstrap()).toEqual({
    timezone: 'Asia/Taipei',
    categories: [expect.objectContaining({ id: 'work' })],
    tagSuggestions: [],
  })
})
```

- [ ] **Step 2: 執行 GAS 領域測試確認失敗**

Run: `npm test -- --run gas/src/services/journal-service.test.ts`

Expected: FAIL，指出 `JournalService` 及測試用儲存庫尚未建立。

- [ ] **Step 3: 實作初始化、時區與 Sheet 儲存庫界線**

`apps-script-journal-store.ts` 只能是 Apps Script API 的轉接層：讀取 `PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')`、以 `SpreadsheetApp.openById` 開啟試算表、建立 `entries`、`categories`、`settings` 三張工作表與精確欄位標頭，並以試算表時區格式化時間。

```ts
export const ENTRY_HEADERS = ['id', 'entryDate', 'title', 'content', 'categoryId', 'tags', 'links', 'createdAt', 'updatedAt']
export const CATEGORY_HEADERS = ['id', 'name', 'isActive', 'createdAt', 'updatedAt']

export function initializeJournal(spreadsheetId: string): void {
  if (!spreadsheetId.trim()) throw new Error('請提供 Google Sheets ID。')
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheetId.trim())
  new AppsScriptJournalStore().ensureSchema()
}
```

`JournalService.bootstrap()` 只回傳啟用分類；時區取自 `Spreadsheet.getSpreadsheetTimeZone()`。所有寫入應包在 `LockService.getScriptLock()`，最多等待 10 秒，並在 `finally` 釋放鎖。

`gas/src/index.ts` 將 `initializeJournal` 指派至 `globalThis`，讓打包後的 GAS 函式可被 Apps Script 執行；Task 6 再將 `executeAppRequest` 加入同一入口。

`gas/appsscript.json` 必須包含：

```json
{
  "timeZone": "Asia/Taipei",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/spreadsheets"
  ],
  "executionApi": { "access": "MYSELF" }
}
```

- [ ] **Step 4: 擴充 FakeJournalStore 並確認服務測試通過**

Run: `npm test -- --run gas/src/services/journal-service.test.ts gas/src/setup.test.ts`

Expected: PASS，驗證工作表欄位、空白試算表 ID、試算表時區及停用分類不會出現在初始化結果。

- [ ] **Step 5: 提出並核可提交訊息後提交**

向使用者提出：`建立 GAS 資料初始化與服務基礎`。獲核可後執行：

```bash
git add gas/src gas/appsscript.json
git commit -m "建立 GAS 資料初始化與服務基礎"
```

### Task 4: 完成 GAS 分類與記事寫入規則

**Files:**
- Modify: `gas/src/domain/validation.ts`
- Modify: `gas/src/services/journal-service.ts`
- Modify: `gas/src/repositories/journal-store.ts`
- Modify: `gas/src/repositories/apps-script-journal-store.ts`
- Modify: `gas/src/test/fake-journal-store.ts`
- Test: `gas/src/services/journal-service.test.ts`

**Interfaces:**
- Produces: `saveCategory(input): Category`、`deactivateCategory(id): Category`、`saveEntry(input): Entry`、`deleteEntry(id): void`。
- Consumes: Task 3 的 `JournalStore` 與 `JournalService`。

- [ ] **Step 1: 寫入分類停用與記事寫入的失敗測試**

```ts
test('有歷史記事的分類可停用且原記事保留分類', () => {
  const store = new FakeJournalStore({ categories: [activeCategory('work')], entries: [entry({ categoryId: 'work' })] })
  const service = new JournalService(store, now, uuid)
  expect(service.deactivateCategory('work')).toMatchObject({ id: 'work', isActive: false })
  expect(store.listEntries({ query: '', from: null, to: null, categoryId: null, tag: null, cursor: null, limit: 20 })[0].categoryId).toBe('work')
})

test('拒絕將記事寫入停用分類', () => {
  const store = new FakeJournalStore({ categories: [inactiveCategory('old')] })
  const service = new JournalService(store, now, uuid)
  expect(() => service.saveEntry(entryInput({ categoryId: 'old' }))).toThrow('請選擇啟用中的分類。')
})
```

- [ ] **Step 2: 執行測試確認規則尚未完整實作**

Run: `npm test -- --run gas/src/services/journal-service.test.ts`

Expected: FAIL，停用操作或分類驗證尚未存在。

- [ ] **Step 3: 以最小服務邏輯完成 CRUD 規則**

```ts
saveEntry(input: EntryInput): Entry {
  const normalized = normalizeEntryInput(input)
  assertValidEntry(normalized, this.activeCategoryIds())
  const current = normalized.id ? this.store.getEntry(normalized.id) : undefined
  if (normalized.id && !current) throw new Error('找不到要更新的記事。')
  const timestamp = this.now()
  const entry: Entry = {
    ...normalized,
    id: current?.id ?? this.uuid(),
    createdAt: current?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  return this.store.saveEntry(entry)
}
```

分類名稱去除空白後不可為空，且不得與其他分類同名（不分大小寫）。`deactivateCategory` 不刪除資料列，只將 `isActive` 寫為 `false`。`deleteEntry` 找不到 ID 時回傳 `找不到要刪除的記事。`。

`AppsScriptJournalStore` 必須對 JSON 欄位安全地 `JSON.parse`；資料列無法解析標籤或連結時拋出含資料列 ID 的錯誤，不可靜默丟失資料。

- [ ] **Step 4: 執行完整 GAS 寫入規則測試**

Run: `npm test -- --run gas/src/services/journal-service.test.ts`

Expected: PASS，涵蓋新增、更新、永久刪除、分類重複名稱、停用與網址格式驗證。

- [ ] **Step 5: 提出並核可提交訊息後提交**

向使用者提出：`完成 GAS 記事與分類寫入規則`。獲核可後執行：

```bash
git add gas/src
git commit -m "完成 GAS 記事與分類寫入規則"
```

### Task 5: 完成 GAS 查詢、月曆彙總、標籤與 CSV 資料產出

**Files:**
- Modify: `gas/src/services/journal-service.ts`
- Modify: `gas/src/repositories/journal-store.ts`
- Modify: `gas/src/repositories/apps-script-journal-store.ts`
- Test: `gas/src/services/journal-service.test.ts`

**Interfaces:**
- Produces: `listEntries(filter): { items: Entry[]; nextCursor: string | null }`、`getEntriesForDate(date, filter): Entry[]`、`getMonthlyEntryCounts(year, month, filter): Array<{ date: string; count: number }>`、`listTagSuggestions(): string[]`、`exportEntries(filter): { headers: string[]; rows: string[][] }`。
- Consumes: Task 4 的完整 `JournalStore`。

- [ ] **Step 1: 寫入複合篩選與 CSV 的失敗測試**

```ts
test('以關鍵字、日期、分類與標籤交集篩選記事', () => {
  const service = serviceWithEntries([
    entry({ id: '1', entryDate: '2026-08-03', title: '週會', content: '規劃專案', categoryId: 'work', tags: ['會議'] }),
    entry({ id: '2', entryDate: '2026-08-04', title: '閱讀', content: '閱讀文章', categoryId: 'life', tags: ['學習'] }),
  ])
  expect(service.listEntries({ query: '專案', from: '2026-08-01', to: '2026-08-04', categoryId: 'work', tag: '會議', cursor: null, limit: 20 }).items)
    .toEqual([expect.objectContaining({ id: '1' })])
})

test('匯出包含 Excel 所需欄位及分類名稱', () => {
  const result = serviceWithEntries([entry({ id: '1', categoryId: 'work' })]).exportEntries(emptyFilter)
  expect(result.headers).toEqual(['id', 'entryDate', 'title', 'content', 'categoryName', 'tags', 'links', 'createdAt', 'updatedAt'])
  expect(result.rows[0][4]).toBe('工作')
})
```

- [ ] **Step 2: 執行查詢測試確認失敗**

Run: `npm test -- --run gas/src/services/journal-service.test.ts`

Expected: FAIL，因查詢、月曆或匯出服務尚未實作。

- [ ] **Step 3: 實作篩選、排序、分頁與 CSV 列資料**

查詢順序必須是 `entryDate` 倒序，若同日則 `createdAt` 倒序；`cursor` 使用最後一筆資料的 `id`，不可使用工作表列號。`query` 以小寫比對 `title`、`content`、`tags` 與連結 `label`。`month` 僅接受 1 至 12，無效時拋出 `月份必須介於 1 到 12。`。

```ts
private matchesFilter(entry: Entry, filter: EntryFilter): boolean {
  const query = filter.query.trim().toLocaleLowerCase()
  const searchable = [entry.title, entry.content, ...entry.tags, ...entry.links.map((link) => link.label)]
    .join('\n').toLocaleLowerCase()
  return (!query || searchable.includes(query))
    && (!filter.from || entry.entryDate >= filter.from)
    && (!filter.to || entry.entryDate <= filter.to)
    && (!filter.categoryId || entry.categoryId === filter.categoryId)
    && (!filter.tag || entry.tags.includes(filter.tag))
}
```

月曆彙總只回傳當月有資料的日期與數量。標籤建議去除重複並依 Unicode 字母順序排序。匯出連結以 `顯示名稱 (網址)` 並用 `; ` 連接。

- [ ] **Step 4: 執行查詢與匯出測試**

Run: `npm test -- --run gas/src/services/journal-service.test.ts`

Expected: PASS，涵蓋複合篩選、同日排序、cursor 分頁、月曆數量、標籤去重及 CSV 資料列。

- [ ] **Step 5: 提出並核可提交訊息後提交**

向使用者提出：`新增 GAS 搜尋月曆與匯出服務`。獲核可後執行：

```bash
git add gas/src
git commit -m "新增 GAS 搜尋月曆與匯出服務"
```

### Task 6: 建立受限 GAS 請求分派器與前端 OAuth API 用戶端

**Files:**
- Create: `gas/src/api/dispatcher.ts`
- Modify: `gas/src/index.ts`
- Test: `gas/src/api/dispatcher.test.ts`
- Create: `src/services/google-oauth.ts`
- Create: `src/services/execution-client.ts`
- Create: `src/services/google-oauth.test.ts`
- Create: `src/services/execution-client.test.ts`

**Interfaces:**
- Produces: GAS 全域函式 `executeAppRequest(request: ApiRequest): ApiResponse<unknown>`。
- Produces: `GoogleOAuth.getAccessToken(prompt?: '' | 'consent'): Promise<string>` 與 `ExecutionClient.run<T>(request: ApiRequest): Promise<T>`。
- Consumes: Task 2 的 `RuntimeConfig`，Task 5 的 `JournalService`。

- [ ] **Step 1: 寫入分派、授權與 API 請求的失敗測試**

```ts
test('未知 action 回傳固定錯誤，不執行服務', () => {
  const response = executeAppRequest({ action: 'unknown' } as never, service)
  expect(response).toEqual({ ok: false, code: 'INVALID_ACTION', message: '不支援的操作。' })
})

test('ExecutionClient 以 Bearer 權杖呼叫 executeAppRequest', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ response: { result: { ok: true, data: [] } } }))))
  await new ExecutionClient(config, { getAccessToken: vi.fn().mockResolvedValue('token') }).run({ action: 'bootstrap' })
  expect(fetch).toHaveBeenCalledWith(
    'https://script.googleapis.com/v1/scripts/script-id:run',
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }),
  )
})
```

- [ ] **Step 2: 執行 OAuth 與分派測試確認失敗**

Run: `npm test -- --run gas/src/api/dispatcher.test.ts src/services/google-oauth.test.ts src/services/execution-client.test.ts`

Expected: FAIL，因分派器與前端服務尚未建立。

- [ ] **Step 3: 實作只公開一個 GAS API 入口與記憶體 OAuth token**

`executeAppRequest` 只允許「共享介面契約」列出的 actions，並將已知錯誤轉為 `{ ok: false, code, message }`；未預期錯誤記錄在 `console.error` 後回傳 `{ ok: false, code: 'INTERNAL_ERROR', message: '處理資料時發生錯誤，請稍後再試。' }`。

```ts
export function executeAppRequest(request: ApiRequest, service = createJournalService()): ApiResponse<unknown> {
  try {
    switch (request.action) {
      case 'bootstrap': return { ok: true, data: service.bootstrap() }
      case 'listEntries': return { ok: true, data: service.listEntries(request.filter) }
      case 'getEntriesForDate': return { ok: true, data: service.getEntriesForDate(request.date, request.filter) }
      case 'getMonthlyEntryCounts': return { ok: true, data: service.getMonthlyEntryCounts(request.year, request.month, request.filter) }
      case 'saveEntry': return { ok: true, data: service.saveEntry(request.entry) }
      case 'deleteEntry': service.deleteEntry(request.id); return { ok: true, data: null }
      case 'saveCategory': return { ok: true, data: service.saveCategory(request.category) }
      case 'deactivateCategory': return { ok: true, data: service.deactivateCategory(request.id) }
      case 'exportEntries': return { ok: true, data: service.exportEntries(request.filter) }
      default: return { ok: false, code: 'INVALID_ACTION', message: '不支援的操作。' }
    }
  } catch (error) {
    return toApiError(error)
  }
}
```

OAuth scope 設為 `https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/spreadsheets`，以符合 API Executable 與 GAS 使用的 Sheets 權限。以 `google.accounts.oauth2.initTokenClient` 取得權杖；收到 `expires_in` 後只在記憶體記錄過期時間，不得寫入 localStorage。Google 回傳錯誤或使用者拒絕時拋出 `Google 登入或授權未完成。`。

`ExecutionClient` 對 `scripts.run` 發出下列 JSON：

```ts
{
  function: 'executeAppRequest',
  parameters: [request],
}
```

若 HTTP 狀態為 401 或 403，丟出 `AuthenticationError('登入已過期或沒有 GAS 使用權限，請重新登入。')`；若 API 回傳 `error` 或 `result.ok === false`，保留後端繁中訊息。

- [ ] **Step 4: 執行 API 用戶端與分派器測試**

Run: `npm test -- --run gas/src/api/dispatcher.test.ts src/services/google-oauth.test.ts src/services/execution-client.test.ts`

Expected: PASS，測試 action 路由、未支援操作、Bearer 標頭、權杖未保存與 401/403 錯誤轉換。

- [ ] **Step 5: 提出並核可提交訊息後提交**

向使用者提出：`串接 Google OAuth 與 GAS 執行 API`。獲核可後執行：

```bash
git add gas/src/api gas/src/index.ts src/services
git commit -m "串接 Google OAuth 與 GAS 執行 API"
```

### Task 7: 建立 Journal Hook、登入與連線狀態畫面

**Files:**
- Create: `src/features/journal/use-journal.ts`
- Create: `src/features/journal/connection-screen.tsx`
- Create: `src/features/journal/use-journal.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/zh-TW.ts`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: `useJournal(client)`，回傳 `status`、`bootstrap`、`categories`、`tagSuggestions`、`error`、`signIn()`、`retry()`。
- Consumes: Task 6 的 `GoogleOAuth`、`ExecutionClient` 與 `bootstrap` API。

- [ ] **Step 1: 寫入登入成功及 API 權限失敗的測試**

```tsx
test('登入後載入啟用分類並進入首頁', async () => {
  const client = { run: vi.fn().mockResolvedValue({ timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }) }
  render(<App client={client} />)
  await userEvent.click(screen.getByRole('button', { name: '使用 Google 帳號登入' }))
  expect(await screen.findByRole('heading', { name: '每日記事' })).toBeInTheDocument()
})

test('GAS 權限錯誤顯示重新登入指引', async () => {
  render(<App client={{ run: vi.fn().mockRejectedValue(new AuthenticationError('登入已過期或沒有 GAS 使用權限，請重新登入。')) }} />)
  await userEvent.click(screen.getByRole('button', { name: '使用 Google 帳號登入' }))
  expect(await screen.findByText('登入已過期或沒有 GAS 使用權限，請重新登入。')).toBeInTheDocument()
})
```

- [ ] **Step 2: 執行登入畫面測試確認失敗**

Run: `npm test -- --run src/features/journal/use-journal.test.tsx`

Expected: FAIL，因 Hook 與登入畫面尚未實作。

- [ ] **Step 3: 實作有限狀態機與可操作錯誤畫面**

狀態限定為 `checking-config`、`signed-out`、`loading`、`ready`、`error`。`App` 在初始化讀取設定；設定錯誤顯示「部署設定有誤」及 Task 2 的完整處理訊息。登入按鈕觸發 OAuth，再執行 `bootstrap`。成功時將時區、啟用分類與標籤保存於 Hook state。

`connection-screen.tsx` 對 `signed-out` 顯示「使用 Google 帳號登入」；對 `error` 同時顯示「重新登入」與「重新嘗試」按鈕。按鈕在 `loading` 時停用並標示「連線中...」。

- [ ] **Step 4: 執行登入與錯誤狀態測試**

Run: `npm test -- --run src/features/journal/use-journal.test.tsx`

Expected: PASS，設定錯誤、登入成功、登入取消與權限過期均有明確可見結果。

- [ ] **Step 5: 提出並核可提交訊息後提交**

向使用者提出：`新增登入與 GAS 連線狀態處理`。獲核可後執行：

```bash
git add src/features/journal src/App.tsx src/i18n src/styles
git commit -m "新增登入與 GAS 連線狀態處理"
```

### Task 8: 實作記事表單、時間軸、搜尋與刪除

**Files:**
- Create: `src/features/entries/entry-form.tsx`
- Create: `src/features/entries/timeline.tsx`
- Create: `src/features/entries/filter-bar.tsx`
- Create: `src/features/entries/entry-card.tsx`
- Create: `src/features/entries/entry-form.test.tsx`
- Create: `src/features/entries/timeline.test.tsx`
- Modify: `src/features/journal/use-journal.ts`
- Modify: `src/App.tsx`
- Modify: `src/i18n/zh-TW.ts`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: `saveEntry(input: EntryInput)`、`loadEntries(filter: EntryFilter, append?: boolean)`、`deleteEntry(id: string)` 與 `setFilter(filter)`。
- Consumes: Task 2 的驗證器、Task 6 的 API client、Task 7 的分類及標籤 state。

- [ ] **Step 1: 寫入新增多筆連結與刪除確認的失敗測試**

```tsx
test('提交含標籤與兩筆網址的記事', async () => {
  render(<EntryForm categories={[category('work')]} onSave={onSave} tagSuggestions={['會議']} />)
  await userEvent.type(screen.getByLabelText('記事內容'), '完成週會紀錄')
  await userEvent.selectOptions(screen.getByLabelText('分類'), 'work')
  await userEvent.type(screen.getByLabelText('標籤'), '會議{Enter}專案A{Enter}')
  await userEvent.click(screen.getByRole('button', { name: '新增連結' }))
  await userEvent.type(screen.getByLabelText('連結名稱 1'), '會議紀錄')
  await userEvent.type(screen.getByLabelText('連結網址 1'), 'https://example.com/meeting')
  await userEvent.click(screen.getByRole('button', { name: '儲存記事' }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ tags: ['會議', '專案A'], links: [expect.objectContaining({ label: '會議紀錄' })] }))
})

test('刪除前要求再次確認', async () => {
  render(<EntryCard entry={entry()} onEdit={vi.fn()} onDelete={onDelete} />)
  await userEvent.click(screen.getByRole('button', { name: '刪除記事' }))
  expect(screen.getByRole('dialog', { name: '刪除記事確認' })).toBeInTheDocument()
})
```

- [ ] **Step 2: 執行記事元件測試確認失敗**

Run: `npm test -- --run src/features/entries/entry-form.test.tsx src/features/entries/timeline.test.tsx`

Expected: FAIL，因表單、時間軸與確認對話框尚未實作。

- [ ] **Step 3: 實作記事 CRUD 和複合篩選 UI**

表單的記錄日期預設為瀏覽器當日 `YYYY-MM-DD`，但後端仍以試算表時區為最終判定。必填欄位是記錄日期、分類和內文；標題留空時 `EntryCard` 顯示 `content.slice(0, 80)`。標籤以 Enter 或逗號送出、去重並顯示可移除 chip。連結新增時建立一列空白輸入欄；有任一欄填寫的連結須有有效名稱及 http/https URL。

`FilterBar` 提供關鍵字、起訖日期、分類和標籤；任何欄位變動時重設 cursor 並載入第一頁。`Timeline` 依 `entryDate` 分組，顯示「載入更多」且只在 `nextCursor !== null` 時可見。連結使用 `target="_blank" rel="noreferrer noopener"`。

刪除使用具焦點管理的原生 `<dialog>`；確認後呼叫 `deleteEntry`，成功後移除列表項，失敗則保留項目並顯示錯誤。

- [ ] **Step 4: 執行表單、時間軸與篩選測試**

Run: `npm test -- --run src/features/entries/entry-form.test.tsx src/features/entries/timeline.test.tsx`

Expected: PASS，涵蓋必填欄位、重複標籤、多連結、摘要、複合篩選、載入更多及刪除確認。

- [ ] **Step 5: 提出並核可提交訊息後提交**

向使用者提出：`完成記事編輯時間軸與搜尋功能`。獲核可後執行：

```bash
git add src/features/entries src/features/journal/use-journal.ts src/App.tsx src/i18n src/styles
git commit -m "完成記事編輯時間軸與搜尋功能"
```

### Task 9: 實作月曆、檢視偏好與響應式首頁

**Files:**
- Create: `src/features/entries/calendar-view.tsx`
- Create: `src/features/journal/view-preference.ts`
- Create: `src/features/entries/calendar-view.test.tsx`
- Create: `src/features/journal/view-preference.test.ts`
- Modify: `src/features/journal/use-journal.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: `getInitialView(width: number, stored: JournalView | null): JournalView`，其中 `JournalView = 'timeline' | 'calendar'`。
- Produces: `CalendarView`，接收 `month`、`counts`、`onMonthChange`、`onSelectDate`。
- Consumes: Task 5 的 `getMonthlyEntryCounts` 與 Task 8 的日期篩選載入。

- [ ] **Step 1: 寫入裝置預設與月曆選日的失敗測試**

```ts
test('沒有已儲存偏好時，手機預設時間軸、平板預設月曆', () => {
  expect(getInitialView(375, null)).toBe('timeline')
  expect(getInitialView(768, null)).toBe('calendar')
})

test('已儲存偏好優先於裝置尺寸', () => {
  expect(getInitialView(375, 'calendar')).toBe('calendar')
})
```

```tsx
test('點選有兩則記事的日期時載入該日資料', async () => {
  render(<CalendarView month="2026-08" counts={[{ date: '2026-08-04', count: 2 }]} onMonthChange={vi.fn()} onSelectDate={onSelectDate} />)
  await userEvent.click(screen.getByRole('button', { name: '2026-08-04，共 2 則記事' }))
  expect(onSelectDate).toHaveBeenCalledWith('2026-08-04')
})
```

- [ ] **Step 2: 執行月曆與偏好測試確認失敗**

Run: `npm test -- --run src/features/entries/calendar-view.test.tsx src/features/journal/view-preference.test.ts`

Expected: FAIL，因月曆與偏好函式尚未建立。

- [ ] **Step 3: 實作月曆資料載入與響應式檢視切換**

`view-preference.ts` 以 `localStorage` key `daily-journal:view` 保存使用者的切換結果。未保存偏好時，寬度小於 768px 為 `timeline`，其餘為 `calendar`。使用 segmented button，兩個按鈕均具 `aria-pressed`。

`CalendarView` 依 ISO 月份產生七欄網格，以週一為首日。按鈕的 accessible name 固定使用：`YYYY-MM-DD，共 N 則記事`。切換月份只請求 Task 5 的月曆數量；點選日期後以現有篩選條件和指定日期呼叫 `getEntriesForDate`，再用既有 `Timeline` 呈現結果。

CSS 斷點精確定義為手機 `max-width: 767px`、平板 `768px 至 1023px`、桌面 `min-width: 1024px`。平板及桌面顯示雙欄主區塊（記事表單／月曆與結果），手機採單欄與固定底部新增按鈕；所有觸控按鈕最小尺寸為 44px。

- [ ] **Step 4: 執行月曆與響應式偏好測試**

Run: `npm test -- --run src/features/entries/calendar-view.test.tsx src/features/journal/view-preference.test.ts`

Expected: PASS，驗證裝置預設、已儲存偏好、月份切換、記事數量與選日載入。

- [ ] **Step 5: 提出並核可提交訊息後提交**

向使用者提出：`新增月曆檢視與響應式版面`。獲核可後執行：

```bash
git add src/features/entries/calendar-view.tsx src/features/entries/calendar-view.test.tsx src/features/journal/view-preference.ts src/features/journal/view-preference.test.ts src/features/journal/use-journal.ts src/App.tsx src/styles
git commit -m "新增月曆檢視與響應式版面"
```

### Task 10: 實作分類管理與 CSV 檔案下載

**Files:**
- Create: `src/features/categories/category-manager.tsx`
- Create: `src/features/categories/category-manager.test.tsx`
- Create: `src/features/entries/csv-download.ts`
- Create: `src/features/entries/csv-download.test.ts`
- Modify: `src/features/journal/use-journal.ts`
- Modify: `src/App.tsx`
- Modify: `src/i18n/zh-TW.ts`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: `saveCategory(name, id?)`、`deactivateCategory(id)` 與 `exportEntries(scope: 'filtered' | 'all')`。
- Produces: `createCsvBlob(headers: string[], rows: string[][]): Blob`。
- Consumes: Task 5 的 `saveCategory`、`deactivateCategory`、`exportEntries` API 操作。

- [ ] **Step 1: 寫入分類停用與 CSV 編碼的失敗測試**

```tsx
test('停用分類前顯示歷史記事仍會保留的說明', async () => {
  render(<CategoryManager categories={[category('work')]} onSave={vi.fn()} onDeactivate={onDeactivate} />)
  await userEvent.click(screen.getByRole('button', { name: '停用 工作' }))
  expect(screen.getByText('停用後，既有記事會保留此分類，新記事不可再選用。')).toBeInTheDocument()
})
```

```ts
test('CSV 使用 UTF-8 BOM 並跳脫雙引號', async () => {
  const text = await createCsvBlob(['標題'], [['包含 "引號"']]).text()
  expect(text).toBe('\uFEFF標題\r\n"包含 ""引號"""\r\n')
})
```

- [ ] **Step 2: 執行分類與 CSV 測試確認失敗**

Run: `npm test -- --run src/features/categories/category-manager.test.tsx src/features/entries/csv-download.test.ts`

Expected: FAIL，因分類管理與 CSV 工具尚未建立。

- [ ] **Step 3: 實作分類頁與 CSV 下載工具**

`CategoryManager` 可新增、改名及停用分類。停用需對話框明確顯示「停用後，既有記事會保留此分類，新記事不可再選用。」；分類清單應將停用項目標示「已停用」。

```ts
export function createCsvBlob(headers: string[], rows: string[][]): Blob {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n') + '\r\n'
  return new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
}
```

匯出區要有「匯出目前篩選結果」與「匯出全部記事」兩個按鈕。檔名格式為 `daily-journal-YYYY-MM-DD.csv`，日期使用瀏覽器本地日期。下載前禁用重複點擊，錯誤時顯示後端訊息。

- [ ] **Step 4: 執行分類與 CSV 測試**

Run: `npm test -- --run src/features/categories/category-manager.test.tsx src/features/entries/csv-download.test.ts`

Expected: PASS，確認分類改名、停用說明、UTF-8 BOM、逗號與引號跳脫、兩種匯出範圍。

- [ ] **Step 5: 提出並核可提交訊息後提交**

向使用者提出：`完成分類管理與 CSV 匯出`。獲核可後執行：

```bash
git add src/features/categories src/features/entries/csv-download.ts src/features/entries/csv-download.test.ts src/features/journal/use-journal.ts src/App.tsx src/i18n src/styles
git commit -m "完成分類管理與 CSV 匯出"
```

### Task 11: 完成部署文件、可部署設定與端對端手動驗收

**Files:**
- Create: `README.md`
- Create: `docs/deployment.md`
- Create: `docs/acceptance-checklist.md`
- Modify: `.env.example`
- Modify: `public/app-config.example.js`
- Modify: `.clasp.json.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: 從空白 Google 帳號資源完成前端、Google Cloud、GAS、Sheets 與各靜態主機部署的逐步說明。
- Consumes: Tasks 1 至 10 的實際指令、環境變數名稱、函式名稱與錯誤訊息。

- [ ] **Step 1: 寫入部署設定範例的失敗檢查**

```ts
import { readFile } from 'node:fs/promises'

test('環境變數範例只含公開設定鍵', async () => {
  const content = await readFile('.env.example', 'utf8')
  expect(content).toContain('APP_GOOGLE_CLIENT_ID=')
  expect(content).toContain('APP_GAS_SCRIPT_ID=')
  expect(content).not.toMatch(/SPREADSHEET_ID|CLIENT_SECRET|ACCESS_TOKEN/)
})
```

將測試放在 `scripts/config-files.test.ts`，並將 Vitest include 擴充為 `src/**/*.test.ts?(x)` 及 `scripts/**/*.test.ts`。

- [ ] **Step 2: 執行設定檔測試確認失敗**

Run: `npm test -- --run scripts/config-files.test.ts`

Expected: FAIL，因設定檔內容與測試尚未完成。

- [ ] **Step 3: 撰寫精確部署與驗收文件**

`README.md` 必須說明功能、架構、先決條件、`npm install`、`npm run dev`、測試與建置指令，以及不支援功能。

`docs/deployment.md` 必須依下列順序提供可複製的步驟：

1. 建立 Google Sheets，記下 Sheet ID 並於「檔案 > 設定」選擇時區。
2. 建立標準 Google Cloud 專案，啟用 Google Apps Script API，並將 GAS 專案關聯至同一 Cloud 專案。
3. 建立 OAuth 2.0 Web Client，在「授權 JavaScript 來源」加入 `http://localhost:5173` 與正式網域；不加入 Vercel Preview 網址。
4. 複製 `.clasp.json.example` 為未追蹤的 `.clasp.json`，填入 GAS Script ID；使用 `clasp login`、`npm run build:gas`、`clasp push`。
5. 在 GAS 編輯器以手動執行 `initializeJournal('你的 Sheet ID')` 完成授權與工作表初始化。
6. 在 GAS 部署選擇 API Executable，存取權設定為「僅我自己」，並確認 `appsscript.json` 的 `executionApi.access` 為 `MYSELF`。
7. 將 `APP_GOOGLE_CLIENT_ID`、`APP_GAS_SCRIPT_ID` 放入 Vercel、Cloudflare Pages、Netlify、GitHub Pages Actions 的建置環境變數，或建立未追蹤的 `public/app-config.js` 後執行 `npm run build`。
8. 各平台的輸出目錄均為 `dist`；SPA 需設定未知路由回傳 `index.html`。

文件必須列出「OAuth origin_mismatch」、「Apps Script API 未啟用」、「GAS access denied」、「找不到 SPREADSHEET_ID」、「Sheets 時區不正確」五個錯誤與對應修正方式。

`docs/acceptance-checklist.md` 應涵蓋：三個斷點、登入與權杖過期、初始化空試算表、記事 CRUD、多筆同日、分類停用、四種篩選交集、月曆計數、CSV Excel 開啟及 Vercel 正式部署。

- [ ] **Step 4: 執行設定檔測試與全專案品質檢查**

Run: `npm run check`

Expected: PASS，lint、所有 Vitest 測試、前端 production build 與 GAS bundle 均成功。

- [ ] **Step 5: 依驗收清單在實際 Google 與 Vercel 資源驗證**

依 `docs/acceptance-checklist.md` 執行所有手動步驟。記錄實際 OAuth 網域、GAS deployment ID、測試時間與任何失敗原因；不得將 Sheet ID、GAS Script ID、OAuth Client ID 或使用者資料提交到 Git。

- [ ] **Step 6: 提出並核可提交訊息後提交**

向使用者提出：`補齊跨平台部署與驗收文件`。獲核可後執行：

```bash
git add README.md docs .env.example public/app-config.example.js .clasp.json.example .gitignore scripts/config-files.test.ts vitest.config.ts
git commit -m "補齊跨平台部署與驗收文件"
```

## 計畫自我檢核

- 規格覆蓋：11 個任務涵蓋靜態跨平台部署、OAuth、Execution API、GAS/Sheets、記事 CRUD、分類、標籤、連結、複合篩選、時間軸、月曆、CSV、繁中、響應式、錯誤處理、測試及文件。
- 範圍控制：計畫未加入離線同步、提醒、檔案上傳或集中式多使用者資料服務。
- 型別一致性：前端與 GAS 使用同名 JSON 結構；跨端互動僅透過 `ApiRequest` 與 `ApiResponse`；唯一公開 GAS endpoint 為 `executeAppRequest`。
- 部署安全性：前端僅有公開 Client ID 與 Script ID；`SPREADSHEET_ID` 留在 GAS Script Properties；未追蹤設定及產物均已納入 `.gitignore`。
