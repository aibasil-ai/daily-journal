# 多使用者專屬 Google Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將目前的單一 GAS 日記改為可公開提供多位 Google 使用者登入的服務，每位使用者只透過本站伺服器存取自己擁有的 Google Sheet。

**Architecture:** Vercel Functions 將以 Cloud Firestore 保存最少必要的使用者、加密 refresh token、Sheet 連線、短效流程與不透明 session 資料，並以 Firestore transaction 管理唯一 Sheet 綁定與換表競態。記事領域規則會抽成可由 GAS 與 Node 共用的純 TypeScript 核心；公開 `/api/journal` 則以已驗證的使用者 OAuth 憑證直接呼叫 Google Sheets API，不再經過 GAS Execution API。

**Tech Stack:** React 19、TypeScript 5.9、Vite 8、Vitest 4、Vercel Functions、Node.js `crypto`、`jose`、`@google-cloud/firestore`、Google OAuth 2.0、Google Drive API、Google Sheets API、Cloud Firestore Native mode。

**Spec:** `docs/superpowers/specs/2026-08-19-multi-user-google-sheets-design.md`

## Global Constraints

- 維持 Node.js `>=20.19.0`、嚴格 TypeScript、React、Vite、Vitest 與現有同網域 `/api` 架構。
- 新增的使用者文案必須集中在 `src/i18n/zh-TW.ts`，所有介面維持繁體中文。
- 瀏覽器不得取得、儲存或記錄 Google access token、refresh token、Firestore 服務帳號憑證、Sheet ID 或任意其他使用者的資料。
- Cookie 僅保存以 `SESSION_ENCRYPTION_KEY` 保護的不透明本站 session ID，並使用 `HttpOnly; Secure; SameSite=Lax; Path=/` 與明確效期。
- refresh token 寫入 Firestore 前必須使用獨立的 `TOKEN_ENCRYPTION_KEY` 以 AES-256-GCM 加密，並保存 `TOKEN_ENCRYPTION_KEY_VERSION`；access token 只存在單次 Function 請求記憶體。
- Firestore 必須為 Native mode，僅由 Vercel 的最小權限服務帳號讀寫；前端不得使用 Firebase 或 Firestore SDK。
- Google OAuth 必須採 Authorization Code Flow、PKCE、伺服器端 `state`、ID token 簽章與 `iss`、`aud`、`exp`、`sub` 驗證；使用固定 `APP_ORIGIN` 建立 callback URL。
- OAuth scope 固定包含 `openid`、`email`、`profile`、`spreadsheets`、`drive.metadata.readonly` 與 `drive.file`；`drive.file` 只可刪除系統建立的 Sheet。
- 只有伺服器依有效 session 取得的作用中連線能決定日記資料來源；一般日記 payload 不得接受 `userId`、`googleSub`、`spreadsheetId` 或 token。
- 使用者自行連結的 Sheet 永遠不得由帳號刪除流程刪除；只有系統建立的作用中 Sheet 可在明確二次確認後刪除。
- 每次 Sheet 讀寫前都必須驗證 `entries`、`categories`、`settings` 的欄位和 schema version；格式不符時不得覆寫資料。
- Google Sheets 寫入必須使用批次請求；同一作用中 Sheet 的本站寫入必須由 Firestore 租約鎖串行。
- Production 與 Preview 必須使用不同的 Firestore、OAuth 設定與加密金鑰，或完全停用 Preview 的真實 Google 連線。
- `gas/` 可保留為受限內部工具，但不得再成為公開使用者資料路徑。
- 每項工作都先寫失敗測試、確認失敗、最小實作、確認通過，再請使用者核可繁體中文 commit 訊息後才提交。
- 日誌、錯誤回應、測試 fixture 與分析事件不得包含 token、session Cookie、日記內容或完整 Sheet ID。

---

## 檔案結構與責任分配

| 檔案或目錄 | 變更 | 責任 |
| --- | --- | --- |
| `shared/journal/` | 建立 | 純領域型別、驗證、服務、請求分派與記憶體 store，供 GAS 與 Vercel 共用。 |
| `api/_lib/server-config.ts` | 修改 | 驗證 OAuth、Firestore、兩組加密金鑰、固定 origin 與受保護管理端點設定。 |
| `api/_lib/firestore.ts` | 建立 | 以服務帳號建立且快取 Firestore server client。 |
| `api/_lib/token-crypto.ts` | 建立 | 加密、解密與金鑰版本化 refresh token。 |
| `api/_lib/session-store.ts`、`connection-store.ts`、`rate-limit.ts` | 建立 | Firestore session、使用者、連線、唯一 Sheet claim、租約鎖與速率限制。 |
| `api/_lib/google-oauth.ts`、`oidc.ts` | 修改／建立 | PKCE、OAuth code 交換、refresh、ID token 驗證與安全錯誤分類。 |
| `api/_lib/google-drive.ts`、`google-sheets.ts`、`sheets-journal-store.ts` | 建立 | Drive 候選清單與所有權驗證、Sheets schema／初始化、直接日記讀寫。 |
| `api/_lib/provisioning-service.ts` | 建立 | 首次設定、換表、選擇代碼、確認、連線中斷與帳號刪除的伺服器規則。 |
| `api/auth/`、`api/session.ts`、`api/journal.ts` | 修改 | OAuth、本站 session 和直接 Google Sheets 日記 API。 |
| `api/provisioning/`、`api/account/`、`api/internal/` | 建立 | 資料空間設定、帳號生命週期、過期資料清理與一次性舊 Sheet 遷移 routes。 |
| `src/services/journal-api-client.ts` | 修改 | 解析本站原生 `ApiResponse`、session 狀態與資料空間設定 API。 |
| `src/features/provisioning/`、`src/features/settings/` | 建立 | 首次資料空間設定、換表、連線狀態、中斷連線和帳號刪除 UI。 |
| `src/features/journal/use-journal.ts`、`src/App.tsx` | 修改 | 區分未登入、設定中、連線修復與可讀寫日記，並在帳號或 Sheet 改變時立即清空舊資料。 |
| `.env.example`、`vercel.json`、`README.md`、`docs/` | 修改／建立 | Firestore／OAuth／Vercel 設定、隱私政策、服務條款、遷移與人工驗收。 |

### Task 1: 多使用者伺服器設定與 Firestore 用戶端

**Files:**
- Modify: `package.json:6-40`
- Modify: `package-lock.json`
- Modify: `api/_lib/server-config.ts:1-35`
- Modify: `api/_lib/_server-config.test.ts:1-30`
- Create: `api/_lib/firestore.ts`
- Create: `api/_lib/_firestore.test.ts`
- Modify: `.env.example:1-11`
- Modify: `scripts/config-files.test.ts:1-38`
- Modify: `tsconfig.app.json:1-25`
- Modify: `tsconfig.api.json:1-20`
- Modify: `tsconfig.gas.json:1-19`
- Modify: `vitest.config.ts:1-28`

**Interfaces:**
- Produces `ServerConfig`，包含 `googleClientId`、`googleClientSecret`、`appOrigin`、`sessionEncryptionKey`、`tokenEncryptionKey`、`tokenEncryptionKeyVersion`、`firestoreProjectId`、`firestoreCredentials`、`legacyMigrationSecret` 與 `cronSecret`。
- Produces `getServerConfig(env?: NodeJS.ProcessEnv): ServerConfig`、`createFirestoreClient(config: ServerConfig): Firestore` 和 `getFirestoreClient(): Firestore`。
- Adds runtime dependencies `@google-cloud/firestore` and `jose` without exposing either package to the Vite bundle.

