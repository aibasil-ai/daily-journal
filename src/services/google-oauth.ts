import type { RuntimeConfig } from '../config/runtime-config'
import { zhTW } from '../i18n/zh-TW'

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ')

export class GoogleOAuthError extends Error {
  constructor(message: string = zhTW.errors.googleAuthorization) {
    super(message)
    this.name = 'GoogleOAuthError'
  }
}

export class GoogleOAuth {
  private accessToken: string | undefined
  private expiresAt = 0

  constructor(private readonly config: Pick<RuntimeConfig, 'googleClientId'>) {}

  async getAccessToken(prompt: '' | 'consent' = ''): Promise<string> {
    if (prompt === '' && this.accessToken && Date.now() < this.expiresAt) {
      return this.accessToken
    }

    const oauth2 = window.google?.accounts.oauth2
    if (!oauth2) {
      throw new GoogleOAuthError(zhTW.errors.googleNotLoaded)
    }

    return new Promise<string>((resolve, reject) => {
      const tokenClient = oauth2.initTokenClient({
        client_id: this.config.googleClientId,
        scope: GOOGLE_SCOPES,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new GoogleOAuthError())
            return
          }

          this.accessToken = response.access_token
          // 提前一分鐘更新，避免請求剛送出就遇到權杖過期。
          this.expiresAt = Date.now() + Math.max((response.expires_in ?? 0) - 60, 0) * 1000
          resolve(response.access_token)
        },
        error_callback: () => reject(new GoogleOAuthError()),
      })
      tokenClient.requestAccessToken({ prompt })
    })
  }
}
