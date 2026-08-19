import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type EncryptedToken = {
  ciphertext: string
  keyVersion: string
}

const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

export function encryptRefreshToken(
  token: string,
  key: Buffer,
  keyVersion: string,
): EncryptedToken {
  if (!token) {
    throw new Error('無法加密空的 token。')
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertextBuffer = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  const ciphertext = [iv, authTag, ciphertextBuffer]
    .map((part) => part.toString('base64url'))
    .join('.')

  return { ciphertext, keyVersion }
}

export function decryptRefreshToken(
  value: EncryptedToken,
  keys: Map<string, Buffer> | Buffer,
): string | undefined {
  if (!value || typeof value.ciphertext !== 'string' || typeof value.keyVersion !== 'string') {
    return undefined
  }

  const key = keys instanceof Map ? keys.get(value.keyVersion) : keys
  if (!key) return undefined

  const parts = value.ciphertext.split('.')
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    return undefined
  }

  try {
    const [iv, authTag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'))
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
      return undefined
    }

    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    if (!plaintext) return undefined
    return plaintext
  } catch {
    return undefined
  }
}
