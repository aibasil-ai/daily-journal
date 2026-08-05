# 每日記事

以 React、Google OAuth 與 Google Apps Script 建立的個人記事應用程式。資料儲存在使用者擁有的 Google Sheets；前端是可部署至靜態主機的網站。

## 功能

- 使用 Google 帳號登入，透過 Apps Script Execution API 讀寫資料。
- 新增、編輯、刪除記事，包含日期、分類、標籤與連結。
- 搜尋、日期範圍、分類及標籤的複合篩選。
- 時間軸與月曆檢視，月曆顯示每日記事數量。
- 分類管理與停用，以及 CSV 匯出，可直接以 Excel 開啟。

## 架構

瀏覽器只持有 Google OAuth 用戶端 ID 與 GAS Script ID。取得 OAuth access token 後，前端呼叫 Apps Script Execution API 的 `executeAppRequest`。GAS 將 Google Sheets ID 保存在「專案設定 > 指令碼屬性」的 `SPREADSHEET_ID`，並以試算表時區讀寫 `entries`、`categories` 與 `settings` 工作表。部署者必須在 GAS 編輯器手動執行無參數的 `initializeJournal` 建立 schema；前端不會呼叫它。

## 先決條件

- Node.js 20 以上與 npm。
- 可建立 Google Sheets、Google Cloud 與 Google Apps Script 資源的 Google 帳號。
- 部署 GAS 時需安裝 `@google/clasp`，並可執行 `clasp login`。

完整的 Google、GAS 與靜態主機部署步驟請見 [部署文件](docs/deployment.md)。實際上線前請逐項執行[手動驗收清單](docs/acceptance-checklist.md)。

## 本機開發

```bash
npm install
Copy-Item .env.example .env
```

在未追蹤的 `.env` 填入下列兩個公開前端設定值：

```dotenv
APP_GOOGLE_CLIENT_ID=你的 Google OAuth 用戶端 ID
APP_GAS_SCRIPT_ID=你的 GAS Script ID
```

啟動開發伺服器：

```bash
npm run dev
```

預設網址為 `http://localhost:5173`。此網址必須先加入 OAuth 用戶端的授權 JavaScript 來源。

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

前端只有下列兩個公開設定值：

- `APP_GOOGLE_CLIENT_ID`
- `APP_GAS_SCRIPT_ID`

可在靜態主機的建置環境變數設定它們，或將 `public/app-config.example.js` 複製成未追蹤的 `public/app-config.js` 後填入值，再執行建置。不要將本機 `.env`、`.clasp.json`、`public/app-config.js` 或任何資料庫識別資訊提交至 Git。

## 不支援功能

- 離線同步、衝突解決與多使用者共用記事。
- 提醒通知、檔案上傳或附件管理。
- 集中式後端資料庫、伺服器端帳密保管或權限管理。
- Google Sheets 以外的資料儲存後端。
