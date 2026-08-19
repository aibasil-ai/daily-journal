# 多使用者專屬 Google Sheets 儲存需求規格

> **狀態：** 已核可（2026-08-19）
>
> **取代範圍：** 本文件取代既有「單一部署者、單一 Google Sheet、僅部署者可使用 GAS」的資料存取與工作階段設計。既有記事 CRUD、分類、搜尋、月曆與 CSV 匯出功能維持，但改為每位使用者只存取自己的 Google Sheet。

## 目標

將每日記事由個人自行部署的工具，改為可公開提供多位使用者以 Google 帳號登入的服務。

第一版必須滿足下列原則：

- 每位使用者的記事、分類與設定資料永久保存於該使用者自己擁有的 Google Sheet。
- 使用者 A 無法讀取、修改、刪除或匯出使用者 B 的任何資料。
- Google OAuth 僅由 Vercel 伺服器端處理；瀏覽器不得取得 Google access token 或 refresh token。
- 中央資料庫只保存帳號對應、加密的 refresh token、Sheet ID 與工作階段資料，不保存記事、分類、標籤、連結或匯出內容。
- 維持 GitHub 推送後由 Vercel 自動部署網站與 API 的流程。

## 第一版設計決策

1. 第一版首次登入時，使用者必須選擇「建立新的每日記事 Sheet」或「連結既有 Google Sheet」其中一種資料空間建立方式。
2. 每個 Google 帳號第一版同時間只能綁定一份作用中的日記 Sheet；使用者可透過設定介面更換該份 Sheet，系統不會自動搬移或刪除舊 Sheet 的資料。
3. 系統直接使用 Google Sheets API 存取使用者的 Sheet，不再透過共用的 Apps Script API Executable 讀寫公開使用者資料。
4. Google `sub` 是使用者的不可變識別碼；email 僅作為顯示與通知資訊，不得作為資料擁有權或主鍵依據。
5. 既有部署者的個人 Sheet 必須以一次性遷移方式綁定到部署者的 Google `sub`，不得依 email 自動猜測其擁有者。
6. 既有 Sheet 的選擇器由伺服器代理 Google Drive API 實作；不使用需要將 Google access token 交給瀏覽器的 Google Drive Picker。
7. 中央資料庫採 Google Cloud Firestore Native mode；Vercel Functions 只透過受限服務帳號存取，並以 transaction 與決定性 claim 文件保證使用者與 Sheet 的唯一綁定。
8. 刪除帳號資料時預設保留 Google Sheet；只有系統建立的 Sheet 可經使用者明確二次確認後刪除。使用者自行連結的既有 Sheet 一律保留，由使用者自行在 Google Drive 管理。

## 非目標

- 不提供多人共用同一份日記、團隊空間、邀請成員或角色權限。
- 不在中央資料庫複製或備份使用者的日記內容。
- 不提供同時使用多份 Sheet、連結共用 Sheet、匯入非本系統格式的 Sheet，或將一份 Sheet 連結給多個本站帳號。
- 不提供離線編輯、衝突合併、附件上傳、帳務、訂閱或管理後台。
- 不將現有 GAS API Executable 放寬為公開多人存取。

## 名詞

| 名詞 | 定義 |
| --- | --- |
| 使用者 | 完成 Google OAuth 登入且以已驗證 Google `sub` 識別的人。 |
| 專屬 Sheet | 由系統建立，或由使用者選擇且經伺服器驗證可安全連結的 Google Sheet；必須由目前 Google 帳號擁有。 |
| 連線資料 | 中央資料庫中的使用者 ID、Google `sub`、Sheet ID、加密 refresh token、授權範圍與生命週期資訊。 |
| 工作階段 | 本站登入狀態；瀏覽器只保存不透明的 session ID，實際資料存在伺服器端。 |
| Sheet 選擇代碼 | 伺服器為候選 Sheet 發出的短效、不透明且僅能使用一次的代碼；前端不可取得候選 Sheet 的原始 ID。 |
| 封存連線 | 曾經作用中、後來被使用者更換的 Sheet 連線資料。封存只移除本站的作用中資料來源，不會更動使用者原本的 Google Sheet。 |

