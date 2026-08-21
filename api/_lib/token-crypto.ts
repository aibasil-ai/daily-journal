import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type EncryptedToken = {
  ciphertext: string
  keyVersion: string
}

export type TokenDecryptionKeys = ReadonlyMap<string, Buffer> | Buffer

const IV_BYTES = 12
const AUTH_TAG_BYTES = 16
const BASE64URL = /^[A-Za-z0-9_-]+$/

export function encryptRefreshToken(
  token: string,
  key: Buffer,
  keyVersion: string,
): EncryptedToken {
  if (!token) throw new Error('無法加密空的 token。')
  assertAes256Key(key)
  if (!isKeyVersion(keyVersion)) throw new Error('TOKEN_ENCRYPTION_KEY_VERSION 無效。')

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])

  return {
    ciphertext: [iv, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString('base64url'))
      .join('.'),
    keyVersion,
  }
}

export function decryptRefreshToken(
  value: EncryptedToken,
  keys: TokenDecryptionKeys,
): string | undefined {
  if (!isEncryptedToken(value)) return undefined

  const key = Buffer.isBuffer(keys) ? keys : keys.get(value.keyVersion)
  if (!key || !isAes256Key(key)) return undefined

  const parts = value.ciphertext.split('.')
  if (parts.length !== 3) return undefined
  const decoded = parts.map(decodeBase64Url)
  if (decoded.some((part) => part === undefined)) return undefined

  const [iv, authTag, ciphertext] = decoded as [Buffer, Buffer, Buffer]
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
    return undefined
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return plaintext || undefined
  } catch {
    return undefined
  }
}

function assertAes256Key(key: Buffer): void {
  if (!isAes256Key(key)) throw new Error('TOKEN_ENCRYPTION_KEY 必須是 32-byte 金鑰。')
}

function isAes256Key(key: unknown): key is Buffer {
  return Buffer.isBuffer(key) && key.length === 32
}

function isEncryptedToken(value: unknown): value is EncryptedToken {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as EncryptedToken).ciphertext === 'string'
    && typeof (value as EncryptedToken).keyVersion === 'string'
    && isKeyVersion((value as EncryptedToken).keyVersion)
}

function isKeyVersion(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value)
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL.test(value)) return undefined
  const decoded = Buffer.from(value, 'base64url')
  return decoded.toString('base64url') === value ? decoded : undefined
}
