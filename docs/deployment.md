# 部署指南

本服務以 Vercel Functions、Google OAuth、Google Drive／Sheets API 與 Cloud Firestore Native mode 組成。請勿將 OAuth Client Secret、Firestore 服務帳號 JSON、加密金鑰、`LEGACY_MIGRATION_SECRET`、`CRON_SECRET`、Sheet URL、token 或使用者資料提交至 Git。

## 1. 建立 Google Cloud 資源

1. 建立正式環境專用的 Google Cloud 專案，啟用 **Google Sheets API**、**Google Drive API** 與 **Cloud Firestore API**。
2. 在 Firestore 建立資料庫時選擇 **Native mode**，不是 Datastore mode。瀏覽器不得載入 Firebase 或 Firestore SDK。
3. 為 Vercel 建立專屬服務帳號，只授予此 Firestore 資料庫所需的最小權限 **Cloud Datastore User**（`roles/datastore.user`）。不要授予 Owner、Editor、Google Drive、Google Sheets 或使用者 OAuth 模擬權限。
4. 建立服務帳號 JSON，僅存到 Vercel 的 server-only 環境變數 `FIRESTORE_SERVICE_ACCOUNT_JSON`。
5. 為 Preview 另建 Google Cloud／Firestore 資源與服務帳號，或完全停用 Preview 的真實 Google 連線。Preview 絕不可指向 Production Firestore。

## 2. 設定 OAuth 同意畫面與 Web Client

1. OAuth Audience 設為 `External`，填妥支援聯絡信箱、正式網域、隱私權政策 URL 與服務條款 URL：

   ```text
   https://<正式網域>/privacy-policy.html
   https://<正式網域>/terms-of-service.html
   ```

2. 宣告且只宣告本服務需要的 scopes：

   ```text
   openid
   email
   profile
   https://www.googleapis.com/auth/spreadsheets
   https://www.googleapis.com/auth/drive.metadata.readonly
   https://www.googleapis.com/auth/drive.file
   ```

3. 若 Google 將任一 Sheets 或 Drive scope 判定為敏感，先完成 OAuth 驗證及發布要求，再開放一般使用者登入。
4. 建立 OAuth 2.0「網頁應用程式」Client。Production 的授權重新導向 URI 只能是固定正式網址：

   ```text
   https://<正式網域>/api/auth/callback
   ```

5. 不要把不固定的 Vercel Preview URL 加入 Production OAuth Client。Preview 若啟用 OAuth，必須有隔離的 Client、callback URL、使用者與資料庫。

`drive.metadata.readonly` 只供伺服器端列出與驗證使用者自己擁有的 Sheet；`drive.file` 只供刪除本服務建立且經明確確認的 Sheet。一般使用者流程不需要 Apps Script scope。

## 3. 設定 Vercel

1. 將儲存庫匯入 Vercel，建置指令使用 `npm run build`，輸出目錄是 `dist`。
2. 在每個環境設定以下 **10 個** server-only 環境變數。Production 與 Preview 的每一個值都必須隔離：

| 環境變數 | 用途 |
| --- | --- |
| `GOOGLE_CLIENT_ID` | 該環境的 OAuth Web Client ID。 |
| `GOOGLE_CLIENT_SECRET` | 該環境的 OAuth Web Client Secret。 |
| `APP_ORIGIN` | 固定 HTTPS 網站來源，用於 callback URL。 |
| `SESSION_ENCRYPTION_KEY` | 32-byte base64url session 保護金鑰。 |
| `TOKEN_ENCRYPTION_KEY` | 與 session 金鑰不同的 32-byte base64url refresh token 加密金鑰。 |
| `TOKEN_ENCRYPTION_KEY_VERSION` | 目前 refresh token 金鑰版本。 |
| `FIRESTORE_PROJECT_ID` | Firestore Native mode 的專案 ID。 |
| `FIRESTORE_SERVICE_ACCOUNT_JSON` | 僅限 Vercel Function 的服務帳號 JSON。 |
| `LEGACY_MIGRATION_SECRET` | 一次性舊個人 Sheet 遷移的 base64url ASCII 隨機密鑰，至少 32 個字元。 |
| `CRON_SECRET` | 清理排程的 base64url ASCII 隨機密鑰，至少 32 個字元，且不得與 `LEGACY_MIGRATION_SECRET` 相同。 |

3. 分別產生 `SESSION_ENCRYPTION_KEY`、`TOKEN_ENCRYPTION_KEY`、`LEGACY_MIGRATION_SECRET` 與 `CRON_SECRET` 四個不同的密碼學安全亂數值。每次執行下列指令只會產生一組值，請勿將輸出寫入文件、版本控制、CI log 或 issue：

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

