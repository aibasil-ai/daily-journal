# 伺服器端工作階段與自動登入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 Vercel Functions、加密 HttpOnly Cookie 與 Google OAuth 授權碼流程，讓每日記事在刷新後安全地自動恢復登入。

**Architecture:** 瀏覽器只呼叫同網域的 `/api`；Vercel Functions 以加密 Cookie 保存 refresh token、在伺服器端換取短效 access token，並代理固定的 Apps Script `executeAppRequest` 呼叫。React App 啟動時先查詢 `/api/session`，成功後自動 bootstrap，未登入時才顯示導向 OAuth 授權碼流程的登入按鈕。

**Tech Stack:** React 19、TypeScript、Vite 8、Vitest、Node.js crypto、Vercel Functions、Google OAuth 2.0 Web Server Flow、Apps Script Execution API。

## Global Constraints

- 不使用資料庫、refresh token、access token、`GOOGLE_CLIENT_SECRET` 與 `SESSION_ENCRYPTION_KEY` 均不可傳給瀏覽器或提交至 Git。
- 工作階段 Cookie 以 AES-256-GCM 加密，使用 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/` 與 30 天 `Max-Age`。
- OAuth state Cookie 必須為 HttpOnly、Secure、SameSite=Lax、Path=/，且 10 分鐘到期。
- 前端不得直接載入 Google Identity Services、直接呼叫 Google API、使用 `APP_GOOGLE_CLIENT_ID` 或 `APP_GAS_DEPLOYMENT_ID`。
- Vercel Function 只可固定呼叫 GAS `executeAppRequest`，不可接受前端指定函式名稱。
- Google OAuth state 不符、無效或過期 session、refresh token 失效與 GAS 401/403 都必須清除 session Cookie；一般上游網路錯誤保留有效 Cookie 並回傳 502。
- 所有新增使用者可見文字集中於 `src/i18n/zh-TW.ts`。
- 每個 commit 前都必須先取得使用者對繁體中文 commit 訊息的核可。

---

## 檔案結構

- `api/_lib/server-config.ts`：讀取並驗證 Vercel server-only 環境變數。
- `api/_lib/cookies.ts`：解析 Cookie、建立與清除 session/state Cookie。
- `api/_lib/session-crypto.ts`：AES-256-GCM 加密、解密與 session 到期驗證。
- `api/_lib/google-oauth.ts`：建立 Google 授權 URL、交換授權碼、refresh access token。
- `api/_lib/function-response.ts`：Function 共用 JSON、redirect 與多個 Set-Cookie response helper。
- `api/auth/start.ts`、`api/auth/callback.ts`、`api/auth/logout.ts`、`api/session.ts`：OAuth 與工作階段 HTTP routes。
- `api/journal.ts`：工作階段驗證、token refresh 與固定 GAS function proxy。
- `api/**/*.test.ts`：Node 環境測試 Function 與 server helper。
- `src/services/journal-api-client.ts`：前端同網域 API client，處理 session、journal 與 logout。
- `src/App.tsx`、`src/features/journal/use-journal.ts`：啟動時恢復 session、登入 redirect、401 轉未登入與立即登出 state。
- `src/services/google-oauth.ts`、`src/services/execution-client.ts`、`src/config/runtime-config.ts` 與對應測試：移除舊的瀏覽器 OAuth／直接 GAS 呼叫實作。
- `index.html`、`vite.config.ts`、`src/vite-env.d.ts`、`.env.example`、`public/app-config.example.js`：移除前端 Google 設定與 GIS script。
- `tsconfig.app.json`、`vitest.config.ts`、`vercel.json`：將 API TypeScript 納入型別檢查、測試與 SPA routing。
- `docs/deployment.md`、`docs/acceptance-checklist.md`、`README.md`：更新 Vercel、Google OAuth redirect URI 與手動驗收說明。

### Task 1: Server-only 設定、Cookie 與加密工作階段

**Files:**
- Create: `api/_lib/server-config.ts`
- Create: `api/_lib/cookies.ts`
- Create: `api/_lib/session-crypto.ts`
- Create: `api/_lib/server-config.test.ts`
- Create: `api/_lib/cookies.test.ts`
- Create: `api/_lib/session-crypto.test.ts`
- Modify: `tsconfig.app.json:19-22`
- Modify: `vitest.config.ts:4-12`

**Interfaces:**
- Produces: `getServerConfig(env?: NodeJS.ProcessEnv): ServerConfig`.
- Produces: `encryptSession(session: SessionPayload, key: Buffer): string` and `decryptSession(value: string, key: Buffer, now?: number): SessionPayload | undefined`.
- Produces: `createSessionCookie(value: string)`, `clearSessionCookie()`, `createOAuthStateCookie(state: string)`, `clearOAuthStateCookie()` and `readCookie(header: string | null, name: string): string | undefined`.

- [ ] **Step 1: 寫入 server config 與加密 session 的失敗測試**

建立 `api/_lib/server-config.test.ts`，驗證完整環境變數會產生下列物件；缺少任一值或 `SESSION_ENCRYPTION_KEY` 不是 base64url 解碼後 32 bytes 時拋出錯誤：

```ts
expect(getServerConfig({
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  SESSION_ENCRYPTION_KEY: base64url32ByteKey,
  GAS_DEPLOYMENT_ID: 'AKfycbDeploymentId',
})).toMatchObject({ googleClientId: 'client-id', gasDeploymentId: 'AKfycbDeploymentId' })
```

建立 `api/_lib/session-crypto.test.ts`，以固定 32-byte key 加密 `{ refreshToken: 'refresh-token', expiresAt: future }`，驗證解密結果相同；篡改一個字元與 `now > expiresAt` 時都得到 `undefined`。

建立 `api/_lib/cookies.test.ts`，驗證 session Cookie 字串包含 `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`，state Cookie 使用 `Max-Age=600`，清除 Cookie 使用同樣 path／security 屬性及 `Max-Age=0`。

- [ ] **Step 2: 執行 server helper 測試確認失敗**

Run: `npm test -- --run api/_lib/server-config.test.ts api/_lib/session-crypto.test.ts api/_lib/cookies.test.ts`

Expected: FAIL，因 server helper 尚不存在且 Vitest 尚未包含 `api/**/*.test.ts`。

- [ ] **Step 3: 實作安全 helper 與測試設定**

在 `server-config.ts` 定義：

```ts
export type ServerConfig = {
  googleClientId: string
  googleClientSecret: string
  sessionEncryptionKey: Buffer
  gasDeploymentId: string
}
```

在 `session-crypto.ts` 以 `node:crypto` 的 `randomBytes(12)`、`createCipheriv('aes-256-gcm', key, iv)` 與 auth tag 建立 `base64url(iv).base64url(tag).base64url(ciphertext)`；payload 僅含 `refreshToken` 與 `expiresAt`。解密時必須驗證三段格式、auth tag、JSON shape 與到期時間，任一失敗回傳 `undefined`。

在 `cookies.ts` 集中 cookie attribute，避免 auth routes 清除時遺漏 `Secure`、`SameSite` 或 `Path`。將 `tsconfig.app.json` 的 `types` 加入 `node` 並將 `include` 改為 `['src', 'api']`；將 `vitest.config.ts` include 加入 `api/**/*.test.ts`。

- [ ] **Step 4: 執行 helper 測試確認通過**

Run: `npm test -- --run api/_lib/server-config.test.ts api/_lib/session-crypto.test.ts api/_lib/cookies.test.ts`

Expected: PASS，驗證設定、加密、篡改、到期與 Cookie flags。

- [ ] **Step 5: 取得 commit 核可後提交 server helper**

先請使用者核可訊息 `新增安全工作階段伺服器工具`，再執行：

```bash
git add api/_lib/server-config.ts api/_lib/cookies.ts api/_lib/session-crypto.ts api/_lib/*.test.ts tsconfig.app.json vitest.config.ts
git commit -m "新增安全工作階段伺服器工具"
```

### Task 2: Google 授權碼與工作階段 HTTP routes

**Files:**
- Create: `api/_lib/google-oauth.ts`
- Create: `api/_lib/function-response.ts`
- Create: `api/auth/start.ts`
- Create: `api/auth/callback.ts`
- Create: `api/auth/logout.ts`
- Create: `api/session.ts`
- Create: `api/_lib/google-oauth.test.ts`
- Create: `api/auth/auth-routes.test.ts`

**Interfaces:**
- Consumes: `ServerConfig`、cookie helpers、`encryptSession`／`decryptSession`。
- Produces: `buildAuthorizationUrl(origin: string, state: string, config: ServerConfig): URL`.
- Produces: `exchangeAuthorizationCode(code: string, redirectUri: string, config: ServerConfig, fetchImpl?: typeof fetch): Promise<{ refreshToken: string }>`.
- Produces: GET `/api/auth/start`、GET `/api/auth/callback`、GET `/api/session`、POST `/api/auth/logout`。

- [ ] **Step 1: 寫入 OAuth URL 與 route 的失敗測試**

在 `google-oauth.test.ts` 驗證授權 URL 為 `https://accounts.google.com/o/oauth2/v2/auth`，並包含：

```ts
expect(url.searchParams).toMatchObject({
  client_id: 'client-id',
  redirect_uri: 'https://journal.example/api/auth/callback',
  response_type: 'code',
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: 'true',
  state: 'csrf-state',
})
```

mock `https://oauth2.googleapis.com/token`，驗證授權碼交換使用 `application/x-www-form-urlencoded` body，且無 `refresh_token` 時拒絕。

在 `auth-routes.test.ts` 直接呼叫 Web `Request` route exports。驗證 start 回傳 302、state Cookie 及 Google redirect；callback 對 state mismatch 回傳 400 並清除 state Cookie；成功 callback 產生加密 session Cookie、清除 state Cookie 並 redirect `/`；`GET /api/session` 對有效 cookie 回 `{ authenticated: true }`、無效或缺少 cookie 回 `{ authenticated: false }`；logout 回 204 並清除 session Cookie。

- [ ] **Step 2: 執行 OAuth route 測試確認失敗**

Run: `npm test -- --run api/_lib/google-oauth.test.ts api/auth/auth-routes.test.ts`

Expected: FAIL，因 OAuth helper 與 API routes 尚不存在。

- [ ] **Step 3: 實作 OAuth code flow 與 route response**

`buildAuthorizationUrl()` 必須請求既有 scopes：

```ts
const scopes = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/spreadsheets',
]
```

`exchangeAuthorizationCode()` 與 `refreshAccessToken()` 均只能在 server route 中使用 `GOOGLE_CLIENT_SECRET`。callback 必須以 `crypto.timingSafeEqual` 比較長度相同的 state、以 `new URL(request.url).origin` 組 redirect URI，並將 30 天後的 `expiresAt` 連同 refresh token 加密。

所有 route 使用 Web `Request`／`Response` API：

```ts
export async function GET(request: Request): Promise<Response> {
  // route-specific implementation
}
```

`function-response.ts` 必須允許同一 response append state 與 session 的多個 `Set-Cookie` header。callback 收到 Google `error`、state 不符、授權碼交換失敗或無 refresh token 時，不得建立 session。

- [ ] **Step 4: 執行 OAuth route 測試確認通過**

Run: `npm test -- --run api/_lib/google-oauth.test.ts api/auth/auth-routes.test.ts`

Expected: PASS，涵蓋 Google URL、CSRF state、授權碼交換、session probe 與 logout。

- [ ] **Step 5: 取得 commit 核可後提交 OAuth routes**

先請使用者核可訊息 `新增 Google 授權與工作階段路由`，再執行：

```bash
git add api/_lib/google-oauth.ts api/_lib/function-response.ts api/_lib/google-oauth.test.ts api/auth
git commit -m "新增 Google 授權與工作階段路由"
```

### Task 3: Server-side Apps Script proxy

**Files:**
- Create: `api/journal.ts`
- Create: `api/journal.test.ts`
- Modify: `api/_lib/google-oauth.ts`

**Interfaces:**
- Consumes: encrypted session Cookie、`refreshAccessToken(refreshToken, config)`、`GAS_DEPLOYMENT_ID`。
- Produces: POST `/api/journal`，接受 `ApiRequest` JSON 並傳回 Apps Script 原始 response JSON。

- [ ] **Step 1: 寫入 journal proxy 的失敗測試**

建立有效 session Cookie 與 mock token endpoint、GAS Execution API。驗證：

```ts
expect(fetch).toHaveBeenNthCalledWith(1, 'https://oauth2.googleapis.com/token', expect.objectContaining({ method: 'POST' }))
expect(fetch).toHaveBeenNthCalledWith(2,
  'https://script.googleapis.com/v1/scripts/AKfycbDeploymentId:run',
  expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({ Authorization: 'Bearer server-access-token' }),
    body: JSON.stringify({ function: 'executeAppRequest', parameters: [{ action: 'bootstrap' }] }),
  }),
)
```

另驗證 GET 回 405、缺少／無效 session 回 401 並清除 cookie、Google refresh 或 GAS 回 401/403 時回 401 並清除 cookie、一般 token/GAS 5xx 或網路錯誤回 502 且不清除有效 cookie。前端提供的 request 不可覆寫 `function: 'executeAppRequest'`。

- [ ] **Step 2: 執行 journal proxy 測試確認失敗**

Run: `npm test -- --run api/journal.test.ts`

Expected: FAIL，因 `/api/journal` 尚不存在。

- [ ] **Step 3: 實作 refresh 與固定 GAS proxy**

在 `google-oauth.ts` 新增：

```ts
export async function refreshAccessToken(
  refreshToken: string,
  config: ServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string>
```

它向 token endpoint POST `grant_type=refresh_token`、`client_id`、`client_secret` 與 `refresh_token`，只接受非空 `access_token`。

`api/journal.ts` 只接受 POST 與可解析的 JSON body。它從 session 取得 refresh token、刷新 access token，並固定建構：

```ts
JSON.stringify({ function: 'executeAppRequest', parameters: [requestBody] })
```

GAS response 以原 JSON status 200 回傳，讓前端保留既有 domain response 驗證。不可將 refresh token 或 access token 放入 response、錯誤 body、log 或 header。

- [ ] **Step 4: 執行 journal proxy 測試確認通過**

Run: `npm test -- --run api/journal.test.ts`

Expected: PASS，驗證 token 只用在 server-to-server GAS 請求、401 cookie 清除與 502 保留 session。

- [ ] **Step 5: 取得 commit 核可後提交 journal proxy**

先請使用者核可訊息 `新增伺服器端 GAS 請求代理`，再執行：

```bash
git add api/journal.ts api/journal.test.ts api/_lib/google-oauth.ts
git commit -m "新增伺服器端 GAS 請求代理"
```

### Task 4: 前端改用 server session 與自動 bootstrap

**Files:**
- Create: `src/services/journal-api-client.ts`
- Create: `src/services/journal-api-client.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/features/journal/use-journal.ts`
- Modify: `src/features/journal/use-journal.test.tsx`
- Modify: `src/i18n/zh-TW.ts`
- Delete: `src/services/google-oauth.ts`
- Delete: `src/services/google-oauth.test.ts`
- Delete: `src/services/execution-client.ts`
- Delete: `src/services/execution-client.test.ts`
- Delete: `src/config/runtime-config.ts`
- Delete: `src/config/runtime-config.test.ts`
- Delete: `src/types/google-identity.d.ts`

**Interfaces:**
- Produces: `JournalApiClient.restoreSession(): Promise<boolean>`、`beginSignIn(): void`、`signOut(): void`、`run<T>(request: ApiRequest): Promise<T>`。
- Produces: `AuthenticationError` 與 `JournalApiClientError`，供 hook 將 401/403 與可重試上游錯誤區分處理。
- Produces: `JournalClient` with `beginSignIn(): void`、`signOut(): void` and `run<T>(request: ApiRequest): Promise<T>`.
- Preserves: Journal CRUD、篩選、月曆、CSV 匯出與登出後的 request epoch 防護。

- [ ] **Step 1: 寫入前端 session client 與自動登入的失敗測試**

在 `journal-api-client.test.ts` mock `/api/session`、`/api/journal` 與 `/api/auth/logout`：session `{ authenticated: true }` 回 true、false 回 false；journal request 使用 `credentials: 'same-origin'`；401/403 映射為 `AuthenticationError`；非 JSON 或 5xx 映射為既有可操作網路錯誤；logout 使用 POST、`credentials: 'same-origin'` 與 `keepalive: true`。

在 `use-journal.test.tsx` 加入初始 restore 流程測試：render 後 client `restoreSession()` 回 true，hook 自動呼叫 bootstrap 並載入列表；回 false 時顯示「使用 Google 帳號登入」且沒有 bootstrap；bootstrap 401 時清除資料並轉未登入。驗證登入按鈕只呼叫 `beginSignIn()`，不直接呼叫 Google GIS。

- [ ] **Step 2: 執行前端 session 測試確認失敗**

Run: `npm test -- --run src/services/journal-api-client.test.ts src/features/journal/use-journal.test.tsx`

Expected: FAIL，因現有前端仍依賴 GoogleOAuth、ExecutionClient 與 runtime config。

- [ ] **Step 3: 實作同網域 session client 與自動恢復**

`JournalApiClient` 固定使用相對 URL：

```ts
fetch('/api/session', { credentials: 'same-origin' })
fetch('/api/journal', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(request),
})
```

`beginSignIn()` 呼叫 `window.location.assign('/api/auth/start')`；它不回傳 Google token。`signOut()` 以 keepalive POST 呼叫 `/api/auth/logout`，而 `useJournal.signOut()` 仍同步清除畫面 state 與使舊 request 失效。

`useJournal` 的初始 state 為連線中，mount effect 先呼叫 `restoreSession()`；成功後呼叫 bootstrap，否則設為 `signed-out`。`AuthenticationError` 在 restore、bootstrap、CRUD 或匯出發生時均立即呼叫既有 state 清除路徑，不保留舊記事。一般 `ExecutionClientError` 等網路錯誤維持 retry 畫面。

`App` 不再載入 runtime config 或 GoogleOAuth，直接建立 `JournalApiClient`。刪除舊瀏覽器 OAuth、直接 GAS client、runtime config、GIS 型別及其測試；更新所有注入 `JournalClient` 的測試 mock 為 `beginSignIn`。

- [ ] **Step 4: 執行前端 session 測試確認通過**

Run: `npm test -- --run src/services/journal-api-client.test.ts src/features/journal/use-journal.test.tsx src/App.test.tsx`

Expected: PASS，刷新自動 bootstrap、未登入顯示登入、401 清除資料、登出與舊 request 防護均通過。

- [ ] **Step 5: 取得 commit 核可後提交前端 session 改造**

先請使用者核可訊息 `改用伺服器端工作階段連線`，再執行：

```bash
git add src/App.tsx src/features/journal/use-journal.ts src/features/journal/use-journal.test.tsx src/services/journal-api-client.ts src/services/journal-api-client.test.ts src/i18n/zh-TW.ts
git rm src/services/google-oauth.ts src/services/google-oauth.test.ts src/services/execution-client.ts src/services/execution-client.test.ts src/config/runtime-config.ts src/config/runtime-config.test.ts src/types/google-identity.d.ts
git commit -m "改用伺服器端工作階段連線"
```

### Task 5: 移除前端設定、完成 Vercel routing 與部署文件

**Files:**
- Modify: `index.html:1-14`
- Modify: `vite.config.ts:1-17`
- Modify: `src/vite-env.d.ts:1-16`
- Modify: `.env.example:1-3`
- Delete: `public/app-config.example.js`
- Modify: `scripts/config-files.test.ts`
- Create: `vercel.json`
- Modify: `README.md`
- Modify: `docs/deployment.md`

**Interfaces:**
- Produces: Vercel routing where `/api/*` resolves Functions and SPA deep links resolve `index.html`.
- Produces: server-only environment variable documentation and manual verification instructions.

- [ ] **Step 1: 寫入移除瀏覽器設定與 Vercel routing 的失敗測試**

更新 `scripts/config-files.test.ts`，要求 `.env.example` 僅列出下列 server-only keys，且不包含 `APP_`、`SPREADSHEET_ID`、`ACCESS_TOKEN` 或 `REFRESH_TOKEN`：

```ts
expect(keys).toEqual([
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SESSION_ENCRYPTION_KEY',
  'GAS_DEPLOYMENT_ID',
])
```

新增檔案設定測試，驗證 `index.html` 不含 `accounts.google.com/gsi` 或 `app-config.js`，`vite.config.ts` 不含 `loadEnv`、`APP_GOOGLE_CLIENT_ID`、`APP_GAS_DEPLOYMENT_ID`，且 `vercel.json` 有 SPA fallback rewrite。 

- [ ] **Step 2: 執行設定測試確認失敗**

Run: `npm test -- --run scripts/config-files.test.ts`

Expected: FAIL，因目前仍嵌入 GIS script、前端 build config 與公開 `APP_` 變數。

- [ ] **Step 3: 實作 server-only 部署設定與文件**

移除 `index.html` 的 Google GIS 與 `app-config.js` script。將 `vite.config.ts` 簡化為 React plugin 與 `base: './'`，刪除 build config define、`JournalConfig` 全域型別及公開 app config 範例。

新增 `vercel.json`，先由 filesystem 處理 `/api/*` Functions，再以 catch-all 支援 Vite SPA 深連結：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

部署文件必須要求在 Vercel Production 設定四個 server-only values、在 Google OAuth Web Client 加入 `https://你的正式網域/api/auth/callback` 到授權重新導向 URI、更新 OAuth redirect 後重新部署。文件也必須明示：首次登入後刷新應自動進入首頁；若 Cookie 過期、Google 授權撤銷或登入其他瀏覽器，才再次走授權流程。

- [ ] **Step 4: 執行設定測試與完整品質檢查**

Run: `npm test -- --run scripts/config-files.test.ts && npm run check`

Expected: PASS，包含 API route 測試與完整前後端 TypeScript/Vite/GAS 驗證。

- [ ] **Step 5: 取得 commit 核可後提交 routing 與文件**

先請使用者核可訊息 `更新伺服器端登入部署設定`，再執行：

```bash
git add index.html vite.config.ts src/vite-env.d.ts .env.example scripts/config-files.test.ts vercel.json README.md docs/deployment.md
git rm public/app-config.example.js
git commit -m "更新伺服器端登入部署設定"
```

### Task 6: Production OAuth 與刷新手動驗收

**Files:**
- Modify: `docs/acceptance-checklist.md`

**Interfaces:**
- Verifies: Vercel Function、Google OAuth callback、加密 Cookie、session restore、GAS proxy 與本網站登出端對端行為。

- [ ] **Step 1: 補齊手動驗收清單**

在 `docs/acceptance-checklist.md` 加入以下可勾選項目：

```markdown
- [ ] Vercel Production 已設定 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、SESSION_ENCRYPTION_KEY、GAS_DEPLOYMENT_ID，且沒有 APP_GOOGLE_CLIENT_ID 或 APP_GAS_DEPLOYMENT_ID。
- [ ] OAuth Web Client 的授權重新導向 URI 包含正式網址 `/api/auth/callback`。
- [ ] 清除網站 Cookie 後首次登入可完成 Google 授權並回到首頁。
- [ ] 刷新 Production 網站後可直接載入記事，沒有 Google 帳號選擇或同意畫面。
- [ ] 點選登出後刷新網站仍顯示登入畫面，且 Google Sheets 資料未被刪除。
- [ ] 撤銷 Google 授權後刷新網站顯示登入畫面；重新授權後 CRUD 與 CSV 匯出正常。
```

- [ ] **Step 2: 執行完整品質檢查**

Run: `npm run check`

Expected: PASS，lint、所有 Vitest、production build 與 GAS bundle 全部成功。

- [ ] **Step 3: 取得 commit 核可後提交驗收清單**

先請使用者核可訊息 `補齊自動登入手動驗收清單`，再執行：

```bash
git add docs/acceptance-checklist.md
git commit -m "補齊自動登入手動驗收清單"
```
