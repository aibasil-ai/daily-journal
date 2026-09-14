# 日曆日／週／月視角實作計畫

> **給代理工作者：** REQUIRED SUB-SKILL: 使用 `superpowers:subagent-driven-development`（建議）或 `superpowers:executing-plans` 逐項執行本計畫。每個步驟使用 checkbox（`- [ ]`）追蹤。

**目標：** 將既有單一月視角擴充成可保留焦點日期、切換日／週／月、精確查詢期間記事，並支援指定日期新增與響應式週版面的日曆。

**架構：** 共用領域層新增含頭含尾且最多 42 天的 `getEntriesForRange`，舊日期與月份動作委派同一查詢核心；前端以 `CalendarMode + anchorDate` 推導期間，由 `App` 管理兩套獨立查詢狀態與深入頁返回。純呈現層拆成共用框架、日、週、月元件，週視角使用專用精簡卡，版面以 CSS mobile-first 在 1024px 才切換七欄。

**技術棧：** React 19、TypeScript 5.9、Vite 8、Vitest 4、React Testing Library、Vercel Functions、Google Sheets API v4、Google Apps Script 相容層。

**設計規格：** `docs/superpowers/specs/2026-09-03-calendar-day-week-month-views-design.md`

---

## 執行原則

- 所有 production 變更先寫失敗測試、確認紅燈，再寫最小實作並確認綠燈。
- `calendar` 主頁識別值與 `daily-journal:view` 儲存值維持不變；只有介面名稱從「月曆」改為「日曆」。
- Google Sheet schema、`Entry`、`DailyEntries` 與 CSV 格式不變；本功能不建立資料遷移。
- `getEntriesForRange` 的 42 天限制只限制 API 日期跨度；現有 Sheet store 仍會載入完整工作表後在記憶體篩選，本次不建立索引或分頁。
- 新 range 驗證重用既有 `isIsoDate()` 定義，因此沿用其四位數年份範圍（包括既有可接受的 `0000`）；本功能不改變既有記事日期或篩選日期的接受範圍。
- API、既有資料與日／月視角的 `anchorDate` 接受 `0000-01-01` 至 `9999-12-31`。週視角因必須顯示完整週一至週日，只把 anchor 限制為 `0000-01-03` 至 `9999-12-26`；切入週視角時才鉗制到最近安全日期。各模式越界期間導覽維持原 anchor 並停用對應箭頭。
- 查詢範圍的 `rangeFrom/rangeTo` 與使用者篩選的 `filter.from/filter.to` 必須取交集，不得互相覆蓋。
- 日曆一般查詢錯誤只顯示在日曆內容區；只有 `AuthenticationError` 交給既有中央 session 流程。
- 類別顏色改變不增加 `revision`、不觸發 range 查詢；三種視角從最新 `categories` props 即時解析顏色。
- 不導入日期、日曆、狀態管理或 UI 套件。
- 每個 commit 步驟都必須先向使用者出示本計畫列出的繁體中文提交訊息；取得明確確認後才能執行 `git commit`。
- 工作區若有其他變更，只暫存該任務明列的檔案；不得修改、還原或納入 `opencode.json` 等無關檔案。
- 每次開始任務前先執行 `git status --short`，確認並保留其他工作者的變更。
- 本計畫是執行依據；開始 Task 1 前，規劃階段必須已向使用者出示繁體中文提交訊息、取得明確核准並提交本檔。15 個實作任務不重複 stage 本計畫。

## 檔案責任圖

### 新增檔案

- `shared/journal/validation.test.ts`：日期區間格式、順序與 42 天上限。
- `src/features/entries/calendar-date.ts`：`CalendarMode`、純 UTC 日期位移、週界線、期間與標題。
- `src/features/entries/calendar-date.test.ts`：跨月、跨年、閏年、月底鉗制與期間標題。
- `src/features/entries/calendar-mode-preference.ts`：安全讀寫 `daily-journal:calendar-mode`。
- `src/features/entries/calendar-mode-preference.test.ts`：有效、無效及 storage 例外回退。
- `src/features/entries/calendar-frame.tsx`：期間標題、計數、模式切換、期間導覽、載入、錯誤及重試。
- `src/features/entries/calendar-frame.test.tsx`：共用控制與無障礙狀態。
- `src/features/entries/calendar-month-view.tsx`：既有月格、兩則上限、更多記事 picker、今日及焦點日期；所有當月日期都有按鈕，但空白日期維持停用。
- `src/features/entries/calendar-month-view.test.tsx`：月視角既有行為與焦點回呼。
- `src/features/entries/calendar-day-view.tsx`：單日今日提示、完整摘要卡與指定日期新增。
- `src/features/entries/calendar-day-view.test.tsx`：單日今日提示、內容、操作、空白及類別色。
- `src/features/entries/week-entry-card.tsx`：週欄專用精簡記事卡。
- `src/features/entries/week-entry-card.test.tsx`：類別、標題、兩行摘要、前兩標籤及開啟詳情。
- `src/features/entries/calendar-week-view.tsx`：週一到週日、每日三則、展開／收合與指定日期新增。
- `src/features/entries/calendar-week-view.test.tsx`：七日順序、狀態標示、展開重設及無障礙關聯。

### 共用領域與傳輸層

- `shared/journal/types.ts`：新增 `getEntriesForRange` request union 分支。
- `shared/journal/validation.ts`：新增 `assertValidEntryRange()` 與 42 天常數。
- `shared/journal/service.ts`：新增日期區間分組核心，讓新舊查詢共用篩選與排序。
- `shared/journal/service.test.ts`：區間交集、排序、空結果及舊 API characterization tests。
- `shared/journal/dispatcher.ts`、`shared/journal/dispatcher.test.ts`：分派新唯讀動作並拒絕畸形輸入。
- `api/_journal.test.ts`：確認 range 動作走目前 session 的唯讀 store 路徑，不取得 write lease。
- `api/_lib/_sheets-journal-store.test.ts`：確認真實 Sheet fixture 可執行 range 查詢且不寫入。
- `gas/src/api/dispatcher.test.ts`：確認 GAS 相容入口自動取得新動作。
- `src/services/journal-api-client.test.ts`：固定瀏覽器傳輸 body 與原生 `ApiResponse` 解包契約。

### 前端表單、狀態與視角

- `src/features/entries/entry-form.tsx`、`.test.tsx`：建立記事支援 `initialDate`，編輯仍以記事日期優先。
- `src/features/entries/entry-detail.tsx`、`.test.tsx`：依來源顯示返回時間軸或返回日曆。
- `src/components/confirm-dialog.tsx`：既有 overflow／刪除對話框沿用，不修改。
- `src/features/journal/use-journal.ts`、`.test.tsx`：日曆頁停用背景時間軸清單，切回時間軸才依目前 filter 刷新。
- `src/features/journal/view-preference.ts`、`.test.ts`：補強既有主檢視 localStorage 容錯。
- `src/App.tsx`、`src/App.test.tsx`：保存 mode／anchor、兩套 range query、workspace 隔離、編輯器日期、深入頁與捲動還原。
- `src/i18n/zh-TW.ts`：日曆名稱、模式、期間、計數、空白、導覽、展開與重試文字。
- `src/styles/global.css`：共用框架、日／週／月、44px 控制、焦點／今日及 1024px 七欄。

### 移除與文件

- 刪除 `src/features/entries/calendar-view.tsx`：月格行為移至 `calendar-month-view.tsx`，共用控制移至 `calendar-frame.tsx`。
- 刪除 `src/features/entries/calendar-view.test.tsx`：測試分流至 frame 與 month view。
- `docs/acceptance-checklist.md`：加入日／週／月、競態、指定日期新增、斷點及鍵盤驗收。
- `README.md`、`docs/deployment.md`：將目前功能描述中的「月曆」更新為「日曆」，歷史規格與歷史計畫不回寫。

---

### Task 1：建立日期區間驗證與查詢核心

**Files:**
- Create: `shared/journal/validation.test.ts`
- Modify: `shared/journal/validation.ts:20-88`
- Modify: `shared/journal/service.ts:19-25,277-311,361-378`
- Modify: `shared/journal/service.test.ts:272-316`

- [ ] **Step 1：先寫日期區間驗證的失敗測試**

建立 `shared/journal/validation.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { assertValidEntryRange } from './validation.js'

describe('assertValidEntryRange', () => {
  it('接受含頭含尾 1 至 42 天的有效日期區間', () => {
    expect(() => assertValidEntryRange('2026-09-03', '2026-09-03')).not.toThrow()
    expect(() => assertValidEntryRange('2026-01-01', '2026-02-11')).not.toThrow()
    expect(() => assertValidEntryRange('2024-02-29', '2024-03-01')).not.toThrow()
    expect(() => assertValidEntryRange('0000-01-01', '0000-01-01')).not.toThrow()
  })

  it.each([
    ['2026-9-03', '2026-09-03', '查詢起始日期格式錯誤。'],
    ['2026-09-03', '2026-02-29', '查詢結束日期格式錯誤。'],
    ['2026-09-04', '2026-09-03', '查詢起始日期不可晚於結束日期。'],
    ['2026-01-01', '2026-02-12', '一次最多查詢 42 天。'],
  ])('拒絕無效區間 %s 至 %s', (from, to, message) => {
    expect(() => assertValidEntryRange(from, to)).toThrow(message)
  })
})
```

- [ ] **Step 2：執行驗證測試並確認紅燈**

Run: `npm run test:run -- --project=server shared/journal/validation.test.ts`

Expected: FAIL，訊息包含 `assertValidEntryRange` 尚未匯出。

- [ ] **Step 3：實作最小日期區間驗證**

在 `shared/journal/validation.ts` 的日期驗證附近加入：

```ts
export const MAX_ENTRY_RANGE_DAYS = 42

export function assertValidEntryRange(from: string, to: string): void {
  if (!isIsoDate(from)) {
    throw new JournalError('VALIDATION_ERROR', '查詢起始日期格式錯誤。')
  }
  if (!isIsoDate(to)) {
    throw new JournalError('VALIDATION_ERROR', '查詢結束日期格式錯誤。')
  }
  if (from > to) {
    throw new JournalError('VALIDATION_ERROR', '查詢起始日期不可晚於結束日期。')
  }

  const fromTime = Date.parse(`${from}T00:00:00.000Z`)
  const toTime = Date.parse(`${to}T00:00:00.000Z`)
  const inclusiveDays = Math.round((toTime - fromTime) / 86_400_000) + 1
  if (inclusiveDays > MAX_ENTRY_RANGE_DAYS) {
    throw new JournalError('VALIDATION_ERROR', `一次最多查詢 ${MAX_ENTRY_RANGE_DAYS} 天。`)
  }
}
```

- [ ] **Step 4：執行驗證測試並確認綠燈**

Run: `npm run test:run -- --project=server shared/journal/validation.test.ts`

Expected: PASS，4 組區間規則全部通過。

- [ ] **Step 5：先寫 service 區間、交集、排序及舊 API 的失敗測試**

在 `shared/journal/service.test.ts` 加入：

```ts
it('以含頭含尾區間分組，先套篩選再依日期升冪回傳', () => {
  const service = createService({
    categories: [category({ id: 'work' }), category({ id: 'life', name: '生活' })],
    entries: [
      entry({ id: 'outside', entryDate: '2026-08-30', content: '專案', tags: ['會議'] }),
      entry({ id: 'older', entryDate: '2026-09-01', content: '專案', tags: ['會議'], createdAt: '2026-09-01T09:00:00+08:00' }),
      entry({ id: 'newer', entryDate: '2026-09-01', content: '專案', tags: ['會議'], createdAt: '2026-09-01T15:00:00+08:00' }),
      entry({ id: 'wrong-tag', entryDate: '2026-09-02', content: '專案', tags: ['閱讀'] }),
      entry({ id: 'last', entryDate: '2026-09-06', content: '專案', tags: ['會議'] }),
    ],
  })

  expect(service.getEntriesForRange('2026-08-31', '2026-09-06', {
    ...emptyCriteria,
    query: '專案',
    from: '2026-09-01',
    categoryId: 'work',
    tag: '會議',
  })).toEqual([
    { date: '2026-09-01', entries: [expect.objectContaining({ id: 'newer' }), expect.objectContaining({ id: 'older' })] },
    { date: '2026-09-06', entries: [expect.objectContaining({ id: 'last' })] },
  ])
})

it('區間查詢回傳稀疏空結果並限制最多 42 天', () => {
  const service = createService({ categories: [category()] })

  expect(service.getEntriesForRange('2026-01-01', '2026-02-11', emptyCriteria)).toEqual([])
  expect(() => service.getEntriesForRange('2026-01-01', '2026-02-12', emptyCriteria))
    .toThrow('一次最多查詢 42 天。')
})

it('舊日期與月份方法保留回應形狀及驗證訊息', () => {
  const service = createService({
    categories: [category()],
    entries: [entry({ id: 'leap', entryDate: '2024-02-29' })],
  })

  expect(service.getEntriesForDate('2024-02-29', emptyCriteria)).toEqual([
    expect.objectContaining({ id: 'leap' }),
  ])
  expect(service.getMonthlyEntries(2024, 2, emptyCriteria)).toEqual([
    { date: '2024-02-29', entries: [expect.objectContaining({ id: 'leap' })] },
  ])
  expect(service.getMonthlyEntryCounts(2024, 2, emptyCriteria)).toEqual([
    { date: '2024-02-29', count: 1 },
  ])
  expect(() => service.getEntriesForDate('2026-02-29', emptyCriteria)).toThrow('請選擇記錄日期。')
  expect(() => service.getMonthlyEntries(2026, 13, emptyCriteria)).toThrow('月份必須介於 1 到 12。')
})
```

- [ ] **Step 6：執行 service 測試並確認紅燈**

Run: `npm run test:run -- --project=server shared/journal/service.test.ts`

Expected: FAIL，訊息包含 `getEntriesForRange is not a function`。

- [ ] **Step 7：實作共用區間核心並讓舊方法委派**

在 `shared/journal/service.ts` 匯入 `assertValidEntryRange`，並以以下方法取代現有三個日期／月份方法；月份驗證順序與文字保持不變：

```ts
getEntriesForRange(from: string, to: string, filter: EntryFilterCriteria): DailyEntries[] {
  assertValidEntryRange(from, to)
  assertEntryFilterCriteria(filter)
  return this.groupEntriesForRange(from, to, filter)
}

getEntriesForDate(date: string, filter: EntryFilterCriteria): Entry[] {
  assertValidEntryDate(date)
  assertEntryFilterCriteria(filter)
  return this.groupEntriesForRange(date, date, filter)[0]?.entries ?? []
}

getMonthlyEntryCounts(year: number, month: number, filter: EntryFilterCriteria): DailyEntryCount[] {
  return this.getMonthlyEntries(year, month, filter).map(({ date, entries }) => ({
    date,
    count: entries.length,
  }))
}

getMonthlyEntries(year: number, month: number, filter: EntryFilterCriteria): DailyEntries[] {
  assertEntryFilterCriteria(filter)
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new JournalError('VALIDATION_ERROR', '年份必須是正整數。')
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new JournalError('VALIDATION_ERROR', '月份必須介於 1 到 12。')
  }

  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
  const from = `${prefix}-01`
  const to = `${prefix}-${String(daysInMonth(year, month)).padStart(2, '0')}`
  return this.groupEntriesForRange(from, to, filter)
}
```

在 `JournalService` private methods 中加入：

```ts
private groupEntriesForRange(from: string, to: string, filter: EntryFilterCriteria): DailyEntries[] {
  const entriesByDate = new Map<string, Entry[]>()
  for (const entry of this.filteredEntries(filter)) {
    if (entry.entryDate < from || entry.entryDate > to) continue
    const entries = entriesByDate.get(entry.entryDate) ?? []
    entries.push(entry)
    entriesByDate.set(entry.entryDate, entries)
  }

  return [...entriesByDate.entries()]
    .map(([date, entries]) => ({ date, entries }))
    .sort((left, right) => left.date.localeCompare(right.date))
}
```

在檔案尾端加入不受 JavaScript 0 至 99 年特例影響的月份天數函式：

```ts
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leapYear ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}
```

- [ ] **Step 8：執行共用領域測試**

Run: `npm run test:run -- --project=server shared/journal/validation.test.ts shared/journal/service.test.ts`

Expected: PASS，且既有 service 測試沒有回歸。

- [ ] **Step 9：向使用者出示提交訊息並等待核准**

提交訊息：`feat: 新增記事日期區間查詢服務`

- [ ] **Step 10：核准後只提交本任務檔案**

```bash
git add shared/journal/validation.test.ts shared/journal/validation.ts shared/journal/service.ts shared/journal/service.test.ts
git commit -m "feat: 新增記事日期區間查詢服務"
```

---

### Task 2：擴充 API 型別與共用分派器

**Files:**
- Modify: `shared/journal/types.ts:92-108`
- Modify: `shared/journal/dispatcher.ts:31-65,144-160`
- Modify: `shared/journal/dispatcher.test.ts:65-75,104-131`

- [ ] **Step 1：先寫新 action 分派與錯誤分類的失敗測試**

在 `shared/journal/dispatcher.test.ts` 加入：

```ts
it('分派日期區間查詢並維持唯讀分類', () => {
  const journalService = service()
  const getEntriesForRange = vi.spyOn(journalService, 'getEntriesForRange')
  const filter = { query: '', from: null, to: null, categoryId: null, tag: null }
  const request = {
    action: 'getEntriesForRange' as const,
    from: '2026-08-31',
    to: '2026-09-06',
    filter,
  }

  expect(executeJournalRequest(request, journalService)).toEqual({ ok: true, data: [] })
  expect(getEntriesForRange).toHaveBeenCalledWith('2026-08-31', '2026-09-06', filter)
  expect(isJournalMutation(request)).toBe(false)
})

it.each([
  [{ action: 'getEntriesForRange', to: '2026-09-06', filter: {} }, 'INVALID_REQUEST'],
  [{ action: 'getEntriesForRange', from: 1, to: '2026-09-06', filter: {} }, 'INVALID_REQUEST'],
  [{ action: 'getEntriesForRange', from: '2026-09-07', to: '2026-09-06', filter: { query: '', from: null, to: null, categoryId: null, tag: null } }, 'VALIDATION_ERROR'],
])('拒絕畸形日期區間請求', (request, code) => {
  expect(executeJournalRequest(request, service())).toMatchObject({ ok: false, code })
})
```

- [ ] **Step 2：執行 dispatcher 測試並確認紅燈**

Run: `npm run test:run -- --project=server shared/journal/dispatcher.test.ts`

Expected: FAIL；TypeScript union 不接受新 action，或執行結果為 `INVALID_ACTION`。

- [ ] **Step 3：新增 `ApiRequest` 分支**

在 `shared/journal/types.ts` 的日期查詢分支中加入：

```ts
| {
    action: 'getEntriesForRange'
    from: string
    to: string
    filter: EntryFilterCriteria
  }
```

保留 `getEntriesForDate`、`getMonthlyEntryCounts` 與 `getMonthlyEntries` 分支。

- [ ] **Step 4：分派新 action 並加入支援白名單**

在 `shared/journal/dispatcher.ts` 的 `getEntriesForDate` 前加入：

```ts
case 'getEntriesForRange': {
  const from = readString(request, 'from')
  const to = readString(request, 'to')
  const filter = parseEntryFilterCriteria(request.filter)
  return {
    ok: true,
    data: getService().getEntriesForRange(from, to, filter),
  }
}
```

並在 `isSupportedAction()` 加入：

```ts
|| action === 'getEntriesForRange'
```

不得將它加入 `isJournalMutation()` 的 mutation 清單。

- [ ] **Step 5：執行 dispatcher 與共用領域測試**

Run: `npm run test:run -- --project=server shared/journal/validation.test.ts shared/journal/service.test.ts shared/journal/dispatcher.test.ts`

Expected: PASS，新 action、畸形輸入與舊 action 全部通過。

- [ ] **Step 6：向使用者出示提交訊息並等待核准**

提交訊息：`feat: 分派記事日期區間查詢`

- [ ] **Step 7：核准後只提交本任務檔案**

```bash
git add shared/journal/types.ts shared/journal/dispatcher.ts shared/journal/dispatcher.test.ts
git commit -m "feat: 分派記事日期區間查詢"
```

---

### Task 3：固定 Vercel、Sheets、GAS 與瀏覽器傳輸契約

**Files:**
- Modify: `api/_journal.test.ts`
- Modify: `api/_lib/_sheets-journal-store.test.ts`
- Modify: `gas/src/api/dispatcher.test.ts`
- Modify: `src/services/journal-api-client.test.ts`

- [ ] **Step 1：加入 Vercel route 的唯讀 range 測試**

在 `api/_journal.test.ts` 的 read/write lease 測試附近加入：

```ts
test('日期區間查詢只走目前 session 的唯讀 store 路徑', async () => {
  const system = createSystem()
  const requestBody = {
    action: 'getEntriesForRange',
    from: '2026-08-31',
    to: '2026-09-06',
    filter: { query: '', from: null, to: null, categoryId: null, tag: null },
  }
  system.aliceStore.execute.mockResolvedValueOnce({ ok: true, data: [] })

  const response = await system.handler(journalRequest('session-alice', requestBody))

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({ ok: true, data: [] })
  expect(system.aliceStore.execute).toHaveBeenCalledWith(requestBody)
  expect(system.rateLimiter.consume).not.toHaveBeenCalled()
  expect(system.connections.withSheetWriteLease).not.toHaveBeenCalled()
})
```

- [ ] **Step 2：加入 Sheets store 的真實分派與不寫入測試**

在 `api/_lib/_sheets-journal-store.test.ts` 的 `execute` 測試後加入：

```ts
test('execute 可查詢日期區間且唯讀請求不寫回 Sheet', async () => {
  const inside = entryRow('inside')
  inside[1] = '2026-09-03'
  inside[3] = '範圍內內容'
  const outside = entryRow('outside')
  outside[1] = '2026-09-07'
  outside[3] = '範圍外內容'
  const client = fakeClient({
    metadata: compatibleMetadata(),
    schemaRanges: compatibleSchemaRanges(),
    dataRanges: [
      { range: `${ENTRY_SHEET_NAME}!A2:I`, values: [inside, outside] },
      { range: `${CATEGORY_SHEET_NAME}!A2:F`, values: [categoryRow('category-a')] },
    ],
  })
  const store = await SheetsJournalStore.load({
    client,
    accessToken: 'test-token',
    spreadsheetId: 'sheet-ref-a',
  })

  await expect(store.execute({
    action: 'getEntriesForRange',
    from: '2026-08-31',
    to: '2026-09-06',
    filter: { query: '', from: null, to: null, categoryId: null, tag: null },
  })).resolves.toEqual({
    ok: true,
    data: [{ date: '2026-09-03', entries: [expect.objectContaining({ id: 'inside' })] }],
  })
  expect(client.batchUpdate).not.toHaveBeenCalled()
})
```

