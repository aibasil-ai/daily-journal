# 每日記事

可自行部署的繁體中文多使用者個人記事網站。每位使用者的記事保留在自己的 Google Sheets；Vercel Functions 代管 Google OAuth、Token 加密管理與 Google Sheets/Drive REST API，瀏覽器不會取得 Google access token 或 refresh token。

## 功能

- 多使用者獨立 Google Sheets 儲存：每位使用者可選擇雲端硬碟現有試算表或由系統自動建立初始化試算表。
- 新增、閱讀、編輯與永久刪除記事。
- 補登任意日期，支援一個啟用分類、多個標籤與多筆具名稱的網址連結。
- 以關鍵字、日期區間、分類與標籤交集篩選。
- 時間軸與月曆檢視；手機預設時間軸，平板與桌面預設月曆。
- 分類新增、重新命名與停用；歷史記事會保留已停用分類。
- 將目前篩選結果或全部記事下載為含 UTF-8 BOM 的 CSV。
- 資料表切換、結構修復與帳號資料清除。
- 首次授權後，30 天內刷新網站可自動恢復登入；可從網站安全登出。
- 使用 Vercel 部署前端與 serverless API，使用 Cloud Firestore Native mode 管理使用者連線與工作階段。

## 架構

```text
React + TypeScript + Vite
          |
          | 同網域 /api 與 HttpOnly Session Cookie
          v
Vercel Functions -- AES-256-GCM Refresh Token --> Cloud Firestore
          |
          +-- Google Sheets / Drive REST API --> 使用者 Google Sheets
```

- `src/`：React 前端、狀態、驗證與響應式介面。
- `api/`：Vercel Functions、OAuth 授權碼流程 (PKCE)、Firestore 儲存、Google Drive / Sheets REST API 用戶端。
- `shared/`：純領域核心型別、錯誤定義、驗證與記事服務邏輯。
- `docs/sample_pages/`：本專案採用的視覺與操作樣稿。

## 本機開發

先決條件：Node.js 20.19 以上、npm。

```bash
npm install
npm run dev
```

建立未追蹤的 `.env` 並填入 server-only 設定（請參考 `.env.example`）：

```ini
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APP_ORIGIN=
SESSION_ENCRYPTION_KEY=
TOKEN_ENCRYPTION_KEY=
TOKEN_ENCRYPTION_KEY_VERSION=
FIRESTORE_PROJECT_ID=
FIRESTORE_SERVICE_ACCOUNT_JSON=
LEGACY_MIGRATION_SECRET=
CRON_SECRET=
```

可用下列指令產生 32-byte base64url 金鑰：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

使用 Vercel CLI 的 `vercel dev` 可在本機同時提供前端與 `/api` Functions。詳細的 Google Cloud、Firestore 與 Vercel 設定請見 [部署文件](docs/deployment.md)。

## 品質檢查

```bash
npm run lint
npm run test:run
npm run build
npm run check
```

`npm run check` 會依序執行 lint、全部單元測試、前端 production build。

## 安全界線

- 使用者 Google refresh token 經 AES-256-GCM 加密後存於 Firestore，金鑰版本控管。
- 工作階段 Cookie 採用 AES-256-GCM 加密，內含隨機 sessionId，不含任何敏感憑證。
- 短效 access token 僅存在 Vercel Function 的單次上游請求生命週期中。
- 寫入排他鎖（write lease lock）與速率限制防止並行衝突與濫用。
- `.env`、建置產物均已列入 `.gitignore`。