## 使用者流程

### 首次登入

1. 使用者按下「使用 Google 帳號登入」。
2. 伺服器產生並保存 OAuth `state` 與 PKCE 驗證資料，將使用者導向 Google。
3. Google 同時授予登入身分與 Google Sheets 存取權；使用者首次使用時會看到 Google 同意畫面。
4. OAuth callback 驗證 `state`、PKCE 與 ID token 後，以 Google `sub` 查詢使用者與連線資料。
5. 查無作用中連線資料時，伺服器建立僅可用於資料空間設定的短效暫存工作階段，並將加密 refresh token 保存於待設定連線資料。
6. 前端顯示資料空間設定頁，讓使用者選擇建立新 Sheet 或連結既有 Sheet。
7. 使用者選擇建立新 Sheet 時，伺服器以該使用者的 OAuth 憑證建立一份「每日記事」Sheet，初始化資料結構。
8. 使用者選擇既有 Sheet 時，伺服器完成候選 Sheet 驗證、資料結構檢查與安全連結。
9. 僅在 Sheet 已成功建立或連結後，伺服器才將待設定連線升級為作用中連線，建立本站工作階段 Cookie，並讓前端載入記事。

若建立 Sheet 或初始化任一階段失敗，系統不得建立可存取日記的本站工作階段，也不得留下作用中的不完整連線資料。短效暫存工作階段只能呼叫資料空間設定 API，逾期後必須連同暫存 token 清除。已建立但未完成初始化的 Sheet 必須標記為失敗並可由受控重試流程處理，不能讓下一次登入誤認為資料已可用。

### 選擇既有 Google Sheet

資料空間設定頁必須同時提供下列方式：

1. 「選擇我的 Google Sheet」：前端向本站 API 取得分頁的候選清單，顯示名稱與最後更新時間，使用者選取後送回 Sheet 選擇代碼。
2. 「貼上 Google Sheet 網址」：使用者可貼上完整的 Google Sheet 網址；伺服器解析 Sheet ID 並驗證，前端不得自行信任或保留解析後的 ID。

本站 API 使用伺服器端短效 access token 呼叫 Google Drive API，以 `application/vnd.google-apps.spreadsheet` 篩選候選檔案。候選清單必須：

- 僅列出目前 Google 帳號擁有、未在垃圾桶且可編輯的 Google Sheet。
- 使用固定的最大頁面大小、游標與最短查詢長度，避免將整個 Google Drive 檔案清單一次傳回前端。
- 對每個候選 Sheet 發出只限目前使用者、目前設定流程且短時間有效的一次性選擇代碼。
- 不回傳 Google access token、refresh token、其他檔案類型、完整 Google Drive 權限清單或原始 Sheet ID。

連結既有 Sheet 前，伺服器必須再次以 Google Drive API 與 Google Sheets API 驗證：

1. 檔案 MIME type 為 Google Sheet，未被移至垃圾桶，且目前使用者是擁有者並具備編輯權限。
2. Sheet ID 尚未被其他使用者的作用中或保留中連線資料使用。
3. Sheet 為完全空白，可安全初始化；或已完全符合本站支援的 `entries`、`categories`、`settings` 欄位與 schema version。
4. 不符合格式的非空 Sheet 必須被拒絕，系統不得自動清空、改名、覆寫或部分初始化它。

使用者選擇共用、他人擁有、唯讀、已刪除或已連結的 Sheet 時，系統必須拒絕連結並說明原因。此限制避免使用者誤將私人日記放入其他人可檢視或控制的試算表。

Google 官方 Drive Picker 需要將 OAuth access token 提供給瀏覽器。為維持本站「Google token 僅存在伺服器端」的安全原則，第一版不得使用該 Picker；選擇器由本站前端搭配受限的伺服器 API 呈現。