- [ ] **Step 3：加入 GAS 相容分派測試**

在 `gas/src/api/dispatcher.test.ts` 加入：

```ts
it('日期區間 action 自動使用共用分派器', () => {
  const getEntriesForRange = () => []
  const service = { getEntriesForRange } as unknown as JournalService

  expect(executeAppRequest({
    action: 'getEntriesForRange',
    from: '2026-08-31',
    to: '2026-09-06',
    filter: { query: '', from: null, to: null, categoryId: null, tag: null },
  }, service)).toEqual({ ok: true, data: [] })
})
```

- [ ] **Step 4：加入瀏覽器 client request body 測試**

在 `src/services/journal-api-client.test.ts` 加入：

```ts
test('原樣送出日期區間查詢並解包每日記事', async () => {
  const data = [{ date: '2026-09-03', entries: [] }]
  const fetchMock = vi.fn(async () => jsonResponse({ ok: true, data }))
  vi.stubGlobal('fetch', fetchMock)
  const request = {
    action: 'getEntriesForRange' as const,
    from: '2026-08-31',
    to: '2026-09-06',
    filter: { query: '', from: null, to: null, categoryId: null, tag: null },
  }

  await expect(new JournalApiClient().run(request)).resolves.toEqual(data)
  expect(fetchMock).toHaveBeenCalledWith('/api/journal', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
})
```

- [ ] **Step 5：執行四層契約測試**

Run: `npm run test:run -- --project=server api/_journal.test.ts api/_lib/_sheets-journal-store.test.ts gas/src/api/dispatcher.test.ts`

Expected: PASS；route 不取得 lease、Sheet 不寫入、GAS 可分派。

Run: `npm run test:run -- --project=frontend src/services/journal-api-client.test.ts`

Expected: PASS；client 原樣送出 request 並解包 `DailyEntries[]`。

- [ ] **Step 6：執行 GAS 建置**

Run: `npm run build:gas`

Expected: PASS，共用新 action 可被 GAS 相容 bundle 編譯。

- [ ] **Step 7：向使用者出示提交訊息並等待核准**

提交訊息：`test: 驗證日期區間查詢傳輸契約`

- [ ] **Step 8：核准後只提交本任務檔案**

```bash
git add api/_journal.test.ts api/_lib/_sheets-journal-store.test.ts gas/src/api/dispatcher.test.ts src/services/journal-api-client.test.ts
git commit -m "test: 驗證日期區間查詢傳輸契約"
```

---

### Task 4：建立純 UTC 日曆日期工具

**Files:**
- Create: `src/features/entries/calendar-date.ts`
- Create: `src/features/entries/calendar-date.test.ts`
- Modify: `src/utils/date.ts:40-49`

- [ ] **Step 1：先寫日期位移、期間與標題的失敗測試**

建立 `src/features/entries/calendar-date.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  addCalendarDays,
  clampCalendarAnchorDate,
  formatCalendarMonthDay,
  formatCalendarPeriodTitle,
  formatCalendarWeekday,
  getCalendarDateRange,
  listCalendarDates,
  MAX_CALENDAR_ANCHOR_DATE,
  MAX_CALENDAR_WEEK_ANCHOR_DATE,
  MIN_CALENDAR_ANCHOR_DATE,
  MIN_CALENDAR_WEEK_ANCHOR_DATE,
  shiftCalendarAnchorDate,
} from './calendar-date'

describe('日曆日期工具', () => {
  it('以週一到週日建立跨月與跨年的七日範圍', () => {
    expect(getCalendarDateRange('week', '2026-09-03')).toEqual({
      from: '2026-08-31',
      to: '2026-09-06',
    })
    expect(getCalendarDateRange('week', '2027-01-01')).toEqual({
      from: '2026-12-28',
      to: '2027-01-03',
    })
    expect(listCalendarDates('2026-08-31', '2026-09-06')).toHaveLength(7)
  })

  it('建立日與閏年月的含頭含尾範圍', () => {
    expect(getCalendarDateRange('day', '2024-02-29')).toEqual({
      from: '2024-02-29',
      to: '2024-02-29',
    })
    expect(getCalendarDateRange('month', '2024-02-29')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    })
  })

  it('依模式位移並在月末鉗制日期', () => {
    expect(shiftCalendarAnchorDate('day', '2026-09-03', -1)).toBe('2026-09-02')
    expect(shiftCalendarAnchorDate('week', '2026-09-03', 1)).toBe('2026-09-10')
    expect(shiftCalendarAnchorDate('month', '2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftCalendarAnchorDate('month', '2024-03-31', -1)).toBe('2024-02-29')
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('依模式限制互動焦點年界且不產生畸形或五位數日期', () => {
    expect(clampCalendarAnchorDate('day', '0000-01-01')).toBe(MIN_CALENDAR_ANCHOR_DATE)
    expect(clampCalendarAnchorDate('month', '9999-12-31')).toBe(MAX_CALENDAR_ANCHOR_DATE)
    expect(clampCalendarAnchorDate('week', '0000-01-01')).toBe(MIN_CALENDAR_WEEK_ANCHOR_DATE)
    expect(clampCalendarAnchorDate('week', '9999-12-31')).toBe(MAX_CALENDAR_WEEK_ANCHOR_DATE)
    expect(getCalendarDateRange('day', MIN_CALENDAR_ANCHOR_DATE)).toEqual({
      from: '0000-01-01',
      to: '0000-01-01',
    })
    expect(getCalendarDateRange('month', MAX_CALENDAR_ANCHOR_DATE)).toEqual({
      from: '9999-12-01',
      to: '9999-12-31',
    })
    expect(getCalendarDateRange('week', MIN_CALENDAR_WEEK_ANCHOR_DATE)).toEqual({
      from: '0000-01-03',
      to: '0000-01-09',
    })
    expect(getCalendarDateRange('week', MAX_CALENDAR_WEEK_ANCHOR_DATE)).toEqual({
      from: '9999-12-20',
      to: '9999-12-26',
    })
    expect(shiftCalendarAnchorDate('day', MIN_CALENDAR_ANCHOR_DATE, -1)).toBe(MIN_CALENDAR_ANCHOR_DATE)
    expect(shiftCalendarAnchorDate('day', MAX_CALENDAR_ANCHOR_DATE, 1)).toBe(MAX_CALENDAR_ANCHOR_DATE)
    expect(shiftCalendarAnchorDate('month', MIN_CALENDAR_ANCHOR_DATE, -1)).toBe(MIN_CALENDAR_ANCHOR_DATE)
    expect(shiftCalendarAnchorDate('month', MAX_CALENDAR_ANCHOR_DATE, 1)).toBe(MAX_CALENDAR_ANCHOR_DATE)
    expect(shiftCalendarAnchorDate('week', MIN_CALENDAR_WEEK_ANCHOR_DATE, -1)).toBe(MIN_CALENDAR_WEEK_ANCHOR_DATE)
    expect(shiftCalendarAnchorDate('week', MAX_CALENDAR_WEEK_ANCHOR_DATE, 1)).toBe(MAX_CALENDAR_WEEK_ANCHOR_DATE)
    expect(shiftCalendarAnchorDate('week', '0000-01-04', -1)).toBe('0000-01-04')
    expect(shiftCalendarAnchorDate('week', '9999-12-20', 1)).toBe('9999-12-20')
    expect(listCalendarDates(MAX_CALENDAR_ANCHOR_DATE, MAX_CALENDAR_ANCHOR_DATE))
      .toEqual([MAX_CALENDAR_ANCHOR_DATE])
    expect(() => addCalendarDays('0000-01-01', -1)).toThrow('日曆日期超出四位數年份範圍。')
    expect(() => addCalendarDays('9999-12-31', 1)).toThrow('日曆日期超出四位數年份範圍。')
  })

  it('格式化三種期間、星期與月日', () => {
    expect(formatCalendarPeriodTitle('day', '2026-09-03')).toBe('2026年9月3日 星期四')
    expect(formatCalendarPeriodTitle('week', '2026-09-03')).toBe('2026年8月31日－9月6日')
    expect(formatCalendarPeriodTitle('week', '2027-01-01')).toBe('2026年12月28日－2027年1月3日')
    expect(formatCalendarPeriodTitle('month', '2026-09-03')).toBe('2026年9月')
    expect(formatCalendarWeekday('2026-09-03')).toBe('星期四')
    expect(formatCalendarMonthDay('2026-09-03')).toBe('9月3日')
  })
})
```

- [ ] **Step 2：執行日期工具測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-date.test.ts`

Expected: FAIL，訊息包含找不到 `./calendar-date`。

- [ ] **Step 3：實作日曆日期工具**

建立 `src/features/entries/calendar-date.ts`：

```ts
export type CalendarMode = 'day' | 'week' | 'month'

export type CalendarDateRange = {
  from: string
  to: string
}

export const MIN_CALENDAR_ANCHOR_DATE = '0000-01-01'
export const MAX_CALENDAR_ANCHOR_DATE = '9999-12-31'
export const MIN_CALENDAR_WEEK_ANCHOR_DATE = '0000-01-03'
export const MAX_CALENDAR_WEEK_ANCHOR_DATE = '9999-12-26'

const WEEKDAYS = [
  '星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六',
] as const

export function addCalendarDays(date: string, amount: number): string {
  const parsed = parseCalendarDate(date)
  parsed.setUTCDate(parsed.getUTCDate() + amount)
  return toCalendarDate(parsed)
}

export function getCalendarDateRange(mode: CalendarMode, anchorDate: string): CalendarDateRange {
  assertCalendarAnchorDate(mode, anchorDate)
  if (mode === 'day') return { from: anchorDate, to: anchorDate }
  if (mode === 'week') {
    const parsed = parseCalendarDate(anchorDate)
    const offsetFromMonday = (parsed.getUTCDay() + 6) % 7
    const from = addCalendarDays(anchorDate, -offsetFromMonday)
    return { from, to: addCalendarDays(from, 6) }
  }

  const { year, month } = calendarDateParts(anchorDate)
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
  return {
    from: `${prefix}-01`,
    to: `${prefix}-${String(daysInMonth(year, month)).padStart(2, '0')}`,
  }
}

export function shiftCalendarAnchorDate(
  mode: CalendarMode,
  anchorDate: string,
  direction: -1 | 1,
): string {
  assertCalendarAnchorDate(mode, anchorDate)
  const { min, max } = calendarAnchorBounds(mode)
  if (mode === 'day') {
    if ((direction < 0 && anchorDate === min) || (direction > 0 && anchorDate === max)) return anchorDate
    return keepAnchorWhenOutsideBounds(mode, anchorDate, addCalendarDays(anchorDate, direction))
  }
  if (mode === 'week') {
    const range = getCalendarDateRange(mode, anchorDate)
    if ((direction < 0 && range.from === min) || (direction > 0 && range.to === max)) return anchorDate
    return keepAnchorWhenOutsideBounds(mode, anchorDate, addCalendarDays(anchorDate, direction * 7))
  }

  const { year, month, day } = calendarDateParts(anchorDate)
  const targetIndex = year * 12 + month - 1 + direction
  if (targetIndex < 0 || targetIndex > 9999 * 12 + 11) return anchorDate
  const targetYear = Math.floor(targetIndex / 12)
  const targetMonth = targetIndex - targetYear * 12 + 1
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth))
  return keepAnchorWhenOutsideBounds(mode, anchorDate, formatCalendarDate(targetYear, targetMonth, targetDay))
}

export function clampCalendarAnchorDate(mode: CalendarMode, date: string): string {
  const { min, max } = calendarAnchorBounds(mode)
  if (date < min) return min
  if (date > max) return max
  return date
}

export function listCalendarDates(from: string, to: string): string[] {
  const dates: string[] = []
  for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
    dates.push(date)
    if (date === to) break
  }
  return dates
}

export function formatCalendarPeriodTitle(mode: CalendarMode, anchorDate: string): string {
  assertCalendarAnchorDate(mode, anchorDate)
  const anchor = calendarDateParts(anchorDate)
  if (mode === 'day') {
    return `${anchor.year}年${anchor.month}月${anchor.day}日 ${formatCalendarWeekday(anchorDate)}`
  }
  if (mode === 'month') return `${anchor.year}年${anchor.month}月`

  const { from, to } = getCalendarDateRange('week', anchorDate)
  const start = calendarDateParts(from)
  const end = calendarDateParts(to)
  if (start.year === end.year) {
    return `${start.year}年${start.month}月${start.day}日－${end.month}月${end.day}日`
  }
  return `${start.year}年${start.month}月${start.day}日－${end.year}年${end.month}月${end.day}日`
}

export function formatCalendarWeekday(date: string): string {
  return WEEKDAYS[parseCalendarDate(date).getUTCDay()]
}

export function formatCalendarMonthDay(date: string): string {
  const { month, day } = calendarDateParts(date)
  return `${month}月${day}日`
}

function calendarDateParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day }
}

function parseCalendarDate(date: string): Date {
  const { year, month, day } = calendarDateParts(date)
  const parsed = new Date(0)
  parsed.setUTCFullYear(year, month - 1, day)
  parsed.setUTCHours(0, 0, 0, 0)
  return parsed
}