- [ ] **Step 1: 寫入 server config、Firestore 建立與環境範例的失敗測試。**

  將 `api/_lib/_server-config.test.ts` 的完整環境改為下列形狀，並新增無效 JSON、不同專案 ID、無效 token key、非 HTTPS `APP_ORIGIN` 和缺少管理密鑰的案例：

  ```ts
  const firestoreServiceAccount = JSON.stringify({
    project_id: 'journal-production',
    client_email: 'journal-api@journal-production.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n',
  })

  expect(getServerConfig({
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    APP_ORIGIN: 'https://journal.example',
    SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url'),
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64url'),
    TOKEN_ENCRYPTION_KEY_VERSION: 'v1',
    FIRESTORE_PROJECT_ID: 'journal-production',
    FIRESTORE_SERVICE_ACCOUNT_JSON: firestoreServiceAccount,
    LEGACY_MIGRATION_SECRET: 'm'.repeat(32),
    CRON_SECRET: 'c'.repeat(32),
  })).toMatchObject({
    appOrigin: 'https://journal.example',
    tokenEncryptionKeyVersion: 'v1',
    firestoreProjectId: 'journal-production',
  })
  ```

  在 `_firestore.test.ts` 注入 Firestore 建構子 factory，斷言 `projectId`、`client_email` 與 `private_key` 只會傳給 server client，且不會從模組匯出憑證。

  將 `scripts/config-files.test.ts` 的 `.env.example` 預期鍵改為完整且固定的 10 個 server-only key：

  ```ts
  expect(keys).toEqual([
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APP_ORIGIN',
    'SESSION_ENCRYPTION_KEY', 'TOKEN_ENCRYPTION_KEY', 'TOKEN_ENCRYPTION_KEY_VERSION',
    'FIRESTORE_PROJECT_ID', 'FIRESTORE_SERVICE_ACCOUNT_JSON',
    'LEGACY_MIGRATION_SECRET', 'CRON_SECRET',
  ])
  ```

- [ ] **Step 2: 執行設定測試，確認新設定尚未存在。**

  Run: `npm run test:run -- api/_lib/_server-config.test.ts api/_lib/_firestore.test.ts scripts/config-files.test.ts`

  Expected: FAIL，因 Firestore 設定、`createFirestoreClient()` 與新的環境變數尚未定義。

- [ ] **Step 3: 加入依賴、設定驗證和 Firestore factory。**

  執行 `npm install @google-cloud/firestore jose`。將 `GAS_DEPLOYMENT_ID` 自 `ServerConfig`、`.env.example` 和設定測試中移除；它不再是公開資料流設定。

  `getServerConfig()` 必須以同一個 32-byte base64url 驗證器驗證兩把金鑰、要求 `TOKEN_ENCRYPTION_KEY_VERSION` 為非空 ASCII 識別碼、解析服務帳號 JSON 並要求 `project_id`、`client_email`、`private_key`，且 `project_id === FIRESTORE_PROJECT_ID`。`APP_ORIGIN` 必須是沒有 query、hash 或 path 的 HTTPS origin。

  建立下列 server-only factory；只在 `getFirestoreClient()` 以 module-level private 變數快取 Firestore 實例，讓測試可直接呼叫未快取的 `createFirestoreClient()`：

  ```ts
  import { Firestore } from '@google-cloud/firestore'

  export function createFirestoreClient(config: ServerConfig): Firestore {
    return new Firestore({
      projectId: config.firestoreProjectId,
      credentials: {
        client_email: config.firestoreCredentials.clientEmail,
        private_key: config.firestoreCredentials.privateKey,
      },
    })
  }

  let firestoreClient: Firestore | undefined

  export function getFirestoreClient(): Firestore {
    return firestoreClient ??= createFirestoreClient(getServerConfig())
  }
  ```

  將三份 TypeScript 設定的 `include` 加入 `shared`，將 server Vitest include 加入 `shared/**/*.test.ts`，讓之後的共用領域核心可被 Vite、Node 和 GAS 同時型別檢查。

- [ ] **Step 4: 執行設定與型別檢查。**

  Run: `npm run test:run -- api/_lib/_server-config.test.ts api/_lib/_firestore.test.ts scripts/config-files.test.ts`

  Expected: PASS，且缺少或格式錯誤的 secret、服務帳號或 origin 都被拒絕。

- [ ] **Step 5: 取得核可後提交設定基礎。**

  先請使用者核可訊息 `建立多使用者伺服器設定`，再執行：

  ```bash
  git add package.json package-lock.json api/_lib/server-config.ts api/_lib/_server-config.test.ts api/_lib/firestore.ts api/_lib/_firestore.test.ts .env.example scripts/config-files.test.ts tsconfig.app.json tsconfig.api.json tsconfig.gas.json vitest.config.ts
  git commit -m "建立多使用者伺服器設定"
  ```

### Task 2: 抽出共用記事領域核心

**Files:**
- Create: `shared/journal/types.ts`
- Create: `shared/journal/errors.ts`
- Create: `shared/journal/validation.ts`
- Create: `shared/journal/store.ts`
- Create: `shared/journal/in-memory-store.ts`
- Create: `shared/journal/service.ts`
- Create: `shared/journal/dispatcher.ts`
- Create: `shared/journal/service.test.ts`
- Create: `shared/journal/dispatcher.test.ts`
- Modify: `gas/src/domain/journal.ts:1-107`
- Modify: `gas/src/domain/errors.ts:1-24`
- Modify: `gas/src/domain/validation.ts:1-204`
- Modify: `gas/src/repositories/journal-store.ts:1-15`
- Modify: `gas/src/services/journal-service.ts:1-376`
- Modify: `gas/src/api/dispatcher.ts:1-160`
- Modify: `gas/src/test/fake-journal-store.ts:1-91`
- Modify: `src/domain/journal.ts:1-126`
- Modify: imports in `gas/src/setup.ts`, `gas/src/index.ts`, `gas/src/repositories/apps-script-journal-store.ts` and their tests

**Interfaces:**
- Produces `JournalStore`, `InMemoryJournalStore`, `JournalService`, `executeJournalRequest(request, service)`、`isJournalMutation(request)`、`JournalError` 和所有既有 `ApiRequest`／`ApiResponse` 型別。
- Preserves every existing CRUD、分類、搬移、搜尋、月曆和 CSV 回應形狀。
- Keeps GAS compatibility through thin wrappers; `gas/src/index.ts` continues to export `executeAppRequest()` and `initializeJournal()`.

- [ ] **Step 1: 將現有純領域測試移至 `shared`，並加入 API 契約回歸測試。**

  將 `gas/src/services/journal-service.test.ts` 的 service 測試移至 `shared/journal/service.test.ts`，將 dispatcher 測試移至 `shared/journal/dispatcher.test.ts`。新增一個只依賴共用 API 的測試，固定現有行為：

  ```ts
  const store = new InMemoryJournalStore({
    timezone: 'Asia/Taipei',
    categories: [category({ id: 'work' })],
    entries: [entry({ id: 'one', categoryId: 'work' })],
  })
  const service = new JournalService(store, () => timestamp, () => 'uuid-1')

  expect(executeJournalRequest({ action: 'listEntries', filter: DEFAULT_FILTER }, service))
    .toEqual({ ok: true, data: { items: [expect.objectContaining({ id: 'one' })], nextCursor: null } })
  ```

  保留 GAS 的 wrapper 測試，確保 `executeAppRequest()` 仍可將 service 例外轉為既有安全的 `{ ok: false, code, message }`。

- [ ] **Step 2: 執行共用核心測試，確認模組尚未存在。**

  Run: `npm run test:run -- shared/journal/service.test.ts shared/journal/dispatcher.test.ts gas/src/setup.test.ts`

  Expected: FAIL，因 `shared/journal/*` 尚不存在且 GAS 尚未改用共用核心。

