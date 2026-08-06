# 伺服器端工作階段與自動登入設計

## 目標

讓個人每日記事 App 在使用者完成首次 Google 授權後，於瀏覽器刷新時自動恢復登入並載入記事資料。Google refresh token 僅在 Vercel 後端的加密 HttpOnly Cookie 內保存，前端不得取得或儲存 Google access token。

## 架構

網站從純靜態 Vite App 改為 Vite 前端加上 Vercel Serverless Functions。前端只呼叫同網域 `/api` 路由；Vercel Functions 解密工作階段、使用 refresh token 取得短效 access token，並代理 Apps Script Execution API 請求。

不使用資料庫。每位使用者的 refresh token 與到期時間加密後放入 HttpOnly、Secure、SameSite=Lax Cookie；伺服器以 `SESSION_ENCRYPTION_KEY` 進行 AES-256-GCM 加密與解密。Cookie 使用 30 天 `Max-Age`，包含隨機 IV 與驗證標籤。Cookie 內容與加密金鑰均不會提供給前端 JavaScript。

## OAuth 流程

1. 未登入使用者點選「使用 Google 帳號登入」，前端導向 `GET /api/auth/start`。
2. Function 產生不可預測的 OAuth state，將 state 以 10 分鐘 HttpOnly Cookie 保存，並轉址到 Google OAuth 授權碼流程，要求 `access_type=offline`、`prompt=consent` 與既有的 Apps Script、Sheets scopes。
3. Google 回呼 `GET /api/auth/callback`。Function 驗證 state Cookie，使用授權碼與 `GOOGLE_CLIENT_SECRET` 交換 refresh token。
4. Function 加密 refresh token 寫入工作階段 Cookie，移除 state Cookie，然後轉址回網站根路徑。
5. 前端載入時呼叫 `GET /api/session`；若 Cookie 有效，回傳已登入狀態並自動 bootstrap 記事。
6. 若沒有、解密失敗或 refresh token 已撤銷，Function 清除工作階段 Cookie 並回傳未登入狀態；前端顯示登入按鈕。

首次授權、Google 登出、撤銷授權、Cookie 過期或使用不同瀏覽器時，使用者必須再次完成 Google 登入與同意流程。

## 記事 API 代理

1. 前端將現有 `ApiRequest` POST 至 `POST /api/journal`。
2. Function 驗證工作階段 Cookie，使用 refresh token 向 Google token endpoint 換取短效 access token。
3. Function 以短效 access token 呼叫 `https://script.googleapis.com/v1/scripts/{GAS_DEPLOYMENT_ID}:run`，固定執行 `executeAppRequest` 並傳送前端請求資料。
4. Function 回傳既有 Apps Script response；前端沿用現有 domain response 驗證。
5. token 刷新或 GAS 授權失敗時，Function 清除工作階段 Cookie 並回傳 401；前端切回未登入畫面，且不顯示舊記事資料。

前端不再包含 `APP_GOOGLE_CLIENT_ID`、`APP_GAS_DEPLOYMENT_ID`、Google Identity Services SDK 或直接呼叫 Google API 的程式。

## 登出流程

1. 使用者在記事首頁點選「登出」。
2. 前端呼叫 `POST /api/auth/logout`。
3. Function 立即以相同 Cookie 屬性清除工作階段 Cookie，回傳 204。
4. 前端清除記事、篩選、月曆、編輯與匯出 state，切回未登入畫面。

登出只移除此網站的工作階段；不呼叫 Google revoke API，不刪除 Google Sheets 資料，也不登出 Google 帳號。

## 安全與設定

Vercel Production 環境變數：

- `GOOGLE_CLIENT_ID`：OAuth Web Client ID。
- `GOOGLE_CLIENT_SECRET`：OAuth Web Client Secret，只供 Function 使用。
- `SESSION_ENCRYPTION_KEY`：32-byte base64url 高熵隨機秘密值，用於 AES-256-GCM Cookie 加密。
- `GAS_DEPLOYMENT_ID`：Apps Script API Executable Deployment ID。

Google Cloud OAuth Web Client 必須將下列 URL 加入「授權重新導向 URI」：

```text
https://你的正式網域/api/auth/callback
```

不將上述設定值、refresh token、access token 或工作階段 Cookie 提交至 Git。瀏覽器與 Vercel API 必須全程 HTTPS；Cookie 必須設定 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/` 與 30 天 `Max-Age`。

## 錯誤處理

- state 遺失或不符：清除 state Cookie、回傳 400，且不建立工作階段。
- 授權碼交換失敗或未取得 refresh token：清除暫存 Cookie、回到未登入頁並顯示可操作錯誤。
- session Cookie 解密失敗：清除 Cookie 並回傳未登入狀態。
- refresh token 或 GAS 失效：清除 session Cookie、回傳 401；前端立即登出。
- 網路與非預期上游錯誤：不清除有效 Cookie，回傳 502；前端顯示既有重試提示。

## 測試

- Cookie 加密與解密、篡改拒絕、過期拒絕與 cookie 清除屬性。
- OAuth state 產生、驗證、授權碼交換與失敗路徑。
- journal proxy 使用 server-side access token 呼叫固定 GAS 函式，且不將 token 回傳前端。
- 前端首次載入成功 session 時自動 bootstrap；未登入、401 與登出時清除畫面 state。
- Vercel API route 與前端 API client 的 response／error 契約。
- `npm run check`，以及 Vercel Production 環境的實際 OAuth callback、刷新自動登入、登出與 GAS CRUD 手動驗收。