function toCalendarDate(date: Date): string {
  return formatCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function formatCalendarDate(year: number, month: number, day: number): string {
  if (year < 0 || year > 9999) throw new RangeError('日曆日期超出四位數年份範圍。')
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function assertCalendarAnchorDate(mode: CalendarMode, date: string): void {
  const { min, max } = calendarAnchorBounds(mode)
  if (date < min || date > max) {
    throw new RangeError('日曆焦點日期超出支援範圍。')
  }
}

function keepAnchorWhenOutsideBounds(mode: CalendarMode, anchorDate: string, candidate: string): string {
  const { min, max } = calendarAnchorBounds(mode)
  return candidate < min || candidate > max
    ? anchorDate
    : candidate
}

function calendarAnchorBounds(mode: CalendarMode): { min: string; max: string } {
  return mode === 'week'
    ? { min: MIN_CALENDAR_WEEK_ANCHOR_DATE, max: MAX_CALENDAR_WEEK_ANCHOR_DATE }
    : { min: MIN_CALENDAR_ANCHOR_DATE, max: MAX_CALENDAR_ANCHOR_DATE }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leapYear ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}
```

- [ ] **Step 4：移除未使用且採本地時區的舊月份工具**

確認 `shiftMonth()` 沒有呼叫端後，從 `src/utils/date.ts` 移除：

```ts
export function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year, monthNumber - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
```

暫時保留 `monthParts()` 給舊月視角 wrapper；Task 11 移除 wrapper 後再確認是否可刪除。

- [ ] **Step 5：執行日期測試與既有日期回歸**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-date.test.ts src/utils/date.test.ts`

Expected: PASS，包含跨年、閏年、月底鉗制、四位數輸出與互動焦點年界。

- [ ] **Step 6：向使用者出示提交訊息並等待核准**

提交訊息：`feat: 新增日曆日期期間工具`

- [ ] **Step 7：核准後只提交本任務檔案**

```bash
git add src/features/entries/calendar-date.ts src/features/entries/calendar-date.test.ts src/utils/date.ts
git commit -m "feat: 新增日曆日期期間工具"
```

---

### Task 5：建立安全的日曆模式偏好

**Files:**
- Create: `src/features/entries/calendar-mode-preference.ts`
- Create: `src/features/entries/calendar-mode-preference.test.ts`
- Modify: `src/features/journal/view-preference.ts:9-15`
- Modify: `src/features/journal/view-preference.test.ts:6-16`

- [ ] **Step 1：先寫模式偏好與 storage 例外的失敗測試**

建立 `src/features/entries/calendar-mode-preference.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCalendarModePreference, saveCalendarModePreference } from './calendar-mode-preference'

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('日曆模式偏好', () => {
  it('預設為月並只接受三種有效模式', () => {
    expect(readCalendarModePreference()).toBe('month')
    window.localStorage.setItem('daily-journal:calendar-mode', 'invalid')
    expect(readCalendarModePreference()).toBe('month')
    for (const mode of ['day', 'week', 'month'] as const) {
      saveCalendarModePreference(mode)
      expect(readCalendarModePreference()).toBe(mode)
    }
  })

  it('瀏覽器拒絕 localStorage 時安全回退且不阻止切換', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })

    expect(readCalendarModePreference()).toBe('month')
    expect(() => saveCalendarModePreference('week')).not.toThrow()
  })
})
```

在 `src/features/journal/view-preference.test.ts` 加入：

```ts
test('主檢視偏好在 localStorage 被拒絕時安全回退', () => {
  vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })

  expect(readViewPreference()).toBeNull()
  expect(() => saveViewPreference('calendar')).not.toThrow()
})
```

並把該檔案的 Vitest import 補上 `afterEach`、`vi`，加入：

```ts
afterEach(() => vi.restoreAllMocks())
```

避免第一個 storage spy 留到下一個測試。

- [ ] **Step 2：執行偏好測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-mode-preference.test.ts src/features/journal/view-preference.test.ts`

Expected: FAIL；新模組不存在，既有主檢視 helper 會拋出 `blocked`。

- [ ] **Step 3：實作日曆模式偏好**

建立 `src/features/entries/calendar-mode-preference.ts`：

```ts
import type { CalendarMode } from './calendar-date'

const CALENDAR_MODE_STORAGE_KEY = 'daily-journal:calendar-mode'

export function readCalendarModePreference(): CalendarMode {
  try {
    const value = window.localStorage.getItem(CALENDAR_MODE_STORAGE_KEY)
    return value === 'day' || value === 'week' || value === 'month' ? value : 'month'
  } catch {
    return 'month'
  }
}

export function saveCalendarModePreference(mode: CalendarMode): void {
  try {
    window.localStorage.setItem(CALENDAR_MODE_STORAGE_KEY, mode)
  } catch {
    // 模式仍在目前 React state 生效；無法持久化不應阻止操作。
  }
}
```

- [ ] **Step 4：補強既有主檢視偏好容錯**

將 `src/features/journal/view-preference.ts` 的讀寫函式改成：

```ts
export function readViewPreference(): JournalView | null {
  try {
    const value = window.localStorage.getItem(VIEW_STORAGE_KEY)
    return value === 'timeline' || value === 'calendar' ? value : null
  } catch {
    return null
  }
}

export function saveViewPreference(view: JournalView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // 目前導覽仍應繼續，只有跨重新整理偏好無法保存。
  }
}
```

- [ ] **Step 5：執行偏好測試**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-mode-preference.test.ts src/features/journal/view-preference.test.ts`

Expected: PASS，有效值、無效值與兩種 storage 例外都通過。

- [ ] **Step 6：向使用者出示提交訊息並等待核准**

提交訊息：`feat: 儲存日曆檢視模式偏好`

- [ ] **Step 7：核准後只提交本任務檔案**

```bash
git add src/features/entries/calendar-mode-preference.ts src/features/entries/calendar-mode-preference.test.ts src/features/journal/view-preference.ts src/features/journal/view-preference.test.ts
git commit -m "feat: 儲存日曆檢視模式偏好"
```

---

### Task 6：支援指定日期新增與來源感知返回

**Files:**
- Modify: `src/features/entries/entry-form.tsx:9-34,259-280`
- Modify: `src/features/entries/entry-form.test.tsx`
- Modify: `src/features/entries/entry-detail.tsx:9-19,42-58`
- Modify: `src/features/entries/entry-detail.test.tsx`
- Modify: `src/App.tsx:505-519`
- Modify: `src/App.test.tsx`
- Modify: `src/i18n/zh-TW.ts:122-144`

- [ ] **Step 1：先寫 `initialDate` 優先順序的失敗測試**

在 `src/features/entries/entry-form.test.tsx` 加入固定分類 fixture：

```ts
const category = {
  id: 'work',
  name: '工作',
  color: null,
  isActive: true,
  createdAt: '2026-08-04T00:00:00+08:00',
  updatedAt: '2026-08-04T00:00:00+08:00',
}
```

再加入：

```tsx
test('新增記事使用指定日期，編輯記事仍使用原日期', () => {
  const props = {
    categories: [category],
    tagSuggestions: [],
    timezone: 'Asia/Taipei',
    onSave: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
  }
  const { rerender } = render(<EntryForm {...props} initialDate="2026-09-03" />)

  expect(screen.getByLabelText('記事日期')).toHaveValue('2026-09-03')

  rerender(<EntryForm
    {...props}
    initialDate="2026-09-03"
    entry={{
      id: 'entry-1', entryDate: '2026-08-20', title: '', content: '既有內容', categoryId: 'work',
      tags: [], links: [], createdAt: '2026-08-20T09:00:00+08:00', updatedAt: '2026-08-20T09:00:00+08:00',
    }}
  />)
  expect(screen.getByLabelText('記事日期')).toHaveValue('2026-08-20')
})
```

- [ ] **Step 2：執行表單測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/features/entries/entry-form.test.tsx`

Expected: FAIL；`EntryFormProps` 不接受 `initialDate`，或日期仍是今天。

- [ ] **Step 3：實作 `initialDate` 並保持編輯日期優先**

調整 `EntryForm` props、draft 初始化及 effect dependency：

```ts
type EntryFormProps = {
  entry?: Entry
  initialDate?: string
  categories: Category[]
  tagSuggestions: string[]
  timezone: string
  onSave: (entry: EntryInput) => Promise<void>
  onCancel: () => void
}

export function EntryForm({ entry, initialDate, categories, tagSuggestions, timezone, onSave, onCancel }: EntryFormProps) {
  const defaultCategoryId = categories.find((category) => category.isActive)?.id ?? ''
  const [draft, setDraft] = useState<EntryInput>(() => createDraft(entry, initialDate, defaultCategoryId, timezone))

  useEffect(() => {
    setDraft(createDraft(entry, initialDate, defaultCategoryId, timezone))
    setTagInput('')
    setIssues([])
    setSubmitError(undefined)
  }, [defaultCategoryId, entry, initialDate, timezone])
```

將 `createDraft` 簽章改為：

```ts
function createDraft(
  entry: Entry | undefined,
  initialDate: string | undefined,
  defaultCategoryId: string,
  timezone: string,
): EntryInput {
  if (entry) {
    const { id, entryDate, title, content, categoryId, tags, links } = entry
    return { id, entryDate, title, content, categoryId, tags: [...tags], links: links.map((link) => ({ ...link })) }
  }
  return {
    entryDate: initialDate ?? getJournalDate(timezone),
    title: '',
    content: '',
    categoryId: defaultCategoryId,
    tags: [],
    links: [],
  }
}
```

- [ ] **Step 4：先寫兩種詳情返回來源的失敗測試**

在 `src/features/entries/entry-detail.test.tsx` 的所有既有 render 補上 `returnTarget="calendar"`，並加入：

```tsx
it.each([
  ['timeline' as const, '返回時間軸'],
  ['calendar' as const, '返回日曆'],
])('依 %s 來源顯示返回文字', async (returnTarget, label) => {
  const onBack = vi.fn()
  render(
    <EntryDetail
      entry={mockEntry}
      categoryName="工作"
      categoryColor={null}
      timezone="Asia/Taipei"
      returnTarget={returnTarget}
      onBack={onBack}
      onEdit={vi.fn()}
      onDelete={vi.fn().mockResolvedValue(undefined)}
    />,
  )

  await userEvent.click(screen.getByRole('button', { name: label }))
  expect(onBack).toHaveBeenCalledOnce()
})
```

- [ ] **Step 5：執行詳情測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/features/entries/entry-detail.test.tsx`

Expected: FAIL；元件沒有 `returnTarget`，且返回文字固定為「返回月曆」。

- [ ] **Step 6：實作來源感知返回並更新文案**

在 `src/i18n/zh-TW.ts` 把：

```ts
backToCalendar: '返回月曆',
```

改為：

```ts
backToCalendar: '返回日曆',
```

在 `EntryDetailProps` 新增：

```ts
returnTarget: 'timeline' | 'calendar'
```

接收 prop 後將返回文字改為：

```tsx
{returnTarget === 'timeline' ? zhTW.actions.backToTimeline : zhTW.actions.backToCalendar}
```

- [ ] **Step 7：先寫 App 來源整合測試，再接上必填返回來源**

先不要修改 App；在 `src/App.test.tsx` 加入整合測試：

```tsx
test('記事詳情依原主頁顯示返回時間軸或日曆', async () => {
  const user = userEvent.setup()
  const entryDate = `${getJournalMonth('Asia/Taipei')}-03`
  const entry = {
    id: 'entry-source', entryDate, title: '來源測試', content: '內容', categoryId: 'work',
    tags: [], links: [], createdAt: `${entryDate}T09:00:00+08:00`, updatedAt: `${entryDate}T09:00:00+08:00`,
  }
  const category = {
    id: 'work', name: '工作', color: null, isActive: true,
    createdAt: '2026-09-03T00:00:00+08:00', updatedAt: '2026-09-03T00:00:00+08:00',
  }
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: 1 } }
    if (request.action === 'listEntries') return { items: [entry], nextCursor: null }
    if (request.action === 'getMonthlyEntries') return [{ date: entry.entryDate, entries: [entry] }]
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({ run: run as JournalClient['run'] })} />)

  await user.click((await screen.findAllByRole('button', { name: '時間軸' }))[0])
  await user.click(await screen.findByRole('button', { name: '閱讀記事：來源測試' }))
  expect(screen.getByRole('button', { name: '返回時間軸' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '返回時間軸' }))

  await user.click(screen.getAllByRole('button', { name: '月曆' })[0])
  await user.click(await screen.findByRole('button', { name: '閱讀記事：來源測試' }))
  expect(screen.getByRole('button', { name: '返回日曆' })).toBeInTheDocument()
})
```

Run: `npm run test:run -- --project=frontend src/App.test.tsx`

Expected: FAIL；App 尚未傳入必填 `returnTarget`，或詳情仍顯示錯誤來源文字。

接著在 `src/App.tsx` 渲染 `EntryDetail` 時加入：

```tsx
returnTarget={page === 'timeline' ? 'timeline' : 'calendar'}
```

`page` 在進入詳情後仍保存原主頁；詳情畫面沒有主導覽可改變它，因此不另建重複 source state。同時把 `src/App.test.tsx` 既有兩個「返回月曆」按鈕預期值改為「返回日曆」；此任務只改返回文字，導覽本身仍維持「月曆」直到 Task 11。

此時 App 仍使用舊 `getMonthlyEntries`；Task 11 會把相同 fixture 遷移到 `getEntriesForRange`。

- [ ] **Step 8：執行表單、詳情與 App 測試**

Run: `npm run test:run -- --project=frontend src/features/entries/entry-form.test.tsx src/features/entries/entry-detail.test.tsx src/App.test.tsx`

Expected: PASS，指定日期、兩種返回來源及 App 必填 prop 均正確。

- [ ] **Step 9：執行前端建置以確認中間 commit 完整**

Run: `npm run build`

Expected: PASS，App 與所有 `EntryDetail` 呼叫端都已傳入必填 prop。

- [ ] **Step 10：向使用者出示提交訊息並等待核准**

提交訊息：`feat: 支援指定日期新增與詳情返回來源`

- [ ] **Step 11：核准後只提交本任務檔案**

```bash
git add src/features/entries/entry-form.tsx src/features/entries/entry-form.test.tsx src/features/entries/entry-detail.tsx src/features/entries/entry-detail.test.tsx src/App.tsx src/App.test.tsx src/i18n/zh-TW.ts
git commit -m "feat: 支援指定日期新增與詳情返回來源"
```

---

### Task 7：抽出月視角並保留既有互動

**Files:**
- Create: `src/features/entries/calendar-month-view.tsx`
- Create: `src/features/entries/calendar-month-view.test.tsx`
- Modify: `src/features/entries/calendar-view.tsx`
- Modify: `src/features/entries/calendar-view.test.tsx`
- Modify: `src/i18n/zh-TW.ts:190-201`

- [ ] **Step 1：先建立月視角的 characterization tests**

建立 `src/features/entries/calendar-month-view.test.tsx`，將現有 `calendar-view.test.tsx` 的四個月格測試搬入，再將 render 目標改為 `CalendarMonthView` 並補足新 props：

```tsx
const defaultProps = {
  anchorDate: '2026-08-04',
  today: '2026-08-04',
  days: [{ date: '2026-08-04', entries }],
  categories: [],
  onFocusDate: vi.fn(),
  onSelectDate: vi.fn(),
  onOpenEntry: vi.fn(),
}
```

保留既有驗證：

```tsx
expect(screen.getByRole('grid', { name: '2026年8月' })).toBeInTheDocument()
await user.click(screen.getByRole('button', { name: /^2026-08-04，共 3 則記事/ }))
expect(defaultProps.onFocusDate).toHaveBeenCalledWith('2026-08-04')
expect(defaultProps.onSelectDate).toHaveBeenCalledWith('2026-08-04')

await user.click(screen.getByRole('button', { name: '閱讀記事：第一則記事' }))
expect(defaultProps.onFocusDate).toHaveBeenCalledWith('2026-08-04')
expect(defaultProps.onOpenEntry).toHaveBeenCalledWith(entries[0])

await user.click(screen.getByRole('button', { name: '還有 1 則記事' }))
expect(await screen.findByRole('dialog', { name: '2026-08-04 的記事' })).toBeInTheDocument()
```

另加入今日、焦點及空白日期測試：

```tsx
expect(screen.getByRole('button', { name: /2026-08-04.*今天.*焦點日期/ })).toHaveAttribute('aria-current', 'date')
const emptyDate = screen.getByRole('button', { name: '2026-08-05，共 0 則記事' })
expect(emptyDate).toBeDisabled()
expect(emptyDate.closest('[role="gridcell"]')).not.toHaveClass('calendar-grid__cell--has-entries')
```

再加入 0 至 99 年不被 `Date.UTC` 偏移的回歸測試：

```tsx
test('西元 0 至 99 年仍建立正確月份日期', () => {
  render(
    <CalendarMonthView
      {...defaultProps}
      anchorDate="0099-02-03"
      today="2026-09-03"
      days={[]}
    />,
  )

  expect(screen.getByRole('grid', { name: '99年2月' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '0099-02-28，共 0 則記事' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: /0099-02-29/ })).not.toBeInTheDocument()
})
```

- [ ] **Step 2：執行月視角測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-month-view.test.tsx`

Expected: FAIL，訊息包含找不到 `./calendar-month-view`。

- [ ] **Step 3：抽出月格與更多記事視窗**

建立 `src/features/entries/calendar-month-view.tsx`：

```tsx
import { useState } from 'react'
import type { Category, DailyEntries, Entry } from '../../domain/journal'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'
import { categoryColorStyle } from '../../utils/category-color'
import { getCalendarDateRange } from './calendar-date'

const VISIBLE_ENTRIES_PER_DAY = 2

type CalendarMonthViewProps = {
  anchorDate: string
  today: string
  days: DailyEntries[]
  categories: Category[]
  onFocusDate: (date: string) => void
  onSelectDate: (date: string) => void
  onOpenEntry: (entry: Entry) => void
}

export function CalendarMonthView({
  anchorDate,
  today,
  days,
  categories,
  onFocusDate,
  onSelectDate,
  onOpenEntry,
}: CalendarMonthViewProps) {
  const [overflowDate, setOverflowDate] = useState<string>()
  const year = Number(anchorDate.slice(0, 4))
  const month = Number(anchorDate.slice(5, 7))
  const entriesByDate = new Map(days.map((day) => [day.date, day.entries]))
  const categoriesById = new Map(categories.map((category) => [category.id, category]))
  const overflowEntries = overflowDate ? entriesByDate.get(overflowDate) : undefined

  return (
    <div className="calendar-month-view">
      <div className="calendar-grid" role="grid" aria-label={zhTW.calendar.monthLabel(year, month)}>
        {zhTW.calendar.weekdays.map((weekday) => (
          <div className="calendar-grid__weekday" role="columnheader" key={weekday}>{weekday}</div>
        ))}
        {createMonthCells(anchorDate).map((cell, index) => {
          if (!cell) {
            return <div className="calendar-grid__cell calendar-grid__cell--empty" role="gridcell" key={`empty-${index}`} />
          }

          const entries = entriesByDate.get(cell) ?? []
          const count = entries.length
          const visibleEntries = entries.slice(0, VISIBLE_ENTRIES_PER_DAY)
          const hiddenEntryCount = count - visibleEntries.length
          const dateLabel = [
            zhTW.calendar.selectDate(cell, count),
            cell === today ? zhTW.calendar.todayIndicator : '',
            cell === anchorDate ? zhTW.calendar.anchorDateIndicator : '',
          ].filter(Boolean).join('，')

          return (
            <div
              className={`calendar-grid__cell${count ? ' calendar-grid__cell--has-entries' : ''}`}
              role="gridcell"
              key={cell}
              onClick={() => {
                if (!count) return
                onFocusDate(cell)
                onSelectDate(cell)
              }}
            >
              <button
                type="button"
                className={`calendar-day${count ? ' calendar-day--has-entries' : ''}${cell === anchorDate ? ' calendar-day--focused' : ''}`}
                aria-label={dateLabel}
                aria-current={cell === today ? 'date' : undefined}
                disabled={count === 0}
                onClick={(event) => {
                  event.stopPropagation()
                  onFocusDate(cell)
                  onSelectDate(cell)
                }}
              >
                <span>{Number(cell.slice(-2))}</span>
              </button>
              {count > 0 && (
                <div className="calendar-day__entries">
                  {visibleEntries.map((entry) => {
                    const title = entryTitle(entry)
                    const categoryColor = categoriesById.get(entry.categoryId)?.color ?? null
                    return (
                      <button
                        className="calendar-entry"
                        type="button"
                        key={entry.id}
                        title={title}
                        aria-label={`${zhTW.timeline.readEntry}：${title}`}
                        style={categoryColorStyle(categoryColor)}
                        onClick={(event) => {
                          event.stopPropagation()
                          onFocusDate(cell)
                          onOpenEntry(entry)
                        }}
                      >
                        {title}
                      </button>
                    )
                  })}
                  {hiddenEntryCount > 0 && (
                    <button
                      className="calendar-entry calendar-entry--more"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onFocusDate(cell)
                        setOverflowDate(cell)
                      }}
                    >
                      {zhTW.calendar.moreEntries(hiddenEntryCount)}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {overflowDate && overflowEntries && (
        <ConfirmDialog labelledBy={`calendar-overflow-${overflowDate}`} onCancel={() => setOverflowDate(undefined)}>
          <div className="calendar-entry-picker">
            <header className="calendar-entry-picker__header">
              <span className="confirm-dialog__icon calendar-entry-picker__icon"><Icon>format_list_bulleted</Icon></span>
              <div>
                <h2 id={`calendar-overflow-${overflowDate}`}>{zhTW.calendar.chooseEntryTitle(overflowDate)}</h2>
                <p>{zhTW.calendar.chooseEntryDescription}</p>
              </div>
            </header>
            <div className="calendar-entry-picker__list">
              {overflowEntries.map((entry) => {
                const title = entryTitle(entry)
                const categoryColor = categoriesById.get(entry.categoryId)?.color ?? null
                return (
                  <button
                    className="calendar-entry-picker__item"
                    type="button"
                    key={entry.id}
                    style={categoryColorStyle(categoryColor)}
                    onClick={() => {
                      onFocusDate(overflowDate)
                      setOverflowDate(undefined)
                      onOpenEntry(entry)
                    }}
                  >
                    <span>{title}</span>
                    <Icon>chevron_right</Icon>
                  </button>
                )
              })}
            </div>
            <div className="confirm-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                data-dialog-initial-focus
                onClick={() => setOverflowDate(undefined)}
              >
                {zhTW.actions.cancel}
              </button>
            </div>
          </div>
        </ConfirmDialog>
      )}
    </div>
  )
}

function entryTitle(entry: Entry): string {
  return entry.title || entry.content.slice(0, 48) || zhTW.timeline.untitled
}

function createMonthCells(anchorDate: string): Array<string | null> {
  const year = Number(anchorDate.slice(0, 4))
  const month = Number(anchorDate.slice(5, 7))
  const first = new Date(0)
  first.setUTCFullYear(year, month - 1, 1)
  const firstWeekday = (first.getUTCDay() + 6) % 7
  const daysInMonth = Number(getCalendarDateRange('month', anchorDate).to.slice(-2))
  const cells: Array<string | null> = Array.from({ length: firstWeekday }, () => null)

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}
```

在 `src/i18n/zh-TW.ts` 的既有 `calendar` 物件加入，供本任務立即編譯：

```ts
todayIndicator: '今天',
anchorDateIndicator: '焦點日期',
```

完整實作保證日期、月格記事、更多記事按鈕及 picker 選取都先更新焦點；picker 只保存 `overflowDate` 並每次從最新 `days` 解析內容。`createMonthCells()` 不使用 `Date.UTC(year, ...)`，避免 0 至 99 年被偏移。

CSS class 名稱暫時沿用 `.calendar-grid`、`.calendar-day`、`.calendar-entry` 與 `.calendar-entry-picker`，讓抽取後畫面在 Task 14 新樣式完成前保持現有外觀。

- [ ] **Step 4：執行月視角測試**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-month-view.test.tsx`

Expected: PASS，原四項月格行為、今日與焦點皆通過。

- [ ] **Step 5：暫時讓舊 `CalendarView` 包裝新月視角**

保留 `CalendarView` 現有 props 與月份標題／導覽，匯入 `CalendarMonthView`，並在既有日期工具 import 補上 `getJournalDate`。刪除已搬移的月格內容，改成：

```tsx
<CalendarMonthView
  anchorDate={`${month}-01`}
  today={getJournalDate(timezone)}
  days={days}
  categories={categories}
  onFocusDate={() => undefined}
  onSelectDate={onSelectDate}
  onOpenEntry={onOpenEntry}
/>
```

Task 11 App 換成新共用框架後才刪除此相容 wrapper，避免中途讓主分支無法建置。

- [ ] **Step 6：執行既有 wrapper 與月視角測試**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-view.test.tsx src/features/entries/calendar-month-view.test.tsx`

Expected: PASS；App 尚未重構時既有月曆行為不回歸。

- [ ] **Step 7：向使用者出示提交訊息並等待核准**

提交訊息：`refactor: 抽出日曆月視角元件`

- [ ] **Step 8：核准後只提交本任務檔案**

```bash
git add src/features/entries/calendar-month-view.tsx src/features/entries/calendar-month-view.test.tsx src/features/entries/calendar-view.tsx src/features/entries/calendar-view.test.tsx src/i18n/zh-TW.ts
git commit -m "refactor: 抽出日曆月視角元件"
```

---

### Task 8：建立共用日曆框架

**Files:**
- Create: `src/features/entries/calendar-frame.tsx`
- Create: `src/features/entries/calendar-frame.test.tsx`
- Modify: `src/i18n/zh-TW.ts:10-15,122-144,190-201`

- [ ] **Step 1：先寫模式、期間導覽與狀態的失敗測試**

建立 `src/features/entries/calendar-frame.test.tsx`：

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarFrame } from './calendar-frame'

afterEach(cleanup)

const defaultProps = {
  mode: 'week' as const,
  anchorDate: '2026-09-03',
  entryCount: 4,
  isLoading: false,
  error: undefined,
  canMovePrevious: true,
  canMoveNext: true,
  onModeChange: vi.fn(),
  onMovePeriod: vi.fn(),
  onToday: vi.fn(),
  onRetry: vi.fn(),
}

describe('CalendarFrame', () => {
  it('顯示期間、計數與三段模式切換', async () => {
    const user = userEvent.setup()
    render(<CalendarFrame {...defaultProps}><p>週內容</p></CalendarFrame>)

    expect(screen.getByRole('heading', { name: '2026年8月31日－9月6日' })).toBeInTheDocument()
    expect(screen.getByText('本週共有 4 則記事')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '日曆檢視模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '週' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '日' }))
    expect(defaultProps.onModeChange).toHaveBeenCalledWith('day')
    expect(screen.getByRole('button', { name: '日' })).toHaveFocus()
  })

  it('依模式提供期間導覽並支援今天', async () => {
    const user = userEvent.setup()
    render(<CalendarFrame {...defaultProps}><p>週內容</p></CalendarFrame>)

    await user.click(screen.getByRole('button', { name: '上一週' }))
    await user.click(screen.getByRole('button', { name: '今天' }))
    await user.click(screen.getByRole('button', { name: '下一週' }))
    expect(defaultProps.onMovePeriod.mock.calls).toEqual([[-1], [1]])
    expect(defaultProps.onToday).toHaveBeenCalledOnce()
  })

  it('在互動日期邊界停用無法移動的方向', () => {
    render(
      <CalendarFrame {...defaultProps} canMovePrevious={false} canMoveNext={false}>
        <p>週內容</p>
      </CalendarFrame>,
    )

    expect(screen.getByRole('button', { name: '上一週' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一週' })).toBeDisabled()
  })

  it('在載入與錯誤狀態不顯示過期 children', async () => {
    const { rerender } = render(
      <CalendarFrame {...defaultProps} entryCount={null} isLoading><p>過期內容</p></CalendarFrame>,
    )
    expect(screen.getByRole('region', { name: '日曆內容' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('查詢中...')).toBeInTheDocument()
    expect(screen.queryByText('過期內容')).not.toBeInTheDocument()

    rerender(
      <CalendarFrame {...defaultProps} entryCount={null} error="載入失敗"><p>過期內容</p></CalendarFrame>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('載入失敗')
    await userEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(defaultProps.onRetry).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2：執行框架測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-frame.test.tsx`

Expected: FAIL，訊息包含找不到 `./calendar-frame`。

- [ ] **Step 3：補齊框架所需文案**

在 `src/i18n/zh-TW.ts` 加入或調整：

```ts
calendarViewMode: '日曆檢視模式',
calendarContent: '日曆內容',
```

以上兩鍵加入既有 `accessibility`；以下五鍵加入既有 `actions`：

```ts
previousDay: '前一天',
nextDay: '後一天',
previousWeek: '上一週',
nextWeek: '下一週',
reload: '重新載入',
```

以下兩組加入既有 `calendar`：

```ts
modes: { day: '日', week: '週', month: '月' },
periodEntryCount: {
  day: (count: number) => `本日共有 ${count} 則記事`,
  week: (count: number) => `本週共有 ${count} 則記事`,
  month: (count: number) => `本月共有 ${count} 則記事`,
},
```

`navigation.calendar` 與舊 `calendar.monthTitle` 在這個中間 commit 暫不改名，避免 App 與舊 wrapper 測試提早失敗；Task 11 會在 App 完成遷移時一次更新產品名稱與相關測試。

- [ ] **Step 4：實作共用框架**

建立 `src/features/entries/calendar-frame.tsx`，固定 props：

```ts
import type { ReactNode } from 'react'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'
import { formatCalendarPeriodTitle, type CalendarMode } from './calendar-date'

type CalendarFrameProps = {
  mode: CalendarMode
  anchorDate: string
  entryCount: number | null
  isLoading: boolean
  error?: string
  canMovePrevious: boolean
  canMoveNext: boolean
  onModeChange: (mode: CalendarMode) => void
  onMovePeriod: (direction: -1 | 1) => void
  onToday: () => void
  onRetry: () => void
  children: ReactNode
}
```

imports 與 props 後的完整實作為：

```tsx
const MODES: CalendarMode[] = ['day', 'week', 'month']

const navigationLabels = {
  day: [zhTW.actions.previousDay, zhTW.actions.nextDay],
  week: [zhTW.actions.previousWeek, zhTW.actions.nextWeek],
  month: [zhTW.actions.previousMonth, zhTW.actions.nextMonth],
} as const

export function CalendarFrame({
  mode,
  anchorDate,
  entryCount,
  isLoading,
  error,
  canMovePrevious,
  canMoveNext,
  onModeChange,
  onMovePeriod,
  onToday,
  onRetry,
  children,
}: CalendarFrameProps) {
  const [previousLabel, nextLabel] = navigationLabels[mode]

  return (
    <section className="calendar-frame" aria-label={zhTW.navigation.calendar}>
      <header className="calendar-frame__header">
        <div className="calendar-frame__period" aria-live="polite" aria-atomic="true">
          <h2>{formatCalendarPeriodTitle(mode, anchorDate)}</h2>
          {entryCount !== null && <p>{zhTW.calendar.periodEntryCount[mode](entryCount)}</p>}
        </div>
        <div
          className="calendar-frame__mode-toggle"
          role="group"
          aria-label={zhTW.accessibility.calendarViewMode}
        >
          {MODES.map((candidate) => (
            <button
              type="button"
              aria-pressed={candidate === mode}
              onClick={() => onModeChange(candidate)}
              key={candidate}
            >
              {zhTW.calendar.modes[candidate]}
            </button>
          ))}
        </div>
        <div className="calendar-frame__navigation">
          <button className="icon-button" type="button" aria-label={previousLabel} disabled={!canMovePrevious} onClick={() => onMovePeriod(-1)}>
            <Icon>chevron_left</Icon>
          </button>
          <button className="button button--secondary" type="button" onClick={onToday}>
            {zhTW.actions.today}
          </button>
          <button className="icon-button" type="button" aria-label={nextLabel} disabled={!canMoveNext} onClick={() => onMovePeriod(1)}>
            <Icon>chevron_right</Icon>
          </button>
        </div>
      </header>
      <div
        className="calendar-frame__content"
        role="region"
        aria-label={zhTW.accessibility.calendarContent}
        aria-busy={isLoading}
      >
        {isLoading ? (
          <p className="loading-note" role="status">{zhTW.filters.searching}</p>
        ) : error ? (
          <div className="calendar-frame__error" role="alert">
            <p>{error}</p>
            <button className="button button--secondary" type="button" onClick={onRetry}>
              {zhTW.actions.reload}
            </button>
          </div>
        ) : children}
      </div>
    </section>
  )
}
```

不要以 `key={mode}` 重建整個框架；模式按鈕必須留在同一 DOM 位置，讓瀏覽器保留點擊後焦點。

- [ ] **Step 5：執行框架與日期工具測試**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-frame.test.tsx src/features/entries/calendar-date.test.ts`

Expected: PASS，模式、焦點、期間、計數、邊界停用、loading 與 retry 全部通過。

- [ ] **Step 6：向使用者出示提交訊息並等待核准**

提交訊息：`feat: 建立日曆檢視共用框架`

- [ ] **Step 7：核准後只提交本任務檔案**

```bash
git add src/features/entries/calendar-frame.tsx src/features/entries/calendar-frame.test.tsx src/i18n/zh-TW.ts
git commit -m "feat: 建立日曆檢視共用框架"
```

---

### Task 9：建立日視角

**Files:**
- Create: `src/features/entries/calendar-day-view.tsx`
- Create: `src/features/entries/calendar-day-view.test.tsx`
- Modify: `src/i18n/zh-TW.ts:190-210`

- [ ] **Step 1：先寫完整卡片、操作與空白狀態的失敗測試**

建立 `src/features/entries/calendar-day-view.test.tsx`：

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { CalendarDayView } from './calendar-day-view'

afterEach(cleanup)

const entry = {
  id: 'entry-1', entryDate: '2026-09-03', title: '第一則記事', content: '完整摘要內容', categoryId: 'work',
  tags: ['會議', '專案'], links: [], createdAt: '2026-09-03T09:00:00+08:00', updatedAt: '2026-09-03T09:00:00+08:00',
}
const category = {
  id: 'work', name: '工作', color: '#b97c66' as const, isActive: true,
  createdAt: '2026-09-03T00:00:00+08:00', updatedAt: '2026-09-03T00:00:00+08:00',
}

test('顯示完整摘要卡並傳遞詳情、編輯、刪除與指定日期新增', async () => {
  const user = userEvent.setup()
  const onOpenEntry = vi.fn()
  const onEditEntry = vi.fn()
  const onDeleteEntry = vi.fn().mockResolvedValue(undefined)
  const onCreateEntry = vi.fn()
  render(
    <CalendarDayView
      date="2026-09-03"
      today="2026-09-03"
      entries={[entry]}
      categories={[category]}
      timezone="Asia/Taipei"
      onOpenEntry={onOpenEntry}
      onEditEntry={onEditEntry}
      onDeleteEntry={onDeleteEntry}
      onCreateEntry={onCreateEntry}
    />,
  )

  expect(screen.getByText('完整摘要內容')).toBeInTheDocument()
  expect(screen.getByText('#會議')).toBeInTheDocument()
  expect(screen.getByText('工作')).toHaveStyle({ '--category-color': '#b97c66' })
  await user.click(screen.getByRole('button', { name: '閱讀記事：第一則記事' }))
  await user.click(screen.getByRole('button', { name: '編輯 第一則記事' }))
  await user.click(screen.getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '永久刪除' }))
  await user.click(screen.getByRole('button', { name: '新增這天的記事' }))
  expect(onOpenEntry).toHaveBeenCalledWith(entry)
  expect(onEditEntry).toHaveBeenCalledWith(entry)
  expect(onDeleteEntry).toHaveBeenCalledWith('entry-1')
  expect(onCreateEntry).toHaveBeenCalledWith('2026-09-03')
})

test('空白日仍可新增指定日期記事', async () => {
  const onCreateEntry = vi.fn()
  render(
    <CalendarDayView
      date="2026-09-03"
      today="2026-09-04"
      entries={[]}
      categories={[]}
      timezone="Asia/Taipei"
      onOpenEntry={vi.fn()}
      onEditEntry={vi.fn()}
      onDeleteEntry={vi.fn().mockResolvedValue(undefined)}
      onCreateEntry={onCreateEntry}
    />,
  )

  expect(screen.getByText('這天還沒有符合條件的記事')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '新增這天的記事' }))
  expect(onCreateEntry).toHaveBeenCalledWith('2026-09-03')
})

test('焦點日是今天時提供可見且可讀的非顏色提示', () => {
  const { rerender } = render(
    <CalendarDayView
      date="2026-09-03"
      today="2026-09-03"
      entries={[]}
      categories={[]}
      timezone="Asia/Taipei"
      onOpenEntry={vi.fn()}
      onEditEntry={vi.fn()}
      onDeleteEntry={vi.fn().mockResolvedValue(undefined)}
      onCreateEntry={vi.fn()}
    />,
  )

  expect(screen.getByText('今天')).toHaveAttribute('aria-current', 'date')
  expect(screen.getByText('焦點日期')).toBeInTheDocument()
  rerender(
    <CalendarDayView
      date="2026-09-03"
      today="2026-09-04"
      entries={[]}
      categories={[]}
      timezone="Asia/Taipei"
      onOpenEntry={vi.fn()}
      onEditEntry={vi.fn()}
      onDeleteEntry={vi.fn().mockResolvedValue(undefined)}
      onCreateEntry={vi.fn()}
    />,
  )
  expect(screen.queryByText('今天')).not.toBeInTheDocument()
  expect(screen.getByText('焦點日期')).toBeInTheDocument()
})
```

- [ ] **Step 2：執行日視角測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-day-view.test.tsx`

Expected: FAIL，訊息包含找不到 `./calendar-day-view`。

- [ ] **Step 3：加入日視角文案**

在 `zhTW.actions` 與 `zhTW.calendar` 加入：

```ts
addEntryForDate: '新增這天的記事',
emptyDay: '這天還沒有符合條件的記事',
```

- [ ] **Step 4：實作日視角並重用 `EntryCard`**

建立 `src/features/entries/calendar-day-view.tsx`：

```tsx
import type { Category, Entry } from '../../domain/journal'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'
import { EntryCard } from './entry-card'

type CalendarDayViewProps = {
  date: string
  today: string
  entries: Entry[]
  categories: Category[]
  timezone: string
  onOpenEntry: (entry: Entry) => void
  onEditEntry: (entry: Entry) => void
  onDeleteEntry: (id: string) => Promise<void>
  onCreateEntry: (date: string) => void
}

export function CalendarDayView({
  date,
  today,
  entries,
  categories,
  timezone,
  onOpenEntry,
  onEditEntry,
  onDeleteEntry,
  onCreateEntry,
}: CalendarDayViewProps) {
  const categoriesById = new Map(categories.map((category) => [category.id, category]))

  return (
    <section className="calendar-day-view" aria-label={date}>
      <p className="calendar-day-view__status">
        {date === today && <span aria-current="date">{zhTW.calendar.todayIndicator}</span>}
        <span>{zhTW.calendar.anchorDateIndicator}</span>
      </p>
      <div className="calendar-day-view__entries">
        {entries.length === 0 && <p className="calendar-day-view__empty">{zhTW.calendar.emptyDay}</p>}
        {entries.map((entry) => {
          const category = categoriesById.get(entry.categoryId)
          return (
            <EntryCard
              key={entry.id}
              entry={entry}
              categoryName={category?.name ?? zhTW.detail.category}
              categoryColor={category?.color ?? null}
              timezone={timezone}
              onOpen={() => onOpenEntry(entry)}
              onEdit={() => onEditEntry(entry)}
              onDelete={() => onDeleteEntry(entry.id)}
            />
          )
        })}
      </div>
      <button className="button button--primary" type="button" onClick={() => onCreateEntry(date)}>
        <Icon filled>add</Icon>
        {zhTW.actions.addEntryForDate}
      </button>
    </section>
  )
}
```

Task 14 只會在此新增按鈕補上 `calendar-day-view__create` class，不改事件或資料行為。

- [ ] **Step 5：執行日視角與既有完整卡片測試**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-day-view.test.tsx src/features/entries/entry-card.test.tsx src/features/entries/timeline.test.tsx`

Expected: PASS；今天有文字與 `aria-current` 提示，完整卡片、時間軸及類別色無回歸。

- [ ] **Step 6：向使用者出示提交訊息並等待核准**

提交訊息：`feat: 新增日曆日視角`

- [ ] **Step 7：核准後只提交本任務檔案**

```bash
git add src/features/entries/calendar-day-view.tsx src/features/entries/calendar-day-view.test.tsx src/i18n/zh-TW.ts
git commit -m "feat: 新增日曆日視角"
```

---

### Task 10：建立週精簡卡與週視角

**Files:**
- Create: `src/features/entries/week-entry-card.tsx`
- Create: `src/features/entries/week-entry-card.test.tsx`
- Create: `src/features/entries/calendar-week-view.tsx`
- Create: `src/features/entries/calendar-week-view.test.tsx`
- Modify: `src/i18n/zh-TW.ts:122-144,190-210`

- [ ] **Step 1：先寫週精簡卡的失敗測試**

建立 `src/features/entries/week-entry-card.test.tsx`：

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { WeekEntryCard } from './week-entry-card'

afterEach(cleanup)

test('只顯示精簡資訊、前兩標籤並開啟詳情', async () => {
  const onOpen = vi.fn()
  render(
    <WeekEntryCard
      entry={{
        id: 'entry-1', entryDate: '2026-09-03', title: '週記事', content: '兩行摘要內容', categoryId: 'work',
        tags: ['一', '二', '三'], links: [], createdAt: '2026-09-03T09:00:00+08:00', updatedAt: '2026-09-03T09:00:00+08:00',
      }}
      categoryName="工作"
      categoryColor="#b97c66"
      onOpen={onOpen}
    />,
  )

  expect(screen.getByText('工作')).toHaveStyle({ '--category-color': '#b97c66' })
  expect(screen.getByText('週記事')).toBeInTheDocument()
  expect(screen.getByText('兩行摘要內容')).toBeInTheDocument()
  expect(screen.getByText('#一')).toBeInTheDocument()
  expect(screen.getByText('#二')).toBeInTheDocument()
  expect(screen.queryByText('#三')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /編輯|刪除/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '閱讀記事：週記事' }))
  expect(onOpen).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2：執行週卡測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/features/entries/week-entry-card.test.tsx`

Expected: FAIL，訊息包含找不到 `./week-entry-card`。

- [ ] **Step 3：實作週精簡卡**

建立 `src/features/entries/week-entry-card.tsx`：

```tsx
import type { CategoryColor, Entry } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { categoryColorStyle } from '../../utils/category-color'

type WeekEntryCardProps = {
  entry: Entry
  categoryName: string
  categoryColor: CategoryColor | null
  onOpen: () => void
}

export function WeekEntryCard({ entry, categoryName, categoryColor, onOpen }: WeekEntryCardProps) {
  const title = entry.title || entry.content.slice(0, 80) || zhTW.timeline.untitled

  return (
    <article className="week-entry-card">
      <button
        className="week-entry-card__read"
        type="button"
        aria-label={`${zhTW.timeline.readEntry}：${title}`}
        onClick={onOpen}
      >
        <span
          className={`category-badge${categoryColor ? ' category-badge--custom-color' : ''}`}
          style={categoryColorStyle(categoryColor)}
        >
          {categoryName}
        </span>
        <strong className="week-entry-card__title">{title}</strong>
        <span className="week-entry-card__summary">{entry.content}</span>
        {entry.tags.length > 0 && (
          <span className="week-entry-card__tags">
            {entry.tags.slice(0, 2).map((tag) => <span className="tag-chip" key={tag}>#{tag}</span>)}
          </span>
        )}
      </button>
    </article>
  )
}
```

內容的兩行限制由 Task 14 CSS 完成；資料層不渲染第三個以後的標籤，也不顯示額外數量。

- [ ] **Step 4：先寫週一到週日與展開行為的失敗測試**

建立 `src/features/entries/calendar-week-view.test.tsx`，先加入完整 fixture：

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import type { Entry } from '../../domain/journal'
import { CalendarWeekView } from './calendar-week-view'

afterEach(cleanup)

const entries: Entry[] = Array.from({ length: 5 }, (_, index) => ({
  id: `entry-${index + 1}`,
  entryDate: '2026-09-03',
  title: `第 ${index + 1} 則記事`,
  content: `第 ${index + 1} 則內容`,
  categoryId: 'work',
  tags: ['會議', '專案', '其他'],
  links: [],
  createdAt: `2026-09-03T0${index + 1}:00:00+08:00`,
  updatedAt: `2026-09-03T0${index + 1}:00:00+08:00`,
}))

const category = {
  id: 'work',
  name: '工作',
  color: '#b97c66' as const,
  isActive: true,
  createdAt: '2026-09-03T00:00:00+08:00',
  updatedAt: '2026-09-03T00:00:00+08:00',
}

const props = {
  anchorDate: '2026-09-03',
  today: '2026-09-03',
  days: [{ date: '2026-09-03', entries }],
  categories: [category],
  expansionResetKey: 'week-a',
  onFocusDate: vi.fn(),
  onOpenEntry: vi.fn(),
  onCreateEntry: vi.fn(),
}
```

再加入：

```tsx
test('依週一到週日呈現七個具關聯標題的日期區段', () => {
  render(<CalendarWeekView {...props} anchorDate="2026-09-03" today="2026-09-03" />)

  const sections = screen.getAllByRole('region', { name: /星期[一二三四五六日]/ })
  expect(sections).toHaveLength(7)
  for (const section of sections) {
    const headingId = section.getAttribute('aria-labelledby')
    expect(headingId).toBeTruthy()
    expect(document.getElementById(headingId!)).toHaveProperty('tagName', 'H3')
  }
  expect(screen.getByRole('region', { name: /9月3日.*今天.*焦點日期/ })).toBeInTheDocument()
})

test('每天先顯示三則並可原地展開、收合及依 resetKey 重設', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<CalendarWeekView {...props} expansionResetKey="week-a" />)

  expect(screen.getAllByRole('button', { name: /閱讀記事/ })).toHaveLength(3)
  const expand = screen.getByRole('button', { name: '還有 2 則' })
  expect(expand).toHaveAttribute('aria-expanded', 'false')
  expect(expand).toHaveAttribute('aria-controls')
  await user.click(expand)
  expect(screen.getAllByRole('button', { name: /閱讀記事/ })).toHaveLength(5)
  expect(screen.getByRole('button', { name: '收合' })).toHaveAttribute('aria-expanded', 'true')
  await user.click(screen.getByRole('button', { name: '收合' }))
  expect(screen.getAllByRole('button', { name: /閱讀記事/ })).toHaveLength(3)

  await user.click(screen.getByRole('button', { name: '還有 2 則' }))
  rerender(<CalendarWeekView {...props} expansionResetKey="week-b" />)
  expect(screen.getAllByRole('button', { name: /閱讀記事/ })).toHaveLength(3)
})

test('每一天都可新增並先更新焦點日期', async () => {
  const user = userEvent.setup()
  render(<CalendarWeekView {...props} />)

  await user.click(screen.getByRole('button', { name: /星期二.*9月1日/ }))
  expect(props.onFocusDate).toHaveBeenCalledWith('2026-09-01')
  props.onFocusDate.mockClear()

  await user.click(screen.getByRole('button', { name: '新增 2026-09-01 的記事' }))
  expect(props.onFocusDate).toHaveBeenCalledWith('2026-09-01')
  expect(props.onCreateEntry).toHaveBeenCalledWith('2026-09-01')
})
```

- [ ] **Step 5：執行週視角測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-week-view.test.tsx`

Expected: FAIL，訊息包含找不到 `./calendar-week-view`。

- [ ] **Step 6：補齊週視角文案**

在 `src/i18n/zh-TW.ts` 加入：

```ts
collapse: '收合',
```

以上加入既有 `actions`；以下加入既有 `calendar`：

```ts
moreCompactEntries: (count: number) => `還有 ${count} 則`,
addEntryForSpecificDate: (date: string) => `新增 ${date} 的記事`,
```

- [ ] **Step 7：實作週視角與展開重設**

建立 `src/features/entries/calendar-week-view.tsx`：

```tsx
import { useEffect, useState } from 'react'
import type { Category, DailyEntries, Entry } from '../../domain/journal'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'
import {
  formatCalendarMonthDay,
  formatCalendarWeekday,
  getCalendarDateRange,
  listCalendarDates,
} from './calendar-date'
import { WeekEntryCard } from './week-entry-card'

type CalendarWeekViewProps = {
  anchorDate: string
  today: string
  days: DailyEntries[]
  categories: Category[]
  expansionResetKey: string
  onFocusDate: (date: string) => void
  onOpenEntry: (entry: Entry) => void
  onCreateEntry: (date: string) => void
}

const VISIBLE_ENTRIES_PER_DAY = 3

export function CalendarWeekView({
  anchorDate,
  today,
  days,
  categories,
  expansionResetKey,
  onFocusDate,
  onOpenEntry,
  onCreateEntry,
}: CalendarWeekViewProps) {
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set())
  const { from, to } = getCalendarDateRange('week', anchorDate)
  const dates = listCalendarDates(from, to)
  const entriesByDate = new Map(days.map((day) => [day.date, day.entries]))
  const categoriesById = new Map(categories.map((category) => [category.id, category]))

  useEffect(() => {
    setExpandedDates(new Set())
  }, [expansionResetKey])

  return (
    <div className="calendar-week-view">
      {dates.map((date) => {
        const entries = entriesByDate.get(date) ?? []
        const expanded = expandedDates.has(date)
        const visibleEntries = expanded ? entries : entries.slice(0, VISIBLE_ENTRIES_PER_DAY)
        const hiddenCount = entries.length - VISIBLE_ENTRIES_PER_DAY
        const headingId = `calendar-week-date-${date}`
        const entriesId = `calendar-week-entries-${date}`
        const headingParts = [
          formatCalendarWeekday(date),
          formatCalendarMonthDay(date),
          zhTW.calendar.entryCount(entries.length),
          date === today ? zhTW.calendar.todayIndicator : '',
          date === anchorDate ? zhTW.calendar.anchorDateIndicator : '',
        ].filter(Boolean)

        return (
          <section className="calendar-week-day" role="region" aria-labelledby={headingId} key={date}>
            <h3 id={headingId} className="calendar-week-day__header">
              <button type="button" onClick={() => onFocusDate(date)}>
                {headingParts.map((part) => <span key={part}>{part}</span>)}
              </button>
            </h3>
            <div className="calendar-week-day__entries" id={entriesId}>
              {entries.length === 0 && <p>{zhTW.calendar.emptyDay}</p>}
              {visibleEntries.map((entry) => {
                const category = categoriesById.get(entry.categoryId)
                return (
                  <WeekEntryCard
                    key={entry.id}
                    entry={entry}
                    categoryName={category?.name ?? zhTW.detail.category}
                    categoryColor={category?.color ?? null}
                    onOpen={() => {
                      onFocusDate(date)
                      onOpenEntry(entry)
                    }}
                  />
                )
              })}
            </div>
            {entries.length > VISIBLE_ENTRIES_PER_DAY && (
              <button
                className="calendar-week-day__expand"
                type="button"
                aria-expanded={expanded}
                aria-controls={entriesId}
                onClick={() => {
                  onFocusDate(date)
                  setExpandedDates((current) => {
                    const next = new Set(current)
                    if (expanded) next.delete(date)
                    else next.add(date)
                    return next
                  })
                }}
              >
                {expanded ? zhTW.actions.collapse : zhTW.calendar.moreCompactEntries(hiddenCount)}
              </button>
            )}
            <button
              className="calendar-week-day__create"
              type="button"
              aria-label={zhTW.calendar.addEntryForSpecificDate(date)}
              onClick={() => {
                onFocusDate(date)
                onCreateEntry(date)
              }}
            >
              <Icon filled>add</Icon>
              <span>{zhTW.actions.addEntry}</span>
            </button>
          </section>
        )
      })}
    </div>
  )
}
```

Task 14 才依 `date === today`／`date === anchorDate` 把狀態 class 加到 section；本任務已用標題文字提供非顏色狀態。固定七日不依 API 是否回傳空白日，週卡、日期、展開與新增等單日操作都先更新焦點。

- [ ] **Step 8：執行週卡與週視角測試**

Run: `npm run test:run -- --project=frontend src/features/entries/week-entry-card.test.tsx src/features/entries/calendar-week-view.test.tsx`

Expected: PASS，七日、資訊密度、三則上限、展開／收合、重設及指定日期新增皆通過。

- [ ] **Step 9：向使用者出示提交訊息並等待核准**

提交訊息：`feat: 新增日曆週視角`

- [ ] **Step 10：核准後只提交本任務檔案**

```bash
git add src/features/entries/week-entry-card.tsx src/features/entries/week-entry-card.test.tsx src/features/entries/calendar-week-view.tsx src/features/entries/calendar-week-view.test.tsx src/i18n/zh-TW.ts
git commit -m "feat: 新增日曆週視角"
```

---

### Task 11：將 App 改為模式、焦點日期與區間查詢

**Files:**
- Modify: `src/App.tsx:1-32,76-155,193-203,261-317,451-487,505-644,699-725,727-845`
- Modify: `src/App.test.tsx`
- Modify: `src/features/journal/use-journal.ts:28-136,201-250,400-485`
- Modify: `src/features/journal/use-journal.test.tsx`
- Delete: `src/features/entries/calendar-view.tsx`
- Delete: `src/features/entries/calendar-view.test.tsx`
- Modify: `src/i18n/zh-TW.ts:1-24,122-201`
- Modify: `src/utils/date.ts:40-49`

- [ ] **Step 1：先隔離 App 測試的 localStorage 與 Date fake，並遷移既有 API mock**

先將 `Entry` 加入 `src/App.test.tsx` 從 `./domain/journal` 匯入的型別，供本任務的 CRUD fixture 使用。

把 `src/App.test.tsx` 的 teardown 改成：

```ts
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
```

需要固定今天時只 fake `Date`，不 fake `setTimeout`／`setInterval`，因此 `userEvent` 仍使用真實 timer。

將既有所有 `getMonthlyEntries` fake client 分支改為 `getEntriesForRange` 並回傳 `DailyEntries[]`；將既有 `getEntriesForDate` 分支改成同 action 且以 `request.from === request.to` 區分單日清單。把所有導覽與標題的「月曆」預期值改成「日曆」；返回文字已在 Task 6 更新。

- [ ] **Step 2：先寫 mode、anchor、時區與 range request 的失敗整合測試**

在 `src/App.test.tsx` 加入：

```tsx
test('依記事時區初始化日曆，保存模式並以焦點日期查詢正確期間', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-01T16:30:00.000Z'))
  const user = userEvent.setup()
  window.localStorage.setItem('daily-journal:view', 'calendar')
  window.localStorage.setItem('daily-journal:calendar-mode', 'week')
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange') return []
    throw new Error(`未預期的請求：${request.action}`)
  })

  render(<App client={createClient({ run: run as JournalClient['run'] })} />)

  expect(await screen.findByRole('heading', { name: '2026年8月31日－9月6日' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '週' })).toHaveAttribute('aria-pressed', 'true')
  expect(run).toHaveBeenCalledWith({
    action: 'getEntriesForRange',
    from: '2026-08-31',
    to: '2026-09-06',
    filter: { query: '', from: null, to: null, categoryId: null, tag: null },
  })

  await user.click(screen.getByRole('button', { name: '日' }))
  expect(screen.getByRole('heading', { name: '2026年9月2日 星期三' })).toBeInTheDocument()
  expect(window.localStorage.getItem('daily-journal:calendar-mode')).toBe('day')
})
```

另加入期間導覽與回到今天測試：

```tsx
await user.click(screen.getByRole('button', { name: '後一天' }))
expect(screen.getByRole('heading', { name: /2026年9月3日/ })).toBeInTheDocument()
await user.click(screen.getByRole('button', { name: '月' }))
await user.click(screen.getByRole('button', { name: '下一個月' }))
expect(screen.getByRole('heading', { name: '2026年10月' })).toBeInTheDocument()
await user.click(screen.getByRole('button', { name: '今天' }))
expect(screen.getByRole('heading', { name: '2026年9月' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true')
```

再加入從其他主頁返回日曆的焦點規則：

```tsx
await user.click(screen.getByRole('button', { name: '日' }))
await user.click(screen.getByRole('button', { name: '後一天' }))
expect(screen.getByRole('heading', { name: /2026年9月3日/ })).toBeInTheDocument()
await user.click(screen.getAllByRole('button', { name: '時間軸' })[0])
await user.click(screen.getAllByRole('button', { name: '日曆' })[0])
expect(await screen.findByRole('heading', { name: '2026年9月2日 星期三' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: '日' })).toHaveAttribute('aria-pressed', 'true')
```

這段驗證模式保留，但從其他主頁重新進入時 anchor 回到記事時區今天。

再加入所有篩選條件與期間計數測試：

```tsx
test('日曆區間查詢與期間計數反映所有篩選條件', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-01T16:30:00.000Z'))
  const user = userEvent.setup()
  window.localStorage.setItem('daily-journal:view', 'calendar')
  const category = {
    id: 'work', name: '工作', color: null, isActive: true,
    createdAt: '2026-09-01T00:00:00+08:00', updatedAt: '2026-09-01T00:00:00+08:00',
  }
  const matching = {
    id: 'matching', entryDate: '2026-09-03', title: '週會', content: '內容', categoryId: 'work',
    tags: ['會議'], links: [], createdAt: '2026-09-03T09:00:00+08:00', updatedAt: '2026-09-03T09:00:00+08:00',
  }
  const other = { ...matching, id: 'other', title: '其他' }
  const rangeRequests: Extract<ApiRequest, { action: 'getEntriesForRange' }>[] = []
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: ['會議'] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: 2 } }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange') {
      rangeRequests.push(request)
      const filtered = request.filter.query === '週會'
        && request.filter.from === '2026-09-01'
        && request.filter.to === '2026-09-30'
        && request.filter.categoryId === 'work'
        && request.filter.tag === '會議'
      return filtered
        ? [{ date: matching.entryDate, entries: [matching] }]
        : [{ date: matching.entryDate, entries: [matching, other] }]
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({ run: run as JournalClient['run'] })} />)
  expect(await screen.findByText('本月共有 2 則記事')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '開啟搜尋與篩選' }))
  await user.type(screen.getByPlaceholderText('搜尋記事...'), '週會')
  fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-09-01' } })
  fireEvent.change(screen.getByLabelText('結束日期'), { target: { value: '2026-09-30' } })
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.selectOptions(screen.getByLabelText('標籤'), '會議')

  await waitFor(() => expect(rangeRequests.at(-1)?.filter).toEqual({
    query: '週會',
    from: '2026-09-01',
    to: '2026-09-30',
    categoryId: 'work',
    tag: '會議',
  }))
  expect(await screen.findByText('本月共有 1 則記事')).toBeInTheDocument()
})
```

把 `fireEvent` 加入 `@testing-library/react` import；date input 固定使用 `fireEvent.change`，其他互動仍使用 `userEvent`。

再加入日曆篩選不啟動背景時間軸查詢的測試：

```tsx
test('日曆頁不執行時間軸 listEntries，篩選只重查目前期間', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-01T16:30:00.000Z'))
  window.localStorage.setItem('daily-journal:view', 'calendar')
  const user = userEvent.setup()
  let listEntriesCount = 0
  let timelineAllowed = false
  const listRequests: Extract<ApiRequest, { action: 'listEntries' }>[] = []
  const rangeRequests: Extract<ApiRequest, { action: 'getEntriesForRange' }>[] = []
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') {
      listEntriesCount += 1
      listRequests.push(request)
      if (!timelineAllowed) throw new Error('時間軸查詢不應在日曆執行')
      return { items: [], nextCursor: null }
    }
    if (request.action === 'getEntriesForRange') {
      rangeRequests.push(request)
      return []
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({ run: run as JournalClient['run'] })} />)
  expect(await screen.findByText('本月共有 0 則記事')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '開啟搜尋與篩選' }))
  await user.type(screen.getByPlaceholderText('搜尋記事...'), '週會')

  await waitFor(() => expect(rangeRequests.at(-1)?.filter.query).toBe('週會'))
  expect(listEntriesCount).toBe(0)
  expect(screen.queryByText('時間軸查詢不應在日曆執行')).not.toBeInTheDocument()

  timelineAllowed = true
  await user.click(screen.getAllByRole('button', { name: '時間軸' })[0])
  await waitFor(() => expect(listEntriesCount).toBe(1))
  expect(listRequests[0].filter).toEqual(expect.objectContaining({ query: '週會', cursor: null }))
})
```

再加入類別顏色只重繪、不重查的回歸測試：

```tsx
test('類別顏色完成更新時重繪日曆，但不額外查詢期間', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-01T16:30:00.000Z'))
  window.localStorage.setItem('daily-journal:view', 'calendar')
  window.localStorage.setItem('daily-journal:calendar-mode', 'day')
  const user = userEvent.setup()
  const colorRequest = deferred<unknown>()
  const category = {
    id: 'work', name: '工作', color: null, isActive: true,
    createdAt: '2026-09-02T00:00:00+08:00', updatedAt: '2026-09-02T00:00:00+08:00',
  }
  const entry = {
    id: 'color-entry', entryDate: '2026-09-02', title: '顏色記事', content: '內容', categoryId: 'work',
    tags: [], links: [], createdAt: '2026-09-02T09:00:00+08:00', updatedAt: '2026-09-02T09:00:00+08:00',
  }
  let rangeCount = 0
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: 1 } }
    if (request.action === 'listEntries') return { items: [entry], nextCursor: null }
    if (request.action === 'getEntriesForRange') {
      rangeCount += 1
      return [{ date: entry.entryDate, entries: [entry] }]
    }
    if (request.action === 'setCategoryColor') return colorRequest.promise
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({ run: run as JournalClient['run'] })} />)
  await screen.findByText('顏色記事')

  await user.click(screen.getAllByRole('button', { name: '類別管理' })[0])
  await user.click(screen.getByRole('button', { name: '設定「工作」的類別顏色' }))
  await user.click(screen.getByRole('menuitemradio', { name: '黃' }))
  await waitFor(() => expect(run).toHaveBeenCalledWith({ action: 'setCategoryColor', id: 'work', color: '#ffe784' }))
  await user.click(screen.getAllByRole('button', { name: '日曆' })[0])
  await waitFor(() => expect(rangeCount).toBe(2))

  await act(async () => {
    colorRequest.resolve({ ...category, color: '#ffe784' })
  })
  await waitFor(() => expect(screen.getByText('工作')).toHaveStyle({ '--category-color': '#ffe784' }))
  expect(rangeCount).toBe(2)
})
```

這個測試先容許「重新進入日曆」必要的一次 range query，再確認顏色 state 完成更新不產生第三次查詢；effect dependency 不可包含 `categories`。

最後在 App 重構前先加入日視角編輯與刪除刷新測試，讓 `revision` query key 的 production 變更有明確紅燈：

```tsx
test('日視角編輯與刪除成功後依序刷新目前期間', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-01T16:30:00.000Z'))
  window.localStorage.setItem('daily-journal:view', 'calendar')
  window.localStorage.setItem('daily-journal:calendar-mode', 'day')
  const user = userEvent.setup()
  const category = {
    id: 'work', name: '工作', color: null, isActive: true,
    createdAt: '2026-09-02T00:00:00+08:00', updatedAt: '2026-09-02T00:00:00+08:00',
  }
  const original = {
    id: 'edit-delete', entryDate: '2026-09-02', title: '編輯前記事', content: '內容', categoryId: 'work',
    tags: [], links: [], createdAt: '2026-09-02T09:00:00+08:00', updatedAt: '2026-09-02T09:00:00+08:00',
  }
  let current: Entry | undefined = original
  let rangeCount = 0
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: current ? 1 : 0 } }
    if (request.action === 'getEntriesForRange') {
      rangeCount += 1
      return current ? [{ date: current.entryDate, entries: [current] }] : []
    }
    if (request.action === 'saveEntry') {
      current = { ...original, ...request.entry, id: original.id, updatedAt: '2026-09-02T10:00:00+08:00' }
      return current
    }
    if (request.action === 'deleteEntry') {
      current = undefined
      return null
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({ run: run as JournalClient['run'] })} />)
  await screen.findByText('編輯前記事')

  await user.click(screen.getByRole('button', { name: '編輯 編輯前記事' }))
  await user.clear(screen.getByLabelText('記事標題'))
  await user.type(screen.getByLabelText('記事標題'), '編輯後記事')
  await user.click(screen.getByRole('button', { name: '儲存變更' }))
  expect(await screen.findByText('編輯後記事')).toBeInTheDocument()
  expect(rangeCount).toBe(2)

  await user.click(screen.getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '永久刪除' }))
  expect(await screen.findByText('這天還沒有符合條件的記事')).toBeInTheDocument()
  expect(rangeCount).toBe(3)
})
```

- [ ] **Step 3：執行 App 測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/App.test.tsx`

