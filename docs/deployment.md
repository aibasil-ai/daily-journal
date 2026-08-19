# 部署指南

本文件說明從空白 Google Cloud 與 Vercel 資源部署「每日記事」多使用者版本的流程。請勿將 OAuth Client Secret、加密金鑰、Firestore 服務帳號憑證或任何密鑰提交至 Git。

## 1. 建立 Google Cloud 專案與 API 啟用

1. 在 Google Cloud Console 建立標準 Google Cloud 專案。
2. 在「API 和服務 > 程式庫」中啟用下列 API：
   - **Google Sheets API**
   - **Google Drive API**
3. 建立 OAuth 同意畫面：
   - 應用程式類型選擇「外部」。
   - 新增 OAuth 範圍：`openid`、`https://www.googleapis.com/auth/userinfo.email`、`https://www.googleapis.com/auth/userinfo.profile`、`https://www.googleapis.com/auth/drive.file`、`https://www.googleapis.com/auth/spreadsheets`。
   - 若應用程式尚未公開驗證，將測試使用者的 Google 帳號加入名單。
4. 建立 OAuth 2.0「網頁應用程式」用戶端：
   - 保留 Client ID 與 Client Secret。
   - 在「已授權的重新導向 URI」加入正式回呼網址，例如：`https://daily-journal.example.com/api/auth/callback`。

## 2. 建立 Cloud Firestore 資料庫與服務帳號

1. 在 Google Cloud Console 進入 **Firestore**，建立資料庫（選擇 **Native mode** 原生模式）。
2. 在「IAM 與管理 > 服務帳號」建立專用的服務帳號（例如 `journal-firestore-api`）。
3. 賦予此服務帳號 **Cloud Datastore User**（或 **Firestore 使用者**）權限。
4. 進入該服務帳號建立新的 JSON 格式私密金鑰並下載保存。

## 3. 部署至 Vercel

1. 將儲存庫匯入 Vercel，使用預設的 Vite build 設定，建置指令為 `npm run build`，輸出目錄為 `dist`。
2. 在 Vercel Production 環境設定下列 10 個 server-only 環境變數：

```ini
# Google OAuth
GOOGLE_CLIENT_ID=您的_OAuth_網頁用戶端_ID
GOOGLE_CLIENT_SECRET=您的_OAuth_網頁用戶端密鑰
APP_ORIGIN=https://daily-journal.example.com

# AES-256-GCM 32-bytes base64url 加密金鑰
SESSION_ENCRYPTION_KEY=32_bytes_base64url_random_value
TOKEN_ENCRYPTION_KEY=32_bytes_base64url_random_value
TOKEN_ENCRYPTION_KEY_VERSION=v1

# Cloud Firestore
FIRESTORE_PROJECT_ID=您的_GCP_專案_ID
FIRESTORE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

# 保護管理與排程端點密鑰（各至少 32 字元）
LEGACY_MIGRATION_SECRET=至少32字元的隨機字串
CRON_SECRET=至少32字元的隨機字串
```

3. 可用下列指令產生 32-byte base64url 金鑰：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

4. 確認 OAuth Web Client 的重新導向 URI 與 `APP_ORIGIN` 網域一致，重新部署 Vercel 專案。

## 4. 設定定期清理排程 (Vercel Cron)

在 `vercel.json` 中可配置每小時或每日定期呼叫 `/api/cron/cleanup` 清理過期的工作階段與未完成的授權請求：

```json
{
  "crons": [
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 * * * *"
    }
  ]
}
```

Vercel Cron 在呼叫端點時會自動帶上 `Authorization: Bearer <CRON_SECRET>`。

## 疑難排解

| 問題 | 原因與修正 |
| --- | --- |
| `redirect_uri_mismatch` | 將目前正式網域的完整 `/api/auth/callback` URL 加入 Google OAuth Web Client 的授權重新導向 URI。 |
| Google Sheets / Drive API 403 | 確認 Google Cloud 專案已啟用 Google Sheets API 與 Google Drive API。 |
| Firestore 存取拒絕 | 確認 `FIRESTORE_SERVICE_ACCOUNT_JSON` 與 `FIRESTORE_PROJECT_ID` 相同，且服務帳號具備 Firestore 讀寫權限。 |
| 加密金鑰錯誤 | `SESSION_ENCRYPTION_KEY` 與 `TOKEN_ENCRYPTION_KEY` 必須是 32 random bytes 編碼後的 base64url 字串（43 字元）。 |
| 登入後提示 SCHEMA_MISMATCH | 選擇的試算表缺少必要的工作表或欄位結構，可使用「建立全新試算表」由系統自動初始化結構。 |

