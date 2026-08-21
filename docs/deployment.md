# 正式環境逐步部署手冊

本手冊以「第一次將此專案部署到正式網域」為目標，依序完成 Vercel、Google Cloud、Google OAuth 與 Cloud Firestore 設定。請照順序操作，不要跳過安全檢查。

> 本專案的 Google Sheets 存取權來自每位使用者自己的 Google OAuth 授權。Vercel 的 Firestore 服務帳號**不需要**、也不應具有 Google Drive 或 Google Sheets 權限。

## 開始前先準備

完成下列項目後再開始：

- 一個 GitHub 儲存庫，且 `main` 是要部署的正式分支。
- 一個可管理 DNS 的正式網域，例如 `journal.example.com`。
- 可建立 Google Cloud 專案、啟用計費與建立服務帳號的 Google 帳號。
- 一個 Vercel 帳號；Hobby 方案即可部署目前的每日 cleanup cron。Vercel Hobby 只支援每日一次、每小時精度，不保證精確分鐘；若日後要每 5 分鐘清理，才需要 Pro 或 Enterprise。
- Node.js `24.x`（與 `package.json` 的 `engines` 設定一致）與 npm。以下終端機指令以 PowerShell 為例。

以下用 `<正式網域>` 代表你的實際網域。假設你選擇 `journal.example.com`，後續所有範例都要改成：

```text
https://journal.example.com
```

不要使用含路徑、查詢字串或結尾斜線的值，例如 `https://journal.example.com/` 或 `https://journal.example.com/app` 都不正確。

## 第 1 步：先在本機確認要部署的版本

1. 在專案根目錄開啟 PowerShell。
2. 確認 Node.js 版本為 `24.x`（需與 `package.json` 的 `engines` 一致）：

   ```powershell
   node --version
   ```

3. 安裝鎖定版本的套件並執行完整檢查：

   ```powershell
   npm ci
   npm run check
   ```

4. 確認指令全部成功後，將要部署的程式推送到 GitHub 的 `main` 分支。
5. 不要建立或提交真實 `.env`、服務帳號 JSON、OAuth secret、Sheet URL、token 或任何下文產生的密鑰。`.env` 已受 `.gitignore` 保護，`.env.example` 必須保持空值範本。

## 第 2 步：建立正式 Google Cloud 專案與 Firestore

### 2-1. 建立專案

