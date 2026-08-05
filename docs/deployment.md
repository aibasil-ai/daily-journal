# 部署文件

本文件從空白的 Google 資源開始設定每日記事。前端只需要公開的 `APP_GOOGLE_CLIENT_ID` 與 `APP_GAS_SCRIPT_ID`；試算表識別資訊僅存在 GAS 的 Script Properties，絕不可寫入前端、設定範例或 Git。

## 先決條件

- Node.js 20 以上、npm，以及可建立 Google Cloud、Apps Script 與 Google Sheets 資源的 Google 帳號。
- 已安裝 clasp：`npm install --global @google/clasp`。
- 一個要部署網站的正式網域。使用 Vercel 時，這是 Production 網址，不是 Preview 網址。

## 1. 建立 Google Sheets 與時區

1. 在 Google Drive 建立新的 Google Sheets 試算表，初始內容可為空白。
2. 從試算表網址 `https://docs.google.com/spreadsheets/d/<Sheet ID>/edit` 記下 `<Sheet ID>`，僅在初始化時私下使用。
3. 在試算表選擇「檔案 > 設定」，將時區選為此日記實際使用的時區，例如 `Asia/Taipei`，然後儲存。

請先完成時區設定再初始化。GAS 會依這個試算表時區格式化日期與時間。

## 2. 建立標準 Google Cloud 專案並連結 GAS

1. 在 Google Cloud Console 建立一個標準 Google Cloud 專案，記下專案名稱以便後續選取。
2. 在「API 和服務 > 程式庫」啟用 **Google Apps Script API**。
3. 建立或開啟這個應用程式的 GAS 專案。在 Apps Script 的「專案設定」選擇變更 Google Cloud Platform (GCP) 專案，將它關聯至同一個標準 Google Cloud 專案。
4. 回到 Google Cloud Console，確認啟用 API 的專案與 GAS 關聯的專案相同。

## 3. 建立 OAuth 2.0 Web Client

1. 在該 Google Cloud 專案開啟「API 和服務 > 憑證」，建立「OAuth 用戶端 ID」。
2. 應用程式類型選擇「網頁應用程式」。
3. 在「授權 JavaScript 來源」新增下列值：

```text
http://localhost:5173
https://你的正式網域
```

若 Vercel Production 網域為 `https://daily-journal.vercel.app`，就新增該完整 origin。不要加入 Vercel Preview 網址；Preview 網址每次部署可能改變，且不應取得正式 OAuth 存取權。

4. 儲存後，複製 OAuth 用戶端 ID。此 ID 是前端的 `APP_GOOGLE_CLIENT_ID`；不要建立或使用前端密鑰。

## 4. 以 clasp 推送 GAS

在專案根目錄建立只供本機使用的 clasp 設定：

```powershell
Copy-Item .clasp.json.example .clasp.json
```

macOS 或 Linux 可使用：

```bash
cp .clasp.json.example .clasp.json
```

在未追蹤的 `.clasp.json` 填入 GAS Script ID，接著登入、建置並推送：

```bash
clasp login
npm run build:gas
clasp push
```

`gas-dist` 是 clasp 的推送目錄；不要直接修改其中產物。

## 5. 初始化空白試算表

推送完成後，開啟 GAS 編輯器，使用你自己的 `<Sheet ID>` 手動執行：

```ts
initializeJournal('你的 Sheet ID')
```

第一次執行會要求授權。完成後會在 Script Properties 保存試算表識別資訊，並建立 `entries`、`categories` 與 `settings` 工作表。`initializeJournal` 只供部署者在 GAS 編輯器手動初始化；前端與 UI 不得呼叫它。此值只能停留在 GAS；不得搬到 `.env`、`app-config.js` 或任何前端設定。

## 6. 部署 Apps Script Execution API

1. 在 GAS 編輯器選擇「部署 > 新增部署」。
2. 部署類型選擇 **API Executable**。
3. 存取權設定為「僅我自己」，完成部署。
4. 開啟 `gas/appsscript.json`，確認其設定包含：

```json
{
  "executionApi": { "access": "MYSELF" }
}
```

前端資料操作只會透過 Execution API 呼叫 `executeAppRequest`；這是前端唯一的 API 函式入口。`initializeJournal` 雖可從 GAS 編輯器手動執行，但不得由前端或 UI 透過 Execution API 呼叫。登入的 Google 帳號必須是有權使用這個 GAS 與試算表的帳號。

