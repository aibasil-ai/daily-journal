# 每日記事

可自行部署的繁體中文 Google Sheets 日記服務。每位使用者以自己的 Google 帳號登入，記事、分類、標籤、連結與設定永久保存在該使用者擁有的 Google Sheet；瀏覽器不會取得 Google access token 或 refresh token。

## 功能與資料界線

- 首次登入可建立新的「每日記事」Sheet，或連結自己擁有且符合 schema 的既有 Sheet。
- 每個 Google 帳號同時只有一份作用中的日記 Sheet；更換時會封存舊連線，不會複製、搬移、清空或刪除舊 Sheet 的資料。
- 支援記事、分類、搜尋、月曆與 CSV 匯出，所有 API 都依伺服器驗證的 session 選擇資料來源。
- 中央 Cloud Firestore Native mode 僅保存帳號對應、加密 refresh token、Sheet 連線、工作階段與短效設定流程資料；不保存日記內容、分類、標籤、連結或 CSV。
- 使用者 A 與 B 的 session、OAuth 憑證及 Sheet 連線完全分離；A 無法透過 API 讀取、修改、刪除或匯出 B 的資料。

## 架構

```text
React + TypeScript + Vite
          |
          | 同網域 /api 與 HttpOnly session Cookie
          v
Vercel Functions -- encrypted refresh token --> Google OAuth / Drive / Sheets API
          |
          v
Cloud Firestore Native mode
```

- `src/`：React 前端、資料空間設定與響應式介面。
- `api/`：Vercel Functions、OAuth、Firestore session、Google Drive／Sheets 代理與內部維護端點。
- `shared/`：前後端共用的日記領域邏輯。
- `docs/`：部署、驗收與營運文件。

公開使用者資料流程不使用 Apps Script 或固定共用 `SPREADSHEET_ID`。

## 本機開發

先決條件：Node.js 20.19 以上、npm，以及 Python 3（虛擬環境若需要請以 `python -m venv .venv` 建立，且不納入版本控制）。

```bash
npm install
npm run dev
```

建立未追蹤的 `.env`，填入下列 10 個 server-only 環境變數：

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

`SESSION_ENCRYPTION_KEY` 與 `TOKEN_ENCRYPTION_KEY` 都必須是不同的 32-byte base64url 隨機值。`LEGACY_MIGRATION_SECRET` 與 `CRON_SECRET` 也必須各自使用不同、以密碼學安全亂數產生的 base64url ASCII 值，且至少 32 個字元；不得重複使用任一加密金鑰或彼此共用值。每次執行下列指令只會產生一組值，請分別產生四組並只填入部署平台的 server-only 環境變數：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

詳細的 Google Cloud、Firestore、Vercel、OAuth 驗證與遷移程序請見[部署指南](docs/deployment.md)。

## OAuth 與安全

一般登入只請求下列 scopes：

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/drive.metadata.readonly`
- `https://www.googleapis.com/auth/drive.file`

Google 將 Sheets 或 Drive scope 視為敏感權限時，必須完成 OAuth 同意畫面所需驗證後才可公開服務。正式 callback 固定為 `APP_ORIGIN/api/auth/callback`，不可將不固定的 Vercel Preview URL 加入正式 OAuth 用戶端。

- refresh token 在寫入 Firestore 前以獨立的 `TOKEN_ENCRYPTION_KEY` 加密；短效 access token 只存在單次 Vercel Function 記憶體。
- 瀏覽器只保存 `HttpOnly`、`Secure`、`SameSite=Lax` 的不透明 session Cookie。
- Vercel 使用的 Firestore 服務帳號只應授予最小必要的 **Cloud Datastore User** 權限，不應持有 Google Drive、Google Sheets、Owner 或 Editor 廣泛權限。
- `vercel.json` 先以 filesystem 路由 `/api/*`，再將其餘路徑回退至 Vite SPA，並保留 `0 0 * * *` 排程，每日執行受 `CRON_SECRET` 保護的過期資料清理。
- Vercel Cron 使用 UTC 的標準 cron 表達式。Hobby 僅允許每日一次執行，且只有每小時精度；此每日排程預計在 UTC 00:00（台灣約 08:00）所在小時執行，不保證精確分鐘。若升級為 Pro 或 Enterprise，才可改回 `*/5 * * * *` 的每 5 分鐘清理。過期 session 與設定流程在每次請求時仍會檢查到期時間，不依賴 cron 才失效。
- Vercel Production 與 Preview 必須使用不同的 Firestore 資料庫、服務帳號、加密金鑰與 OAuth 設定；Preview 絕不可使用 Production refresh token 或資料庫。

## 舊個人 Sheet 遷移

遷移前必須先完整備份既有 Sheet。部署者先以目標 Google 帳號完成新的 OAuth 登入並停在資料空間設定流程，再由受信任的伺服器端管理程序呼叫 `POST /api/internal/migrate-legacy-sheet`，並提供 `Authorization: Bearer <LEGACY_MIGRATION_SECRET>`、該帳號的 `googleSub` 與完整 Google Sheet URL。

遷移程序會重新確認該帳號仍擁有 Sheet、schema 與所有既有資料列可讀，然後以 Firestore transaction 將其 claim 為作用中連線。它不會複製、清空、初始化、覆寫或寫入任何日記資料列。已遷移、非擁有、schema 不符、過期設定流程與未知 token 金鑰版本都會安全拒絕；未知金鑰版本的暫存資料不會被清除。

## Sheet 刪除規則

- 中斷連線或刪除帳號資料預設保留 Google Sheet。
- 只有服務建立的作用中 Sheet，使用者才可在明確二次確認後要求服務刪除。
- 使用者自行連結的既有 Sheet 永遠不由服務刪除，必須由使用者自行在 Google Drive 管理。

## 品質檢查

```bash
npm run lint
npm run test:run
npm run build
npm run check
```

## 法務文件

- [隱私權政策](/privacy-policy.html)
- [服務條款](/terms-of-service.html)