### 更換已連結 Google Sheet

使用者必須可在登入後的「資料空間設定」介面查看目前作用中 Sheet 的名稱與連線狀態，並選擇「更換資料表」。介面不得顯示或編輯原始 Sheet ID。

更換流程必須遵守下列規則：

1. 使用者可選擇建立新的 Sheet，或以既有 Sheet 選擇器／貼上網址連結另一份 Sheet。
2. 新 Sheet 必須通過與首次設定相同的擁有權、編輯權限、唯一連結與資料結構驗證。
3. 驗證完成後，介面必須顯示目前 Sheet 與目標 Sheet 的名稱，明確說明「舊 Sheet 的記事不會自動複製、搬移或刪除」，並要求使用者確認。
4. 使用者確認後，伺服器必須以單一受控交易將目標連線設為作用中，並將原連線標記為封存。每位使用者同時只能有一份作用中連線。
5. 成功更換後，伺服器必須輪替本站 session，前端清除目前所有記事、分類、篩選、月曆與編輯狀態，再從新 Sheet 重新 bootstrap。
6. 目標 Sheet 驗證、初始化、確認或連線更新任一步驟失敗時，原作用中連線與目前畫面資料必須保持不變。
7. 使用者選擇目前已作用中的同一份 Sheet 時，系統不得建立重複連線或重複初始化資料結構。
8. 多個瀏覽器分頁同時執行更換時，伺服器必須以連線版本或交易鎖保證最後只會有一個成功結果；失敗的一方必須重新讀取目前狀態。

封存連線的 Google Sheet 與其資料仍屬於使用者。使用者可在日後再次選擇已封存的 Sheet；伺服器必須重新驗證其狀態後，將既有連線重新啟用，而不是建立重複的 Sheet ID 紀錄。

第一版不提供跨 Sheet 的資料複製、合併、搬移、刪除或自動同步。若未來要提供資料遷移，必須另訂資料量限制、覆寫確認、失敗回復與重複執行安全規格。

### 後續登入與重新整理

1. 瀏覽器送出本站 session Cookie。
2. 伺服器依 session 找到使用者與連線資料，解密 refresh token，換取短效 access token。
3. 伺服器僅對該使用者對應的 Sheet 執行 Google Sheets API 請求。
4. 已有有效連線資料時，不得以 `prompt=consent` 強制顯示 Google 權限確認畫面。

Google 授權已撤銷、refresh token 失效、Sheet 被刪除或使用者撤銷本系統權限時，系統必須清除本站工作階段，保留足夠的安全狀態以顯示「重新連線 Google Sheet」的明確指引。

### 登出與帳號切換

- 登出只撤銷本站工作階段，不刪除使用者的 Sheet、連線資料或 Google 授權。
- 同一瀏覽器的同一網站網域一次只維持一個作用中的本站帳號；登入另一個 Google 帳號後必須取代目前 session 並清除前端所有舊資料。
- 帳號切換不得讓前一位使用者的記事短暫顯示於下一位使用者畫面。

### 重新連線與資料刪除

- 使用者可主動撤銷 Google 授權；下次存取時系統必須要求重新授權，不得重複使用舊 token。
- 系統提供「中斷連線」流程：清除伺服器端加密 token 與本站 sessions，但不刪除使用者的 Google Sheet。
- 系統提供「刪除帳號資料」流程：刪除中央資料庫的使用者、連線與工作階段資料，預設不刪除 Google Sheet。只有系統建立的作用中 Sheet 可在明確二次確認後由伺服器刪除；使用者自行連結的既有 Sheet 一律保留。

## OAuth 與身份需求

### 授權範圍

OAuth 請求必須包含：

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/drive.metadata.readonly`
- `https://www.googleapis.com/auth/drive.file`

