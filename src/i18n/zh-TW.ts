export const zhTW = {
  appTitle: '每日記事',
  config: {
    missingDeployment: '找不到部署設定。請設定 APP_GOOGLE_CLIENT_ID 與 APP_GAS_SCRIPT_ID，或建立 public/app-config.js。',
  },
  validation: {
    entryDate: '請選擇記錄日期。',
    content: '請輸入記事內容。',
    categoryId: '請選擇啟用中的分類。',
    links: '每個連結都需要名稱與有效的 http 或 https 網址。',
  },
  auth: {
    incomplete: 'Google 登入或授權未完成。',
    expired: '登入已過期或沒有 GAS 使用權限，請重新登入。',
  },
  api: {
    invalidResponse: '服務回應格式錯誤，請稍後再試。',
    requestFailed: '暫時無法連線至服務，請稍後再試。',
  },
  journal: {
    connectionTitle: '連線至每日記事',
    configErrorTitle: '部署設定有誤',
    checkingConfig: '正在檢查部署設定...',
    signedOutDescription: '登入後即可安全連線至你的 Google Sheets 記事資料。',
    connectingDescription: '正在登入並連線至 Google Sheets，請稍候。',
    signIn: '使用 Google 帳號登入',
    signInAgain: '重新登入',
    retry: '重新嘗試',
    connecting: '連線中...',
    ready: '已連線至 Google Sheets。',
  },
} as const
