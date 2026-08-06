# 端對端手動驗收清單

此清單必須由持有實際 Google 與部署平台資源的人執行。不要將 Sheet ID、GAS Script ID、OAuth 用戶端 ID、使用者資料、正式網域或 deployment ID 寫入 Git；可在未追蹤的本機紀錄保存驗收時間與結果。

## 執行紀錄

- [ ] 驗收日期與時間：__________
- [ ] 驗收者：__________
- [ ] 正式網站網址已私下記錄，且 OAuth callback redirect URI 已設為 `https://正式網域/api/auth/callback`。
- [ ] GAS API Executable deployment ID 已私下記錄。
- [ ] Sheet 時區已在「檔案 > 設定」確認：__________

## 前置條件

- [ ] 依 [部署文件](deployment.md) 完成 Google Sheets、Google Cloud、OAuth、clasp 與 API Executable 設定。
- [ ] 已在 GAS「專案設定 > 指令碼屬性」新增 `SPREADSHEET_ID` 並填入空白 Google Sheets ID；從函式下拉選單手動執行無參數的 `initializeJournal`，確認 `entries`、`categories`、`settings` 三個工作表已建立。
- [ ] Vercel Production 已設定四個 server-only 值 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`SESSION_ENCRYPTION_KEY`、`GAS_DEPLOYMENT_ID`，且未設定 `APP_GOOGLE_CLIENT_ID` 或 `APP_GAS_DEPLOYMENT_ID`；本機設定檔及任何秘密均未提交。

## 響應式三斷點

以瀏覽器裝置工具開啟已部署網站，在每個寬度重新載入並確認沒有水平捲軸、內容可操作、文字沒有被遮住。

- [ ] `375px`，行動版：篩選欄位為單欄，右下角顯示「新增記事」浮動按鈕。
- [ ] `768px`，平板版：表單與記事內容為兩欄，篩選欄位為兩欄。
- [ ] `1024px`，桌面版：兩欄版面與時間軸可正常閱讀、操作。

## OAuth 與工作階段

完整 OAuth 驗收必須在 Vercel Production 網域執行；Preview URL 不可作為 OAuth 驗收目標。

- [ ] OAuth Web Client 的 redirect URI 為 `https://正式網域/api/auth/callback`。
- [ ] 清除正式網站 Cookie 後，首次按「使用 Google 帳號登入」，完成帳號選取與同意畫面，回到記事首頁並讀取資料。
- [ ] 重新整理已登入的 Production 頁面，確認 session 自動恢復並載入記事，不再顯示登入按鈕、Google 帳號選擇或 OAuth 同意畫面。
- [ ] 按「登出」後，確認畫面立即清空並回到登入畫面；重新整理仍維持未登入，並以重新登入或直接查看 Google Sheets 確認既有記事未被刪除。
- [ ] 在 Google 帳號撤銷網站授權後重新整理，確認畫面顯示登入；重新授權後，實際新增、讀取、編輯、刪除一筆非敏感記事，並以 CSV 匯出驗證。

## 空白試算表與記事 CRUD

- [ ] 使用全新的空白試算表完成初始化，確認沒有手動建立工作表或前端設定試算表識別資訊。
- [ ] 新增一則含日期、標題、內容、分類、至少一個標籤與連結的記事，確認它出現在時間軸。
- [ ] 編輯該記事的標題或內容並儲存，重新整理後仍為更新後資料。
- [ ] 對該記事執行刪除，於確認對話框確認後，重新整理並確認資料已移除。

## 同日、分類與篩選

- [ ] 新增至少兩則相同日期的記事，確認時間軸與該日資料都同時保留多筆。
- [ ] 新增分類後建立一則採用該分類的記事；停用分類時確認提示「既有記事會保留此分類，新記事不可再選用」。
- [ ] 停用後確認舊記事仍顯示該分類，新記事的分類選單不再提供它。
- [ ] 建立能被唯一辨識的測試記事，依序同時套用關鍵字搜尋、日期範圍、分類、標籤四種篩選，確認交集只留下預期資料。
- [ ] 逐一清除四種篩選，確認列表不會保留上一個篩選的過期結果。

## 月曆與匯出

- [ ] 切換至「月曆檢視」，確認含多筆同日記事的日期顯示正確數量。
- [ ] 切換上個月與下個月，再回到測試月份，確認每月計數與日期選取後的記事列表一致。
- [ ] 執行「匯出篩選結果」，以 Excel 開啟 CSV，確認繁中欄位與內容正常、沒有亂碼。
- [ ] 執行「匯出全部記事」，以 Excel 開啟 CSV，確認筆數多於或等於篩選匯出且欄位完整。

## Vercel 正式部署

- [ ] Vercel 專案以 `npm run build` 建置，Output Directory 為 `dist`。
- [ ] 四個 server-only 環境變數只設於 Vercel Production，並重新部署 Production。
- [ ] Production callback URL 已加入 OAuth redirect URI；確認不使用 browser GIS 與公開 OAuth 設定。
- [ ] 直接開啟未知 SPA 路徑並重新整理，確認 fallback 回傳 `index.html`；`/api/session`、`/api/journal`、`/api/auth/start` 仍由 Function 回應。
- [ ] 在 Production 網址完成登入、讀取、建立一筆非敏感測試記事並刪除，確認端對端流程成功。
