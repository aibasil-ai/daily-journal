# 登入續用與本網站登出設計

## 目標

降低重新整理後重複出現 Google 同意畫面的頻率，並讓已登入使用者可立即結束本網站的連線狀態。網站維持純靜態部署，不保存 Google access token，也不撤銷 Google 帳號對此應用程式的授權。

## 範圍與限制

- 使用 Google Identity Services (GIS) OAuth token model 與既有的 Apps Script Execution API。
- Google 要求使用者操作才能可靠地請求 access token，因此重新整理後不可保證自動進入記事首頁。
- 不建立後端工作階段、不使用 refresh token，也不將 access token 寫入 localStorage、sessionStorage、Cookie 或 URL。
- 「登出」僅登出本網站；不呼叫 Google revoke API，之後可重新快速連線。

## 登入續用流程

1. 網站重新整理後顯示「繼續使用 Google」按鈕。
2. 使用者按下按鈕時，先以 GIS 的 `prompt: ''` 取得既有 Google 工作階段的 access token。
3. 若 GIS 成功回傳權杖，立即載入記事資料，不顯示帳號選擇或同意畫面。
4. 若沒有可續用的 Google 工作階段或授權，於同一次使用者操作中改以 `prompt: 'consent'` 顯示正常 Google 同意流程。
5. 任一流程失敗時，清除暫存權杖並顯示既有的登入錯誤與重試操作。

首次進入網站、Google 登出、撤銷授權、清除瀏覽器資料或瀏覽器限制第三方登入狀態時，使用者仍可能看見 Google 選帳號或同意畫面。

## 登出流程

1. 記事首頁的「已連線至 Google Sheets」訊息旁顯示「登出」按鈕。
2. 按下後立即清除 `GoogleOAuth` 的記憶體 access token、到期時間與 token client。
3. `useJournal` 立即回復 `signed-out` 狀態，清除 bootstrap、分類、記事、篩選、月曆計數與錯誤訊息。
4. UI 顯示「繼續使用 Google」按鈕，且不再發出 API 請求。
5. 不呼叫 Google revoke API，不改變 Google 帳號登入狀態，也不刪除 Google Sheets 中的資料。

## 元件與介面

- `GoogleOAuth` 新增清除記憶體登入狀態的方法，並提供先無提示、失敗後要求同意的登入流程。
- `JournalClient` 新增 `signOut()`，由 `App` 對應至 OAuth 狀態清除方法。
- `useJournal` 新增 `signOut()`，統一清除前端記事狀態並切回 `signed-out`。它會遞增工作階段序號，讓登出前開始的非同步 API 回應失效。
- `ConnectionScreen` 的未登入主要按鈕文字改為「繼續使用 Google」。
- `JournalApplication` 在連線狀態訊息旁增加「登出」按鈕。
- 所有新增使用者可見文字維持集中於 `src/i18n/zh-TW.ts`。

## 錯誤處理

- 無提示續用失敗時，只針對可預期的未授權狀態改為顯示同意流程；GIS SDK 未載入等系統錯誤保留既有可操作錯誤訊息。
- 登出不依賴網路，永遠先完成本機狀態清除。
- 登出後尚未完成的 API 回應以工作階段序號忽略，不得使畫面重新顯示已登入資料。

## 測試

- 驗證登入先使用 `prompt: ''`，無提示取得失敗時才使用 `prompt: 'consent'`。
- 驗證 token 只存在記憶體，登出後無法再取得舊 token。
- 驗證 `useJournal.signOut()` 立即清除記事狀態並回到登入畫面。
- 驗證登出前開始的 API 回應完成後不會還原已清除的資料。
- 驗證登入後顯示登出按鈕，按下後顯示「繼續使用 Google」。
- 執行既有 `npm run check`，確認 lint、所有測試、前端建置與 GAS 建置通過。
