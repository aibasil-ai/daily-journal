interface GoogleTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
  expires_in?: number
}

interface GoogleTokenClient {
  callback: (response: GoogleTokenResponse) => void
  requestAccessToken(options?: { prompt?: '' | 'consent' }): void
}

interface Window {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient(config: {
          client_id: string
          scope: string
          callback: (response: GoogleTokenResponse) => void
          error_callback?: (error: unknown) => void
        }): GoogleTokenClient
      }
    }
  }
}
