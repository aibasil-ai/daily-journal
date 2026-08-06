export function createSessionCookie(value: string): string {
  return createCookie('session', value, 60 * 60 * 24 * 30)
}

export function clearSessionCookie(): string {
  return createCookie('session', '', 0)
}

export function createOAuthStateCookie(state: string): string {
  return createCookie('oauth_state', state, 60 * 10)
}

export function clearOAuthStateCookie(): string {
  return createCookie('oauth_state', '', 0)
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined

  for (const pair of header.split(';')) {
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex === -1 || pair.slice(0, separatorIndex).trim() !== name) continue

    try {
      return decodeURIComponent(pair.slice(separatorIndex + 1))
    } catch {
      return undefined
    }
  }

  return undefined
}

function createCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}
