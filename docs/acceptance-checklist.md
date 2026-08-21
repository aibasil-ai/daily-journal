# 手動驗收清單

請只使用不含真實日記內容的測試帳號與測試 Sheet。遷移既有個人資料前，先完成完整備份，並將驗收結果記錄在不提交至 Git 的地方。

## 響應式與無障礙

- [ ] 375px 寬度：登入、資料空間設定、時間軸、底部導覽與浮動新增按鈕可用。
- [ ] 768px 寬度：月曆、側欄、Sheet 設定與表單對話框可用。
- [ ] 1024px 以上：時間軸、月曆格、懸停操作與資料空間設定排版正確。
- [ ] 可用鍵盤 Tab 移動到登入按鈕、隱私權政策、服務條款、所有表單欄位、月曆日期與對話框操作。
- [ ] 登入畫面的隱私權政策與服務條款連結可開啟靜態繁中頁面。

## 部署與 OAuth

- [ ] Firestore 已建立為 **Native mode**，不是 Datastore mode。
- [ ] Vercel 服務帳號只具有必要的 **Cloud Datastore User** 權限，沒有 Owner、Editor、Drive 或 Sheets 廣泛權限。
- [ ] Production 與 Preview 使用不同的 Firestore、服務帳號、OAuth Client、`APP_ORIGIN`、session 金鑰與 token 金鑰；Preview 無法讀取 Production token 或資料。
- [ ] 每個環境都設定恰好 10 個 server-only 變數：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`APP_ORIGIN`、`SESSION_ENCRYPTION_KEY`、`TOKEN_ENCRYPTION_KEY`、`TOKEN_ENCRYPTION_KEY_VERSION`、`FIRESTORE_PROJECT_ID`、`FIRESTORE_SERVICE_ACCOUNT_JSON`、`LEGACY_MIGRATION_SECRET`、`CRON_SECRET`。
- [ ] 環境、Git 與前端建置產物都不含 `GAS_DEPLOYMENT_ID`、固定 `SPREADSHEET_ID`、access token、refresh token 或服務帳號 JSON。
- [ ] OAuth Web Client 的 callback URI 是固定正式網址 `/api/auth/callback`，沒有把不固定 Preview 網址加入 Production Client。
- [ ] OAuth 同意畫面正確宣告 `openid`、`email`、`profile`、Sheets、`drive.metadata.readonly` 與 `drive.file` scopes，並在需要時完成 Google 驗證。
- [ ] OAuth 同意畫面已設定正式網域、支援聯絡資訊、隱私權政策 URL 與服務條款 URL。
- [ ] `vercel.json` 以 filesystem-first 處理 `/api/*`，其餘路徑才回退至 SPA，並以每日 `0 0 * * *` cron 呼叫受 `CRON_SECRET` 保護的 cleanup API。

## 登入、設定與隔離

- [ ] 清除 Cookie 後，帳號 A 首次登入可建立新的「每日記事」Sheet，且完成初始化後才進入日記。
- [ ] 帳號 B 可連結由 B 擁有、空白或相容的既有 Sheet；B 不會建立額外不必要 Sheet。
- [ ] B 嘗試選取 A 擁有、共用給 B、唯讀、垃圾桶、已連結或 schema 不相容的 Sheet 時，系統拒絕且不改動該 Sheet。
- [ ] A 建立記事、分類、標籤與連結後切換至 B，B 看不到 A 的任何資料、名稱、Sheet ID、CSV 或搜尋結果。
- [ ] B 建立資料後切回 A，A 的資料仍完整且不含 B 的資料。
- [ ] 刷新已登入的正式網站可恢復正確帳號；登入另一帳號時，前一帳號資料不會短暫顯示。
- [ ] 登出、撤銷 Google 授權、失效 session 或被刪除 Sheet 時，系統清除本站 session 並要求安全重新連線，不刪除原 Sheet。
- [ ] 更換 Sheet 前明確提示不會自動複製、搬移或刪除舊資料；取消、驗證失敗或並行衝突後，原連線與畫面資料保持不變。

## 記事與分類

- [ ] 新增含日期、分類、標題、內容、兩個標籤與兩筆連結的記事。
- [ ] 編輯記事、確認標籤去重與網址驗證。
- [ ] 無標題記事在時間軸顯示內容摘要；同一天多筆記事依建立時間新到舊排列。
- [ ] 刪除前出現確認對話框，確認後永久移除該使用者自己的 Sheet 資料列。
- [ ] 新增、重新命名、停用與重新啟用分類；歷史記事保留已停用分類。
- [ ] 有記事的類別顯示完整記事數、可停用但不可永久刪除。
- [ ] 搬移單筆與多筆記事後，來源與目的分類、時間軸與月曆計數正確；失敗時勾選保留。

## 查詢、月曆與匯出

- [ ] 關鍵字、日期區間、分類與標籤的四種條件交集正確。
- [ ] 時間軸「載入更多」可正確分頁，月曆每日數量正確。
- [ ] 變更月曆月份後只取得該月份每日計數。
- [ ] 匯出目前篩選結果與全部記事，使用 Excel 開啟時繁體中文、引號與帳號隔離正確。

## Sheet 刪除與舊資料遷移

- [ ] 中斷連線後，使用者自行連結的 Sheet 仍保留在 Google Drive。
- [ ] 刪除帳號資料預設保留所有 Sheet。
- [ ] 只有服務建立的作用中 Sheet 在明確二次確認後可被服務刪除；使用者自行連結的 Sheet 永遠不會由服務刪除。
- [ ] 遷移前已建立並開啟既有個人 Sheet 的完整備份。
- [ ] 目標帳號已完成 OAuth 並持有未過期 provisioning attempt 後，才從受信任環境呼叫內部遷移程序。
- [ ] 遷移會成功綁定由目標帳號擁有且 schema／資料列相容的既有 Sheet，且資料列數與內容完全未變。
- [ ] 重複遷移、不同帳號、非擁有者、schema 不符、過期 attempt 與未知 token 金鑰版本都被安全拒絕；拒絕後原 Sheet 與暫存資料未被清空或改寫。
