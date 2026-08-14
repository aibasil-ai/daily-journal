# 部署指南

本文件說明從空白 Google 資源部署每日記事的流程。請勿將 Google Sheets ID、GAS Script ID、OAuth Client ID 以外的密鑰、使用者資料或存取權杖提交至 Git。

## 1. 建立 Google Sheets

1. 建立一份新的 Google Sheets，記下網址中 `/d/` 與 `/edit` 之間的 Sheet ID。
2. 在試算表選擇「檔案 > 設定」，將時區設定為實際使用時區，例如 `Asia/Taipei`。
3. 不需要預先建立工作表；`initializeJournal()` 會建立 `entries`、`categories` 與 `settings`。

## 2. 建立 Google Cloud 專案

1. 在 Google Cloud Console 建立標準 Google Cloud 專案。
2. 啟用 **Google Apps Script API**。
3. 建立 OAuth 同意畫面，將自己加入測試使用者（若應用程式尚未公開）。
4. 建立 OAuth 2.0「網頁應用程式」用戶端。
5. 在「授權 JavaScript 來源」加入 `http://localhost:5173` 與正式網站網域，例如 `https://journal.example.com`。
6. 不要加入 Vercel Preview 網址，因為每個 Preview 網域不同且不適合用於正式 OAuth 設定。

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
6. 在 Apps Script 編輯器選擇並手動執行無參數的 `initializeJournal()`，完成授權與工作表初始化。

> 進階用途：本機測試或程式碼中也可傳入 `initializeJournal('Sheet ID')`。正式部署建議以 Script Properties 保存 ID，再從編輯器執行無參數版本。

## 4. 部署 API Executable

1. 在 Apps Script 選擇「部署 > 新增部署」。
2. 類型選擇 **API Executable**。
3. 存取權設定為 **僅我自己**，並確認 `gas/appsscript.json` 的 `executionApi.access` 為 `MYSELF`。
4. 記下產生的 Deployment ID；它是前端的 `APP_GAS_DEPLOYMENT_ID`。

## 5. 建置靜態前端

提供下列兩個公開設定，不要提供 Client Secret：

```ini
APP_GOOGLE_CLIENT_ID=OAuth_網頁用戶端_ID
APP_GAS_DEPLOYMENT_ID=API_Executable_Deployment_ID
```

接著執行：

```bash
npm install
npm run build
```

輸出目錄為 `dist`。若主機無法提供建置環境變數，可建立未追蹤的 `public/app-config.js` 後再執行建置；格式請參考 `public/app-config.example.js`。

## 6. 靜態主機設定

| 平台 | 建置指令 | 輸出目錄 | 環境變數 |
| --- | --- | --- | --- |
| Vercel | `npm run build` | `dist` | 設定兩個 `APP_*` 變數 |
| Cloudflare Pages | `npm run build` | `dist` | 設定兩個 `APP_*` 變數 |
| Netlify | `npm run build` | `dist` | 設定兩個 `APP_*` 變數 |
| GitHub Pages | `npm run build -- --base=/<repository-name>/` | `dist` | 在 GitHub Actions 建置環境注入兩個變數 |
| 一般靜態主機 | 本機執行 `npm run build` | 上傳 `dist` | 使用建置變數或 `app-config.js` |

若日後新增前端路由，所有平台都應設定未知路徑回傳 `index.html`。目前應用程式不依賴任何 Vercel 專屬 API 或 Serverless Function。

GitHub Pages 的專案站點通常位於 `https://<owner>.github.io/<repository-name>/`。請將建置參數中的 `<repository-name>` 替換為實際儲存庫名稱；Vite 會一併將 `app-config.js` 與前端資源調整為正確的子路徑。

## 疑難排解

| 問題 | 原因與修正 |
| --- | --- |
| `origin_mismatch` | 將目前網站的協定、網域與連接埠完整加入 OAuth 用戶端的「授權 JavaScript 來源」。重新部署後再登入。 |
| Apps Script API 未啟用 | 確認 OAuth 用戶端、GAS 專案關聯的是同一個標準 Cloud 專案，並在該專案啟用 Google Apps Script API。 |
| GAS access denied | 確認 API Executable 部署為「僅我自己」，目前登入 Google 帳號與部署者相同，且 OAuth scope 已重新授權。 |
| 找不到 `SPREADSHEET_ID` | 到 GAS 專案設定新增 Script Property `SPREADSHEET_ID`，填入正確的 Sheet ID，再執行 `initializeJournal()`。 |
| Sheets 時區不正確 | 在 Google Sheets 的「檔案 > 設定」調整時區，然後重新整理網站。所有建立時間由試算表時區產生。 |
| 找不到部署設定 | 檢查 `APP_GOOGLE_CLIENT_ID`、`APP_GAS_DEPLOYMENT_ID` 是否在建置時存在，或確認 `public/app-config.js` 已在站點根目錄提供。 |