- [ ] **Step 3: 移動同步領域規則，不改變商業行為。**

  將目前純 TypeScript 的型別、驗證、`JournalService`、CSV 欄位、`JournalStore` 和 dispatcher 移至 `shared/journal/`。`InMemoryJournalStore` 必須深複製記事的 `tags`、`links` 與分類，並提供 `snapshot()` 給 Vercel 的 Sheets adapter 比較資料列變化。

  共用 dispatcher 必須完整保留目前所有 action，並在未知例外時只回傳安全的泛用中文訊息，不呼叫 `console.error` 輸出可能含日記內容的物件：

  ```ts
  export function executeJournalRequest(
    request: unknown,
    service: JournalService,
  ): ApiResponse<unknown> {
    if (!isRequest(request)) return invalidRequestResponse()
    try {
      switch (request.action) {
        case 'bootstrap': return { ok: true, data: service.bootstrap() }
        case 'listCategories': return { ok: true, data: service.listCategories() }
        case 'listEntries': return { ok: true, data: service.listEntries(parseEntryFilter(request.filter)) }
        case 'getEntriesForDate': return { ok: true, data: service.getEntriesForDate(readString(request, 'date'), parseEntryFilterCriteria(request.filter)) }
        case 'getMonthlyEntryCounts': return { ok: true, data: service.getMonthlyEntryCounts(readNumber(request, 'year'), readNumber(request, 'month'), parseEntryFilterCriteria(request.filter)) }
        case 'getMonthlyEntries': return { ok: true, data: service.getMonthlyEntries(readNumber(request, 'year'), readNumber(request, 'month'), parseEntryFilterCriteria(request.filter)) }
        case 'saveEntry': return { ok: true, data: service.saveEntry(parseEntryInput(request.entry)) }
        case 'deleteEntry': service.deleteEntry(readString(request, 'id')); return { ok: true, data: null }
        case 'saveCategory': return { ok: true, data: service.saveCategory(parseCategoryInput(request.category)) }
        case 'deactivateCategory': return { ok: true, data: service.deactivateCategory(readString(request, 'id')) }
        case 'activateCategory': return { ok: true, data: service.activateCategory(readString(request, 'id')) }
        case 'moveEntries': return { ok: true, data: service.moveEntries(parseMoveEntriesInput(request)) }
        case 'deleteCategory': service.deleteCategory(readString(request, 'id')); return { ok: true, data: null }
        case 'exportEntries': return { ok: true, data: service.exportEntries(parseEntryFilterCriteria(request.filter)) }
        default: return invalidActionResponse()
      }
    } catch (error) {
      return toApiError(error)
    }
  }
  ```

  將 `gas/src/domain/*`、`gas/src/repositories/journal-store.ts`、`gas/src/services/journal-service.ts` 改為 re-export wrapper，保留既有 GAS import 路徑。`gas/src/api/dispatcher.ts` 只負責注入 `createJournalService()` 後呼叫 `executeJournalRequest()`。`src/domain/journal.ts` 從 `shared/journal/types` re-export 型別，並保留只有前端需要的 `DEFAULT_ENTRY_FILTER` 和 `toFilterCriteria()`。

- [ ] **Step 4: 驗證共用核心、GAS 與前端型別仍一致。**

  Run: `npm run test:run -- shared/journal/service.test.ts shared/journal/dispatcher.test.ts gas/src/setup.test.ts gas/src/api/dispatcher.test.ts src/domain/validation.test.ts`

  Run: `npm run build:gas`

  Expected: PASS，既有 Apps Script bundle 仍提供相同的內部工具入口，且沒有重複的領域型別定義。

- [ ] **Step 5: 取得核可後提交共用領域核心。**

  先請使用者核可訊息 `抽出共用記事領域核心`，再執行：

  ```bash
  git add shared gas/src src/domain/journal.ts tsconfig.app.json tsconfig.api.json tsconfig.gas.json vitest.config.ts
  git commit -m "抽出共用記事領域核心"
  ```

### Task 3: Firestore token、session、連線與鎖定儲存

**Files:**
- Create: `api/_lib/token-crypto.ts`
- Create: `api/_lib/session-store.ts`
- Create: `api/_lib/connection-store.ts`
- Create: `api/_lib/rate-limit.ts`
- Create: `api/_lib/_token-crypto.test.ts`
- Create: `api/_lib/_session-store.test.ts`
- Create: `api/_lib/_connection-store.test.ts`
- Create: `api/_lib/_rate-limit.test.ts`
- Modify: `api/_lib/session-crypto.ts:1-50`
- Modify: `api/_lib/_session-crypto.test.ts:1-28`
- Modify: `api/_lib/cookies.ts:1-42`
- Modify: `api/_lib/_cookies.test.ts:1-32`

**Interfaces:**
- Produces `encryptRefreshToken(token, key, keyVersion): EncryptedToken` and `decryptRefreshToken(value, keys): string | undefined`.
- Produces `SessionStore.create()`, `resolveJournalSession()`, `resolveProvisioningSession()`, `revokeUserSessions()` and `revokeSession()`.
- Produces `ConnectionStore` methods `getOrCreateUser()`, `getUserByGoogleSub()`, `findActiveConnection()`, `createOAuthAttempt()`, `consumeOAuthAttempt()`, `createProvisioningAttempt()`, `activateConnection()`, `archiveAndActivateConnection()`, `markConnectionNeedsReconnect()`, `claimLegacySheet()`, `withSheetWriteLease()` and `deleteAccountData()`.
- Produces `RateLimiter.consume({ scope, subject, limit, windowMs })` for auth start、設定流程和寫入日記的固定限制。

- [ ] **Step 1: 寫入加密、session、Sheet claim、租約鎖與速率限制的失敗測試。**

  使用注入的 in-memory Firestore transaction fake，讓測試明確覆蓋下列情境：

  ```ts
  const encrypted = encryptRefreshToken('refresh-token', tokenKey, 'v1')
  expect(encrypted).toMatchObject({ keyVersion: 'v1' })
  expect(JSON.stringify(encrypted)).not.toContain('refresh-token')
  expect(decryptRefreshToken(encrypted, new Map([['v1', tokenKey]]))).toBe('refresh-token')

  await expect(store.activateConnection({ userId: 'a', spreadsheetId: 'sheet-a' })).resolves.toMatchObject({ status: 'active' })
  await expect(store.activateConnection({ userId: 'b', spreadsheetId: 'sheet-a' }))
    .rejects.toThrow('此資料表已被其他帳號連結')
  ```

  再驗證一般 session 無法通過 provisioning guard、設定 session 無法通過 journal guard、已撤銷或到期 session 無法解析、兩個同時取得同一 Sheet lease 的請求只有第一個成功，且同一 `scope`／`subject` 超過固定次數時得到 `RateLimitError`。

- [ ] **Step 2: 執行儲存層測試，確認新儲存層尚未存在。**

  Run: `npm run test:run -- api/_lib/_token-crypto.test.ts api/_lib/_session-store.test.ts api/_lib/_connection-store.test.ts api/_lib/_rate-limit.test.ts api/_lib/_session-crypto.test.ts api/_lib/_cookies.test.ts`

  Expected: FAIL，因 refresh token 仍在 cookie payload，Firestore store 與兩種 session 尚未實作。

