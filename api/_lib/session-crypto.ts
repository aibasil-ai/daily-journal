import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type SessionPayload = {
  refreshToken: string
  expiresAt: number
}

export function encryptSession(session: SessionPayload, key: Buffer): string {
  if (!hasSessionValues(session) || !isValidKey(key)) throw new Error('工作階段資料無效。')

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const payload = JSON.stringify({
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  })
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`
}

export function decryptSession(value: string, key: Buffer, now = Date.now()): SessionPayload | undefined {
  try {
    if (!isValidKey(key)) return undefined

    const parts = value.split('.')
    if (parts.length !== 3) return undefined

    const [encodedIv, encodedTag, encodedCiphertext] = parts
    const iv = decodeBase64url(encodedIv)
    const tag = decodeBase64url(encodedTag)
    const ciphertext = decodeBase64url(encodedCiphertext)

    if (!iv || !tag || !ciphertext || iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      return undefined
    }

    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const payload: unknown = JSON.parse(plaintext.toString('utf8'))

    if (!isSessionPayload(payload) || payload.expiresAt <= now) return undefined

    return { refreshToken: payload.refreshToken, expiresAt: payload.expiresAt }
  } catch {
    return undefined
  }
}

function isValidKey(key: Buffer): boolean {
  return Buffer.isBuffer(key) && key.length === 32
}

function decodeBase64url(value: string | undefined): Buffer | undefined {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined

  const decoded = Buffer.from(value, 'base64url')
  return decoded.toString('base64url') === value ? decoded : undefined
}

function hasSessionValues(value: unknown): value is SessionPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const { refreshToken, expiresAt } = value as SessionPayload
  return typeof refreshToken === 'string' && refreshToken.length > 0 && Number.isFinite(expiresAt)
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!hasSessionValues(value)) return false

  const keys = Object.keys(value)
  return keys.length === 2 && keys.includes('refreshToken') && keys.includes('expiresAt')
}