Expected: FAIL；App 仍使用 `calendarMonth/getMonthlyEntries`，沒有模式或 range 控制，且 `useJournal` 仍會在日曆頁啟動 `listEntries`。

- [ ] **Step 4：建立 App 的日曆查詢狀態型別**

在 `App.tsx` module scope 加入：

```ts
type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; data: T }
  | { status: 'error'; key: string; message: string }
```

匯入：

```ts
import { CalendarFrame } from './features/entries/calendar-frame'
import { CalendarDayView } from './features/entries/calendar-day-view'
import { CalendarWeekView } from './features/entries/calendar-week-view'
import { CalendarMonthView } from './features/entries/calendar-month-view'
import {
  clampCalendarAnchorDate,
  getCalendarDateRange,
  shiftCalendarAnchorDate,
  type CalendarMode,
} from './features/entries/calendar-date'
import {
  readCalendarModePreference,
  saveCalendarModePreference,
} from './features/entries/calendar-mode-preference'
import { getJournalDate, getLocalDate } from './utils/date'
```

此 import 取代既有的 `getJournalMonth`、`getLocalDate`、`monthParts` 組合；`getLocalDate` 仍供 CSV 檔名使用。

- [ ] **Step 5：以 mode、anchor 與兩套查詢 state 取代月份 state**

