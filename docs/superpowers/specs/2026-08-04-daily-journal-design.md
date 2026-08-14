# 每日記事 App 設計規格

> **歷史文件警示：** 本文件僅供歷史參考，已由 `docs/superpowers/specs/2026-08-06-server-side-session-design.md` 取代；禁止用來部署目前版本。

## 目標與範圍

建立一個僅供個人使用的每日記事網頁 App。使用者可在手機、平板與電腦記錄每天多則事項，並可在日後以日期、分類、標籤與關鍵字查閱。

第一版包含：

- 新增、檢視、編輯與永久刪除記事。
- 可補登任意日期的記事；預設為今天。
- 單一分類、自由多標籤與多筆網址連結。
- 分類新增、重新命名與停用。
- 時間軸與月曆檢視。
- 關鍵字、日期區間、分類及標籤的複合查詢。
- 將目前篩選結果或全部記事匯出為 UTF-8 BOM CSV。
- 以繁體中文為預設介面，將文字集中管理以保留未來多語系空間。

第一版不包含：離線新增與同步、每日提醒、圖片或檔案上傳、多使用者共用服務。

本專案作為可自行部署的範本；每位部署者僅管理自己的資料，並自行建立 Google Sheets、Google Apps Script 與 Google OAuth 設定。

## 使用情境與介面

- 手機預設開啟時間軸；平板與桌面預設開啟月曆。
- 所有裝置皆可切換時間軸與月曆，並在瀏覽器本機保存最後選擇。
- 時間軸依記錄日期由新到舊分組，單日可包含多則記事。
- 月曆顯示各日期的記事數量；點選後開啟該日記事清單。
- 記事編輯器包含：記錄日期、分類、選填標題、內文、自由標籤及多個具顯示名稱的網址連結。
- 未填標題時，以內文前段作為清單與搜尋結果摘要。
- 連結僅保存名稱與網址，於新分頁以安全屬性開啟。
- 搜尋列可將關鍵字、日期區間、分類與標籤任意組合；條件同時套用至時間軸與月曆。
- 分類管理頁提供新增、重新命名與停用；有歷史記事的分類只能停用，既有記事保留原分類，新記事不能選用。

## 技術架構

採用 React、TypeScript 與 Vite 建置純靜態單頁網站。網站不依賴特定主機，可部署在 Vercel、Cloudflare Pages、Netlify、GitHub Pages 或一般靜態主機。

```text
React + TypeScript + Vite
          |
          | Google OAuth access token
          v
Google Apps Script Execution API
          |
          v
Google Apps Script
          |
          v
Google Sheets
```

- 前端使用 Google Identity Services 取得 OAuth 權杖。
- 前端以 OAuth 權杖呼叫已部署為 API Executable 的 GAS 函式。
- GAS 處理輸入驗證、資料規則、時區、資料存取及 CSV 資料產出。
- Google Sheets 是唯一資料來源，試算表 ID 僅保存於 GAS Script Properties，不傳至前端。
- GAS 專案與 OAuth 用戶端須關聯同一個標準 Google Cloud 專案，並啟用 Apps Script API。
- API Executable 僅允許部署者本人執行。
- 前端不得直接讀寫 Google Sheets。

## 跨平台部署設定

前端只需要兩個公開設定：

- `APP_GOOGLE_CLIENT_ID`：Google OAuth 用戶端 ID。
- `APP_GAS_DEPLOYMENT_ID`：GAS API Executable Deployment ID。

這些值不是機密資訊，但每位部署者都必須使用自己的設定。建置工具應讀取上述通用環境變數並產生瀏覽器可讀設定。

對於無法設定建置環境變數的靜態主機，部署者可將 `app-config.example.js` 複製為 `app-config.js` 後填入兩項設定。`app-config.js` 必須列入 `.gitignore`，避免誤提交個人設定。

每位部署者都必須將實際網站網域加入 OAuth 用戶端的「授權 JavaScript 來源」。Vercel 預覽網址不納入；本機開發網址應另行登錄。