- [ ] **Step 3: 實作獨立加密與 Firestore 文件模型。**

  `token-crypto.ts` 使用與現有 session 加密相同的 AES-256-GCM IV／auth tag 格式，但輸出必須是 `{ ciphertext, keyVersion }`，絕不將明文包入例外或錯誤訊息。將 `session-crypto.ts` 的 payload 改為只含隨機 `sessionId` 和 `expiresAt`：

  ```ts
  export type SessionCookiePayload = {
    sessionId: string
    expiresAt: number
  }
  ```

  `sessions/{sessionId}` 保存使用者、`kind: 'journal' | 'provisioning'`、到期、最後使用、撤銷與 provisioning attempt ID；cookie payload 不保存使用者、Sheet 或 token。新增 `daily_journal_provisioning` Cookie helper，效期 20 分鐘，並在登出、授權失敗、token 失效時一併清除兩種 Cookie。

  `ConnectionStore` 必須將 Google `sub` 的唯一映射、使用者文件、連線文件和 `sheetClaims/{sha256(spreadsheetId)}` 在 Firestore transaction 中管理。所有 transaction 必須先讀取 `user`、claim、原作用中連線和目標連線，再寫入；不能透過 Firestore query 假設欄位唯一。claim 保留原 user ID，讓同一使用者重新啟用封存連線時可重用，但其他使用者永遠不能取得它。

  `withSheetWriteLease()` 以隨機 lease ID、30 秒到期時間和 `finally` 中的 compare-and-release 保護單一 Sheet 的寫入。`RateLimiter` 對雜湊後的 IP 或 user ID 建立固定視窗文件：登入每 IP 10 次／15 分鐘、設定每 user 20 次／15 分鐘、日記寫入每 user 60 次／1 分鐘。

- [ ] **Step 4: 驗證安全儲存行為。**

  Run: `npm run test:run -- api/_lib/_token-crypto.test.ts api/_lib/_session-store.test.ts api/_lib/_connection-store.test.ts api/_lib/_rate-limit.test.ts api/_lib/_session-crypto.test.ts api/_lib/_cookies.test.ts`

  Expected: PASS，測試輸出與儲存文件都沒有明文 token，並驗證 Firestore transaction 的唯一綁定、session 權限分離、鎖定與限流規則。

- [ ] **Step 5: 取得核可後提交安全 Firestore 儲存層。**

  先請使用者核可訊息 `新增 Firestore 工作階段與連線儲存`，再執行：

  ```bash
  git add api/_lib/token-crypto.ts api/_lib/session-store.ts api/_lib/connection-store.ts api/_lib/rate-limit.ts api/_lib/session-crypto.ts api/_lib/cookies.ts api/_lib/_token-crypto.test.ts api/_lib/_session-store.test.ts api/_lib/_connection-store.test.ts api/_lib/_rate-limit.test.ts api/_lib/_session-crypto.test.ts api/_lib/_cookies.test.ts
  git commit -m "新增 Firestore 工作階段與連線儲存"
  ```

### Task 4: 安全 Google OAuth、OIDC 與本站 session routes

**Files:**
- Create: `api/_lib/oidc.ts`
- Create: `api/_lib/_oidc.test.ts`
- Modify: `api/_lib/google-oauth.ts:1-108`
- Modify: `api/_lib/_google-oauth.test.ts:1-69`
- Modify: `api/auth/start.ts:1-13`
- Modify: `api/auth/callback.ts:1-44`
- Modify: `api/auth/logout.ts:1-10`
- Modify: `api/session.ts:1-19`
- Modify: `api/auth/_auth-routes.test.ts:1-127`

**Interfaces:**
- Produces `createPkcePair()`、`buildAuthorizationUrl(input)`、`exchangeAuthorizationCode()`、`refreshGoogleCredentials()` 和 `verifyGoogleIdToken()`。
- Produces session probe payloads `{ state: 'authenticated' }`、`{ state: 'provisioning' }` 或 `{ state: 'signed-out' }`。
- Consumes Task 3 的 `ConnectionStore`、`SessionStore` 和 `RateLimiter`。

- [ ] **Step 1: 寫 OAuth PKCE、ID token 驗證與 route 狀態的失敗測試。**

  在 `_google-oauth.test.ts` 驗證授權 URL 含 `code_challenge`、`code_challenge_method=S256` 和完整 scope，但一般登入不含 `prompt=consent`；只有明確重新授權路徑才可加入它。授權碼交換測試必須要求 `code_verifier`、`id_token`，但允許既有作用中連線的 callback 沒有新的 `refresh_token`。

  在 `_oidc.test.ts` 注入 JWT 驗證器，固定拒絕錯誤 issuer、audience、過期 token 和空白 `sub`：

  ```ts
  await expect(verifyGoogleIdToken('token', config, verifyJwt)).resolves.toMatchObject({
    sub: 'google-sub',
    email: 'person@example.com',
  })
  await expect(verifyGoogleIdToken('bad-aud', config, verifyJwt)).rejects.toThrow('Google 身分驗證失敗')
  ```

  更新 route 測試：start 必須在 Firestore 建立含 PKCE verifier 的一次性 OAuth attempt；callback 只能在 state Cookie 與未過期 attempt 都正確時消耗它；有作用中連線時建立 journal session，沒有作用中連線時建立 provisioning session 並 redirect `/?setup=1`。當首次設定沒有新 refresh token 且沒有可用舊 token 時，callback 必須只重試一次 `reauthorize` flow 並附加 `prompt=consent`；第二次仍沒有 token 時回到登入畫面。`/api/session` 不得從 cookie 解出 refresh token。

- [ ] **Step 2: 執行 OAuth 測試，確認目前實作不符合新流程。**

  Run: `npm run test:run -- api/_lib/_google-oauth.test.ts api/_lib/_oidc.test.ts api/auth/_auth-routes.test.ts`

  Expected: FAIL，因目前缺少 PKCE、OIDC 驗證、Firestore OAuth attempt 和 provisioning session。

- [ ] **Step 3: 以 Firestore attempt 實作 OAuth callback。**

  `createPkcePair()` 必須以高熵 verifier 和 SHA-256 base64url challenge 建立配對。start route 以 `APP_ORIGIN` 而非 request URL 建立 callback，先消耗登入限流額度，再儲存下列資料並只把 state 放進 HttpOnly Cookie：

  ```ts
  await connectionStore.createOAuthAttempt({
    state,
    codeVerifier: pkce.verifier,
    intent: reauthorize ? 'reauthorize' : 'sign-in',
    expiresAt: Date.now() + 10 * 60_000,
  })
  ```

  `oidc.ts` 使用 `jose` 的 remote JWK set 驗證 Google JWT；只回傳已檢查的 `{ sub, email, name, picture }`。callback 必須以 transaction 一次性消耗 state，交換 code、驗證 ID token、用 `sub` 建立或查詢使用者；有新 refresh token 時以 Task 3 加密後更新連線，沒有新 token 時保留有效的舊密文。沒有作用中連線時建立 provisioning attempt 和 20 分鐘設定 session；不得先建立 journal session。若首次設定沒有可保存的 refresh token，僅能以新的 state／PKCE attempt 重新導向一次 `reauthorize` flow；它必須帶 `prompt=consent`，再次失敗後不可建立任何 session。

  logout 必須撤銷目前 cookie 對應的 server session，並清除兩個 session Cookie。session route 必須查詢 Firestore，對過期或撤銷記錄清 Cookie，並回傳三種明確狀態。

- [ ] **Step 4: 驗證 OAuth、session 與撤銷行為。**

  Run: `npm run test:run -- api/_lib/_google-oauth.test.ts api/_lib/_oidc.test.ts api/auth/_auth-routes.test.ts`

  Expected: PASS，state、PKCE、ID token、既有 refresh token、設定 session、登出和到期 session 均符合規格。

- [ ] **Step 5: 取得核可後提交 OAuth 與本站 session 改造。**

  先請使用者核可訊息 `強化 Google OAuth 多使用者驗證`，再執行：

  ```bash
  git add api/_lib/oidc.ts api/_lib/_oidc.test.ts api/_lib/google-oauth.ts api/_lib/_google-oauth.test.ts api/auth api/session.ts api/auth/_auth-routes.test.ts
  git commit -m "強化 Google OAuth 多使用者驗證"
  ```