將現有月曆 state 改成：

```ts
const [calendarMode, setCalendarMode] = useState<CalendarMode>(() => readCalendarModePreference())
const [calendarAnchorDate, setCalendarAnchorDate] = useState<string>()
const [calendarQuery, setCalendarQuery] = useState<LoadState<DailyEntries[]>>({ status: 'idle' })
const [selectedDate, setSelectedDate] = useState<string>()
const [selectedDateQuery, setSelectedDateQuery] = useState<LoadState<Entry[]>>({ status: 'idle' })
const [calendarReloadToken, setCalendarReloadToken] = useState(0)
const [selectedDateReloadToken, setSelectedDateReloadToken] = useState(0)
```

保留既有 `selectedEntry: Entry | undefined` 與 `editingEntry`；Task 6 已使用目前 `page` 決定詳情返回目標，不建立重複的來源 state。Task 13 才會把 editor 改為可攜帶 `initialDate` 的判別聯集。

把 `page` state 移到 `useJournal` 呼叫前，並告知 hook 目前是否需要維護時間軸查詢：

```ts
const [journalClient] = useState<AppClient>(() => client ?? new JournalApiClient())
const [page, setPage] = useState<Page>(() => getInitialPage())
const journal = useJournal(journalClient, page === 'timeline')
```

修改 hook 前，先在 `use-journal.test.tsx` 加入直接契約測試：

```tsx
test('停用時間軸時不背景查詢 listEntries，仍可在啟用前主動刷新', async () => {
  let listEntriesCount = 0
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return bootstrap
    if (request.action === 'listCategories') return categoryManagement
    if (request.action === 'listEntries') {
      listEntriesCount += 1
      return { items: [], nextCursor: null }
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const client = createClient({ run: run as JournalClient['run'] })
  const { result } = renderHook(() => useJournal(client, false))

  await waitFor(() => expect(result.current.status).toBe('ready'))
  await act(async () => result.current.updateFilter({ query: '日曆條件' }))
  expect(listEntriesCount).toBe(0)

  await act(async () => result.current.refreshEntries())
  expect(listEntriesCount).toBe(1)
  expect(run).toHaveBeenLastCalledWith({
    action: 'listEntries',
    filter: expect.objectContaining({ query: '日曆條件', cursor: null }),
  })
})
```

同一批紅燈也固定 `listEntries` 的失敗競態；一般錯誤與認證錯誤都不能由被新請求取代的舊 promise 污染目前 session：

```tsx
test.each([
  ['一般錯誤', () => new Error('舊錯誤')],
  ['認證錯誤', () => new AuthenticationError()],
])('忽略晚於新時間軸資料回來的舊%s', async (_label, createError) => {
  const staleList = deferred<unknown>()
  let listCount = 0
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return bootstrap
    if (request.action === 'listCategories') return categoryManagement
    if (request.action === 'listEntries') {
      listCount += 1
      if (listCount === 2) return staleList.promise
      return { items: [], nextCursor: null }
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const client = createClient({ run: run as JournalClient['run'] })
  const { result } = renderHook(() => useJournal(client))
  await waitFor(() => expect(listCount).toBe(1))

  let staleUpdate: Promise<void> = Promise.resolve()
  act(() => {
    staleUpdate = result.current.updateFilter({ query: '舊條件' })
  })
  await waitFor(() => expect(listCount).toBe(2))
  await act(async () => result.current.updateFilter({ query: '新條件' }))

  await act(async () => {
    staleList.reject(createError())
    await staleUpdate
  })
  expect(result.current.status).toBe('ready')
  expect(result.current.filter.query).toBe('新條件')
  expect(result.current.error).toBeUndefined()
})

test('停用後重新啟用時間軸仍忽略停用前的認證錯誤', async () => {
  const staleList = deferred<unknown>()
  let listCount = 0
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return bootstrap
    if (request.action === 'listCategories') return categoryManagement
    if (request.action === 'listEntries') {
      listCount += 1
      if (listCount === 2) return staleList.promise
      return { items: [], nextCursor: null }
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const client = createClient({ run: run as JournalClient['run'] })
  const { result, rerender } = renderHook(
    ({ enabled }) => useJournal(client, enabled),
    { initialProps: { enabled: true } },
  )
  await waitFor(() => expect(listCount).toBe(1))

  let staleUpdate: Promise<void> = Promise.resolve()
  act(() => {
    staleUpdate = result.current.updateFilter({ query: '保留條件' })
  })
  await waitFor(() => expect(listCount).toBe(2))
  rerender({ enabled: false })
  rerender({ enabled: true })
  await act(async () => result.current.refreshEntries())

  await act(async () => {
    staleList.reject(new AuthenticationError())
    await staleUpdate
  })
  expect(result.current.status).toBe('ready')
  expect(result.current.filter.query).toBe('保留條件')
  expect(result.current.error).toBeUndefined()
})
```

在 `use-journal.test.tsx` 的 `createClient` 後加入測試 helper：

```ts
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
```

Run: `npm run test:run -- --project=frontend src/features/journal/use-journal.test.tsx`

Expected: FAIL；`useJournal` 尚未接受啟用狀態、沒有 `refreshEntries()`，而且被新請求取代的 `listEntries` 失敗仍會寫入全域錯誤或誤清除 session。

接著在 `use-journal.ts` 將簽章改為 `useJournal(client, timelineEnabled = true)`，以 ref 保存最新 `timelineEnabled`，並遵守以下邊界：

- `loadBootstrap()` 只有 `timelineEnabledRef.current` 為 true 才啟動初始 `listEntries`；hook 單元測試不傳第二參數，維持原本預設行為。
- `updateFilter()` 一律更新共用 filter；只有時間軸啟用時才呼叫 `loadEntries`。日曆的 range effects 直接因 filter scalar 改變而重查。
- `saveEntry()`、`deleteEntry()`、`moveEntries()` 與 `deleteCategory()` 仍更新類別摘要及 `revision`，但只有時間軸啟用時才額外刷新 `listEntries`。如此日曆 mutation 不會因不相關的時間軸查詢失敗而誤報儲存失敗。
- `timelineEnabled` 從 true 變 false 時增加 `listRequestId` 並清除 `isLoadingEntries`，使離開時間軸後完成的成功或失敗不寫入目前 UI。`loadEntries` 自己必須在 rejection 路徑比對 request ID 與 epoch；被取代的失敗直接視為已失效並 resolve，不能流到呼叫端的 `handleRequestError`。這能涵蓋離開後又重新進入時間軸、最新 ref 已再次變成 true 的情況。
- 新增公開 `refreshEntries()`，使用目前 filter、工作區 epoch 與既有 request ID 重新載入第一頁。`navigate()` 從其他主頁進入 `timeline` 時，在 `setPage(nextPage)` 同一個 handler 內呼叫它；因此在日曆變更 filter 或 mutation 後返回時間軸，才會取得最新清單。

將下列 ref 放在既有 refs 區；每次 render 同步最新值，供已開始的 async catch 判斷：

```ts
const timelineEnabledRef = useRef(timelineEnabled)
timelineEnabledRef.current = timelineEnabled
```

在 refs 宣告後加入失效 effect：

```ts
useEffect(() => {
  if (timelineEnabled) return
  listRequestId.current += 1
  setIsLoadingEntries(false)
}, [timelineEnabled])
```

在 `loadEntries` 後加入公開刷新函式：

```ts
const refreshEntries = async (): Promise<void> => {
  const expectedEpoch = requestEpoch.current
  try {
    await loadEntries({ ...filter, cursor: null }, false, expectedEpoch)
  } catch (loadError) {
    if (timelineEnabledRef.current) handleRequestError(loadError, expectedEpoch)
  }
}
```

另外在既有 `loadEntries` 的 `try` 與 `finally` 之間加入 rejection 防護：

```ts
} catch (loadError) {
  if (expectedEpoch !== requestEpoch.current || requestId !== listRequestId.current) return
  throw loadError
} finally {
```

把 `refreshEntries` 加入 hook return object。`updateFilter` 與四個 mutation 在呼叫 `loadEntries` 前檢查 `timelineEnabledRef.current`。`loadBootstrap()` 的 fire-and-forget catch 也要在呼叫 `handleRequestError` 前重查最新 ref；不能只在發出請求時擷取舊 boolean。由於 `loadEntries` 只會重新拋出目前請求的錯誤，外層 catch 不會再收到過期的一般或認證錯誤。

修正時區優先順序：

```ts
const journalTimezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei'
const calendarToday = getJournalDate(journalTimezone)
```

`clearWorkspaceState()` 移除舊月份欄位並加入：

```ts
setCalendarAnchorDate(undefined)
setCalendarQuery({ status: 'idle' })
setCalendarReloadToken(0)
setSelectedDate(undefined)
setSelectedDateQuery({ status: 'idle' })
setSelectedDateReloadToken(0)
```

同時照舊清除 `selectedEntry` 與 `editingEntry`。不要重設 `calendarMode`，因模式偏好要跨重新登入與資料空間保留。

`revalidateSession()` 的 `sessionState === 'signed-out'` 分支也要先呼叫 `invalidateWorkspace()`，再執行 `clearWorkspaceState()`／`clearSession()`，並把 `invalidateWorkspace` 加入 callback dependencies；不可只依下一個 render 的 status effect 延後失效 App range 請求。

工作區 ready 後才以記事時區初始化焦點，避免先用裝置日期送出錯誤期間請求：

```ts
useEffect(() => {
  if (status !== 'ready') return
  setCalendarAnchorDate((current) => current ?? clampCalendarAnchorDate(calendarMode, calendarToday))
}, [calendarMode, calendarToday, status])
```

只有 `calendarAnchorDate` 已存在時才計算 range、建立 query key 及渲染 `CalendarFrame`；初始化期間沿用頂部「查詢中...」提示。從其他主頁進入日曆時主動設定記事時區今天，因此不等待第二次 effect。

- [ ] **Step 6：建立穩定 query key 與期間查詢 effect**

以固定欄位順序建立 key，不用手工分隔字串：

