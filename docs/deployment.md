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

1. 在 Google Cloud Console 建立一個標準 Google Cloud 專案。
2. 在「IAM 與管理 > 設定」複製此 Cloud 專案的**專案編號**。這是一串純數字，不是專案 ID，也不是 GAS Script ID。
3. 在「API 和服務 > 程式庫」啟用 **Google Apps Script API**。
4. 建立或開啟這個應用程式的 GAS 專案，左側點選齒輪「專案設定」。
5. 在「Google Cloud Platform (GCP) 專案」區塊點選「變更專案」，貼入第 2 步的專案編號，然後按「設定專案」。
6. 回到 Google Cloud Console，確認啟用 API 的專案與 GAS 關聯的專案相同。

若 GAS 欄位顯示紅框或無法設定，請確認使用同一個 Google 帳號、你對目標 Cloud 專案具有擁有者或編輯者權限，且目標是自行建立的標準 Cloud 專案，不是其他 Apps Script 自動建立的預設專案。

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

### 測試模式與測試使用者

個人使用時，不需要立刻送 Google 驗證或發布 OAuth App。維持「測試中」即可，但必須將自己的 Google 帳號加入測試使用者：

1. 在同一個 Cloud 專案開啟「Google Auth Platform > 目標對象」；舊版介面可從「API 和服務 > OAuth 同意畫面」進入。
2. 在「測試使用者」點選「新增使用者」。
3. 輸入實際用來登入 GAS 與 App 的 Google 帳號電子郵件並儲存。

若授權畫面顯示「尚未完成 Google 驗證程序」及 `403: access_denied`，通常代表登入帳號未加入此清單。新增後等待 1 至 5 分鐘再試。

## 4. 以 clasp 推送 GAS

以下指令都在自己的電腦、專案根目錄執行，例如 `C:\path\to\journal`。先確認 Node.js 與 npm 可用，然後安裝 clasp：

```powershell
node --version
npm --version
npm install --global @google/clasp
clasp --version
```

若安裝成功後 PowerShell 仍顯示「`clasp` 無法辨識」，關閉並重新開啟 PowerShell 後再執行 `clasp --version`。也可不進行全域安裝，改在以下所有 `clasp` 指令前加上 `npx --yes @google/clasp@latest`。

在首次 `clasp login` 前，使用同一個 Google 帳號開啟 `https://script.google.com/home/usersettings`，啟用 Google Apps Script API 的使用者存取權。這與第 2 節在 Cloud 專案啟用 API 是兩個都需要的設定；若公司或學校帳號無法啟用，請聯絡 Workspace 管理員。

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

`gas-dist` 是 clasp 的推送目錄；不要直接修改其中產物。初次推送到只含 `myFunction` 的空白 GAS 專案時，clasp 詢問是否覆寫是正常的，可確認覆寫。若剛啟用 Apps Script API，等待 1 至 5 分鐘後再執行 `clasp push`。

## 5. 初始化空白試算表

推送完成後，開啟 GAS 編輯器並完成下列步驟：

1. 選擇「專案設定 > 指令碼屬性」，新增屬性名稱 `SPREADSHEET_ID`，值填入第 1 節私下記下的 `<Sheet ID>`，然後儲存。
2. 重新整理 GAS 編輯器。推送後左側應出現 `Code.js`；不要手動把程式貼到預設的 `myFunction` 檔案。
3. 在頂端工具列「執行」右側的函式下拉選單，選擇 `initializeJournal`。此函式不需要、也不能填入任何參數。
4. 點選三角形「執行」。首次執行會開啟 Google 授權流程；選擇擁有 GAS 與試算表存取權的帳號並允許必要權限。

第一次執行會要求授權。`initializeJournal` 只會以既有的 `SPREADSHEET_ID` 冪等建立 `entries`、`categories` 與 `settings` 工作表，不會寫入或變更此屬性。它只供部署者在 GAS 編輯器手動初始化；前端與 UI 不得呼叫它。此值只能停留在 GAS；不得搬到 `.env`、`app-config.js` 或任何前端設定。

## 6. 部署 Apps Script Execution API

1. 在 GAS 編輯器選擇「部署 > 新增部署」。
2. 部署類型選擇 **API Executable**。
3. 存取權設定為「僅我自己」，完成部署。
4. 在本機專案開啟 `gas/appsscript.json`，確認其設定包含：

```json
{
  "executionApi": { "access": "MYSELF" }
}
```

這個檔案位於本機專案的 `gas/appsscript.json`，修改後需重新執行 `npm run build:gas` 與 `clasp push`。若要在 GAS 網頁編輯器查看它，先到「專案設定」開啟「在編輯器中顯示 `appsscript.json` 資訊清單檔案」；建議仍以本機版本為準，避免網頁端改動被下次推送覆蓋。

前端資料操作只會透過 Execution API 呼叫 `executeAppRequest`；這是前端唯一的 API 函式入口。`initializeJournal` 是僅供部署時使用的特權工具，因 GAS 編輯器需要全域函式才可手動執行。持有同一擁有者權杖的 Execution API 呼叫在技術上可以指定全域函式名稱，但本應用前端與 UI 不會呼叫它；即使被呼叫，它沒有參數、無法變更 `SPREADSHEET_ID`，且只會冪等確保 schema。登入的 Google 帳號必須是有權使用這個 GAS 與試算表的帳號。

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
| `clasp` 無法辨識 | 在本機執行 `npm install --global @google/clasp`，完成後重開 PowerShell，再以 `clasp --version` 確認。也可改用 `npx --yes @google/clasp@latest <指令>`。 |
| `User has not enabled the Apps Script API` | 使用同一個 Google 帳號開啟 `https://script.google.com/home/usersettings` 並啟用 Apps Script API 使用者存取權，等待 1 至 5 分鐘後重新執行 `clasp login` 與 `clasp push`。 |
| 授權出現 `403: access_denied` 或「尚未完成 Google 驗證程序」 | 在同一 Cloud 專案的「Google Auth Platform > 目標對象 > 測試使用者」加入實際登入帳號。個人測試不需要發布為正式版。 |
| GAS 工具列顯示「沒有函式」 | 先確認 `npm run build:gas` 與 `clasp push` 都成功，重新整理 GAS 編輯器，並確認左側有推送後的 `Code.js`。不要手動修改預設 `myFunction`。 |
| GAS access denied | 確認 GAS 已部署為 API Executable、存取權為「僅我自己」、`executionApi.access` 是 `MYSELF`，並以擁有 GAS 與試算表權限的同一 Google 帳號登入。 |
| 找不到 `SPREADSHEET_ID` | 在 Apps Script「專案設定 > 指令碼屬性」新增 `SPREADSHEET_ID`，值填入實際 Google Sheets ID；回到編輯器選擇無參數的 `initializeJournal` 執行並完成授權。不要把此值加入任何前端設定。 |
| Sheets 時區不正確 | 在試算表的「檔案 > 設定」修正時區，再重新確認記事日期與時間。初始化前就應完成此設定，避免跨日資料以錯誤時區建立。 |