### Task 5: Google Drive、Sheets schema 與直接日記儲存庫

**Files:**
- Create: `api/_lib/google-drive.ts`
- Create: `api/_lib/google-sheets.ts`
- Create: `api/_lib/sheets-journal-store.ts`
- Create: `api/_lib/zoned-time.ts`
- Create: `api/_lib/_google-drive.test.ts`
- Create: `api/_lib/_google-sheets.test.ts`
- Create: `api/_lib/_sheets-journal-store.test.ts`
- Create: `api/_lib/_zoned-time.test.ts`

**Interfaces:**
- Produces `GoogleDriveClient.listOwnedSpreadsheets()`、`getOwnedSpreadsheet()`、`deleteSystemCreatedSpreadsheet()`。
- Produces `GoogleSheetsClient.createJournalSpreadsheet()`、`loadValidatedJournal()`、`initializeBlankSpreadsheet()`、`writeJournalChanges()`。
- Produces `SheetsJournalStore.execute(request: unknown): Promise<ApiResponse<unknown>>`，以 Task 2 的 `JournalService` 處理現有 API 契約。

- [ ] **Step 1: 寫 Drive／Sheets REST 和 schema 保護的失敗測試。**

  在 Drive 測試 mock `fetch`，驗證候選清單使用 `application/vnd.google-apps.spreadsheet`、`ownedByMe=true`、`trashed=false`、固定 `pageSize=20`，並只轉換為 `{ id, name, modifiedTime }` 供 server 內部使用。

  在 Sheets 測試建立三種 fixture：空白 Sheet、完全相容的 schema 和有不相容非空資料的 Sheet。另以 401／403、429、503 回應分別驗證權限失效與可重試上游錯誤被分類成安全本站錯誤。驗證：

  ```ts
  await expect(client.initializeBlankSpreadsheet('blank-sheet')).resolves.toMatchObject({ schemaVersion: '1' })
  await expect(client.loadValidatedJournal('invalid-sheet')).rejects.toThrow('資料表格式不符')
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining(':batchUpdate'), expect.anything())
  ```

  `SheetsJournalStore` 測試須執行 `saveEntry`、`moveEntries` 與 `deleteCategory`，斷言它只呼叫一個 Sheets 批次寫入 endpoint，資料列中的 tags／links 保持 JSON 字串，並在任何 headers 或 `schemaVersion` 不符時完全不寫入。

- [ ] **Step 2: 執行 Google API adapter 測試，確認 adapter 尚不存在。**

  Run: `npm run test:run -- api/_lib/_google-drive.test.ts api/_lib/_google-sheets.test.ts api/_lib/_sheets-journal-store.test.ts api/_lib/_zoned-time.test.ts`

  Expected: FAIL，因沒有直接 Drive／Sheets REST client 和 Node 時區時間格式化器。

- [ ] **Step 3: 實作只在伺服器使用的 Google API adapter。**

  `GoogleDriveClient` 必須使用 bearer access token 呼叫 Drive v3，對候選與指定檔案重新檢查 MIME type、`ownedByMe`、`capabilities.canEdit` 與 `trashed`。它不得把原始 Sheet ID 放入可回傳前端的錯誤物件，並將 401／403 分類為連線修復錯誤、429／5xx／網路失敗分類為可重試上游錯誤。`deleteSystemCreatedSpreadsheet()` 只能由後續帳號刪除服務呼叫，且呼叫前必須再次驗證該 connection 的 `createdByService === true`。

  `GoogleSheetsClient` 定義下列固定 schema，建立時以 `spreadsheets.create` 後接 `spreadsheets.batchUpdate` 初始化；連結既有空白 Sheet 時只新增本站三個工作表，不清空任何非空工作表：

  ```ts
  export const ENTRY_HEADERS = ['id', 'entryDate', 'title', 'content', 'categoryId', 'tags', 'links', 'createdAt', 'updatedAt']
  export const CATEGORY_HEADERS = ['id', 'name', 'isActive', 'createdAt', 'updatedAt']
  export const SETTINGS_HEADERS = ['key', 'value']
  export const SCHEMA_VERSION = '1'
  ```

  `loadValidatedJournal()` 必須取得 spreadsheet 時區和所有本站工作表的標題、欄位、資料列；以 `InMemoryJournalStore` 載入資料後，由共用 `JournalService` 執行同步規則。`writeJournalChanges()` 必須將新增、更新和刪除行排序成一個 `spreadsheets.batchUpdate` HTTP request；刪除列必須由列號高到低排列，避免索引位移。`zoned-time.ts` 以 `Intl.DateTimeFormat(..., { timeZoneName: 'longOffset' })` 產生與既有 GAS 相容的可排序 ISO 8601 timestamp。

- [ ] **Step 4: 驗證 Sheet 初始化、schema 拒絕與批次寫入。**

  Run: `npm run test:run -- api/_lib/_google-drive.test.ts api/_lib/_google-sheets.test.ts api/_lib/_sheets-journal-store.test.ts api/_lib/_zoned-time.test.ts`

  Expected: PASS，空白與相容 Sheet 可安全使用，不相容 Sheet 不會被寫入，所有變動採批次 API。

- [ ] **Step 5: 取得核可後提交直接 Sheets 儲存庫。**

  先請使用者核可訊息 `新增專屬 Sheet 資料存取`，再執行：

  ```bash
  git add api/_lib/google-drive.ts api/_lib/google-sheets.ts api/_lib/sheets-journal-store.ts api/_lib/zoned-time.ts api/_lib/_google-drive.test.ts api/_lib/_google-sheets.test.ts api/_lib/_sheets-journal-store.test.ts api/_lib/_zoned-time.test.ts
  git commit -m "新增專屬 Sheet 資料存取"
  ```

### Task 6: 改用作用中連線的 `/api/journal`

**Files:**
- Modify: `api/journal.ts:1-92`
- Modify: `api/_journal.test.ts:1-123`
- Create: `api/_lib/journal-request-context.ts`
- Create: `api/_lib/_journal-request-context.test.ts`

**Interfaces:**
- Produces `createJournalHandler(deps)` 和 `requireJournalRequestContext(request): Promise<{ session, user, connection, accessToken }>`。
- `POST /api/journal` consumes the unchanged `ApiRequest` union and returns the direct `ApiResponse<unknown>` produced by Task 2.
- Consumes Task 3 session／connection／lease stores and Task 5 `SheetsJournalStore`.

- [ ] **Step 1: 改寫 journal route 測試為專屬 Sheet 流程。**

  使用依賴注入建立兩個不同使用者的 fake connection。驗證 route 不讀取 `GAS_DEPLOYMENT_ID`、不呼叫 `script.googleapis.com`，且永遠用 server context 的 `connection.spreadsheetId`：

  ```ts
  const response = await createJournalHandler(deps)(authenticatedRequest({
    action: 'bootstrap',
    spreadsheetId: 'attacker-supplied-sheet',
  }))

  expect(deps.sheets.open).toHaveBeenCalledWith('owned-sheet', 'server-access-token')
  await expect(response.json()).resolves.toEqual({ ok: true, data: expect.anything() })
  ```

  新增 refresh token 失效時撤銷 session、標記連線 `needs_reconnect`、清 Cookie；Google 5xx 保留有效 session 並回安全 `502`；寫入 action 取得 Sheet lease，讀取 action 不取得 lease；不同使用者永遠無法藉由記事 ID 或偽造 Sheet ID 影響另一個 Sheet。

- [ ] **Step 2: 執行 journal route 測試，確認目前仍使用 GAS。**

  Run: `npm run test:run -- api/_journal.test.ts api/_lib/_journal-request-context.test.ts`

  Expected: FAIL，因現有 route 從加密 cookie 取得 refresh token，並呼叫固定 GAS deployment。

