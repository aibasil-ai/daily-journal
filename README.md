# 每日記事

以 React、Vercel Functions、Google OAuth 與 Google Apps Script 建立的個人記事應用程式。資料儲存在使用者擁有的 Google Sheets。

## 功能

- 使用 Google 帳號登入，透過伺服器端 session 安全讀寫資料。
- 新增、編輯、刪除記事，包含日期、分類、標籤與連結。
- 搜尋、日期範圍、分類及標籤的複合篩選。
- 時間軸與月曆檢視，月曆顯示每日記事數量。
- 分類管理與停用，以及 CSV 匯出，可直接以 Excel 開啟。

## 架構

瀏覽器只呼叫同網域的 `/api` 路由，不持有 Google OAuth 權杖、client secret 或 GAS deployment ID。Vercel Function 將加密的 refresh token 儲存在 HttpOnly session cookie，代理 Apps Script Execution API 請求。GAS 將 Google Sheets ID 保存在「專案設定 > 指令碼屬性」的 `SPREADSHEET_ID`，並以試算表時區讀寫 `entries`、`categories` 與 `settings` 工作表。部署者必須在 GAS 編輯器手動執行無參數的 `initializeJournal` 建立 schema；前端不會呼叫它。

## 先決條件

- Node.js 20 以上與 npm。
- 可建立 Google Sheets、Google Cloud 與 Google Apps Script 資源的 Google 帳號。
- 部署 GAS 時需安裝 `@google/clasp`，並可執行 `clasp login`。

完整的 Google、GAS 與 Vercel 部署步驟請見 [部署文件](docs/deployment.md)。實際上線前請逐項執行[手動驗收清單](docs/acceptance-checklist.md)。

## 本機開發

```bash
npm install
Copy-Item .env.example .env
```

在未追蹤的 `.env` 填入下列 Vercel server-only 設定值：

```dotenv
GOOGLE_CLIENT_ID=你的 Google OAuth Web Client ID
GOOGLE_CLIENT_SECRET=你的 Google OAuth Web Client Secret
SESSION_ENCRYPTION_KEY=32-byte base64url 隨機字串
GAS_DEPLOYMENT_ID=你的 GAS API Executable Deployment ID
```

啟動開發伺服器：

```bash
npm run dev
```

Vercel Functions 與前端共用正式網域；本機 Vite 開發伺服器不會模擬 OAuth callback。完整 OAuth 設定與驗收必須依部署文件使用 Vercel Production；Preview URL 不可作為 OAuth 驗收目標。

## 測試與建置

```bash
npm test
npm run test:run
npm run lint
npm run build
npm run build:gas
npm run check
```

`npm run build` 產生靜態前端至 `dist`；`npm run build:gas` 產生可由 clasp 推送的 GAS bundle 至 `gas-dist`。`npm run check` 依序執行 lint、全部 Vitest、前端 production build 與 GAS bundle。

## 部署設定

Vercel Production 環境只設定下列 server-only 值：

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_ENCRYPTION_KEY`
- `GAS_DEPLOYMENT_ID`

不要將本機 `.env`、`.clasp.json`、OAuth secret、session encryption key 或任何資料庫識別資訊提交至 Git。

## 不支援功能

- 離線同步、衝突解決與多使用者共用記事。
- 提醒通知、檔案上傳或附件管理。
- 集中式後端資料庫、多使用者權限管理或 Google Sheets 以外的資料儲存後端。
- Google Sheets 以外的資料儲存後端。
