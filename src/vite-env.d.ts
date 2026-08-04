/// <reference types="vite/client" />

declare const __BUILD_JOURNAL_CONFIG__: {
  googleClientId: string
  gasScriptId: string
}

declare global {
  interface Window {
    __JOURNAL_CONFIG__?: {
      googleClientId?: string
      gasScriptId?: string
    }
  }
}

export {}
