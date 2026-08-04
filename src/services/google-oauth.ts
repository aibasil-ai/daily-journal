import type { RuntimeConfig } from '../config/runtime-config'
import { zhTW } from '../i18n/zh-TW'

const scope = 'https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/spreadsheets'

export class GoogleOAuth {
  private accessToken: string | undefined
  private expiresAt = 0
  private tokenClient: google.accounts.oauth2.TokenClient | undefined

  constructor(private readonly config: RuntimeConfig) {}

  getAccessToken(prompt: '' | 'consent' = ''): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt) return Promise.resolve(this.accessToken)

    return new Promise((resolve, reject) => {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.config.googleClientId,
        scope,
        callback: (response) => {
          if (!response.access_token || response.error) {
            this.accessToken = undefined
            this.expiresAt = 0
            reject(new Error(zhTW.auth.incomplete))
            return
          }

          this.accessToken = response.access_token
          this.expiresAt = Date.now() + (response.expires_in ?? 0) * 1_000
          resolve(response.access_token)
        },
        error_callback: () => reject(new Error(zhTW.auth.incomplete)),
      })
      this.tokenClient.requestAccessToken({ prompt })
    })
  }
}
