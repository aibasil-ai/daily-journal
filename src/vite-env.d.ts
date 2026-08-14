/// <reference types="vite/client" />

declare const __BUILD_JOURNAL_CONFIG__: {
  googleClientId: string
  gasDeploymentId: string
}

interface Window {
  __JOURNAL_CONFIG__?: {
    googleClientId?: string
    gasDeploymentId?: string
  }
}