- [ ] **Step 3: 實作 session-derived 資料來源與直接回應。**

  `journal-request-context.ts` 必須先解析 Task 3 journal session，再載入作用中 connection、解密 refresh token，呼叫 `refreshGoogleCredentials()`；Google 若回傳替換 refresh token，必須在回應前以新金鑰版本安全更新 connection。

  `api/journal.ts` 只接受 JSON object 和 Task 2 支援的 action。它用 action 判斷是否為寫入，再以 Task 3 的 `withSheetWriteLease(connection.id, ...)` 包住 Task 5 store 的 `execute()`：

  ```ts
  const execute = () => sheetsJournalStore.execute(requestBody)
  const result = isJournalMutation(requestBody)
    ? await connections.withSheetWriteLease(context.connection.id, execute)
    : await execute()
  return jsonResponse(result)
  ```

  對 `InvalidRefreshTokenError`、Google 401／403 或找不到作用中連線，撤銷本站 session 並回 `401`；對 schema、鎖定、輸入和領域錯誤回安全 `ApiResponse`；對 Google 暫時錯誤回 `502` 且不得回傳上游 body。

- [ ] **Step 4: 驗證所有 journal route 邊界。**

  Run: `npm run test:run -- api/_journal.test.ts api/_lib/_journal-request-context.test.ts`

  Expected: PASS，沒有 GAS URL、cookie 明文 token 或前端決定資料來源的路徑。

- [ ] **Step 5: 取得核可後提交專屬 Sheet journal API。**

  先請使用者核可訊息 `改用專屬 Sheet 記事 API`，再執行：

  ```bash
  git add api/journal.ts api/_journal.test.ts api/_lib/journal-request-context.ts api/_lib/_journal-request-context.test.ts
  git commit -m "改用專屬 Sheet 記事 API"
  ```

### Task 7: 資料空間設定、換表與帳號生命週期 API

**Files:**
- Create: `api/_lib/provisioning-service.ts`
- Create: `api/_lib/_provisioning-service.test.ts`
- Create: `api/provisioning/status.ts`
- Create: `api/provisioning/start-change.ts`
- Create: `api/provisioning/sheets.ts`
- Create: `api/provisioning/create.ts`
- Create: `api/provisioning/select.ts`
- Create: `api/provisioning/url.ts`
- Create: `api/provisioning/confirm.ts`
- Create: `api/account/disconnect.ts`
- Create: `api/account/delete.ts`
- Create: `api/provisioning/_provisioning-routes.test.ts`
- Create: `api/account/_account-routes.test.ts`

**Interfaces:**
- Produces safe `ProvisioningStatus` with only `phase`、Sheet 名稱、最後更新時間、`connectionVersion`、`canDeleteActiveSystemSheet` 和錯誤代碼；不得包含任何 Sheet ID。
- Produces GET `/api/provisioning/status`、POST `/api/provisioning/start-change`、GET `/api/provisioning/sheets`、POST `/api/provisioning/create`、`/select`、`/url`、`/confirm`、`/api/account/disconnect` 和 `/api/account/delete`。
- Consumes Task 3 stores and Task 5 Drive／Sheets clients.

- [ ] **Step 1: 寫首次設定、候選 Sheet、貼上網址、換表與帳號操作的失敗測試。**

  在 `provisioning-service` 測試建立 A、B 兩個 user 和已被 A claim 的 Sheet。驗證 B 選取相同 code 或貼上相同 URL 時得到安全拒絕；選擇代碼跨使用者、已使用或逾期時均被拒絕；候選清單只回傳下列前端 shape：

  ```ts
  expect(await service.listCandidateSheets(setupSession, { cursor: null, query: '日記' })).toEqual({
    items: [{ selectionCode: expect.any(String), name: '我的日記', modifiedTime: expect.any(String) }],
    nextCursor: null,
  })
  ```

  驗證空白 Sheet 初始化成功、非空不相容 Sheet 完全不寫入、相容封存 Sheet 重新啟用而非複製連線、換表 confirmation 的舊 version 產生衝突、失敗或取消保持原作用中連線。帳號測試須驗證中斷連線會清 token／sessions 但保留 Sheet；刪除帳號預設保留 Sheet，只有 `createdByService` 且送出 `deleteSystemCreatedSheet: true` 和確認文字 `刪除我的帳號` 時才呼叫 Drive delete。

- [ ] **Step 2: 執行設定和帳號 route 測試，確認 routes 尚未存在。**

  Run: `npm run test:run -- api/_lib/_provisioning-service.test.ts api/provisioning/_provisioning-routes.test.ts api/account/_account-routes.test.ts`

  Expected: FAIL，因沒有 provisioning service、一次性選擇代碼或帳號生命週期 routes。

- [ ] **Step 3: 實作伺服器限定的設定流程。**

  `start-change` 僅接受 journal session，建立 20 分鐘 provisioning session 和含原 connection version 的 attempt，並保留原 journal session 到確認成功為止。首次登入 callback 建立的 provisioning session 只能建立或連結第一份 Sheet，不能呼叫任何 CRUD route。

  `sheets` route 使用 Task 5 Drive client，限制 query 至少 2 個字元並以 cursor 取得 20 筆；每個候選檔在 Firestore 建立高熵、一次性、與 `provisioningAttemptId` 綁定且 10 分鐘到期的 selection code。`select` 和 `url` 都必須再次 Drive／Sheets 驗證，將目標只保存於 provisioning attempt，回傳安全的名稱與資料結構狀態。

  `create` 以使用者 access token 建立標題「每日記事」的 Sheet，初始化三個工作表，並將 `createdByService: true` 寫入未完成連線。建立後任一初始化失敗時，標記 attempt 為 failed，絕不升級為作用中連線。初次設定的 `create`、`select` 與 `url` 在成功初始化或驗證後，立即以 transaction 啟用連線、建立 journal session 並消耗 provisioning session；使用者不需要第二次確認。換表流程則只保存已驗證目標，`confirm` 才能在單一 Firestore transaction 中以 expected version 封存舊連線、啟用目標、輪替 journal session、撤銷舊 session 並消耗 provisioning session。

  `disconnect` 將 connection 標記為 `needs_reconnect`、刪除 encrypted token、撤銷所有 sessions。`delete` 預設只刪除 Firestore user、connections、claims、sessions 和暫存文件；要求刪除系統建立 Sheet 時，先以目前使用者 OAuth 憑證刪除 Drive 檔案，成功後再移除資料庫資料，Drive 失敗則保留帳號與連線以供重試。所有 routes 於開始前消耗 Task 3 對應的限流額度。

- [ ] **Step 4: 驗證設定流程和帳號資料邊界。**

  Run: `npm run test:run -- api/_lib/_provisioning-service.test.ts api/provisioning/_provisioning-routes.test.ts api/account/_account-routes.test.ts`

  Expected: PASS，前端永遠收不到 Sheet ID，A 與 B 無法交叉綁定資料，換表衝突保留原資料，且刪除規則符合系統建立／自行連結的區別。

- [ ] **Step 5: 取得核可後提交資料空間和帳號 APIs。**

  先請使用者核可訊息 `新增 Google Sheet 資料空間流程`，再執行：

  ```bash
  git add api/_lib/provisioning-service.ts api/_lib/_provisioning-service.test.ts api/provisioning api/account
  git commit -m "新增 Google Sheet 資料空間流程"
  ```

### Task 8: 前端 session 狀態與首次資料空間設定介面