```ts
const calendarRange = calendarAnchorDate
  ? getCalendarDateRange(calendarMode, calendarAnchorDate)
  : undefined
const calendarRangeFrom = calendarRange?.from ?? ''
const calendarRangeTo = calendarRange?.to ?? ''
const {
  query: calendarFilterQuery,
  from: calendarFilterFrom,
  to: calendarFilterTo,
  categoryId: calendarFilterCategoryId,
  tag: calendarFilterTag,
} = toFilterCriteria(filter)
const calendarQueryKey = calendarRange ? JSON.stringify({
  from: calendarRange.from,
  to: calendarRange.to,
  query: calendarFilterQuery,
  filterFrom: calendarFilterFrom,
  filterTo: calendarFilterTo,
  categoryId: calendarFilterCategoryId,
  tag: calendarFilterTag,
  revision,
  reload: calendarReloadToken,
}) : ''
```

期間 effect 在日曆頁且 range 完整時執行；進入單日清單後仍保留這套獨立背景 query，讓 filter 或 mutation 改變時先準備可返回的目前期間。這個任務先完成基本查詢與 key 可見性，Task 12 再用紅燈測試加入同工作區內的 request ID 防護：

```ts
useEffect(() => {
  if (
    status !== 'ready'
    || page !== 'calendar'
    || !calendarRangeFrom
    || !calendarRangeTo
  ) return

  const expectedWorkspaceEpoch = workspaceEpoch.current
  const key = calendarQueryKey
  setCalendarQuery({ status: 'loading', key })
  void journalClient.run<DailyEntries[]>({
    action: 'getEntriesForRange',
    from: calendarRangeFrom,
    to: calendarRangeTo,
    filter: {
      query: calendarFilterQuery,
      from: calendarFilterFrom,
      to: calendarFilterTo,
      categoryId: calendarFilterCategoryId,
      tag: calendarFilterTag,
    },
  }).then((data) => {
    if (!isCurrentWorkspace(expectedWorkspaceEpoch)) return
    setCalendarQuery({ status: 'ready', key, data })
  }).catch((loadError: unknown) => {
    if (!isCurrentWorkspace(expectedWorkspaceEpoch)) return
    if (loadError instanceof AuthenticationError) handleRequestError(loadError)
    else setCalendarQuery({ status: 'error', key, message: toErrorMessage(loadError) })
  })
}, [
  calendarFilterCategoryId,
  calendarFilterFrom,
  calendarFilterQuery,
  calendarFilterTag,
  calendarFilterTo,
  calendarQueryKey,
  calendarRangeFrom,
  calendarRangeTo,
  handleRequestError,
  isCurrentWorkspace,
  journalClient,
  page,
  status,
])
```

`calendarQuery` 只有 `key === calendarQueryKey` 才可供畫面使用，因此舊 key 不會顯示在新標題下；但舊 promise 晚到仍可能把目前 ready state 換成不可見的舊 key，這個尚未保護的行為正是 Task 12 的預期紅燈。主期間與單日 effect 可在深入頁同時存在但只寫自己的 state。單日 effect 採相同錯誤分流：只有 `AuthenticationError` 呼叫 `handleRequestError`，其他錯誤只寫入 `selectedDateQuery`。

effect 內只引用 `calendarQueryKey`、range 的 `from/to` scalar、五個 filter scalar 與穩定 callback，dependency array 也逐一列出這些值。不得在 effect 內引用每次 render 新建的 `calendarRange` 或 filter object，以免 exhaustive-deps 迫使 object 成為 dependency，並在完成 setState 後重複查詢。

- [ ] **Step 7：建立獨立單日清單 effect**

加入完整 key 與 effect；它使用相同 API，但不讀寫 `calendarQuery`：

```ts
const selectedDateQueryKey = selectedDate ? JSON.stringify({
  date: selectedDate,
  query: calendarFilterQuery,
  filterFrom: calendarFilterFrom,
  filterTo: calendarFilterTo,
  categoryId: calendarFilterCategoryId,
  tag: calendarFilterTag,
  revision,
  reload: selectedDateReloadToken,
}) : ''

useEffect(() => {
  if (status !== 'ready' || page !== 'calendar' || !selectedDate) return

  const expectedWorkspaceEpoch = workspaceEpoch.current
  const date = selectedDate
  const key = selectedDateQueryKey
  setSelectedDateQuery({ status: 'loading', key })
  void journalClient.run<DailyEntries[]>({
    action: 'getEntriesForRange',
    from: date,
    to: date,
    filter: {
      query: calendarFilterQuery,
      from: calendarFilterFrom,
      to: calendarFilterTo,
      categoryId: calendarFilterCategoryId,
      tag: calendarFilterTag,
    },
  }).then((days) => {
    if (!isCurrentWorkspace(expectedWorkspaceEpoch)) return
    const entries = days.find((day) => day.date === date)?.entries ?? []
    setSelectedDateQuery({ status: 'ready', key, data: entries })
  }).catch((loadError: unknown) => {
    if (!isCurrentWorkspace(expectedWorkspaceEpoch)) return
    if (loadError instanceof AuthenticationError) handleRequestError(loadError)
    else setSelectedDateQuery({ status: 'error', key, message: toErrorMessage(loadError) })
  })
}, [
  calendarFilterCategoryId,
  calendarFilterFrom,
  calendarFilterQuery,
  calendarFilterTag,
  calendarFilterTo,
  handleRequestError,
  isCurrentWorkspace,
  journalClient,
  page,
  selectedDate,
  selectedDateQueryKey,
  status,
])
```

同工作區內的 request ID 由 Task 12 加入。這套 state、loading、error 與 retry token 都與主期間獨立。

- [ ] **Step 8：串接模式、期間、日、週與月畫面**

建立 handler：

```ts
const handleSelectDate = (date: string) => {
  if (typeof window !== 'undefined') {
    dateSelectionReturnScrollPositionRef.current = window.scrollY
    window.scrollTo(0, 0)
  }
  setSelectedDateQuery({ status: 'idle' })
  setSelectedDateReloadToken(0)
  setSelectedDate(date)
}

const handleCalendarModeChange = (mode: CalendarMode) => {
  saveCalendarModePreference(mode)
  setCalendarMode(mode)
  setCalendarAnchorDate((date) => date ? clampCalendarAnchorDate(mode, date) : date)
}

const handleCalendarFocusDate = (date: string) => {
  setCalendarAnchorDate(clampCalendarAnchorDate(calendarMode, date))
}

const handleMoveCalendarPeriod = (direction: -1 | 1) => {
  setCalendarAnchorDate((date) => (
    date ? shiftCalendarAnchorDate(calendarMode, date, direction) : date
  ))
}

const handleCalendarToday = () => {
  setCalendarAnchorDate(clampCalendarAnchorDate(calendarMode, calendarToday))
}
```

只有目前 key 的 ready data 可計數：

```ts
const visibleCalendarDays = calendarQuery.status === 'ready' && calendarQuery.key === calendarQueryKey
  ? calendarQuery.data
  : []
const calendarEntryCount = calendarQuery.status === 'ready' && calendarQuery.key === calendarQueryKey
  ? visibleCalendarDays.reduce((total, day) => total + day.entries.length, 0)
  : null
```

另外明確推導目前 key 的 loading 與 error，不能只看 union 的 `status`：

```ts
const calendarQueryMatches = calendarQuery.status !== 'idle' && calendarQuery.key === calendarQueryKey
const isCalendarLoading = Boolean(calendarQueryKey)
  && (!calendarQueryMatches || calendarQuery.status === 'loading')
const calendarError = calendarQueryMatches && calendarQuery.status === 'error'
  ? calendarQuery.message
  : undefined

const selectedDateQueryMatches = selectedDateQuery.status !== 'idle'
  && selectedDateQuery.key === selectedDateQueryKey
const visibleSelectedDateEntries = selectedDateQuery.status === 'ready'
  && selectedDateQuery.key === selectedDateQueryKey
  ? selectedDateQuery.data
  : []
const isSelectedDateLoading = Boolean(selectedDateQueryKey)
  && (!selectedDateQueryMatches || selectedDateQuery.status === 'loading')
const selectedDateError = selectedDateQueryMatches && selectedDateQuery.status === 'error'
  ? selectedDateQuery.message
  : undefined
```

因此 mode、anchor、filter、revision 或 retry 改變的同一個 render 就隱藏舊內容並顯示 loading，不等待 effect 先寫 state。單日清單以相同規則從 `selectedDateQueryKey` 推導 matching、loading 與 error；idle 或舊 key 都視為目前單日請求尚未完成。

把三種視角放入同一個 `CalendarFrame`；依 mode 渲染 `CalendarDayView`、`CalendarWeekView`、`CalendarMonthView`。週的 `expansionResetKey` 不能直接使用含 mode／reload 的 `calendarQueryKey`，否則只在同一週切換焦點或手動重試也會收合；另建立：

```ts
const calendarContentKey = calendarRange ? JSON.stringify({
  from: calendarRange.from,
  to: calendarRange.to,
  query: calendarFilterQuery,
  filterFrom: calendarFilterFrom,
  filterTo: calendarFilterTo,
  categoryId: calendarFilterCategoryId,
  tag: calendarFilterTag,
}) : ''
```

傳給週視角 `expansionResetKey={calendarContentKey}`。月視角 `onSelectDate` 沿用獨立單日清單；日／週／月的焦點 callback 都使用 `handleCalendarFocusDate`，讓切換模式與極端年份仍遵守各模式邊界。

主日曆 JSX 固定為下列結構；不要建立未定義的 spread helper，每個 callback 都明確傳入：

```tsx
const dayEntries = visibleCalendarDays.find(({ date }) => date === calendarAnchorDate)?.entries ?? []
const previousCalendarAnchor = calendarAnchorDate
  ? shiftCalendarAnchorDate(calendarMode, calendarAnchorDate, -1)
  : undefined
const nextCalendarAnchor = calendarAnchorDate
  ? shiftCalendarAnchorDate(calendarMode, calendarAnchorDate, 1)
  : undefined

{page === 'calendar' && !selectedDate && calendarAnchorDate && (
  <CalendarFrame
    mode={calendarMode}
    anchorDate={calendarAnchorDate}
    entryCount={calendarEntryCount}
    isLoading={isCalendarLoading}
    error={calendarError}
    canMovePrevious={previousCalendarAnchor !== calendarAnchorDate}
    canMoveNext={nextCalendarAnchor !== calendarAnchorDate}
    onModeChange={handleCalendarModeChange}
    onMovePeriod={handleMoveCalendarPeriod}
    onToday={handleCalendarToday}
    onRetry={() => setCalendarReloadToken((value) => value + 1)}
  >
    {calendarMode === 'day' && (
      <CalendarDayView
        date={calendarAnchorDate}
        today={calendarToday}
        entries={dayEntries}
        categories={categories}
        timezone={journalTimezone}
        onOpenEntry={handleOpenEntry}
        onEditEntry={(entry) => setEditingEntry(entry)}
        onDeleteEntry={handleDeleteEntry}
        onCreateEntry={(_date) => setEditingEntry(null)}
      />
    )}
    {calendarMode === 'week' && (
      <CalendarWeekView
        anchorDate={calendarAnchorDate}
        today={calendarToday}
        days={visibleCalendarDays}
        categories={categories}
        expansionResetKey={calendarContentKey}
        onFocusDate={handleCalendarFocusDate}
        onOpenEntry={handleOpenEntry}
        onCreateEntry={(_date) => setEditingEntry(null)}
      />
    )}
    {calendarMode === 'month' && (
      <CalendarMonthView
        anchorDate={calendarAnchorDate}
        today={calendarToday}
        days={visibleCalendarDays}
        categories={categories}
        onFocusDate={handleCalendarFocusDate}
        onSelectDate={handleSelectDate}
        onOpenEntry={handleOpenEntry}
      />
    )}
  </CalendarFrame>
)}
```

Task 11 尚未串接指定日期 editor，因此日／週的 `onCreateEntry` 先接受元件回傳的日期但開啟既有新增 editor；Task 13 會改成保存該日期的判別聯集。不要把 `categories` 加進 query key 或 effect dependencies。

單日清單改成下列互斥狀態；ready 才把目前 key 的 entries 傳給既有 `Timeline`：

```tsx
{page === 'calendar' && selectedDate && (
  <section className="calendar-selection">
    <header className="calendar-selection__header">
      <button
        className="button button--text"
        type="button"
        onClick={() => {
          setSelectedDate(undefined)
          setSelectedDateQuery({ status: 'idle' })
        }}
      >
        <Icon>arrow_back</Icon>
        {zhTW.actions.backToCalendar}
      </button>
      <h2>{zhTW.calendar.selectedDateTitle(selectedDate)}</h2>
    </header>
    {isSelectedDateLoading ? (
      <p className="loading-note" role="status">{zhTW.filters.searching}</p>
    ) : selectedDateError ? (
      <div className="calendar-frame__error" role="alert">
        <p>{selectedDateError}</p>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => setSelectedDateReloadToken((value) => value + 1)}
        >
          {zhTW.actions.reload}
        </button>
      </div>
    ) : (
      <Timeline
        entries={visibleSelectedDateEntries}
        categories={categories}
        timezone={journalTimezone}
        nextCursor={null}
        isLoading={false}
        onLoadMore={() => undefined}
        onOpen={handleOpenEntry}
        onEdit={setEditingEntry}
        onDelete={handleDeleteEntry}
        onCreate={() => setEditingEntry(null)}
      />
    )}
  </section>
)}
```

同步移除 `handleDeleteEntry()` 對已刪除 `selectedDateEntries` state 的手動 filter，只保留：

```ts
const handleDeleteEntry = async (id: string) => {
  await deleteEntry(id)
  setSelectedEntry((current) => current?.id === id ? undefined : current)
}
```

刪除後由 `revision` 使主期間與單日 query key 同時失效；新 key 的衍生 loading 會立即隱藏舊記事，不做另一套樂觀資料來源。

頂部 `.search-loading-note` 的條件改成：

```tsx
{((page === 'timeline' && isLoadingEntries)
  || (page === 'calendar' && !calendarAnchorDate)) && (
  <p className="loading-note search-loading-note" role="status">
    <Icon className="loading-note-spinner">progress_activity</Icon>
    <span>{zhTW.filters.searching}</span>
  </p>
)}
```

anchor 存在後的日曆 loading 由 `CalendarFrame` 或單日清單本身公告，避免重複的 `role="status"`。

- [ ] **Step 9：重設主頁進入規則與所有日曆文案**

在 `navigate(nextPage)` 中，只有從非 calendar 主頁進入 calendar 時執行：

```ts
if (nextPage === 'timeline' && page !== 'timeline') {
  void refreshEntries()
}
if (nextPage === 'calendar' && page !== 'calendar') {
  setCalendarAnchorDate(clampCalendarAnchorDate(calendarMode, calendarToday))
}
setSelectedDate(undefined)
setSelectedDateQuery({ status: 'idle' })
setSelectedDateReloadToken(0)
```

`refreshEntries` 必須從 `useJournal` 回傳值解構。進入詳情或單日清單再返回不經 `navigate()`，因此保留 mode 與 anchor。桌面與行動導覽、外層標題及主切換器都由更新後的 `zhTW.navigation.calendar` 顯示「日曆」。

在同一個步驟精確調整 `zh-TW.ts`：

```ts
navigation: {
  calendar: '日曆',
},
```

保留 `actions.backToCalendar: '返回日曆'`；移除不再使用的 `app.calendarDescription` 與 `calendar.monthTitle`。`calendar.monthLabel` 繼續供月格無障礙名稱使用。同步更新本任務所有受影響的 App 測試文字。

- [ ] **Step 10：刪除舊 wrapper 並完成編譯遷移**

刪除：

```text
src/features/entries/calendar-view.tsx
src/features/entries/calendar-view.test.tsx
```

移除 `CalendarView`、`calendarMonth`、`calendarDays` 與舊月曆 effect imports／state。App 與 wrapper 刪除後，`monthParts()` 已只剩舊 App 測試用途；把該測試的年份／月份直接由 `testMonth.split('-').map(Number)` 取得，再從 `src/utils/date.ts` 刪除 `monthParts()`。`getJournalMonth()` 仍由 `src/utils/date.test.ts` 驗證，可保留為公開日期工具，不必為本功能刪除。

- [ ] **Step 11：執行 App 與所有日曆元件測試**

Run: `npm run test:run -- --project=frontend src/App.test.tsx src/features/journal/use-journal.test.tsx src/features/entries/calendar-frame.test.tsx src/features/entries/calendar-day-view.test.tsx src/features/entries/calendar-week-view.test.tsx src/features/entries/calendar-month-view.test.tsx src/features/entries/week-entry-card.test.tsx`

Expected: PASS；日曆只呼叫新 range action，切回時間軸才呼叫 `listEntries`，三種模式都可呈現，既有 workspace epoch 隔離仍通過；同工作區快速切換的新增測試留待 Task 12。

- [ ] **Step 12：執行 TypeScript／Vite 建置**

Run: `npm run build`

Expected: PASS，沒有舊 props、未使用 import 或判別聯集窄化錯誤。

- [ ] **Step 13：向使用者出示提交訊息並等待核准**

提交訊息：`feat: 串接日曆日週月檢視與區間查詢`

- [ ] **Step 14：核准後只提交本任務檔案**

```bash
git add src/App.tsx src/App.test.tsx src/features/journal/use-journal.ts src/features/journal/use-journal.test.tsx src/i18n/zh-TW.ts src/utils/date.ts src/features/entries/calendar-view.tsx src/features/entries/calendar-view.test.tsx
git commit -m "feat: 串接日曆日週月檢視與區間查詢"
```

刪除檔案也必須明確加入 stage；提交前以 `git diff --cached --name-status` 確認顯示兩個 `D`，且未包含其他檔案。

---

### Task 12：完成查詢競態、局部錯誤與重試

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1：先寫快速切換只採最後回應的失敗測試**

將 `DailyEntries` 加入 `src/App.test.tsx` 的 type imports（`Entry` 已由 Task 11 加入），並在檔案尾端既有 `deferred<T>()` 前加入共用 fixture：

```tsx
const calendarCategory = {
  id: 'work',
  name: '工作',
  color: null,
  isActive: true,
  createdAt: '2026-09-03T00:00:00+08:00',
  updatedAt: '2026-09-03T00:00:00+08:00',
}

const bootstrapForCalendar = {
  timezone: 'Asia/Taipei',
  categories: [calendarCategory],
  tagSuggestions: [],
}

const categoryManagementForCalendar = {
  categories: [calendarCategory],
  entryCounts: { work: 0 },
}

function calendarEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-calendar',
    entryDate: '2026-09-03',
    title: '日曆記事',
    content: '內容',
    categoryId: 'work',
    tags: [],
    links: [],
    createdAt: '2026-09-03T09:00:00+08:00',
    updatedAt: '2026-09-03T09:00:00+08:00',
    ...overrides,
  }
}

function renderCalendarApp(run: ReturnType<typeof vi.fn>, mode: 'day' | 'week' | 'month' = 'month') {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-02T16:30:00.000Z'))
  window.localStorage.setItem('daily-journal:view', 'calendar')
  window.localStorage.setItem('daily-journal:calendar-mode', mode)
  render(<App client={createClient({ run: run as JournalClient['run'] })} />)
  return userEvent.setup()
}
```

使用既有 `deferred<T>()` helper 加入：

```tsx
test('快速切換期間時不在新標題下顯示舊資料，且只採最後回應', async () => {
  const octoberRange = deferred<DailyEntries[]>()
  const novemberRange = deferred<DailyEntries[]>()
  let rangeCount = 0
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return bootstrapForCalendar
    if (request.action === 'listCategories') return categoryManagementForCalendar
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange') {
      rangeCount += 1
      if (rangeCount === 1) {
        return [{ date: '2026-09-03', entries: [calendarEntry({ title: '舊期間記事' })] }]
      }
      return rangeCount === 2 ? octoberRange.promise : novemberRange.promise
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const user = renderCalendarApp(run)
  await waitFor(() => expect(rangeCount).toBe(1))
  expect(await screen.findByText('舊期間記事')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '下一個月' }))
  await waitFor(() => expect(rangeCount).toBe(2))
  expect(screen.getByText('查詢中...')).toBeInTheDocument()
  expect(screen.queryByText('舊期間記事')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '下一個月' }))
  await waitFor(() => expect(rangeCount).toBe(3))
  await act(async () => {
    novemberRange.resolve([{
      date: '2026-11-03',
      entries: [calendarEntry({ id: 'new', entryDate: '2026-11-03', title: '新期間記事' })],
    }])
  })
  expect(await screen.findByText('新期間記事')).toBeInTheDocument()

  await act(async () => {
    octoberRange.resolve([{
      date: '2026-10-03',
      entries: [calendarEntry({ id: 'stale', entryDate: '2026-10-03', title: '過期回應記事' })],
    }])
  })
  expect(screen.queryByText('過期回應記事')).not.toBeInTheDocument()
  expect(screen.getByText('新期間記事')).toBeInTheDocument()
})
```

- [ ] **Step 2：先寫局部錯誤及原條件重試的失敗測試**

加入：

```tsx
test('日曆查詢失敗只顯示局部錯誤，重試保留模式日期與篩選', async () => {
  let rangeAttempts = 0
  const rangeRequests: ApiRequest[] = []
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return bootstrapForCalendar
    if (request.action === 'listCategories') return categoryManagementForCalendar
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange') {
      rangeRequests.push(request)
      rangeAttempts += 1
      if (rangeAttempts === 1) throw new Error('日曆暫時無法載入')
      return []
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const user = renderCalendarApp(run, 'week')

  expect(await screen.findByRole('alert')).toHaveTextContent('日曆暫時無法載入')
  expect(screen.queryByRole('button', { name: '重新嘗試' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重新載入' }))
  await waitFor(() => expect(rangeAttempts).toBe(2))
  expect(rangeRequests[1]).toEqual(rangeRequests[0])
  expect(screen.getByRole('button', { name: '週' })).toHaveAttribute('aria-pressed', 'true')
})
```

若 reload token 被包含在內部 query key，它不得出現在 API request body，因此兩次 request 應完全相等。

- [ ] **Step 3：先寫 range 與單日清單互不覆蓋的失敗測試**

加入：

```tsx
test('月期間與單日清單使用獨立 loading 與錯誤 state', async () => {
  const date = '2026-09-03'
  const selectedRange = deferred<DailyEntries[]>()
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return bootstrapForCalendar
    if (request.action === 'listCategories') return categoryManagementForCalendar
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange' && request.from === request.to) return selectedRange.promise
    if (request.action === 'getEntriesForRange') {
      return [{ date, entries: [calendarEntry({ entryDate: date, title: '月格記事' })] }]
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const user = renderCalendarApp(run)
  await user.click(await screen.findByRole('button', { name: new RegExp(`^${date}，共 1 則記事`) }))

  expect(screen.getByRole('heading', { name: `${date} 的記事` })).toBeInTheDocument()
  expect(screen.getByText('查詢中...')).toBeInTheDocument()
  await act(async () => selectedRange.reject(new Error('單日暫時無法載入')))
  expect(await screen.findByRole('alert')).toHaveTextContent('單日暫時無法載入')
  expect(screen.queryByText('月格記事')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '返回日曆' }))
  expect(await screen.findByText('月格記事')).toBeInTheDocument()
})
```