部署文件需分別說明 Vercel、Cloudflare Pages、Netlify、GitHub Pages 與一般靜態主機的設定流程。

## 資料模型

### `entries` 工作表

| 欄位 | 說明 |
| --- | --- |
| `id` | GAS 產生的 UUID。 |
| `entryDate` | 使用者記錄的日期。 |
| `title` | 選填標題。 |
| `content` | 內文。 |
| `categoryId` | 單一分類 ID。 |
| `tags` | 標籤 JSON 字串。 |
| `links` | 包含名稱與網址的連結 JSON 字串。 |
| `createdAt` | GAS 產生的建立時間。 |
| `updatedAt` | GAS 產生的最後更新時間。 |

### `categories` 工作表

| 欄位 | 說明 |
| --- | --- |
| `id` | GAS 產生的 UUID。 |
| `name` | 類別名稱。 |
| `isActive` | 是否可供新記事選擇。 |
| `createdAt` | 建立時間。 |
| `updatedAt` | 最後更新時間。 |

### `settings` 工作表

保存資料結構版本等非機密系統設定。

所有日期與時間由 GAS 依 Google Sheets 設定的時區產生及判定。`entryDate` 可選擇任意日期，預設為當日。

## API 與資料規則

前端只可呼叫受限的 GAS 函式，例如：讀取記事、儲存記事、刪除記事、管理分類、讀取標籤建議、取得月曆彙總及匯出資料。

- 新增與編輯時，GAS 驗證日期、分類、內文與網址格式。
- 標籤需去除前後空白及重複項目；既有標籤可作為輸入建議。
- 記事必須指定啟用中的分類。已停用分類可保留在歷史記事，但編輯該記事時必須改選啟用分類。
- 分類名稱可重新命名；若已有記事使用，只可停用，不可刪除。
- 刪除記事採永久刪除；前端必須要求使用者再次確認。
- 關鍵字搜尋範圍包含標題、內文、標籤及連結名稱。
- 月曆只讀取每月每日的記事數量；使用者點選日期後才讀取完整記事。
- 搜尋清單採分頁或「載入更多」，避免資料增加後首頁過慢。
- GAS 依篩選條件傳回匯出資料；前端生成 UTF-8 BOM CSV 供下載，使 Excel 可正確開啟繁體中文。

## 狀態、錯誤與安全性

- 首次載入時檢查部署設定、Google 登入狀態及 GAS 連線。
- 登入取消、OAuth 權杖過期、GAS 權限不足、設定不正確、網路中斷與試算表初始化失敗，皆需顯示明確原因與可執行的處理指引。
- 寫入期間停用送出按鈕，避免重複新增；成功後重新載入受影響資料並顯示結果。
- OAuth、GAS 與 Google Sheets 皆屬於同一部署者；前端不持有 Sheets ID 或任何私密憑證。
- 本 App 不支援離線寫入；新增、修改、刪除、查詢與匯出皆須網路連線。

## 測試與驗收

- 前端單元測試：表單驗證、篩選組合、月曆計算、CSV 內容與 API 錯誤狀態。
- GAS 測試：輸入驗證、試算表時區、分類停用規則、記事 CRUD、搜尋篩選及 CSV 資料產出。
- 響應式驗收：手機、平板與桌面尺寸；包含鍵盤操作與基本無障礙需求。
- 手動驗收：Google OAuth、Apps Script Execution API 權限、Vercel 部署及其他靜態主機部署流程。

## 已確認決策

- 個人使用，不提供集中式多使用者服務。
- React + TypeScript + Vite 靜態網站。
- Google Sheets + GAS，透過 GAS Execution API 與 Google OAuth 存取。
- 每個裝置各自登入；無離線模式與每日提醒。
- 單一分類、多標籤、多網址連結。
- 手機預設時間軸，平板及桌面預設月曆，可手動切換。
- 記錄日期採 Google Sheets 時區。
- 預設繁體中文，架構保留多語系擴充性。
