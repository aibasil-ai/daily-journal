# 每日記事

可自行部署的繁體中文個人記事網站。資料保留在部署者自己的 Google Sheets，前端透過 Google OAuth 與 Google Apps Script Execution API 存取，不會直接讀寫試算表。

## 功能

- 新增、閱讀、編輯與永久刪除記事。
- 補登任意日期，支援一個啟用分類、多個標籤與多筆具名稱的網址連結。
- 以關鍵字、日期區間、分類與標籤交集篩選。
- 時間軸與月曆檢視；手機預設時間軸，平板與桌面預設月曆。
- 分類新增、重新命名與停用；歷史記事會保留已停用分類。
- 將目前篩選結果或全部記事下載為含 UTF-8 BOM 的 CSV。
- 適用於 Vercel、Cloudflare Pages、Netlify、GitHub Pages 與一般靜態主機。

## 架構

```text
React + TypeScript + Vite
          |
          | Google OAuth access token
          v
Google Apps Script Execution API
          |
          v
Google Apps Script + Google Sheets
```

- `src/`：React 前端、狀態、驗證與響應式介面。
- `gas/src/`：可打包至 Apps Script 的領域服務、Sheets 儲存庫與受限 API 分派器。
- `docs/sample_pages/`：本專案採用的視覺與操作樣稿。

## 本機開發

先決條件：Node.js 20.19 以上、npm，以及 Python 3（專案已建立 `.venv`，不會納入版本控制）。

```bash
npm install
npm run dev
```

建立 `.env` 並填入公開的部署設定：

```ini
APP_GOOGLE_CLIENT_ID=
APP_GAS_DEPLOYMENT_ID=
```

也可以建立未追蹤的 `public/app-config.js`，內容可參考 `public/app-config.example.js`。詳細的 Google Cloud、GAS 與靜態主機設定請見 [部署文件](docs/deployment.md)。

## 品質檢查

```bash
npm run lint
npm run test:run
npm run build
npm run build:gas
npm run check
```

`npm run check` 會依序執行 lint、全部單元測試、前端 production build 與 GAS bundle。

## 安全界線

- `SPREADSHEET_ID` 只存於 GAS Script Properties，絕不傳到前端。
- Google access token 只保存在瀏覽器記憶體，不寫入 `localStorage`。
- `.env`、`.clasp.json`、`public/app-config.js`、建置產物與虛擬環境均已列入 `.gitignore`。
- GAS API Executable 應設為「僅我自己」存取。

## 第一版不支援

- 離線新增與同步。
- 提醒通知。
- 圖片或其他檔案上傳。
- 集中式多使用者資料服務。
- 富文字內容與分類重新啟用。
