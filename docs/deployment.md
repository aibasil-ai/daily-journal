# 部署指南

本文件說明從空白 Google 資源部署每日記事至 Vercel 的流程。請勿將 Google Sheets ID、OAuth Client Secret、工作階段加密金鑰、使用者資料或任何存取權杖提交至 Git。

## 1. 建立 Google Sheets

1. 建立一份新的 Google Sheets，記下網址中 `/d/` 與 `/edit` 之間的 Sheet ID。
2. 在試算表選擇「檔案 > 設定」，將時區設定為實際使用時區，例如 `Asia/Taipei`。
3. 不需要預先建立工作表；`initializeJournal()` 會建立 `entries`、`categories` 與 `settings`。

## 2. 建立 Google Cloud 專案與 OAuth 用戶端

1. 在 Google Cloud Console 建立標準 Google Cloud 專案，並啟用 **Google Apps Script API**。
2. 建立 OAuth 同意畫面，若應用程式尚未公開，將使用者加入測試使用者。
3. 建立 OAuth 2.0「網頁應用程式」用戶端，保留 Client ID 與 Client Secret。
4. Vercel 正式網域建立後，在此 OAuth 用戶端的「授權重新導向 URI」加入完整網址，例如：

```text
https://daily-journal.tools.aibasil.com/api/auth/callback
```

> 瀏覽器不再直接載入 Google Identity Services，因此不需要加入授權 JavaScript 來源。不要加入 Vercel Preview 網址；每個 Preview 網域不同且不適合作為正式登入端點。

## 3. 建立與推送 GAS 專案

1. 在 Apps Script 建立專案，並在專案設定中關聯到上一步建立的 Google Cloud 專案。
2. 將 `.clasp.json.example` 複製成未追蹤的 `.clasp.json`，填入 GAS Script ID。
3. 安裝並登入 clasp：

```bash
npm install --global @google/clasp
clasp login
```

4. 建置並推送 GAS 程式碼：

```bash
npm run build:gas
clasp push
```

5. 在 Apps Script 專案設定的「Script Properties」新增 `SPREADSHEET_ID`，值為第 1 步的 Sheet ID。
6. 推送後重新整理 Apps Script 編輯器。在上方函式選單選擇無參數的 `initializeJournal`，按「執行」完成授權與工作表初始化。

> 打包產物會保留 Apps Script 可辨識的頂層 `initializeJournal()` 與 `executeAppRequest(request)`。請一律使用 `npm run build:gas` 後的 `clasp push` 推送，勿直接將 TypeScript 原始碼貼入 Apps Script 編輯器。

## 4. 部署 API Executable

1. 在 Apps Script 選擇「部署 > 新增部署」。
2. 類型選擇 **API Executable**。
3. 存取權設定為 **僅我自己**，並確認 `gas/appsscript.json` 的 `executionApi.access` 為 `MYSELF`。
4. 記下產生的 Deployment ID；它是 Vercel 的 `GAS_DEPLOYMENT_ID`。

> 第一次建立 API Executable 必須透過 Apps Script 編輯器完成；`clasp deploy` 無法指定部署類型。日後可用 `clasp redeploy <Deployment ID>` 更新已存在的 API Executable 版本。

## 5. 部署至 Vercel

1. 將儲存庫匯入 Vercel，使用預設的 Vite build 設定，建置指令為 `npm run build`，輸出目錄為 `dist`。
2. 在 Vercel Production 環境設定下列四個 server-only 環境變數：

```ini
GOOGLE_CLIENT_ID=OAuth_網頁用戶端_ID
GOOGLE_CLIENT_SECRET=OAuth_網頁用戶端密鑰
SESSION_ENCRYPTION_KEY=32_bytes_base64url_random_value
GAS_DEPLOYMENT_ID=API_Executable_Deployment_ID
```

3. 可用下列指令產生新的 `SESSION_ENCRYPTION_KEY`。每個部署環境必須使用穩定且不同的值；變更該值會使既有使用者工作階段全部失效。

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

4. 確認 OAuth Web Client 已加入第 2 節的正式 callback URL，再重新部署。
5. `vercel.json` 會先交由 filesystem 處理 `/api/*` Functions，再將其他路徑回退至 Vite 的 `index.html`。

首次登入後，使用者應回到首頁並看到記事。刷新正式網站時，30 天有效 Cookie 會自動恢復登入；只有 Cookie 到期、Google 授權遭撤銷或改用另一個瀏覽器時，才需要再次授權。

## 疑難排解

| 問題 | 原因與修正 |
| --- | --- |
| `redirect_uri_mismatch` | 將目前正式網域的完整 `/api/auth/callback` URL 加入 OAuth Web Client 的授權重新導向 URI，然後重新部署。 |
| Apps Script API 未啟用 | 確認 OAuth 用戶端、GAS 專案關聯的是同一個標準 Cloud 專案，並在該專案啟用 Google Apps Script API。 |
| GAS access denied | 確認 API Executable 部署為「僅我自己」，目前授權 Google 帳號與部署者相同，且 OAuth scope 已重新授權。 |
| `Script function not found` | 尚未建立 API Executable 部署。請在 Apps Script 選擇「部署 > 新增部署」，類型選擇「API Executable」。 |
| 找不到 `SPREADSHEET_ID` | 到 GAS 專案設定新增 Script Property `SPREADSHEET_ID`，填入正確 Sheet ID，再執行 `initializeJournal()`。 |
| `SESSION_ENCRYPTION_KEY` 無效 | 值必須是 32 random bytes 編碼後的 base64url 字串，不能使用一般密碼或帶有 `=` padding 的 base64。 |
| 刷新後仍顯示登入頁 | 檢查瀏覽器是否阻擋 Cookie、網站是否使用 HTTPS、Vercel 環境是否保留相同 `SESSION_ENCRYPTION_KEY`，以及 Google 授權是否已撤銷。 |