再用兩種結算結果真正覆蓋單日 request ID：先開啟第一天、在請求未完成時返回月格並開啟第二天；第二天先完成後，第一天較晚到達的成功或錯誤都不得改變第二天畫面。

```tsx
test.each(['success', 'error', 'authentication'] as const)(
  '快速切換單日清單時忽略過期的 %s 回應',
  async (staleOutcome) => {
    const firstDate = '2026-09-02'
    const secondDate = '2026-09-03'
    const firstRange = deferred<DailyEntries[]>()
    const secondRange = deferred<DailyEntries[]>()
    const firstEntry = calendarEntry({ id: 'first', entryDate: firstDate, title: '第一天舊記事' })
    const secondEntry = calendarEntry({ id: 'second', entryDate: secondDate, title: '第二天目前記事' })
    const run = vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') return bootstrapForCalendar
      if (request.action === 'listCategories') return categoryManagementForCalendar
      if (request.action === 'getEntriesForRange' && request.from === request.to) {
        return request.from === firstDate ? firstRange.promise : secondRange.promise
      }
      if (request.action === 'getEntriesForRange') {
        return [
          { date: firstDate, entries: [firstEntry] },
          { date: secondDate, entries: [secondEntry] },
        ]
      }
      throw new Error(`未預期的請求：${request.action}`)
    })
    const user = renderCalendarApp(run)

    await user.click(await screen.findByRole('button', { name: new RegExp(`^${firstDate}，共 1 則記事`) }))
    expect(screen.getByText('查詢中...')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '返回日曆' }))
    await user.click(await screen.findByRole('button', { name: new RegExp(`^${secondDate}，共 1 則記事`) }))
    await act(async () => secondRange.resolve([{ date: secondDate, entries: [secondEntry] }]))
    expect(await screen.findByText('第二天目前記事')).toBeInTheDocument()

    await act(async () => {
      if (staleOutcome === 'success') {
        firstRange.resolve([{ date: firstDate, entries: [firstEntry] }])
      } else if (staleOutcome === 'error') {
        firstRange.reject(new Error('第一天過期錯誤'))
      } else {
        firstRange.reject(new AuthenticationError())
      }
    })

    expect(screen.getByText('第二天目前記事')).toBeInTheDocument()
    expect(screen.queryByText('第一天舊記事')).not.toBeInTheDocument()
    expect(screen.queryByText('第一天過期錯誤')).not.toBeInTheDocument()
    expect(screen.queryByText('查詢中...')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '使用 Google 帳號登入' })).not.toBeInTheDocument()
  },
)
```

- [ ] **Step 4：執行競態測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/App.test.tsx`

Expected: 快速切換期間與快速切換單日清單的一般、成功及認證結果案例 FAIL，因同工作區 request ID 尚未實作；局部錯誤、retry 與 range／單日 state 隔離案例可以先通過，作為 Task 11 基本行為的 characterization test。

- [ ] **Step 5：完成 request ID、query key 與 reload token 防護**

確認兩套 effect 都遵守以下順序：

1. 每次 effect 啟動先增加自己的 request ID，並保存這次 effect 的 query key。
2. 立即把相同 query key 寫為 `loading`，因此舊 ready data 不可見。
3. 成功或失敗前同時檢查 request ID、`workspaceEpoch` 與目前 query state 的 key；更新 state 使用 functional setter，若 current state 已是 idle 或不同 key，就原樣回傳 current，不採用該結果。
4. cleanup 再增加 request ID，讓已離開的 effect 失效。
5. 保留 Task 11 的錯誤分流：一般錯誤只寫入對應 query state；`AuthenticationError` 才呼叫 `handleRequestError`。
6. 保留 Task 11 的 retry：`onRetry` 只增加對應 reload token；mode、anchor、filter 與 selected date 不變。

在 App refs 區加入：

```ts
const calendarRequestId = useRef(0)
const selectedDateRequestId = useRef(0)
```

將 Task 11 的期間 effect 改為：

```ts
useEffect(() => {
  if (
    status !== 'ready'
    || page !== 'calendar'
    || !calendarRangeFrom
    || !calendarRangeTo
  ) return

  const requestId = ++calendarRequestId.current
  const expectedWorkspaceEpoch = workspaceEpoch.current
  const key = calendarQueryKey
  setCalendarQuery({ status: 'loading', key })
  void journalClient.run<DailyEntries[]>({
    action: 'getEntriesForRange',
    from: calendarRangeFrom,
    to: calendarRangeTo,
    filter: {
      query: calendarFilterQuery,
      from: calendarFilterFrom,
      to: calendarFilterTo,
      categoryId: calendarFilterCategoryId,
      tag: calendarFilterTag,
    },
  }).then((data) => {
    if (requestId !== calendarRequestId.current || !isCurrentWorkspace(expectedWorkspaceEpoch)) return
    setCalendarQuery((current) => {
      if (current.status === 'idle' || current.key !== key) return current
      return { status: 'ready', key, data }
    })
  }).catch((loadError: unknown) => {
    if (requestId !== calendarRequestId.current || !isCurrentWorkspace(expectedWorkspaceEpoch)) return
    if (loadError instanceof AuthenticationError) {
      handleRequestError(loadError)
      return
    }
    setCalendarQuery((current) => {
      if (current.status === 'idle' || current.key !== key) return current
      return { status: 'error', key, message: toErrorMessage(loadError) }
    })
  })

  return () => {
    if (calendarRequestId.current === requestId) calendarRequestId.current += 1
  }
}, [
  calendarFilterCategoryId,
  calendarFilterFrom,
  calendarFilterQuery,
  calendarFilterTag,
  calendarFilterTo,
  calendarQueryKey,
  calendarRangeFrom,
  calendarRangeTo,
  handleRequestError,
  isCurrentWorkspace,
  journalClient,
  page,
  status,
])
```

將單日 effect 套用完全獨立的 ID 與相同 guard：

```ts
useEffect(() => {
  if (status !== 'ready' || page !== 'calendar' || !selectedDate) return

  const requestId = ++selectedDateRequestId.current
  const expectedWorkspaceEpoch = workspaceEpoch.current
  const date = selectedDate
  const key = selectedDateQueryKey
  setSelectedDateQuery({ status: 'loading', key })
  void journalClient.run<DailyEntries[]>({
    action: 'getEntriesForRange',
    from: date,
    to: date,
    filter: {
      query: calendarFilterQuery,
      from: calendarFilterFrom,
      to: calendarFilterTo,
      categoryId: calendarFilterCategoryId,
      tag: calendarFilterTag,
    },
  }).then((days) => {
    if (requestId !== selectedDateRequestId.current || !isCurrentWorkspace(expectedWorkspaceEpoch)) return
    const entries = days.find((day) => day.date === date)?.entries ?? []
    setSelectedDateQuery((current) => {
      if (current.status === 'idle' || current.key !== key) return current
      return { status: 'ready', key, data: entries }
    })
  }).catch((loadError: unknown) => {
    if (requestId !== selectedDateRequestId.current || !isCurrentWorkspace(expectedWorkspaceEpoch)) return
    if (loadError instanceof AuthenticationError) {
      handleRequestError(loadError)
      return
    }
    setSelectedDateQuery((current) => {
      if (current.status === 'idle' || current.key !== key) return current
      return { status: 'error', key, message: toErrorMessage(loadError) }
    })
  })

  return () => {
    if (selectedDateRequestId.current === requestId) selectedDateRequestId.current += 1
  }
}, [
  calendarFilterCategoryId,
  calendarFilterFrom,
  calendarFilterQuery,
  calendarFilterTag,
  calendarFilterTo,
  handleRequestError,
  isCurrentWorkspace,
  journalClient,
  page,
  selectedDate,
  selectedDateQueryKey,
  status,
])
```

Task 11 已把 `calendarReloadToken` 加入期間 query key、把 `selectedDateReloadToken` 加入單日 key，並接好兩個「重新載入」按鈕；本任務只補 request ID，並驗證 retry 不改變 API request body。

期間與單日 key 都必須保留 `revision`，mutation 開始重新查詢時不得繼續顯示舊結果。API request body 不得包含 key、request ID、reload token 或 workspace ID。

- [ ] **Step 6：執行 App 競態與工作區隔離測試**

Run: `npm run test:run -- --project=frontend src/App.test.tsx`

Expected: PASS，包含既有「更換資料表期間忽略舊請求」、期間競態、單日成功／一般錯誤／認證錯誤競態、局部錯誤與兩套 state 隔離案例。

- [ ] **Step 7：向使用者出示提交訊息並等待核准**

提交訊息：`fix: 防止日曆舊查詢覆蓋目前期間`

- [ ] **Step 8：核准後只提交本任務檔案**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "fix: 防止日曆舊查詢覆蓋目前期間"
```

---

### Task 13：串接深入流程、指定日期新增與 CRUD 刷新

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1：先寫日／週指定日期新增與全域新增的失敗測試**

使用 Task 12 已建立的 `renderCalendarApp()`、`bootstrapForCalendar` 與 `categoryManagementForCalendar`，加入：

```tsx
test('日與週視角新增預填指定日期，全域新增仍預填今天', async () => {
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return bootstrapForCalendar
    if (request.action === 'listCategories') return categoryManagementForCalendar
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange') return []
    throw new Error(`未預期的請求：${request.action}`)
  })
  const user = renderCalendarApp(run, 'day')
  await screen.findByRole('heading', { name: '2026年9月3日 星期四' })

  await user.click(screen.getByRole('button', { name: '後一天' }))
  await screen.findByRole('heading', { name: '2026年9月4日 星期五' })
  await user.click(await screen.findByRole('button', { name: '新增這天的記事' }))
  expect(screen.getByLabelText('記事日期')).toHaveValue('2026-09-04')
  await user.click(screen.getByRole('button', { name: '取消' }))

  await user.click(screen.getByRole('button', { name: '週' }))
  await user.click(screen.getByRole('button', { name: '新增 2026-09-01 的記事' }))
  expect(screen.getByLabelText('記事日期')).toHaveValue('2026-09-01')
  await user.click(screen.getByRole('button', { name: '取消' }))

  await user.click(screen.getAllByRole('button', { name: '新增記事' })[0])
  expect(screen.getByLabelText('記事日期')).toHaveValue('2026-09-03')
})
```

此測試使用 fake Date 與 `Asia/Taipei`，讓全域今天穩定為 `2026-09-03`。

- [ ] **Step 2：先寫月格深入不切 mode、返回保留 anchor 與兩層捲動的失敗測試**

擴充既有兩個捲動測試：

```tsx
expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true')
await user.click(screen.getByRole('button', { name: new RegExp(`^${testDate}，共 1 則記事`) }))
expect(screen.getByRole('button', { name: '月' })).not.toBeInTheDocument()
expect(await screen.findByRole('heading', { name: `${testDate} 的記事` })).toBeInTheDocument()

Object.defineProperty(window, 'scrollY', { value: 175, writable: true, configurable: true })
await user.click(screen.getByRole('button', { name: '閱讀記事：特定日期記事' }))
await user.click(screen.getByRole('button', { name: '返回日曆' }))
expect(scrollToSpy).toHaveBeenCalledWith(0, 175)

await user.click(screen.getByRole('button', { name: '返回日曆' }))
expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true')
expect(screen.getByRole('button', { name: new RegExp(`${testDate}.*焦點日期`) })).toBeInTheDocument()
expect(scrollToSpy).toHaveBeenCalledWith(0, 420)
```

以上既有回歸測試保護一般深入與 anchor；另加入 deferred mutation 測試，讓 Step 8 的 query readiness 先形成真正紅燈：

```tsx
test('mutation 後依序等待目前單日與月期間 query 才還原兩層捲動', async () => {
  const date = '2026-09-03'
  const entry = calendarEntry({ id: 'scroll-delete', entryDate: date, title: '兩層捲動記事' })
  const refreshedDate = deferred<DailyEntries[]>()
  const refreshedMonth = deferred<DailyEntries[]>()
  let dateAttempts = 0
  let monthAttempts = 0
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return bootstrapForCalendar
    if (request.action === 'listCategories') return categoryManagementForCalendar
    if (request.action === 'deleteEntry') return null
    if (request.action === 'getEntriesForRange' && request.from === request.to) {
      dateAttempts += 1
      return dateAttempts === 1
        ? [{ date, entries: [entry] }]
        : refreshedDate.promise
    }
    if (request.action === 'getEntriesForRange') {
      monthAttempts += 1
      return monthAttempts === 1
        ? [{ date, entries: [entry] }]
        : refreshedMonth.promise
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  const user = renderCalendarApp(run)
  await screen.findByText('兩層捲動記事')

  Object.defineProperty(window, 'scrollY', { value: 420, writable: true, configurable: true })
  await user.click(screen.getByRole('button', { name: new RegExp(`^${date}，共 1 則記事`) }))
  Object.defineProperty(window, 'scrollY', { value: 175, writable: true, configurable: true })
  await user.click(await screen.findByRole('button', { name: '閱讀記事：兩層捲動記事' }))
  scrollToSpy.mockClear()

  await user.click(screen.getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '永久刪除' }))
  await waitFor(() => {
    expect(dateAttempts).toBe(2)
    expect(monthAttempts).toBe(2)
  })
  expect(screen.getByText('查詢中...')).toBeInTheDocument()
  expect(screen.queryByText('兩層捲動記事')).not.toBeInTheDocument()
  expect(scrollToSpy).not.toHaveBeenCalledWith(0, 175)

  await act(async () => refreshedDate.resolve([]))
  await waitFor(() => expect(scrollToSpy).toHaveBeenCalledWith(0, 175))
  scrollToSpy.mockClear()

  await user.click(screen.getByRole('button', { name: '返回日曆' }))
  expect(scrollToSpy).not.toHaveBeenCalledWith(0, 420)
  await act(async () => refreshedMonth.resolve([]))
  await waitFor(() => expect(scrollToSpy).toHaveBeenCalledWith(0, 420))
  expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: new RegExp(`${date}.*焦點日期`) })).toBeInTheDocument()
})
```

若目的 query 以目前 key 進入 error，也視為畫面已穩定可捲動；Task 12 的局部錯誤測試保護 error 呈現，本案例聚焦 mutation 後的 loading → ready 順序。

- [ ] **Step 3：執行深入流程測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/App.test.tsx`

Expected: FAIL；App 尚未把 editor `initialDate`、月格焦點或兩層返回完整串接，既有立即還原 effect 也會在 deferred query 完成前捲動。

- [ ] **Step 4：以判別聯集串接 editor**

保留既有 `selectedEntry` 與 `handleOpenEntry()`；Task 6 已由 `page` 傳入正確 `returnTarget`。將所有 editor 入口固定改用：

先在 `App.tsx` module scope 加入：

```ts
type EntryEditorState =
  | { kind: 'create'; initialDate?: string }
  | { kind: 'edit'; entry: Entry }
```

在 `App` 元件內以以下 state 取代既有 `editingEntry`：

```ts
const [editorState, setEditorState] = useState<EntryEditorState>()
```

逐一將入口改為：

```tsx
// DesktopNavigation、MobileHeader、mobile FAB、主時間軸與單日清單的全域新增
onCreate={() => setEditorState({ kind: 'create' })}

// Timeline、日視角與詳情的編輯
onEdit={(entry) => setEditorState({ kind: 'edit', entry })}
onEditEntry={(entry) => setEditorState({ kind: 'edit', entry })}
onEdit={() => setEditorState({ kind: 'edit', entry: selectedEntry })}

// 日、週視角的指定日期新增
onCreateEntry={(date) => setEditorState({ kind: 'create', initialDate: date })}
```

`clearWorkspaceState()` 改呼叫 `setEditorState(undefined)`；`handleSaveEntry` 成功與取消 editor 也都使用相同 setter。選取詳情分支及一般 app shell 尾端都改成：

```tsx
{editorState && renderEditor(
  editorState,
  categories,
  tagSuggestions,
  journalTimezone,
  handleSaveEntry,
  () => setEditorState(undefined),
)}
```

以完整函式取代舊 `renderEditor(entry, ...)`：

```tsx
function renderEditor(
  editorState: EntryEditorState,
  categories: Category[],
  tagSuggestions: string[],
  timezone: string,
  onSave: (input: EntryInput) => Promise<void>,
  onClose: () => void,
) {
  const entry = editorState.kind === 'edit' ? editorState.entry : undefined
  return (
    <div className="editor-overlay" role="presentation">
      <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="entry-editor-title">
        <header className="editor-modal__header">
          <div>
            <button className="icon-button" type="button" aria-label={zhTW.actions.close} onClick={onClose}>
              <Icon>close</Icon>
            </button>
            <h1 id="entry-editor-title">{entry ? zhTW.form.editTitle : zhTW.form.createTitle}</h1>
          </div>
        </header>
        <EntryForm
          entry={entry}
          initialDate={editorState.kind === 'create' ? editorState.initialDate : undefined}
          categories={categories}
          tagSuggestions={tagSuggestions}
          timezone={timezone}
          onSave={onSave}
          onCancel={onClose}
        />
      </section>
    </div>
  )
}
```

- [ ] **Step 5：保留月格單日深入與 anchor**

`handleSelectDate(date)` 開始時執行：

```ts
setCalendarAnchorDate(clampCalendarAnchorDate(calendarMode, date))
```

但不改 `calendarMode`。月格記事、更多入口及 picker 也由 `CalendarMonthView.onFocusDate` 先更新 anchor。

單日清單返回只清除 `selectedDate` 與其 query state，不能重設 mode／anchor。日曆主頁的切換器只在單日清單外顯示，符合既有深入頁結構。

- [ ] **Step 6：補 CRUD 完整流程與失敗保留介面的回歸測試**

Task 11 已先以日視角編輯／刪除測試完成 `revision` range refresh 的紅綠循環；此處以指定日期 editor 加入新增成功與失敗案例。詳情刪除後的兩套 range refresh 已由 Step 2 的 deferred 捲動測試涵蓋：

```tsx
test('日視角新增成功後保留模式與日期並重新查詢目前 range', async () => {
  let rangeCount = 0
  let didSave = false
  const saved = calendarEntry({ id: 'saved', entryDate: '2026-09-04', title: '新記事' })
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return bootstrapForCalendar
    if (request.action === 'listCategories') return categoryManagementForCalendar
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange') {
      rangeCount += 1
      return didSave ? [{ date: saved.entryDate, entries: [saved] }] : []
    }
    if (request.action === 'saveEntry') {
      didSave = true
      return saved
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const user = renderCalendarApp(run, 'day')
  await screen.findByText('這天還沒有符合條件的記事')

  await user.click(screen.getByRole('button', { name: '後一天' }))
  await screen.findByRole('heading', { name: '2026年9月4日 星期五' })
  await user.click(screen.getByRole('button', { name: '新增這天的記事' }))
  expect(screen.getByLabelText('記事日期')).toHaveValue('2026-09-04')
  await user.type(screen.getByLabelText('記事內容'), '新內容')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  expect(await screen.findByText('新記事')).toBeInTheDocument()
  expect(rangeCount).toBe(3)
  expect(screen.getByRole('button', { name: '日' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('heading', { name: '2026年9月4日 星期五' })).toBeInTheDocument()
})

test('新增失敗時保留表單與指定日期', async () => {
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return bootstrapForCalendar
    if (request.action === 'listCategories') return categoryManagementForCalendar
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange') return []
    if (request.action === 'saveEntry') throw new Error('儲存失敗')
    throw new Error(`未預期的請求：${request.action}`)
  })
  const user = renderCalendarApp(run, 'day')
  await screen.findByText('這天還沒有符合條件的記事')
  await user.click(screen.getByRole('button', { name: '後一天' }))
  await screen.findByRole('heading', { name: '2026年9月4日 星期五' })
  await user.click(await screen.findByRole('button', { name: '新增這天的記事' }))
  await user.type(screen.getByLabelText('記事內容'), '新內容')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  const dialog = screen.getByRole('dialog')
  expect(await within(dialog).findByText('儲存失敗')).toBeInTheDocument()
  expect(dialog).toContainElement(screen.getByRole('heading', { name: '新增記事' }))
  expect(within(dialog).getByLabelText('記事日期')).toHaveValue('2026-09-04')
})

```

刪除失敗由既有 `entry-card.test.tsx`／`entry-detail.test.tsx` 繼續保護確認視窗；Task 11 的日視角案例與 Step 2 的詳情刪除案例證明 revision 會刷新目前 range。編輯使用相同 `saveEntry` 路徑，Task 6 已確認原記事日期優先。

- [ ] **Step 7：讓 mutation 後刷新目前 query 並更新詳情**

`handleSaveEntry` 成功後：

```ts
setEditorState(undefined)
setSelectedEntry((current) => current?.id === saved.id ? saved : current)
```

Task 11 已用先寫的編輯／刪除測試建立 `revision` refresh；本步不新增第二套 fetch 機制。`useJournal.saveEntry/deleteEntry` 增加 `revision` 後，兩套 query key 會重查目前期間與單日清單。刪除成功時只清除被刪除的詳情 state，不做樂觀移除；畫面立即因新 key 隱藏 mutation 前資料並等待對應 range 回應，失敗則既有表單／確認視窗保留。

- [ ] **Step 8：在目的 query 就緒後還原捲動**

先在 query 衍生值旁加入：

```ts
const calendarReturnReady = calendarQuery.status !== 'idle'
  && calendarQuery.key === calendarQueryKey
  && (calendarQuery.status === 'ready' || calendarQuery.status === 'error')
const selectedDateReturnReady = selectedDateQuery.status !== 'idle'
  && selectedDateQuery.key === selectedDateQueryKey
  && (selectedDateQuery.status === 'ready' || selectedDateQuery.status === 'error')
const entryReturnReady = page === 'timeline'
  ? !isLoadingEntries
  : selectedDate ? selectedDateReturnReady : calendarReturnReady
```

以就緒條件取代既有兩個立即還原 effect：

```ts
useEffect(() => {
  if (selectedEntry || !entryReturnReady || entryReturnScrollPositionRef.current === null) return

  const targetScrollY = entryReturnScrollPositionRef.current
  entryReturnScrollPositionRef.current = null
  window.scrollTo(0, targetScrollY)
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.scrollTo(0, targetScrollY))
  }
}, [entryReturnReady, selectedEntry])