`drive.metadata.readonly` 僅用於伺服器端列出及驗證使用者選擇的 Google Sheet，不能用於讀取其他 Drive 檔案內容。`drive.file` 僅用於刪除本系統建立的 Sheet，不得用於列出或操作不屬於目前連線流程的 Drive 檔案。`script.projects` 不再是公開使用者資料流程的必要 scope，應自 OAuth 請求中移除。若保留 GAS 作為內部維護工具，其權限不得由一般使用者 OAuth 流程請求。

### ID token 驗證

伺服器必須驗證 ID token 的簽章與下列 claims：

- `iss` 為 Google 允許的 issuer。
- `aud` 為本站 `GOOGLE_CLIENT_ID`。
- `exp` 尚未過期。
- `sub` 為非空且可作為唯一使用者識別碼的字串。

不得信任前端傳送的 email、Google 使用者 ID、Sheet ID 或任何使用者擁有權欄位。

### OAuth 流程規則

- 採用 Authorization Code Flow、PKCE 與 `state` 防護。
- 首次建立或重新連線 Google Sheet 時，使用 `access_type=offline` 取得 refresh token。
- 正常恢復本站登入時，使用既有伺服器端連線資料；不可因 refresh token 存在於伺服器而要求使用者再次同意。
- 僅在沒有可用 refresh token、使用者明確重新連線，或 Google 要求新增授權範圍時才使用 `prompt=consent`。
- 已有作用中連線的使用者重新登入時，OAuth 授權碼交換可能不會回傳新的 refresh token；伺服器必須保留既有加密 token，不能因此拒絕登入。
- callback URL 僅使用正式固定網域的 `/api/auth/callback`；不得將不固定的 Vercel Preview URL 用作正式使用者 callback。

## 資料與儲存設計

### 使用者專屬 Google Sheet

系統以 Google Sheets API 建立 Sheet，並以該使用者 OAuth 憑證初始化下列工作表：

| 工作表 | 欄位 |
| --- | --- |
| `entries` | `id`, `entryDate`, `title`, `content`, `categoryId`, `tags`, `links`, `createdAt`, `updatedAt` |
| `categories` | `id`, `name`, `isActive`, `createdAt`, `updatedAt` |
| `settings` | `key`, `value` |

每份 Sheet 的 `settings` 工作表必須保存資料結構版本。任何讀寫前都必須驗證版本與欄位；資料格式不符時，系統不得覆寫使用者資料，並應回傳可理解的修復指引。

作用中的 Sheet ID 不得回傳給前端。資料空間設定期間的候選 Sheet 也只能以選擇代碼表示；只有貼上網址的專用設定端點可接收原始 Sheet URL。Sheet ID 不是授權依據，所有 Google API 操作仍須依伺服器端帳號連線資料執行。

### 中央資料庫（Cloud Firestore）

中央資料庫必須使用 Google Cloud Firestore Native mode。Vercel Functions 以專屬服務帳號存取 Firestore，瀏覽器不得載入 Firebase 或 Firestore SDK，也不得持有可直接讀寫 Firestore 的憑證。

中央資料庫至少需要下列邏輯資料：

| 資料 | 必要欄位與規則 |
| --- | --- |
| `users` | 內部 `id`、唯一 `googleSub`、最新 email、顯示名稱、頭像 URL、建立與更新時間。 |
| `sheet_connections` | `userId`、唯一 `spreadsheetId`、加密 refresh token、加密金鑰版本、授權範圍、作用中／封存狀態、連線版本、建立與更新時間。資料庫必須保證每位使用者最多一筆作用中連線，且同一 Sheet 不得連結給不同使用者。 |
| `sessions` | 不透明 session ID、`userId`、到期時間、建立時間、最後使用時間與撤銷時間。 |
| `oauth_attempts` | state、PKCE verifier、流程目的、到期時間與使用時間；僅供 OAuth callback 驗證，不得包含 Google token。 |
| `provisioning_attempts` | 建立、連結或更換專屬 Sheet 的狀態、原連線 ID、加密暫存 refresh token、到期時間、錯誤碼與可安全顯示的診斷資訊；僅可由短效設定工作階段使用。 |
| `sheet_selection_tokens` | `provisioningAttemptId`、候選 Sheet ID、一次性選擇代碼、到期時間與使用時間。此資料不得回傳給前端。 |

