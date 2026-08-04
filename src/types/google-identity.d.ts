declare namespace google.accounts.oauth2 {
  interface TokenClientConfig {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
  }

  interface TokenResponse {
    access_token?: string
    error?: string
  }

  interface TokenClient {
    requestAccessToken: (overrideConfig?: { prompt?: string }) => void
  }

  function initTokenClient(config: TokenClientConfig): TokenClient
}