**Files:**
- Modify: `src/services/journal-api-client.ts:1-92`
- Modify: `src/services/journal-api-client.test.ts:1-60`
- Modify: `src/features/journal/use-journal.ts:1-429`
- Modify: `src/features/journal/use-journal.test.tsx:1-141`
- Create: `src/features/provisioning/data-space-setup.tsx`
- Create: `src/features/provisioning/data-space-setup.test.tsx`
- Modify: `src/features/journal/connection-screen.tsx:1-82`
- Modify: `src/App.tsx:1-448`
- Modify: `src/App.test.tsx:1-116`
- Modify: `src/i18n/zh-TW.ts:1-174`
- Modify: `src/styles/global.css`

**Interfaces:**
- Replaces `restoreSession(): Promise<boolean>` with `restoreSession(): Promise<SessionState>` where `SessionState` is `'authenticated' | 'provisioning' | 'signed-out'`.
- Produces `JournalApiClient.getProvisioningStatus()`、`listCandidateSheets()`、`createSheet()`、`selectCandidate()`、`submitSheetUrl()`、`confirmProvisioning()` and `startSheetChange()`.
- Produces `type DataSpaceMode = 'initial' | 'change'` and `DataSpaceSetup` props `{ client, mode: DataSpaceMode, onComplete, onCancel? }` with no prop for a Sheet ID.

- [ ] **Step 1: 寫前端原生 API、設定 UI 與資料清除的失敗測試。**

  將 journal client 成功 payload 改為本站原生形狀，而不是 GAS 的 `response.result` 包裝：

  ```ts
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, data: [] })))
  await expect(new JournalApiClient().run<string[]>({ action: 'bootstrap' })).resolves.toEqual([])
  ```

  在 hook 測試中讓 `/api/session` 回 `{ state: 'provisioning' }`，斷言不發送 bootstrap。`DataSpaceSetup` 測試須驗證候選清單只以名稱和選擇代碼呈現、貼上 URL 只送到 `/api/provisioning/url`、選擇不相容 Sheet 顯示安全錯誤並保留畫面、初次建立成功後呼叫 `onComplete()`。

  App 測試驗證 provisioning 狀態只顯示資料空間設定畫面，完成後先清空 `entries`、`categories`、filter、月曆與編輯 state，再取得新的 authenticated session 和 bootstrap；前一位帳號的內容不得短暫出現。

- [ ] **Step 2: 執行前端設定測試，確認目前只有布林 session。**

  Run: `npm run test:run -- src/services/journal-api-client.test.ts src/features/journal/use-journal.test.tsx src/features/provisioning/data-space-setup.test.tsx src/App.test.tsx`

  Expected: FAIL，因 client 仍解析 GAS wrapper，hook 沒有 provisioning 狀態，且 UI 元件尚未存在。

- [ ] **Step 3: 實作前端 API client、狀態機與設定畫面。**

  `JournalApiClient.run()` 必須直接驗證 `{ ok: boolean, data?: unknown, code?: string, message?: string }`；非成功 `ApiResponse` 轉為 `JournalApiClientError(message)`，401／403 轉為 `AuthenticationError`。所有 fetch 保持 `credentials: 'same-origin'`。

  `useJournal` 將狀態擴充為 `checking-session | signed-out | provisioning | loading | ready | error`。當 session state 為 provisioning 時，呼叫 `clearData('provisioning')` 且不呼叫 journal API。完成設定時，先遞增 request epoch、清空所有日記畫面資料，再重新探測 session；這使舊的非同步回應無法寫回新 Sheet。

  `DataSpaceSetup` 必須提供「建立新的每日記事 Sheet」、「選擇我的 Google Sheet」與「貼上 Google Sheet 網址」三種可鍵盤操作的入口。候選清單僅顯示 `name`、`modifiedTime` 和「選擇」按鈕；使用者選擇後只傳 selection code。設定中所有 busy 操作需停用重複提交，錯誤以 `role="alert"` 顯示。

- [ ] **Step 4: 驗證首次設定和日記狀態隔離。**

  Run: `npm run test:run -- src/services/journal-api-client.test.ts src/features/journal/use-journal.test.tsx src/features/provisioning/data-space-setup.test.tsx src/App.test.tsx`

  Expected: PASS，前端不再依賴 GAS response，首次設定無法讀取日記，設定完成或帳號切換後沒有舊資料殘留。

- [ ] **Step 5: 取得核可後提交首次設定介面。**

  先請使用者核可訊息 `新增首次資料空間設定介面`，再執行：

  ```bash
  git add src/services/journal-api-client.ts src/services/journal-api-client.test.ts src/features/journal/use-journal.ts src/features/journal/use-journal.test.tsx src/features/provisioning src/features/journal/connection-screen.tsx src/App.tsx src/App.test.tsx src/i18n/zh-TW.ts src/styles/global.css
  git commit -m "新增首次資料空間設定介面"
  ```

### Task 9: 登入後資料連線與帳號設定介面

**Files:**
- Create: `src/features/settings/data-connection-settings.tsx`
- Create: `src/features/settings/data-connection-settings.test.tsx`
- Modify: `src/App.tsx:25-448`
- Modify: `src/features/journal/use-journal.ts:18-364`
- Modify: `src/features/journal/use-journal.test.tsx:24-141`
- Modify: `src/i18n/zh-TW.ts`
- Modify: `src/styles/global.css`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Produces `DataConnectionSettings` with props `status`、`onStartChange`、`onDisconnect` and `onDeleteAccount`.
- Adds `settings` to the desktop and mobile `Page` navigation.
- Extends `JournalClient` with `disconnect()` and `deleteAccount({ deleteSystemCreatedSheet: boolean, confirmation: string })`.

- [ ] **Step 1: 寫資料連線設定、換表確認與帳號刪除的失敗測試。**

  測試目前連線只顯示 Sheet 名稱和狀態，不顯示 Sheet ID。按「更換資料表」後應開啟 Task 8 的 setup UI，成功確認前仍保留舊時間軸；確認成功後設定 UI 必須先清空舊資料再刷新。

  再測試下列帳號條件：

  ```ts
  const deleteSystemSheet = screen.getByRole('checkbox', { name: '同時刪除系統建立的 Google Sheet' })
  expect(deleteSystemSheet).toBeDisabled()

  await user.click(screen.getByRole('button', { name: '中斷連線' }))
  await user.click(screen.getByRole('button', { name: '確認中斷連線' }))
  expect(onDisconnect).toHaveBeenCalledOnce()
  ```

  對可刪除系統建立 Sheet 的帳號，帳號刪除 dialog 必須要求輸入 `刪除我的帳號` 才能送出；自行連結 Sheet 則不能勾選刪除 Sheet。取消、換表驗證失敗和多分頁衝突均保留原頁面資料。

- [ ] **Step 2: 執行設定元件與 App 測試，確認設定頁尚未實作。**

  Run: `npm run test:run -- src/features/settings/data-connection-settings.test.tsx src/features/journal/use-journal.test.tsx src/App.test.tsx`

  Expected: FAIL，因沒有 settings page、帳號 lifecycle client method 或安全確認控制項。

- [ ] **Step 3: 實作設定頁與跨 Sheet 狀態轉換。**

  在 App 導覽新增「設定」，將 `DataConnectionSettings` 放在獨立 page。它從 provisioning status 取得安全的目前名稱與 `connectionVersion`，不從任何 client state 推導 ID。更換流程應在成功後呼叫 hook 的一個 `replaceDataSource()` 路徑：先使舊 request epoch 失效、清除 entries／categories／tag suggestions／filter／月曆／選取項目／編輯器，再 restore session 和 bootstrap。

  中斷連線或刪除帳號成功後使用相同的清除路徑轉為 `signed-out`。帳號刪除 dialog 的確認按鈕在文字不完全等於 `刪除我的帳號` 時必須 disabled；系統建立 Sheet 的 checkbox 只有 `canDeleteActiveSystemSheet` 為 true 時可用。所有 dialog 使用 `role="dialog"`、`aria-modal="true"`、可辨識標題和明確取消按鈕。