## 7. 設定前端並建置

兩個前端設定值的用途如下：

```dotenv
APP_GOOGLE_CLIENT_ID=你的 Google OAuth 用戶端 ID
APP_GAS_SCRIPT_ID=你的 GAS Script ID
```

在 Vercel、Cloudflare Pages、Netlify 與 GitHub Pages Actions 的建置環境變數設定這兩個值。若一般靜態主機無法提供建置環境變數，改為：

```powershell
Copy-Item public/app-config.example.js public/app-config.js
```

填入 `public/app-config.js` 的兩個值，再執行：

```bash
npm run build
```

`public/app-config.js` 必須保持未追蹤；建置後會被複製到 `dist/app-config.js`。無論採用哪種方式，前端產物目錄都固定為 `dist`。

## 8. 部署至靜態主機與 SPA fallback

所有平台均使用下列建置資料：

```text
Build command: npm run build
Output directory: dist
```

未知路由必須回傳 `index.html`，否則重新整理 SPA 路徑會得到 404。

### Vercel

1. 匯入 Git 儲存庫，Framework Preset 選擇 Vite。
2. Build Command 設為 `npm run build`，Output Directory 設為 `dist`。
3. 在 Production 環境加入兩個 `APP_` 設定值並部署。
4. 新增 SPA rewrite，例如專案根目錄的 `vercel.json`：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

只將 Production 網址加入 OAuth origin，不加入 Preview 網址。

### Cloudflare Pages

1. 建立 Pages 專案並連結 Git 儲存庫。
2. 將 Build command 設為 `npm run build`，Build output directory 設為 `dist`。
3. 在生產環境的 Environment variables 加入兩個 `APP_` 設定值。
4. 在 Pages 的 SPA fallback／rewrite 規則中，讓未知路徑回傳 `/index.html`。

### Netlify

1. 建立網站並連結 Git 儲存庫。
2. 將 Build command 設為 `npm run build`，Publish directory 設為 `dist`。
3. 在網站的建置環境變數加入兩個 `APP_` 設定值。
4. 設定 redirect：`/* /index.html 200`，使未知路徑回傳 SPA 入口。

### GitHub Pages Actions

1. 在 GitHub Actions 工作流程的建置步驟提供兩個 `APP_` 環境變數。
2. 執行 `npm ci` 與 `npm run build`，再將 `dist` 作為 Pages artifact 上傳。
3. GitHub Pages 沒有伺服器 rewrite 時，將 `dist/index.html` 複製為 `dist/404.html`，讓未知路徑載入 SPA 入口。
4. 將 Pages 正式網址加入 OAuth origin。

### 一般靜態主機

上傳 `dist` 內的所有檔案至網站根目錄，並在主機的 rewrite 規則設定「檔案不存在時回傳 `/index.html`」。若沒有建置環境變數，依第 7 節以未追蹤的 `public/app-config.js` 建置。

## 疑難排解

| 現象 | 原因與修正 |
| --- | --- |
| `OAuth origin_mismatch` | OAuth 用戶端的「授權 JavaScript 來源」必須與瀏覽器網址的協定、網域及連接埠完全相同。加入 `http://localhost:5173` 與正式網址；Vercel 僅加入 Production origin，不加入 Preview。 |
| Apps Script API 未啟用 | 在與 GAS 關聯的同一個標準 Google Cloud 專案啟用 Google Apps Script API。若剛變更關聯或啟用 API，等待權限生效後重新登入並再試。 |
| GAS access denied | 確認 GAS 已部署為 API Executable、存取權為「僅我自己」、`executionApi.access` 是 `MYSELF`，並以擁有 GAS 與試算表權限的同一 Google 帳號登入。 |
| 找不到 `SPREADSHEET_ID` | 尚未成功初始化。回到 GAS 編輯器，以實際試算表 ID 手動執行 `initializeJournal('你的 Sheet ID')` 並完成授權。不要把此值加入任何前端設定。 |
| Sheets 時區不正確 | 在試算表的「檔案 > 設定」修正時區，再重新確認記事日期與時間。初始化前就應完成此設定，避免跨日資料以錯誤時區建立。 |
