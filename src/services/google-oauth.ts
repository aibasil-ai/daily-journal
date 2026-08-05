import type { RuntimeConfig } from '../config/runtime-config'
import { zhTW } from '../i18n/zh-TW'

const scope = 'https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/spreadsheets'

class InteractionRequiredError extends Error {}

export class GoogleOAuth {
  private accessToken: string | undefined
  private expiresAt = 0
  private tokenClient: google.accounts.oauth2.TokenClient | undefined
  private requestGeneration = 0

  constructor(private readonly config: RuntimeConfig) {}

  getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt) return Promise.resolve(this.accessToken)
    return this.requestAccessToken('')
  }

  clearAccessToken(): void {
    this.requestGeneration += 1
    this.accessToken = undefined
    this.expiresAt = 0
    this.tokenClient = undefined
  }

  async signIn(): Promise<void> {
    this.clearAccessToken()
    try {
      await this.requestAccessToken('')
    } catch (error) {
      if (!(error instanceof InteractionRequiredError)) throw error
      await this.requestAccessToken('consent')
    }
  }

  private requestAccessToken(prompt: '' | 'consent'): Promise<string> {
    const requestGeneration = this.requestGeneration
    if (typeof google === 'undefined' || typeof google.accounts?.oauth2?.initTokenClient !== 'function') {
      this.clearAccessToken()
      return Promise.reject(new Error(zhTW.auth.sdkUnavailable))
    }

    return new Promise((resolve, reject) => {
      const requestIsCurrent = () => requestGeneration === this.requestGeneration
      const rejectStale = () => reject(new Error(zhTW.auth.incomplete))
      const rejectIncomplete = () => {
        if (!requestIsCurrent()) {
          rejectStale()
          return
        }
        this.clearAccessToken()
        reject(new Error(zhTW.auth.incomplete))
      }

      try {
        const tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: this.config.googleClientId,
          scope,
          callback: (response) => {
            if (!requestIsCurrent()) {
              rejectStale()
              return
            }

            if (response.error === 'interaction_required') {
              this.clearAccessToken()
              reject(new InteractionRequiredError())
              return
            }

            if (!response.access_token || response.error) {
              rejectIncomplete()
              return
            }

            this.accessToken = response.access_token
            this.expiresAt = Date.now() + (response.expires_in ?? 0) * 1_000
            resolve(response.access_token)
          },
          error_callback: rejectIncomplete,
        })
        if (!requestIsCurrent()) {
          rejectStale()
          return
        }
        this.tokenClient = tokenClient
        tokenClient.requestAccessToken({ prompt })
      } catch (error) {
        if (requestIsCurrent()) this.clearAccessToken()
        reject(error)
      }
    })
  }
}