Firestore 實作必須以 `sheetClaims/{hash(spreadsheetId)}` 作為決定性唯一索引，並在同一個 transaction 內讀取及更新使用者、作用中連線、目標連線與 claim 文件。交易須保證每位使用者最多一筆作用中連線、同一 Sheet 不得連結給不同使用者，以及多個瀏覽器分頁同時更換時只有一個請求成功。連線版本用於偵測過期的更換確認請求。

短效 OAuth、設定流程與 Sheet 選擇文件必須在每次讀取時檢查到期時間並立即拒絕使用；排程清理程序負責移除已過期文件與其中的加密暫存 token。Firestore TTL 可作為額外清理機制，但不得取代請求時的到期驗證。

中央資料庫不得保存 `entries`、`categories`、CSV 內容、搜尋索引、Google access token 明文或 refresh token 明文。

### Token 與工作階段安全

- refresh token 必須在寫入資料庫前以獨立、穩定的伺服器端高熵金鑰加密；加密演算法須提供機密性與完整性保護。
- 加密金鑰不得與 session Cookie 加密金鑰共用，並應支援金鑰版本，以便未來輪替。
- access token 僅可存在單次伺服器端請求的記憶體中，不得寫入 Cookie、資料庫、前端、日誌或錯誤回應。
- 瀏覽器 Cookie 僅保存不透明 session ID，且必須使用 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/` 與明確到期時間。
- Session 被撤銷、過期、使用者登出或 token 不可用時，伺服器與瀏覽器都必須清除它。
- 資料空間設定工作階段必須與一般日記 session 分離，具較短效期，且僅能列出候選 Sheet、建立新 Sheet 或提交一次性選擇代碼；不得呼叫任何日記 CRUD API。

## API 與資料隔離規則

前端維持透過同網域 `/api` 呼叫記事功能，但每一個請求必須依伺服器驗證的 session 取得 `userId` 與其 `spreadsheetId`。

- 一般記事 API payload 不得包含 `userId`、`googleSub`、`spreadsheetId`、refresh token 或 access token。
- 資料空間設定 API 可接收一次性 Sheet 選擇代碼，或貼上的 Google Sheet URL；不得接受任意 `spreadsheetId` 欄位。
- 更換作用中 Sheet 的設定 API 必須要求目前登入使用者的明確確認，並以伺服器端原連線版本驗證請求；不得由前端指定要封存的連線、使用者或 Sheet ID。
- 除資料空間設定流程中已由伺服器驗證的選擇代碼或 Sheet 網址外，後端不得採用前端提交的任何識別碼決定資料來源。
- 每個 CRUD、搜尋、月曆、分類計數、搬移、刪除與 CSV 匯出操作，都只能針對伺服器從連線資料取得的單一 Sheet 執行。
- 若使用者傳送其他使用者的記事 ID、分類 ID 或猜測的 Sheet ID，系統不得跨 Sheet 查詢或揭露資料存在與否。
- 任何 Google API 的 `401`、`403`、失效 refresh token 或無法開啟 Sheet，都必須轉換為本站安全錯誤，不能將 Google token、完整上游回應或其他帳號資訊回傳前端。

現有 `api/journal.ts` 對固定 `GAS_DEPLOYMENT_ID` 的呼叫，必須改為使用已驗證使用者的 Google access token 直接呼叫 Google Sheets API。公開資料流不再依賴 `gas/appsscript.json` 的 `executionApi.access` 或全域 `SPREADSHEET_ID`。

## 現有資料遷移

1. 公開多人版本上線前，先完整備份既有部署者的 Google Sheet。
2. 部署者首次以目標 Google 帳號完成新 OAuth 流程後，由受保護的一次性管理程序將既有 Sheet ID 綁定至該帳號的 Google `sub`。
3. 綁定前必須驗證該帳號可存取該 Sheet，並驗證其資料結構版本。
4. 遷移完成後，既有資料不複製、不改寫欄位、不併入其他使用者 Sheet。
5. 遷移過程失敗時，原個人版資料必須保持可讀；不得因失敗而建立空白 Sheet 取代既有日記。
6. 遷移完成後，舊的固定 `SPREADSHEET_ID` 設定不得再作為一般使用者的資料來源。

## 部署與營運需求

### Google Cloud

1. 在同一個 Google Cloud 專案啟用 Google Sheets API、Google Drive API 與 Cloud Firestore Native mode。
2. OAuth Audience 設為 `External`，並在完成必要資料後發布為 Production。
3. 設定正式網域、OAuth redirect URI、支援聯絡信箱、隱私權政策 URL 與服務條款 URL。
4. 在 OAuth 同意畫面正確宣告所有使用的 scopes；若 Google 將 Sheets 或任何 Drive scope 視為敏感權限，必須完成 OAuth 驗證後才公開服務。
5. 測試期間的使用者、測試 token 與正式使用者資料必須與 Production 明確隔離。

### Vercel 與 GitHub

GitHub 與 Vercel 的自動部署可以保留，但只負責部署程式碼。下列資源需在部署前手動建立與設定，且不可提交至 Git：

| 設定 | 用途 |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth Web Client ID。 |
| `GOOGLE_CLIENT_SECRET` | OAuth Web Client Secret，只供伺服器使用。 |
| `SESSION_ENCRYPTION_KEY` | session Cookie 或 session 資料保護所用的高熵金鑰。 |
| `TOKEN_ENCRYPTION_KEY` | 資料庫 refresh token 加密金鑰，必須與 session 金鑰分離。 |
| `TOKEN_ENCRYPTION_KEY_VERSION` | 目前 refresh token 加密金鑰版本，用於未來輪替。 |
| `FIRESTORE_PROJECT_ID` | Firestore Native mode 所屬 Google Cloud 專案 ID。 |
| `FIRESTORE_SERVICE_ACCOUNT_JSON` | 僅供 Vercel Function 使用的 Firestore 服務帳號 JSON 憑證。 |
| `APP_ORIGIN` | 正式網站固定來源，用於嚴格產生 OAuth callback URL。 |
| `LEGACY_MIGRATION_SECRET` | 一次性舊個人 Sheet 綁定程序的伺服器端保護密鑰。 |
| `CRON_SECRET` | 清理過期 OAuth、設定與選擇代碼資料的排程端點保護密鑰。 |

- 必須啟用 Firestore Native mode，並為 Vercel 使用的服務帳號授予最小必要的 Firestore 存取權；它不得用於代表使用者呼叫 Google Sheets 或 Drive API。
- Production 與 Preview 必須使用不同的資料庫、加密金鑰與 Google OAuth 設定，或讓 Preview 完全停用真實 Google 連線。
- Preview 不得連到 Production 資料庫，也不得使用 Production 使用者 refresh token。
- 現有 `clasp push` 不會隨 Vercel Git 部署自動執行。公開資料流改為直接使用 Sheets API 後，GAS 可保留為內部維護工具或另行移除，但不能成為公開使用者資料路徑。

## 錯誤處理與使用者體驗

| 情境 | 系統行為 |
| --- | --- |
| 使用者取消 Google 登入或授權 | 清除 OAuth 暫存狀態，回到登入畫面並顯示可重試訊息。 |
| Sheet 建立或初始化失敗 | 不建立可用 session；顯示建立個人資料空間失敗，提供安全重試入口。 |
| 候選 Sheet 清單無法讀取 | 保留資料空間設定畫面，提供重新整理與貼上 Google Sheet 網址的替代方式。 |
| 選擇的 Sheet 非 Google Sheet、非擁有者、唯讀、已在垃圾桶或已連結 | 拒絕連結，不建立 session，顯示明確原因並保留重新選擇入口。 |
| 選擇的 Sheet 非空但格式不符 | 拒絕連結，不改動該 Sheet，說明只能連結空白或符合本站資料結構的 Sheet。 |
| 更換 Sheet 失敗、取消或與其他分頁衝突 | 保留原作用中連線與前端資料，要求使用者重新讀取目前設定後再試。 |
| refresh token 已撤銷或失效 | 清除 session，要求重新連線 Google；不得刪除使用者 Sheet。 |
| Sheet 被刪除或使用者移除系統存取權 | 清除 session，標記連線需修復，提供重新連線或建立新 Sheet 的明確選擇。 |
| 資料結構版本不符 | 停止寫入並顯示資料表需修復的訊息；不得自動覆寫資料。 |
| Google API 配額或暫時性錯誤 | 保留有效 session，顯示可重試錯誤；寫入操作需避免重複提交。 |
| 中央資料庫不可用 | 拒絕所有需身份或資料存取的請求，不得退回共用 Sheet 或無身份模式。 |

## 隱私與安全需求

- 隱私權政策必須清楚說明系統讀寫使用者 Google Sheet 的目的、保存的最小連線資料、token 加密方式、刪除流程與使用者可在 Google 帳號中撤銷權限的方式。
- 服務條款與介面不得宣稱日記資料被儲存在本站資料庫。
- 伺服器日誌、錯誤追蹤、分析事件與測試 fixture 不得記錄 refresh token、access token、session Cookie、日記內容或完整 Sheet ID。
- 所有 OAuth callback、API 與資料庫連線必須使用 HTTPS。
- 需實作登入、Sheet 建立與資料 API 的合理速率限制，避免惡意建立大量 Sheet 或耗盡 Google API 配額。
- 寫入操作需使用 Google Sheets API 批次請求，避免每個欄位或資料列產生不必要的 API 呼叫。
- Google Drive 候選清單必須由伺服器端取得並限制回傳欄位；不得將 Google access token 暴露給瀏覽器，也不得使用瀏覽器端 Google Drive Picker。
- Sheet 選擇代碼必須是高熵、不可猜測、一次性且具短效期，並綁定目前的登入身分與設定流程。

## 測試與驗收

### 自動化測試

- OAuth：`state`、PKCE、ID token claim 驗證、錯誤 callback、首次授權與既有連線登入。
- 帳號：相同 `sub` 再次登入會取得相同使用者與 Sheet；不同 `sub` 必須建立或使用不同 Sheet。
- Token：加密後資料不可明讀；金鑰版本、解密失敗、撤銷與 token 更新行為正確。
- 資料隔離：以兩個使用者測試所有讀取、建立、編輯、刪除、分類管理、搬移、月曆與 CSV 匯出；A 不得取得 B 的資料。
- Sheet 建立：建立正確工作表、欄位與 schema version；任一初始化步驟失敗不留下可用連線。
- Sheet 選擇：候選清單只含目前使用者擁有且可編輯的 Google Sheet；選擇代碼不可跨使用者、重複使用或在到期後使用。
- Sheet 連結：可連結空白或相容格式的既有 Sheet；拒絕共用、他人擁有、唯讀、垃圾桶、格式不符及已連結的 Sheet，且拒絕時不修改原 Sheet。
- Sheet 更換：建立新 Sheet 或連結既有 Sheet 後可安全切換；原 Sheet 會封存且資料不變，新連線驗證失敗、取消或衝突時原連線保持作用中。
- Sheet 更換：同一 Sheet 不會重複連結，多分頁同時更換只允許一個請求成功，成功後 session 輪替且前端不保留舊 Sheet 資料。
- Session：帳號切換、登出、過期與失效 token 時清除前端與伺服器端 session。
- API：前端傳入偽造 `userId`、任意 `spreadsheetId`、無效選擇代碼或他人資料 ID 時，伺服器仍只操作目前 session 對應的 Sheet。

### 手動驗收

1. 使用帳號 A 選擇建立新 Sheet，確認其 Google Drive 出現一份「每日記事」Sheet。
2. 使用帳號 B 選擇既有、空白且由 B 擁有的 Google Sheet，確認系統初始化並連結該 Sheet，且不建立額外 Sheet。
3. 嘗試由 B 選取 A 擁有、共用給 B、唯讀、垃圾桶或不相容的 Sheet，確認系統拒絕且不改動該 Sheet。
4. 在帳號 A 建立記事、分類、標籤與連結後，切換至帳號 B，確認 B 看不到 A 的任何資料。
5. 在 B 建立資料後切回 A，確認 A 的資料仍完整且不含 B 的資料。
6. 在 A 的資料空間設定建立或選擇另一份合格 Sheet，確認警告後完成更換；確認舊 Sheet 資料未被改動，介面只顯示新 Sheet 資料。
7. 於更換流程中取消、選擇不合格 Sheet 或模擬並行更換，確認 A 仍連結原 Sheet 且畫面資料未被清除。
8. 撤銷 A 的 Google 授權，確認系統要求重新連線，但 A 的 Sheet 未被刪除。
9. 登出後重新登入同一帳號，確認不會在既有有效授權下強制顯示同意畫面，且重新取得原本 Sheet。
10. 使用 GitHub 推送觸發 Vercel Production 部署，確認既有使用者不會被導向 Preview 網域，且 Production 資料與 Preview 測試資料完全隔離。
11. 執行既有 CRUD、月曆、搜尋、分類搬移與 CSV 匯出驗收，確認功能在專屬 Sheet 架構下維持正確。

## 實作影響範圍

| 現有範圍 | 必要變更 |
| --- | --- |
| `api/_lib/google-oauth.ts` | 加入 OIDC、PKCE、ID token 處理、Drive metadata 與 Sheets API 所需 scopes；移除一般登入的強制 re-consent。 |
| `api/auth/callback.ts` | 驗證使用者身份、建立或查詢使用者連線、保存加密 token，並在未完成資料空間設定時導向建立或選擇 Sheet 流程。 |
| `api/_lib/session-crypto.ts` 與 Cookie | 不再在瀏覽器 Cookie 保存 refresh token；改為保護本站 session。 |
| `api/journal.ts` | 從固定 GAS proxy 改為依 session 取得使用者連線後直接呼叫 Google Sheets API。 |
| 新增 Sheet 設定 API | 伺服器端列出候選 Google Sheet、核發與驗證選擇代碼、解析貼上的網址、驗證並連結或初始化既有 Sheet，以及以確認與版本檢查安全更換作用中 Sheet。 |
| `gas/` | 不再處理公開使用者 CRUD；可保留為受限內部工具，或在遷移完成後移除。 |
| `src/` | 新增建立新 Sheet／選擇既有 Sheet／更換作用中 Sheet 的設定頁、確認對話框、首次初始化、重新連線、帳號切換與資料連線錯誤的介面狀態及繁體中文文案。 |
| 測試與部署文件 | 新增雙帳號資料隔離、token 儲存、Sheet 建立與選擇、OAuth Production、Google Drive API 與資料庫設定的測試及文件。 |

## 第一版已固定的營運邊界

- 系統建立的 Sheet 標題固定為「每日記事」。
- 帳號刪除預設保留所有 Google Sheet；只有系統建立的作用中 Sheet 可由使用者選擇刪除。自行連結的 Sheet 必須由使用者自行在 Google Drive 刪除。
- 上線前必須依 Google API 配額與預期使用量設定速率限制；首次建立 Sheet 的畫面與文件需說明資料由使用者自行擁有及可在 Google Drive 管理。
- 第一版不顯示封存連線清單；使用者可透過既有 Sheet 選擇器重新選擇自己已封存且仍符合驗證規則的 Sheet。
- 共用 Sheet 即使符合 schema 亦不支援；若未來開放，必須另訂所有權、協作者可見性、資料隔離與多人寫入衝突規格。
