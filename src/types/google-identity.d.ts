declare namespace google.accounts.oauth2 {
  interface TokenClientConfig {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: () => void
  }

  interface TokenResponse {
    access_token?: string
    expires_in?: number
    error?: string
  }

  interface TokenClient {
    requestAccessToken: (overrideConfig?: { prompt?: string }) => void
  }

  function initTokenClient(config: TokenClientConfig): TokenClient
}