- [ ] **Step 4: 驗證設定、安全確認與舊資料清除。**

  Run: `npm run test:run -- src/features/settings/data-connection-settings.test.tsx src/features/journal/use-journal.test.tsx src/App.test.tsx`

  Expected: PASS，換表、登出、中斷連線和帳號刪除均不會讓前一來源資料留在畫面上。

- [ ] **Step 5: 取得核可後提交資料連線設定 UI。**

  先請使用者核可訊息 `新增資料連線與帳號設定`，再執行：

  ```bash
  git add src/features/settings/data-connection-settings.tsx src/features/settings/data-connection-settings.test.tsx src/App.tsx src/App.test.tsx src/features/journal/use-journal.ts src/features/journal/use-journal.test.tsx src/i18n/zh-TW.ts src/styles/global.css
  git commit -m "新增資料連線與帳號設定"
  ```

### Task 10: 過期資料清理、舊 Sheet 遷移與公開部署文件

**Files:**
- Create: `api/internal/cleanup.ts`
- Create: `api/internal/migrate-legacy-sheet.ts`
- Create: `api/internal/_internal-routes.test.ts`
- Create: `api/_lib/legacy-migration.ts`
- Create: `api/_lib/_legacy-migration.test.ts`
- Modify: `vercel.json:1-7`
- Modify: `README.md:1-85`
- Modify: `docs/deployment.md:1-89`
- Modify: `docs/acceptance-checklist.md:1-47`
- Create: `public/privacy-policy.html`
- Create: `public/terms-of-service.html`
- Modify: `src/features/journal/connection-screen.tsx:12-61`
- Modify: `scripts/config-files.test.ts:1-38`

**Interfaces:**
- Produces protected GET `/api/internal/cleanup` and POST `/api/internal/migrate-legacy-sheet`.
- Produces `runLegacyMigration({ googleSub, spreadsheetUrl }): Promise<void>` that only binds an already verified user to the existing owner Sheet.
- Adds Vercel Cron schedule `*/5 * * * *` for cleanup and requires `Authorization: Bearer ${CRON_SECRET}`.

- [ ] **Step 1: 寫清理、遷移、設定檔和公開文件的失敗測試。**

  `internal-routes` 測試必須拒絕缺少或錯誤 bearer secret。cleanup 測試建立過期 OAuth attempt、provisioning attempt、selection code 與 token，斷言它們被刪除而未過期資料不動。

  遷移測試建立已完成 OAuth 的目標 `googleSub`，mock Drive／Sheets 驗證該使用者擁有舊 Sheet 且 schema 相容，並斷言只建立一筆 `createdByService: false` 作用中連線：

  ```ts
  await runLegacyMigration({ googleSub: 'deployer-sub', spreadsheetUrl: legacyUrl }, deps)
  expect(deps.connections.claimLegacySheet).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'deployer-user',
    spreadsheetId: 'legacy-sheet',
    createdByService: false,
  }))
  ```

  加入拒絕未登入 target、非擁有者、schema 不符、重複執行和不正確 admin secret 的測試。更新 config files 測試，驗證 `vercel.json` 保留 filesystem-first SPA routing 並有 cleanup cron，不含 `GAS_DEPLOYMENT_ID`。新增靜態文件測試，驗證隱私政策明確說明資料在使用者 Google Sheet、本站保存加密 token／連線資料、撤銷與刪除流程。

- [ ] **Step 2: 執行營運測試，確認清理、遷移與文件尚未存在。**

  Run: `npm run test:run -- api/internal/_internal-routes.test.ts api/_lib/_legacy-migration.test.ts scripts/config-files.test.ts`

  Expected: FAIL，因沒有受保護內部 routes、舊 Sheet 遷移、Cron 或更新後的部署／隱私文件。

- [ ] **Step 3: 實作安全營運路徑與文件。**

  cleanup route 只接受 Vercel Cron 的 bearer secret，逐批刪除 `expiresAt < now` 的 OAuth、provisioning、選擇代碼與速率限制文件；清除 provisioning attempt 前必須刪除其加密暫存 token 欄位。它的 response 只回傳各類別清理筆數，不回傳 ID 或內容。

  legacy migration route 只接受 `LEGACY_MIGRATION_SECRET`，並將輸入限制為目標使用者的 `googleSub` 與管理者提供的完整 Sheet URL。它必須在 Firestore 找到該 user 已完成 OIDC 驗證且未過期的 provisioning attempt，使用其中加密 refresh token 取得 access token、重做 Drive ownership 與 Sheets schema 驗證，再透過 transaction claim 舊 Sheet 並升級為作用中連線。過程不得複製、清空或改寫任一資料列；重複執行回傳安全衝突且不建立空 Sheet。部署文件必須要求此程序前先建立舊 Sheet 的完整備份，且遷移失敗時維持舊個人版可讀。

  將 `vercel.json` 擴充為：

  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "crons": [{ "path": "/api/internal/cleanup", "schedule": "*/5 * * * *" }],
    "routes": [{ "handle": "filesystem" }, { "src": "/(.*)", "dest": "/index.html" }]
  }
  ```

  更新 README、部署文件和驗收清單：啟用 Firestore Native mode、為 Vercel 服務帳號授予 Cloud Datastore User、設定 10 個環境變數、Production／Preview 隔離、Google OAuth scope／驗證、舊 Sheet 一次性遷移、雙帳號資料隔離、系統建立與自行連結 Sheet 的帳號刪除差異。建立 `public/privacy-policy.html` 和 `public/terms-of-service.html`，並在登入畫面放置可開啟的連結。

- [ ] **Step 4: 執行完整自動化檢查。**

  Run: `npm run check`

  Expected: PASS，包含 ESLint、所有 frontend／server／shared Vitest、TypeScript／Vite build 與保留的 GAS bundle build。

- [ ] **Step 5: 執行 Production 前人工驗收。**

  依 `docs/acceptance-checklist.md` 使用兩個測試 Google 帳號驗證：A 建立系統 Sheet、B 連結自己的空白 Sheet、B 無法連結 A 的 Sheet、兩帳號 CRUD／匯出隔離、換表競態不破壞原連線、撤銷授權後可重新連線、預設帳號刪除保留 Sheet、只有 A 的系統建立 Sheet 可選擇刪除。確認 Vercel Preview 不使用 Production Firestore 或 OAuth 設定。

- [ ] **Step 6: 取得核可後提交遷移、文件與最終驗收。**

  先請使用者核可訊息 `完成多使用者遷移與部署文件`，再執行：

  ```bash
  git add api/internal api/_lib/legacy-migration.ts api/_lib/_legacy-migration.test.ts vercel.json README.md docs/deployment.md docs/acceptance-checklist.md public/privacy-policy.html public/terms-of-service.html src/features/journal/connection-screen.tsx scripts/config-files.test.ts
  git commit -m "完成多使用者遷移與部署文件"
  ```

## 最終驗證順序

1. 執行 `npm run check`，確認 lint、所有單元測試、Vite production build 和 GAS internal bundle 都成功。
2. 執行 `git status --short`，確認只包含這份功能已核可的檔案，且沒有 `.env`、服務帳號 JSON、token、Sheet ID、建置產物或虛擬環境。
3. 在獨立的 Firestore Native mode Preview 專案，以兩個測試 Google 帳號完成 `docs/acceptance-checklist.md` 的所有多使用者案例。
4. 完成 Google OAuth 同意畫面、敏感 scope 驗證、Production Firestore 服務帳號最小權限和固定 Production callback URL 後，才開放 External Production 使用者。