1. 開啟 [Google Cloud Console](https://console.cloud.google.com/)。
2. 點選頂端的專案選擇器，選擇 **New Project／新增專案**。
3. 專案名稱可填 `daily-journal-production`；專案 ID 請記下，後面會填入 `FIRESTORE_PROJECT_ID`。
4. 選擇正確的組織或位置後，點選 **Create／建立**。
5. 建立完成後，從頂端專案選擇器切換到剛建立的專案。
6. 若 Console 顯示需要啟用計費帳戶，請依畫面連結完成。Firestore 與 Google API 的可用功能會受計費與配額影響。

### 2-2. 啟用必要 API

1. 左側選單開啟 **APIs & Services／API 和服務** > **Library／程式庫**。
2. 依序搜尋下列 API，進入各自頁面後點選 **Enable／啟用**：

   ```text
   Google Sheets API
   Google Drive API
   Cloud Firestore API
   ```

3. 回到 **APIs & Services** > **Enabled APIs & services／已啟用的 API 和服務**，確認三個 API 都在清單中。
4. 不需要啟用 Apps Script API，也不要建立固定共用的 Spreadsheet ID。

### 2-3. 建立 Firestore Native mode 資料庫

1. 左側選單開啟 **Firestore**；若看到 **Create database／建立資料庫**，點選它。
2. 先在「選取版本」選擇 **Standard 版**，不要選 Enterprise 版。專案不使用 MongoDB 相容 Firestore。
3. 選擇 Standard 版後，「資料庫 ID」請保持**空白**，不要填入 `daily-journal-db` 或任何自訂名稱。Google 會自動建立名為 `(default)` 的資料庫；目前程式建立 Firestore 用戶端時沒有設定 `databaseId`，只會連線到這個預設資料庫。若欄位仍顯示必填紅字，表示 Enterprise 版尚未取消，請先返回確認 Standard 版已選取。
4. 在「模式」選擇 **原生模式的 Firestore**，不要選「與 MongoDB 相容的 Firestore」。
5. 在「安全性規則」選擇 **限定**，不要選「開啟」。本專案不會讓瀏覽器直接讀寫 Firestore；Vercel 的服務帳號會透過 IAM 的 `roles/datastore.user` 存取資料。
6. 「啟用即時更新」保持**未勾選**。專案未使用 Firebase 網頁或行動 SDK 的即時快照功能，且此設定建立後無法變更。
7. 選擇符合資料所在地與延遲需求的區域。建立後區域通常不能直接變更，請先確認。
8. 依 Console 流程完成建立。
9. 建立後開啟 **Firestore** > **Data／資料**，確認能看到 `(default)` 資料庫。

本服務只從 Vercel Function 使用 Google Cloud Firestore 用戶端，不會讓瀏覽器載入 Firebase 或 Firestore SDK。不要把 Firestore 規則當成網站使用者的登入機制，也不要將 Firestore 憑證放入前端。

### 2-4. 建立 Vercel 專用服務帳號與 JSON 金鑰

1. 左側選單開啟 **IAM & Admin／IAM 和管理** > **Service Accounts／服務帳號**。
2. 點選 **Create service account／建立服務帳號**。
3. 名稱可填 `daily-journal-vercel`，描述可填「Vercel Functions access to Firestore」。點選 **Create and Continue／建立並繼續**。
4. 在角色選擇器搜尋並加入 **Cloud Datastore User**，其角色 ID 是 `roles/datastore.user`。
5. 不要加入 Owner、Editor、Google Drive、Google Sheets 或使用者 OAuth 模擬等廣泛權限。點選完成。
6. 在服務帳號清單中點選剛建立的帳號，再開啟 **Keys／金鑰** 分頁。
7. 點選 **Add Key／新增金鑰** > **Create new key／建立新金鑰** > 選擇 **JSON** > **Create／建立**。
8. 瀏覽器會下載 JSON 檔。將檔案存放在受保護的位置，**不要**放進專案、Google Drive 公開資料夾、GitHub、issue、聊天訊息或截圖。
9. 保留這個檔案到第 6 步；之後會把完整內容貼到 Vercel 的 `FIRESTORE_SERVICE_ACCOUNT_JSON`。

## 第 3 步：建立 Vercel 專案並綁定正式網域

### 3-1. 匯入 GitHub 儲存庫

1. 登入 [Vercel Dashboard](https://vercel.com/dashboard)。
2. Hobby、Pro 與 Enterprise 都可部署目前設定。專案預設每日清理一次；不需要為此先升級方案。
3. 點選 **Add New...** > **Project**。
4. 在 GitHub 區塊找到此專案的儲存庫，點選 **Import**。
5. 在 Configure Project 畫面設定：

   | 欄位 | 填寫方式 |
   | --- | --- |
   | Framework Preset | 選擇 `Vite`；若 Vercel 已自動偵測為 Vite，保留即可。 |
   | Root Directory | 保持專案根目錄 `.`。 |
   | Build Command | `npm run build`。 |
   | Output Directory | `dist`。 |
   | Install Command | 保持自動偵測即可。 |
   | Production Branch | `main`。 |

6. 先不要把 Production 的環境變數勾選到 Preview；詳細填寫方式在第 6 步。
7. 可以先完成首次部署，或先繼續設定正式網域。尚未設定環境變數時，靜態頁面可部署，但登入 API 尚不能正常使用。

### 3-2. 設定正式網域與 DNS

1. 進入 Vercel 專案，開啟 **Settings** > **Domains**。
2. 輸入正式網域，例如 `journal.example.com`，點選 **Add／新增**。
3. Vercel 會顯示需要新增的 DNS 記錄。開啟你的網域註冊商或 DNS 代管商後台，逐字新增 Vercel 顯示的 CNAME 或 A 記錄。
4. 回到 Vercel 等待狀態變成 **Valid Configuration／設定有效**。DNS 傳播可能需要幾分鐘至數小時。
5. 用瀏覽器開啟 `https://<正式網域>/privacy-policy.html` 與 `https://<正式網域>/terms-of-service.html`。正式發佈前兩個頁面都必須可開啟。

現在確定此正式來源：

```text
APP_ORIGIN=https://<正式網域>
```

後面 Google OAuth callback、隱私權政策與服務條款 URL 都必須使用這個完全相同的網域。

## 第 4 步：設定 Google OAuth 同意畫面與 Web Client

Google Cloud Console 的選單可能顯示為 **Google Auth Platform**，舊介面則可能顯示在 **APIs & Services** > **OAuth consent screen／OAuth 同意畫面**。請在第 2 步建立的正式 Google Cloud 專案中操作。

### 4-1. 填寫同意畫面

1. 開啟 **Google Auth Platform**。
2. 在 **Branding／品牌資訊** 填入應用程式名稱、使用者支援電子郵件與開發人員聯絡電子郵件。
3. 填入下列 URL，並把 `<正式網域>` 換成自己的網域：

   ```text
   首頁：https://<正式網域>
   隱私權政策：https://<正式網域>/privacy-policy.html
   服務條款：https://<正式網域>/terms-of-service.html
   ```

4. 將正式根網域新增到 **Authorized domains／已授權網域**。例如使用 `journal.example.com` 時，依 Google 畫面要求填入 `example.com` 或可接受的子網域形式。
5. 若 Google 要求網域驗證，依畫面連結至 Search Console 完成驗證後再回來繼續。
6. 在 **Audience／目標對象** 選擇 **External／外部**。
7. 若應用程式仍是 Testing 狀態，先在 **Test users／測試使用者** 加入自己的測試 Google 帳號；未列入的人無法測試登入。

### 4-2. 宣告最小必要 scopes

1. 在 **Data Access／資料存取權** 點選 **Add or Remove Scopes／新增或移除範圍**。
2. 加入且只加入下列 scopes：

   ```text
   openid
   email
   profile
   https://www.googleapis.com/auth/spreadsheets
   https://www.googleapis.com/auth/drive.metadata.readonly
   https://www.googleapis.com/auth/drive.file
   ```

3. 儲存設定。
4. Google 可能將 Sheets 或 Drive scope 視為敏感權限。若 Console 顯示驗證需求，先完成所要求的隱私權政策、網域、品牌與 OAuth 驗證，才開放一般使用者使用。

`drive.metadata.readonly` 只用來列出和驗證使用者自己擁有的 Sheet；`drive.file` 只允許刪除本服務建立且使用者明確確認的 Sheet。

### 4-3. 建立正式 OAuth Web Client

1. 在 **Clients／用戶端** 點選 **Create Client／建立用戶端**。
2. Application type 選擇 **Web application／網頁應用程式**。
3. 名稱可填 `daily-journal-production`。
4. 在 **Authorized redirect URIs／已授權的重新導向 URI** 新增唯一一筆：

   ```text
   https://<正式網域>/api/auth/callback
   ```

5. 不要把不固定的 Vercel Preview URL、新增臨時網址或其他人的網域加到這個正式 Client。
6. 建立後，複製 **Client ID** 與 **Client secret** 到安全的密碼管理工具。Client secret 只應貼入 Vercel，不要傳給前端或提交到 Git。

## 第 5 步：產生四個獨立密鑰

在安全的本機 PowerShell 執行一次下列指令。它會產生四個不同的 32-byte base64url 值：

```powershell
node --input-type=module -e "import { randomBytes } from 'node:crypto'; for (const name of ['SESSION_ENCRYPTION_KEY', 'TOKEN_ENCRYPTION_KEY', 'LEGACY_MIGRATION_SECRET', 'CRON_SECRET']) console.log(name + '=' + randomBytes(32).toString('base64url'))"
```

1. 將四行輸出暫時保存在受保護的密碼管理工具中。
2. 不要將輸出存進 `.env.example`、Git、CI log、issue、電子郵件、截圖或公開文件。
3. 四個值都是 base64url 隨機值，且 `LEGACY_MIGRATION_SECRET` 與 `CRON_SECRET` 都必須至少 32 個字元。
4. 四個值必須都不同；不得讓 session 金鑰與 token 金鑰相同，也不得讓 migration secret 與 cron secret 相同。
5. `TOKEN_ENCRYPTION_KEY_VERSION` 不需要隨機值，正式首次部署可設定為 `v1`。

## 第 6 步：在 Vercel 設定 10 個 Production 環境變數

1. 回到 Vercel 專案，開啟 **Settings** > **Environment Variables**。
2. 每次新增一個變數時，只勾選 **Production**。不要同時勾選 Preview 或 Development。
3. 依下表逐一新增，總數必須正好是 10 個：

   | 名稱 | 要貼上的值 | 填寫時檢查 |
   | --- | --- | --- |
   | `GOOGLE_CLIENT_ID` | 第 4-3 步取得的 Client ID。 | 對應正式 OAuth Web Client。 |
   | `GOOGLE_CLIENT_SECRET` | 第 4-3 步取得的 Client secret。 | 不可用於前端或以 `VITE_` 開頭。 |
   | `APP_ORIGIN` | `https://<正式網域>` | HTTPS、沒有結尾 `/`、沒有路徑。 |
   | `SESSION_ENCRYPTION_KEY` | 第 5 步產生的同名值。 | 32-byte base64url；不可與下一列相同。 |
   | `TOKEN_ENCRYPTION_KEY` | 第 5 步產生的同名值。 | 32-byte base64url；不可與上一列相同。 |
   | `TOKEN_ENCRYPTION_KEY_VERSION` | `v1` | 只能使用英數、`_` 或 `-`。 |
   | `FIRESTORE_PROJECT_ID` | 第 2-1 步建立的 Google Cloud 專案 ID。 | 必須與 JSON 的 `project_id` 相同。 |
   | `FIRESTORE_SERVICE_ACCOUNT_JSON` | 第 2-4 步下載 JSON 檔的完整內容。 | 直接貼原始 JSON；不要包成額外引號、不要刪除 `private_key` 內容。 |
   | `LEGACY_MIGRATION_SECRET` | 第 5 步產生的同名值。 | 至少 32 字元，且不可與 `CRON_SECRET` 相同。 |
   | `CRON_SECRET` | 第 5 步產生的同名值。 | 至少 32 字元；Vercel Cron 會自動以 Bearer header 傳送。 |

4. 每新增一個值就按 **Save／儲存**。如果 Vercel 提供 Sensitive 或加密標示，保留啟用。
5. 新增完成後，在清單逐一確認名稱、環境為 Production、值沒有明顯空白或錯貼。不要在此畫面截圖分享。
6. 特別確認 `FIRESTORE_SERVICE_ACCOUNT_JSON` 的 `project_id` 與 `FIRESTORE_PROJECT_ID` 相同；程式會拒絕兩者不一致的設定。
7. 本版本不使用 `GAS_DEPLOYMENT_ID`、固定 `SPREADSHEET_ID`、Google access token 或 refresh token 環境變數；不要自行新增它們，也不要使用任何 `VITE_` 前綴來存放秘密。

## 第 7 步：部署正式版本

1. 確認儲存庫的 `main` 已包含 `vercel.json`、`public/privacy-policy.html` 與 `public/terms-of-service.html`。
2. 在 Vercel 專案開啟 **Deployments**。
3. 對最新的 `main` 部署點選 **Redeploy**；若有提示，選擇使用目前 Production 環境變數重新部署。
4. 等待狀態變成 **Ready**。若失敗，先在 Deployment 的 **Build Logs** 或 **Functions Logs** 看第一個錯誤，不要靠猜測修改密鑰。
5. 在瀏覽器開啟 `https://<正式網域>`，點選 Google 登入，使用第 4-1 步的測試帳號完成授權。
6. 首次登入應看到「設定您的資料空間」流程。選擇建立新的「每日記事」Sheet，完成後新增一筆無敏感資料的測試記事。
7. 在 Google Drive 確認新 Sheet 屬於登入的 Google 帳號；在網頁重新整理後，確認測試記事仍存在。

## 第 8 步：確認 cleanup cron 正常執行

本專案已在 `vercel.json` 設定為 Vercel Hobby 相容的每日清理：

```json
{ "path": "/api/internal/cleanup", "schedule": "0 0 * * *" }
```

請不要將 `/api/*` 改成 SPA fallback，也不要刪除或改寫現有 filesystem-first routes。

1. 部署完成後，進入 Vercel 專案的 **Settings** > **Cron Jobs**；若 Dashboard 版面不同，可在專案內搜尋 Cron。
2. 確認 `/api/internal/cleanup` 顯示 `0 0 * * *`。此表達式是 UTC 每日 00:00；台灣約為每日 08:00。Hobby 只保證在該小時內執行，不保證精確分鐘。
3. 等待下一個排程時段，再到 **Logs** 或該次 Function logs，尋找 `GET /api/internal/cleanup` 的執行紀錄。成功時應是 HTTP `200`。
4. 不要直接用未授權的瀏覽器網址測試此端點；它刻意會回傳 `401 unauthorized`。Vercel 會自動讀取 Production 的 `CRON_SECRET`，並以 `Authorization: Bearer <CRON_SECRET>` 呼叫它。

cleanup 只會實體刪除已過期的 Firestore 文件。登入、session、OAuth 與設定流程會在每次請求時自行檢查 `expiresAt`，因此每日清理不會讓已過期資料重新有效；差異只是過期文件最多會多保留約一天。若日後流量成長或需要更快清理，升級至 Pro 或 Enterprise 後，將 schedule 改回 `*/5 * * * *` 並重新部署即可。

若 cron 沒有出現，依序確認 Production 部署是否包含 `vercel.json`、`CRON_SECRET` 是否存在，以及 routes 是否仍保留 filesystem-first 設定。

## 第 9 步：正式上線驗收

請使用不含真實日記內容的帳號與測試 Sheet 做以下檢查：

1. 開啟下列網址，確認沒有 404：

   ```text
   https://<正式網域>/
   https://<正式網域>/privacy-policy.html
   https://<正式網域>/terms-of-service.html
   ```

2. 用測試帳號 A 登入、建立 Sheet、建立分類與一筆記事。
3. 登出後，用測試帳號 B 登入並建立另一份 Sheet。
4. 確認 B 看不到 A 的記事、分類、搜尋結果、月曆、CSV 或 Sheet 名稱；再切回 A 確認 A 的資料仍完整。
5. 到 Vercel Logs 確認沒有下列類型的設定錯誤：

   ```text
   缺少伺服器端環境變數
   APP_ORIGIN 必須是沒有路徑、查詢字串或片段的 HTTPS 來源
   FIRESTORE_SERVICE_ACCOUNT_JSON
   SESSION_ENCRYPTION_KEY
   TOKEN_ENCRYPTION_KEY
   ```

6. 到 Google Cloud Console > Firestore > Data 確認出現使用者與連線資料，但不要手動修改 `users`、`sheet_connections`、`sessions` 或 attempts 集合內容。
7. 依[手動驗收清單](acceptance-checklist.md)完成其餘介面、隔離、匯出、刪除與遷移檢查。

## 第 10 步：Preview 的安全設定

最安全的預設做法是：**完全不要在 Preview 環境設定這 10 個 Production 值。** 這樣 Preview 可以建置和檢視介面，但登入或資料 API 不會接觸任何正式使用者、refresh token 或 Firestore 資料。

Production 與 Preview 必須使用不同的 Firestore、服務帳號、OAuth Client、`APP_ORIGIN`、加密金鑰與 secret；Preview 絕不可讀取 Production refresh token 或資料。

若確實需要可登入的測試環境，不能只複製 Production 環境變數。請先完成以下隔離，再在固定的測試網域部署：

1. 建立另一個 Google Cloud 專案與另一個 Firestore Native mode 資料庫。
2. 另建一個僅供測試的服務帳號，授予該測試專案的 `roles/datastore.user`。
3. 另建一個 OAuth Web Client，callback URI 使用固定測試網域的 `/api/auth/callback`。
4. 產生另一組 session、token、migration 與 cron 密鑰。
5. 在 Vercel 的 Preview 或自訂測試環境只填入這一整組隔離的 10 個值，`APP_ORIGIN` 必須是固定測試 HTTPS 網域。

不要把隨機產生的 Vercel Preview URL 加入正式 OAuth Client，也不要讓 Preview 讀取 Production Firestore。

## 選用：備份優先的舊 Sheet 遷移

此程序只適用於從舊版固定個人 Sheet 升級的部署者，不是一般使用者資料匯入功能。若沒有舊 Sheet，請跳過本節。

### 遷移前必做事項

1. 在舊 Google Sheet 開啟 **File／檔案** > **Make a copy／建立副本**，將完整備份存到安全位置。
2. 開啟備份確認可讀，且記下原 Sheet 的完整網址。
3. 使用擁有該 Sheet 的目標 Google 帳號登入新正式網站。
4. 登入後停在「設定您的資料空間」畫面；不要建立或選擇新 Sheet。此步驟會建立短效設定流程，通常僅有約 20 分鐘可用。
5. 在 Google Cloud Console > Firestore > Data > `users` 開啟該登入帳號的文件，以 `email` 確認帳號後，複製 `googleSub` 欄位值。不要猜測或修改此值。

### 從受信任的 PowerShell 執行遷移

1. 在只有自己可使用的 PowerShell 工作階段執行下列指令。系統會以隱藏輸入方式要求貼入 `LEGACY_MIGRATION_SECRET`，不會把密鑰寫進命令歷史紀錄：

   ```powershell
   $secureSecret = Read-Host '貼入 LEGACY_MIGRATION_SECRET' -AsSecureString
   $migrationSecret = [System.Net.NetworkCredential]::new('', $secureSecret).Password
   $headers = @{ Authorization = "Bearer $migrationSecret"; 'Content-Type' = 'application/json' }
   $body = @{ googleSub = '<從 Firestore 複製的 googleSub>'; sheetUrl = 'https://docs.google.com/spreadsheets/d/<Sheet-ID>/edit' } | ConvertTo-Json -Compress
   Invoke-RestMethod -Method Post -Uri 'https://<正式網域>/api/internal/migrate-legacy-sheet' -Headers $headers -Body $body
   Remove-Variable secureSecret, migrationSecret, headers, body
   ```

2. 將 `<從 Firestore 複製的 googleSub>` 與完整 Sheet URL 換成實際值；不要在命令列、issue 或聊天訊息留下這些值。
3. 成功時回應應包含：

   ```json
   { "migrated": true }
   ```

4. 重新登入網站，先做唯讀檢查，再確認記事、分類與資料列都保持原樣。
5. 在完整驗收完成前，保留原 Sheet 與備份。遷移程序不會複製、清空、初始化、覆寫或寫入任何舊資料列。

## 常見問題與處理方式

| 現象 | 先檢查什麼 | 修正方式 |
| --- | --- | --- |
| Google 顯示 `redirect_uri_mismatch` | Google OAuth Client 的 redirect URI 與 `APP_ORIGIN`。 | 將完全相同的 `https://<正式網域>/api/auth/callback` 加入**正式** Web Client，儲存後重新登入。 |
| 部署後登入 API 顯示設定錯誤 | Vercel Production 變數是否少填、`APP_ORIGIN` 是否有 `/`、JSON 是否完整。 | 修正 Environment Variables 後重新部署；不要只重新整理瀏覽器。 |
| Firestore 權限錯誤 | 專案 ID、資料庫模式與服務帳號 IAM 角色。 | 確認為 Native mode、JSON 與專案 ID 相同，服務帳號只有 `roles/datastore.user`。 |
| Vercel 部署因 cron 失敗 | `vercel.json` 的 schedule 與目前方案。 | Hobby 必須維持每日一次的 `0 0 * * *`；升級至 Pro 或 Enterprise 後才可使用 `*/5 * * * *`。保留 cleanup cron，不要直接刪除。 |
| `/api/internal/cleanup` 在瀏覽器是 401 | 這是預期行為。 | 不要用瀏覽器測試；等 Vercel Cron 自動執行並在 Logs 查看 200。 |
| Preview 出現正式資料 | Preview 使用了 Production 變數。 | 立即移除 Preview 的正式 10 個變數，重新部署 Preview，並檢查 Firestore、OAuth Client 與密鑰是否全數隔離。 |
| 舊 Sheet 遷移被拒絕 | 備份、目標帳號、設定流程時效、Sheet 擁有權與 URL。 | 重新備份並以目標帳號登入後停在設定畫面，再於時效內重試；不要嘗試清空或改寫 Sheet 來繞過驗證。 |

## 上線後的維運規則

- 不要直接在 Firestore 編輯加密 token、session、連線或 provisioning 文件。
- 若必須更換 `TOKEN_ENCRYPTION_KEY`，先規劃金鑰版本與既有 token 遷移；不要直接覆蓋 Production 金鑰。
- 變更 OAuth scopes、正式網域、服務帳號或 Firestore 專案前，先以隔離測試環境驗證。
- 取消使用的服務帳號 JSON 金鑰應在 Google Cloud 的 **Service Accounts** > **Keys** 撤銷；不要只刪除 Vercel 變數。
- 定期查看 Vercel Function Logs、Google Cloud 配額與 OAuth 驗證狀態。