4. 部署後確認 `vercel.json` 仍維持 filesystem-first 路由，讓 `/api/*` Functions 優先處理，其餘路徑才回退至 `/index.html`，並保留 `*/5 * * * *` 排程。其中的 cron 每 5 分鐘呼叫 `GET /api/internal/cleanup`；Vercel 會以 `CRON_SECRET` 送出 Bearer 授權。Vercel Cron 使用 UTC 的標準 cron 表達式；Hobby 方案僅允許每日一次執行且只有每小時精度，更頻繁的排程會使部署失敗。因此此每 5 分鐘設定必須使用 Pro 或 Enterprise，兩者才有每分鐘精度。

不要設定或保留 `GAS_DEPLOYMENT_ID`、固定 `SPREADSHEET_ID`、瀏覽器可讀的 Google OAuth 設定或 Vite 公開 token。

## 4. 上線前安全驗證

1. 確認 Firestore 是 Native mode，且 Vercel 服務帳號只有 Cloud Datastore User 最小權限。
2. 確認 Production 與 Preview 分別使用不同資料庫、服務帳號、加密金鑰、OAuth Client 與 callback origin。
3. 使用兩個不同 Google 帳號建立或連結各自的 Sheet，驗證 A 看不到 B 的任何記事、分類、搜尋結果、月曆、CSV 或 Sheet 連線。
4. 檢查 OAuth 同意畫面上的 scopes、隱私權政策、服務條款與支援資訊，並在需要時完成 Google OAuth 驗證。
5. 確認使用者自行連結的 Sheet 在中斷連線與刪除帳號後仍保留；只有服務建立的 Sheet 可在二次確認後刪除。

## 5. 備份優先的舊 Sheet 遷移

此程序只適用於既有部署者的一次性個人 Sheet 綁定，不是一般使用者資料匯入功能。

1. 先在 Google Drive 建立既有 Sheet 的完整備份，並確認備份可讀。
2. 部署多使用者版本，但不要刪除原 Sheet 或其備份。
3. 部署者以目標 Google 帳號登入，完成 OAuth callback，停在「設定您的資料空間」畫面。這會建立短效 provisioning attempt，暫存的 refresh token 只以加密形式保存。
4. 從受信任的伺服器端環境執行內部請求，不要在前端、瀏覽器主控台、issue 或 CI log 放入密鑰：

   ```http
   POST /api/internal/migrate-legacy-sheet
   Authorization: Bearer <LEGACY_MIGRATION_SECRET>
   Content-Type: application/json

   {"googleSub":"<目標帳號的 Google sub>","sheetUrl":"https://docs.google.com/spreadsheets/d/<Sheet-ID>/edit"}
   ```

5. 程序會重新使用暫存憑證取得短效 access token，驗證 Google Drive 擁有權、Sheets schema 與所有資料列，最後在一個 Firestore transaction 建立 `createdByService: false` 的作用中連線。
6. 遷移不會複製、清空、初始化、覆寫或寫入任何資料列。重複執行、非擁有者、schema 不符、已存在作用中連線、過期 attempt 或未知 token 金鑰版本都會安全拒絕。
7. 成功後以同一帳號重新登入並做唯讀驗證。原 Sheet 與備份都必須保留，直到驗收完成。

## 疑難排解

| 問題 | 原因與修正 |
| --- | --- |
| `redirect_uri_mismatch` | 將目前環境固定來源的完整 `/api/auth/callback` 加入相同環境的 OAuth Web Client。 |
| Google OAuth 尚未驗證 | 檢查 OAuth 同意畫面、敏感 scope、隱私權政策與服務條款 URL，完成 Google 要求的驗證。 |
| Firestore 存取失敗 | 確認資料庫為 Native mode、專案 ID 相符，且 Vercel 服務帳號具有 Cloud Datastore User。 |
| Preview 出現正式資料 | 立即停止 Preview 的真實連線，改用隔離 Firestore、OAuth Client、服務帳號與加密金鑰。 |
| 舊 Sheet 遷移被拒絕 | 確認先完成目標帳號 OAuth、attempt 尚未過期、輸入完整 Sheet URL、帳號仍為擁有者且 Sheet schema／資料列相容；不要嘗試清空或改寫 Sheet 來繞過檢查。 |
| cleanup 未執行 | 確認 Vercel Production cron 已啟用、`CRON_SECRET` 存在且 `/api/internal/cleanup` 未被 SPA fallback 覆蓋。 |
