/// <reference types="vite/client" />

interface JournalConfig {
  googleClientId: string
  gasScriptId: string
}

declare global {
  const __BUILD_JOURNAL_CONFIG__: JournalConfig

  interface Window {
    __JOURNAL_CONFIG__?: Partial<JournalConfig>
  }
}

export {}
