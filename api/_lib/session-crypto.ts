import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type SessionCookiePayload = {
  sessionId: string
  expiresAt: number
}

export type SessionPayload = SessionCookiePayload

const IV_BYTES = 12
const AUTH_TAG_BYTES = 16
const BASE64URL = /^[A-Za-z0-9_-]+$/

export function encryptSession(session: SessionCookiePayload, key: Buffer): string {
  const payload = normalizeSessionPayload(session)
  if (!payload) throw new Error('無效的工作階段 Cookie payload。')
  assertAes256Key(key)

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [iv, authTag, ciphertext].map((part) => part.toString('base64url')).join('.')
}

export function decryptSession(
  value: string,
  key: Buffer,
  now: number = Date.now(),
): SessionCookiePayload | undefined {
  if (typeof value !== 'string' || !isAes256Key(key)) return undefined
  const parts = value.split('.')
  if (parts.length !== 3) return undefined
  const decoded = parts.map(decodeBase64Url)
  if (decoded.some((part) => part === undefined)) return undefined

  try {
    const [iv, authTag, ciphertext] = decoded as [Buffer, Buffer, Buffer]
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

function normalizeSessionPayload(value: unknown): SessionCookiePayload | undefined {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as SessionCookiePayload).sessionId === 'string'
    && Boolean((value as SessionCookiePayload).sessionId)
    && typeof (value as SessionCookiePayload).expiresAt === 'number'
    && Number.isFinite((value as SessionCookiePayload).expiresAt)
    ? {
      sessionId: (value as SessionCookiePayload).sessionId,
      expiresAt: (value as SessionCookiePayload).expiresAt,
    }
    : undefined
}

function isSessionCookiePayload(value: unknown): value is SessionCookiePayload {
  const payload = normalizeSessionPayload(value)
  if (!payload) return false
  const keys = Object.keys(value as object)
  return keys.length === 2 && keys.includes('sessionId') && keys.includes('expiresAt')
}

function assertAes256Key(key: Buffer): void {
  if (!isAes256Key(key)) throw new Error('SESSION_ENCRYPTION_KEY 必須是 32-byte 金鑰。')
}

function isAes256Key(key: unknown): key is Buffer {
  return Buffer.isBuffer(key) && key.length === 32
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL.test(value)) return undefined
  const decoded = Buffer.from(value, 'base64url')
  return decoded.toString('base64url') === value ? decoded : undefined
}