useEffect(() => {
  if (
    selectedDate
    || selectedEntry
    || !calendarReturnReady
    || dateSelectionReturnScrollPositionRef.current === null
  ) return

  const targetScrollY = dateSelectionReturnScrollPositionRef.current
  dateSelectionReturnScrollPositionRef.current = null
  window.scrollTo(0, targetScrollY)
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.scrollTo(0, targetScrollY))
  }
}, [calendarReturnReady, selectedDate, selectedEntry])
```

idle、loading 或舊 key 都不是就緒。單日清單返回月視角也等主 query 對目前 key ready／error 後還原；不得以任意 timeout 延後。

- [ ] **Step 9：執行深入流程、表單、詳情與 App 測試**

Run: `npm run test:run -- --project=frontend src/App.test.tsx src/features/entries/entry-form.test.tsx src/features/entries/entry-detail.test.tsx`

Expected: PASS，來源、日期預填、月模式保留、CRUD refresh 與兩層捲動還原皆通過。

- [ ] **Step 10：向使用者出示提交訊息並等待核准**

提交訊息：`feat: 完成日曆深入與指定日期記事流程`

- [ ] **Step 11：核准後只提交本任務檔案**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: 完成日曆深入與指定日期記事流程"
```

---

### Task 14：完成響應式樣式與無障礙細節

**Files:**
- Modify: `.gitignore`
- Modify: `src/styles/global.css:1290-1402,1517-1939,3081-3379,3396-3454`
- Modify: `src/features/entries/calendar-month-view.tsx`
- Modify: `src/features/entries/calendar-week-view.tsx`
- Modify: `src/features/entries/calendar-day-view.tsx`
- Modify: `src/features/entries/calendar-frame.test.tsx`
- Modify: `src/features/entries/calendar-month-view.test.tsx`
- Modify: `src/features/entries/calendar-week-view.test.tsx`
- Modify: `src/features/entries/calendar-day-view.test.tsx`

- [ ] **Step 1：先補控制、日期狀態與週結構的語意測試**

在各元件測試加入：

```tsx
expect(screen.getByRole('button', { name: '日' })).toHaveAttribute('aria-pressed', 'false')
expect(screen.getByRole('button', { name: '週' })).toHaveAttribute('aria-pressed', 'true')
expect(screen.getByRole('heading', { name: '2026年8月31日－9月6日' }).parentElement)
  .toHaveAttribute('aria-live', 'polite')
expect(screen.getByRole('region', { name: /9月3日.*今天.*焦點日期/ })).toHaveClass('calendar-week-day--today', 'calendar-week-day--focused')
expect(screen.getByRole('button', { name: /2026-08-04.*今天.*焦點日期/ }))
  .toHaveClass('calendar-day--today', 'calendar-day--focused')
expect(screen.getByRole('button', { name: '新增這天的記事' })).toHaveClass('calendar-day-view__create')
```

jsdom 只驗證 class 與 ARIA；實際幾何放到 Step 7 人工驗收。

- [ ] **Step 2：執行日曆元件測試並確認紅燈**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-frame.test.tsx src/features/entries/calendar-day-view.test.tsx src/features/entries/calendar-week-view.test.tsx src/features/entries/calendar-month-view.test.tsx`

Expected: FAIL；Task 8 已建立 live region，但月／週日期與日視角新增入口尚缺本任務要求的明確狀態 class。

- [ ] **Step 3：補上狀態 class 並實作共用框架與日視角樣式**

先將三處 class 改為：

```tsx
// CalendarMonthView 日期按鈕
className={`calendar-day${count ? ' calendar-day--has-entries' : ''}${cell === today ? ' calendar-day--today' : ''}${cell === anchorDate ? ' calendar-day--focused' : ''}`}

// CalendarWeekView 日期 section
className={`calendar-week-day${date === today ? ' calendar-week-day--today' : ''}${date === anchorDate ? ' calendar-week-day--focused' : ''}`}

// CalendarDayView 新增按鈕
className="button button--primary calendar-day-view__create"
```

這些 class 只反映既有 `today`、`anchorDate` 與按鈕角色，不建立新的元件 state。

在 `global.css` 以以下規則取代已刪除元件留下的 `.calendar-view`、`.calendar-view__header`、其標題／副標與 `.calendar-view__controls` 整段；保留後面的 `.calendar-grid`、月格與 picker 規則。色彩全部沿用既有 token：

```css
.calendar-frame {
  overflow: hidden;
  border: 1px solid var(--outline-variant);
  border-radius: 0.875rem;
  background: var(--surface-card);
  box-shadow: var(--shadow);
}

.calendar-frame__header {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border-bottom: 1px solid var(--outline-variant);
}

.calendar-frame__period h2 {
  margin: 0;
  font-size: clamp(1.25rem, 3vw, 1.75rem);
  letter-spacing: -0.03em;
}

.calendar-frame__period p {
  margin: 0.25rem 0 0;
  color: var(--ink-muted);
  font-size: 0.875rem;
}

.calendar-frame__mode-toggle,
.calendar-frame__navigation {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem;
  border-radius: 0.625rem;
  background: var(--surface-container);
}

.calendar-frame__mode-toggle button,
.calendar-frame__navigation button,
.search-toggle-btn,
.view-toggle button,
.calendar-day-view__create,
.calendar-week-day button,
.calendar-day,
.calendar-entry,
.calendar-entry-picker__item {
  min-height: 44px;
}

.calendar-frame__mode-toggle button {
  min-width: 0;
  flex: 1;
  padding: 0.625rem 0.875rem;
  border: 0;
  border-radius: 0.4rem;
  background: transparent;
  color: var(--ink-muted);
  font-weight: 700;
}

.calendar-frame__mode-toggle button[aria-pressed="true"] {
  background: var(--surface-card);
  color: var(--primary);
  box-shadow: 0 1px 3px rgb(15 23 42 / 12%);
}

.calendar-frame__navigation {
  justify-content: space-between;
}

.calendar-frame__content {
  min-height: 12rem;
}

.calendar-frame__content > .loading-note,
.calendar-frame__error {
  margin: 0;
  padding: 2rem 1rem;
  text-align: center;
}

.calendar-frame__header button:focus-visible,
.calendar-grid button:focus-visible,
.calendar-week-day button:focus-visible {
  outline: 0;
  box-shadow: inset 0 0 0 3px rgb(0 74 198 / 32%);
}

.calendar-frame__error p {
  margin: 0 0 1rem;
  color: var(--error);
}

.calendar-day-view {
  display: grid;
  gap: 1rem;
  padding: 1rem;
}

.calendar-day-view__entries {
  display: grid;
  gap: 0.875rem;
  width: min(100%, 64rem);
  margin: 0 auto;
}

.calendar-day-view__status {
  display: flex;
  gap: 0.5rem;
  width: min(100%, 64rem);
  margin: 0 auto;
  color: var(--primary);
  font-weight: 700;
}

.calendar-day-view__empty {
  margin: 2rem 0;
  color: var(--ink-muted);
  text-align: center;
}

.calendar-day-view__create {
  justify-self: center;
}
```

- [ ] **Step 4：限縮時間軸專屬 `EntryCard` 規則**

把 768px 以上的：

```css
.entry-card__time
.entry-card__dot
.entry-card__actions
.entry-card__body:hover .entry-card__actions
.entry-card__actions:focus-within
```

分別改成：

```css
.timeline .entry-card__time
.timeline .entry-card__dot
.timeline .entry-card__actions
.timeline .entry-card__body:hover .entry-card__actions
.timeline .entry-card__actions:focus-within
```

將原本位於 768px block 的 opacity／hover 規則移到獨立條件；定位規則仍留在 768px block：

```css
@media (min-width: 768px) and (hover: hover) and (pointer: fine) {
  .timeline .entry-card__actions {
    opacity: 0;
    transition: opacity 160ms ease;
  }

  .timeline .entry-card__body:hover .entry-card__actions,
  .timeline .entry-card__actions:focus-within {
    opacity: 1;
  }
}
```

觸控裝置與日視角因不符合 selector 而保持操作可見。

- [ ] **Step 5：實作週視角 mobile-first 與月視角狀態**

加入：

```css
.calendar-week-view {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
}

.calendar-week-day {
  display: grid;
  overflow: hidden;
  min-width: 0;
  border: 1px solid var(--outline-variant);
  border-radius: 0.75rem;
  background: var(--surface-card);
}

.calendar-week-day__header {
  margin: 0;
  border-bottom: 1px solid var(--outline-variant);
}

.calendar-week-day__header button {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.5rem;
  padding: 0.75rem;
  border: 0;
  background: var(--surface-low);
  color: var(--ink);
  text-align: left;
}

.calendar-week-day__header span:first-child {
  font-weight: 800;
}

.calendar-week-day__header span:nth-child(n + 3) {
  color: var(--ink-muted);
  font-size: 0.75rem;
}

.calendar-week-day--today {
  border-color: var(--primary);
}

.calendar-week-day--focused {
  box-shadow: inset 0 0 0 2px rgb(0 74 198 / 18%);
}

.calendar-week-day__entries {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
}

.calendar-week-day__entries > p {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.week-entry-card,
.week-entry-card__read,
.week-entry-card__title,
.week-entry-card__summary,
.calendar-week-day__header {
  min-width: 0;
}

.week-entry-card__read {
  display: grid;
  width: 100%;
  gap: 0.375rem;
  padding: 0.625rem;
  border: 1px solid var(--outline-variant);
  border-radius: 0.5rem;
  background: var(--surface-card);
  color: var(--ink);
  text-align: left;
}

.week-entry-card__read:hover,
.week-entry-card__read:focus-visible {
  border-color: var(--primary);
  background: var(--surface-low);
}

.week-entry-card__title,
.week-entry-card__summary {
  display: block;
}

.week-entry-card__title {
  overflow-wrap: anywhere;
  font-size: 0.875rem;
  line-height: 1.4;
}

.week-entry-card__summary {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ink-muted);
  font-size: 0.8125rem;
  line-height: 1.5;
  white-space: pre-line;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.week-entry-card__tags {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.week-entry-card .category-badge,
.week-entry-card .tag-chip {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-week-day__expand,
.calendar-week-day__create {
  display: inline-flex;
  width: calc(100% - 1.5rem);
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  margin: 0 0.75rem 0.75rem;
  padding: 0.5rem;
  border: 1px solid var(--outline-variant);
  border-radius: 0.5rem;
  background: var(--surface-low);
  color: var(--primary);
  font-weight: 700;
}

.calendar-week-day__expand:hover,
.calendar-week-day__create:hover {
  border-color: var(--primary);
  background: var(--primary-fixed);
}

.calendar-day--today {
  font-weight: 800;
  text-decoration: underline;
  text-decoration-thickness: 2px;
}

.calendar-day--focused {
  box-shadow: inset 0 0 0 2px var(--primary);
}
```

保留月格固定七欄與兩則記事 chip；所有可點的月格記事與「更多」按鈕以 44px 高度堆疊，日期格高度自然增加，不為了維持舊高度縮小觸控目標。移除既有 `.calendar-view__controls` 的 36px 覆寫，新框架控制維持 44px。上述 focus-visible inset box-shadow 避免 `overflow: hidden` 裁掉月格與週欄焦點環，不增加頁面水平溢位。

- [ ] **Step 6：在 1024px 建立七欄並保護臨界寬度**

在既有 `@media (min-width: 1024px)` 加入：

```css
.calendar-frame__header {
  grid-template-columns: minmax(14rem, 1fr) auto auto;
  align-items: center;
}

.calendar-week-view {
  grid-template-columns: repeat(7, minmax(0, 1fr));
  align-items: start;
  gap: 1px;
  padding: 0;
  background: var(--outline-variant);
}

.calendar-week-day {
  border: 0;
  border-radius: 0;
}

.calendar-week-day__header button,
.calendar-week-day__entries,
.week-entry-card__read {
  padding: 0.5rem;
}

.calendar-week-day__create span:last-child {
  display: none;
}

.calendar-week-day__expand,
.calendar-week-day__create {
  width: calc(100% - 1rem);
  margin: 0 0.5rem 0.5rem;
}

.app-main:has(.calendar-frame) {
  padding-inline: 1.5rem;
}
```

在 1023px 以下 header 依 DOM 順序換行；mode toggle 三等分填滿。精確 1024px 每欄約 100px，週欄採上述緊湊 padding；新增按鈕只隱藏可見文字，元件既有 `aria-label` 仍提供完整名稱並保有 44px 觸控範圍。

- [ ] **Step 7：執行元件與完整前端測試**

Run: `npm run test:run -- --project=frontend src/features/entries/calendar-frame.test.tsx src/features/entries/calendar-day-view.test.tsx src/features/entries/calendar-week-view.test.tsx src/features/entries/calendar-month-view.test.tsx src/features/entries/week-entry-card.test.tsx src/features/entries/entry-card.test.tsx src/features/entries/timeline.test.tsx src/App.test.tsx`

Expected: PASS，ARIA、class 契約及既有卡片行為無回歸。

- [ ] **Step 8：執行 lint 與前端建置**

Run: `npm run lint`

Expected: PASS，沒有 CSS 以外的 lint 錯誤。

Run: `npm run build`

Expected: PASS，production CSS 與所有 TypeScript 元件可編譯。

- [ ] **Step 9：人工驗收關鍵寬度與鍵盤操作**

`npm run dev` 只啟動 Vite，專案沒有 `/api` proxy，不能用來做登入後日曆驗收。優先開啟已設定完整 serverless API、隔離 Firestore／Google OAuth 與無真實日記測試帳號的 Preview deployment。

先在 `.gitignore` 的 local deployment 區加入 `.vercel/`，避免任何 Vercel 專案連結資訊進入版本控制；既有 `.env.*` 規則已涵蓋 `.env.local`。

若開發機已具備同等隔離的 Vercel Development 環境、開發用 OAuth callback 及 `.env.local`，可改在專案根目錄執行官方完整堆疊命令：

Run: `vercel dev --listen 127.0.0.1:3000`

Expected: `http://127.0.0.1:3000` 可完成測試帳號登入，Vite 前端與 `/api/*` functions 都由 Vercel CLI 提供。不得下載 Production env、使用 Production OAuth client 或真實日記資料；若缺少上述條件就使用 Preview，不以 mock 畫面取代整合驗收。

使用瀏覽器 DevTools 依序檢查 375、767、768、1023、1024、1280、1440px：

- 375 至 1023px 週視角是週一到週日七個直向區段，無頁面水平溢位。
- 768px 固定側欄出現後，日曆標題、三段切換器與導覽按 DOM 順序換行。
- 精確 1024px 週視角切為七欄；標題、摘要、兩個標籤與 44px 新增入口不超出欄界。
- 1024px 以上切換器位於期間標題與期間導覽之間。
- 月視角仍是七欄，每格兩則與更多記事 picker 可用。
- 今天與焦點日期可同時辨識，且不只靠顏色。
- Tab、Enter、Space 可操作模式、期間、記事、展開／收合、新增與返回；切模式後焦點留在按鈕。
- 200% 文字縮放下重測 768 與 1024px，長期間／記事標題不遮住控制。

停止 dev server 或完成 Preview 驗收後再繼續，並確認沒有產生要提交的 `.env*`、`.vercel/` 或驗收資料。

- [ ] **Step 10：向使用者出示提交訊息並等待核准**

提交訊息：`style: 完成日曆日週月響應式版面`

- [ ] **Step 11：核准後只提交本任務檔案**

```bash
git add .gitignore src/styles/global.css src/features/entries/calendar-month-view.tsx src/features/entries/calendar-week-view.tsx src/features/entries/calendar-day-view.tsx src/features/entries/calendar-frame.test.tsx src/features/entries/calendar-month-view.test.tsx src/features/entries/calendar-week-view.test.tsx src/features/entries/calendar-day-view.test.tsx
git commit -m "style: 完成日曆日週月響應式版面"
```

---

### Task 15：更新驗收文件並執行完整品質檢查

**Files:**
- Modify: `docs/acceptance-checklist.md:5-51`
- Modify: `README.md:5-10,33-42`
- Modify: `docs/deployment.md:268`

- [ ] **Step 1：更新響應式與無障礙驗收**

將 `docs/acceptance-checklist.md:7-10` 既有前三個尺寸項目與第四個舊「月曆日期」鍵盤項目整段取代為：

```md
- [ ] 375px：登入、資料空間設定、時間軸、底部導覽與浮動新增按鈕可用；日曆期間標題、計數、日／週／月切換與期間導覽依序換行，週視角為七個直向日期區段，沒有頁面水平溢位。
- [ ] 768px 至 1023px：固定側欄、Sheet 設定與表單對話框可用；週視角仍是七個直向日期區段，摘要、標籤及新增按鈕沒有裁切。
- [ ] 1024px 以上：時間軸、懸停操作與資料空間設定排版正確；週一至週日依 DOM 順序呈現七欄，欄位頂端對齊，單欄展開不拉高其他欄，切換器位於期間標題與期間導覽之間。
- [ ] 可用鍵盤 Tab 到達登入、隱私權政策、服務條款、所有表單欄位，以及所有模式、期間、記事、展開／收合、指定日期新增、返回與對話框操作；觸控目標至少 44px。
- [ ] 日／週／月具正確 `aria-pressed`，週展開具正確 `aria-expanded`／`aria-controls`，模式切換後焦點留在原按鈕。
- [ ] 今日、焦點日期與目前模式除顏色外另有文字、外框或 ARIA 狀態；期間標題以 polite live region 公告而不搶焦點。
- [ ] 200% 文字縮放、跨年週標題與長記事標題不遮住導覽控制。
```

- [ ] **Step 2：更新隔離、記事與日曆驗收**

在登入／隔離段加入：

```md
- [ ] 登出、重新登入或更換資料空間後，舊日曆區間與單日請求不得寫回；焦點日期使用新資料空間的記事時區今天，日／週／月模式偏好仍保留。
```

將「查詢、月曆與匯出」改為「查詢、日曆與匯出」，並以具體項目取代過時的月份計數描述：

```md
- [ ] 關鍵字、日期區間、分類與標籤的交集一致套用到日、週、月內容與期間計數。
- [ ] 無效或不可讀模式偏好回退月視角；有效模式跨重新整理保留，但從其他主頁進入日曆時焦點回到記事時區今天。
- [ ] 日／週／月切換保留焦點日期；箭頭移動一天、七天或一個月，月底鉗制與「今天」正確。
- [ ] 日視角完整卡及週視角精簡卡內容正確；日與週新增預填指定日期，全域新增仍預填今天。
- [ ] 週一至週日每天先顯示三則，第四則起可展開／收合，切模式、期間或篩選時重設。
- [ ] 月視角維持每格兩則與 picker；空白日期不可進單日清單，點記事直接進詳情，有記事日期仍開獨立單日清單。
- [ ] 日、週、月分別送出一天、七天與當月範圍的單一 `getEntriesForRange`；跨月／跨年週不拆請求。
- [ ] 新期間載入時不顯示舊資料；錯誤保留目前控制，重新載入只重送目前期間。
- [ ] 時間軸詳情顯示「返回時間軸」；任一日曆來源顯示「返回日曆」，深入並返回可還原模式、焦點與捲動位置。
```

把記事與分類段的「月曆計數」改成「日曆三種視角與期間計數」。

- [ ] **Step 3：更新目前功能文件的名稱**

把 `README.md` 目前功能描述的「月曆」改為「日／週／月日曆」。同時更正本機開發段落：Node/npm 先決條件補上 Vercel CLI，`npm run dev` 明確標示為只啟動無 `/api` proxy 的 Vite 前端；需要登入及 serverless API 的完整本機流程改用 `vercel dev --listen 127.0.0.1:3000`，把 server-only 本機設定檔明列為未追蹤的 `.env.local`，並重申只能使用隔離的 Development env 與測試帳號。

把 `docs/deployment.md` 目前部署隔離驗收中的「月曆」改為「日曆」。不修改 `docs/superpowers/specs/` 或 `plans/` 內的歷史文件。

- [ ] **Step 4：執行文件與程式碼差異檢查**

Run: `git diff --check`

Expected: PASS，沒有尾端空白或衝突標記。

- [ ] **Step 5：執行完整自動化品質檢查**

Run: `npm run check`

Expected: PASS；`lint`、frontend/server 全部 Vitest、Vite build 與 GAS build 均為 0 failures。

- [ ] **Step 6：執行最終 Git 範圍檢查**

Run: `git status --short`

Expected: 本任務未提交範圍只有三份文件；既有未追蹤的 `opencode.json` 或其他工作者變更可同時存在，但不得納入後續 stage，也不得有其他本功能檔案遺漏未提交。

Run: `git diff --stat -- docs/acceptance-checklist.md README.md docs/deployment.md`

Expected: 只顯示 `docs/acceptance-checklist.md`、`README.md` 與 `docs/deployment.md`。

- [ ] **Step 7：向使用者出示提交訊息並等待核准**

提交訊息：`docs: 更新日曆日週月視角驗收文件`

- [ ] **Step 8：核准後只提交本任務檔案**

```bash
git add docs/acceptance-checklist.md README.md docs/deployment.md
git commit -m "docs: 更新日曆日週月視角驗收文件"
```

- [ ] **Step 9：提交後重新驗證完整分支**

Run: `npm run check`

Expected: PASS；以提交後工作樹再次取得 0 failures 的新鮮證據。

Run: `git status --short --branch`

Expected: 分支相對遠端包含本功能 commits；`opencode.json` 仍未追蹤，沒有本功能未提交檔案，其他工作者原有變更保持原狀。

---

## 最終需求對照

- 區間 API、42 天上限、篩選交集與舊 action 相容：Tasks 1 至 3。
- 純 UTC 日期、週一到週日、跨月／跨年、月底鉗制與互動焦點年界：Tasks 4、8、11。
- 最後模式保存、無效偏好與 storage 例外：Task 5。
- 指定日期 draft 與詳情來源文字：Task 6。
- 既有月格、兩則上限、picker、今天與焦點：Task 7。
- 紅框位置共用切換器、期間標題／計數、44px 控制、載入／錯誤／重試：Tasks 8、11、14。
- 日視角完整卡與空白新增：Task 9。
- 週精簡卡、每日三則、展開／收合、手機／平板直向與桌面七欄：Tasks 10、14。
- `mode + anchorDate`、主頁進入重設、range request 與計數：Task 11。
- 日曆不背景刷新時間軸清單、返回時間軸才依目前 filter 載入：Task 11。
- request ID、query key、workspace epoch、局部錯誤與兩套查詢隔離：Task 12。
- 月格單日深入、CRUD refresh 與兩層捲動還原：Task 13。
- 響應式、無障礙、精確 1024px 與 200% 文字縮放：Task 14。
- 文件、完整 `npm run check` 與提交後驗證：Task 15。
