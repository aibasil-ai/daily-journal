# 部署文件

每日記事由 Vite 前端與 Vercel Functions 組成。瀏覽器不保存 Google access token、refresh token、OAuth client secret 或 GAS deployment ID；所有 Google API 存取均由同網域的 Vercel Function 代理。

## 先決條件

- Node.js 20 以上、npm，以及可建立 Google Cloud、Apps Script 與 Google Sheets 資源的 Google 帳號。
- 已安裝 clasp：`npm install --global @google/clasp`。
- 一個 Vercel Production 網域。

## 1. 建立 Google Sheets 與 GAS

1. 建立新的 Google Sheets，於「檔案 > 設定」選擇實際使用時區。
2. 建立或開啟 GAS 專案，並將它連結至同一個 Google Cloud 專案。
3. 在 GAS「專案設定 > 指令碼屬性」設定 `SPREADSHEET_ID`。此值只能存在 GAS，不得加入 `.env`、前端或 Git。
4. 使用 `.clasp.json.example` 建立未追蹤的 `.clasp.json`，再執行：

```bash
clasp login
npm run build:gas
clasp push
```

5. 在 GAS 編輯器手動執行無參數的 `initializeJournal`，完成初次 Google 授權並建立 `entries`、`categories`、`settings` 工作表。
6. 新增 **API Executable** 部署、存取權設為「僅我自己」，記下 Deployment ID。確認 `gas/appsscript.json` 設定 `executionApi.access` 為 `MYSELF`。

## 2. 建立 OAuth Web Client

1. 在與 GAS 相同的 Google Cloud 專案啟用 Google Apps Script API。
2. 建立 OAuth 用戶端 ID，應用程式類型選擇「網頁應用程式」。
3. 在授權重新導向 URI 加入正式 Vercel 網址：

```text
https://你的正式網域/api/auth/callback
```

4. 複製 OAuth Web Client ID 與 Client Secret。兩者都只放入 Vercel server-only 環境變數，不得放入 browser bundle。
5. OAuth app 維持測試模式時，於「Google Auth Platform > 目標對象」加入實際登入帳號為測試使用者。

不需要設定授權 JavaScript 來源，也不需要載入 Google Identity Services SDK。

## 3. 設定 Vercel

1. 匯入 Git 儲存庫，Framework Preset 選擇 Vite。
2. Build Command 設為 `npm run build`，Output Directory 設為 `dist`。
3. 在 Production Environment Variables 設定四個 server-only 值：

```dotenv
GOOGLE_CLIENT_ID=你的 Google OAuth Web Client ID
GOOGLE_CLIENT_SECRET=你的 Google OAuth Web Client Secret
SESSION_ENCRYPTION_KEY=32-byte base64url 隨機字串
GAS_DEPLOYMENT_ID=你的 GAS API Executable Deployment ID
```

4. 產生 encryption key 時，可在安全環境執行：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

5. 保留根目錄 `vercel.json`。它先讓 filesystem 對應 `api/` Functions 與靜態檔案，再把未匹配路徑導向 `/index.html` 作為 SPA fallback。
6. 部署至 Production；Vercel 的 API Function 與前端必須使用同一個 HTTPS 網域。

## 4. 登入與工作階段驗證

1. 首次使用者按「使用 Google 帳號登入」時，瀏覽器導向 `/api/auth/start`。
2. Function 以 OAuth authorization code flow 取得 refresh token，將加密 session 寫入 HttpOnly、Secure、SameSite=Lax cookie，然後導回網站根目錄。
3. 重新整理後，前端以 `/api/session` 確認 session 並自動 bootstrap；不會要求 GIS token 或將 token 放入 localStorage。
4. 按「登出」會呼叫 `/api/auth/logout` 並立即清除前端 state。它只移除此網站的工作階段，不會登出 Google 帳號。
5. Google 授權遭撤銷、refresh token 過期或 GAS 權限失效時，Function 回傳 401 並清除 cookie；前端會清空資料並顯示登入按鈕。

## 疑難排解

| 現象 | 原因與修正 |
| --- | --- |
| OAuth `redirect_uri_mismatch` | OAuth Web Client 的 redirect URI 必須完全等於 `https://正式網域/api/auth/callback`。 |
| 首次登入後仍回到登入畫面 | 檢查四個 Vercel Production 環境變數、callback 網域與瀏覽器 cookie。 |
| 重新整理後 session 未恢復 | 檢查 HTTPS、Production 網域與 `SESSION_ENCRYPTION_KEY` 在部署之間保持不變。 |
| 授權撤銷後無法操作 | 這是預期行為；再次按登入並完成同意畫面即可建立新的 session。 |
| GAS access denied | 確認 GAS 為 API Executable、`executionApi.access` 是 `MYSELF`，且登入帳號擁有 GAS 與試算表存取權。 |
| 找不到 `SPREADSHEET_ID` | 在 GAS 指令碼屬性設定 Sheet ID，再手動執行 `initializeJournal`。 |
