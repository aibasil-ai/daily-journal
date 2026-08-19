import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type SessionCookiePayload = {
  sessionId: string
  expiresAt: number
}

export type SessionPayload = SessionCookiePayload

const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

export function encryptSession(session: SessionCookiePayload, key: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [iv, authTag, ciphertext].map((part) => part.toString('base64url')).join('.')
}

export function decryptSession(value: string, key: Buffer, now: number = Date.now()): SessionCookiePayload | undefined {
  const parts = value.split('.')
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return undefined

  try {
    const [iv, authTag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'))
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) return undefined

    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    const payload = JSON.parse(plaintext) as unknown
    if (!isSessionCookiePayload(payload) || now >= payload.expiresAt) return undefined
    return payload
  } catch {
    return undefined
  }
}

function isSessionCookiePayload(value: unknown): value is SessionCookiePayload {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as SessionCookiePayload).sessionId === 'string'
    && Boolean((value as SessionCookiePayload).sessionId)
    && typeof (value as SessionCookiePayload).expiresAt === 'number'
    && Number.isFinite((value as SessionCookiePayload).expiresAt)
}

