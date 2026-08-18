export const SESSION_COOKIE_NAME = 'daily_journal_session'
export const OAUTH_STATE_COOKIE_NAME = 'daily_journal_oauth_state'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const STATE_MAX_AGE_SECONDS = 60 * 10
const COOKIE_ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/'

export function createSessionCookie(value: string): string {
  return createCookie(SESSION_COOKIE_NAME, value, SESSION_MAX_AGE_SECONDS)
}

export function clearSessionCookie(): string {
  return createCookie(SESSION_COOKIE_NAME, '', 0)
}

export function createOAuthStateCookie(value: string): string {
  return createCookie(OAUTH_STATE_COOKIE_NAME, value, STATE_MAX_AGE_SECONDS)
}

export function clearOAuthStateCookie(): string {
  return createCookie(OAUTH_STATE_COOKIE_NAME, '', 0)
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined

  for (const part of header.split(';')) {
    const [key, ...valueParts] = part.trim().split('=')
    if (key !== name) continue
    try {
      return decodeURIComponent(valueParts.join('='))
    } catch {
      return undefined
    }
  }

  return undefined
}

function createCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAge}`
}
