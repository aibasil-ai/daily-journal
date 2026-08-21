import { createCipheriv, randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { decryptSession, encryptSession } from './session-crypto.js'

const key = Buffer.alloc(32, 3)
const session = { sessionId: 'opaque-session-id', expiresAt: 1_000_000 }

describe('工作階段加密', () => {
  test('以 AES-GCM 加密後可還原原始工作階段', () => {
    const encrypted = encryptSession(session, key)

    expect(decryptSession(encrypted, key, session.expiresAt - 1)).toEqual(session)
  })

  test('Cookie payload 只保留 sessionId 與 expiresAt', () => {
    const payloadWithUnexpectedFields = {
      ...session,
      refreshToken: 'must-not-reach-cookie',
      userId: 'user-1',
      spreadsheetId: 'sheet-1',
    }
    const encrypted = encryptSession(payloadWithUnexpectedFields, key)

    expect(encrypted).not.toContain('must-not-reach-cookie')
    expect(decryptSession(encrypted, key, session.expiresAt - 1)).toEqual(session)
    expect(decryptSession(
      encryptRawSession({ ...session, refreshToken: 'must-not-be-accepted' }),
      key,
      session.expiresAt - 1,
    )).toBeUndefined()
  })

  test('拒絕遭竄改的密文', () => {
    const encrypted = encryptSession(session, key)
    const [iv, authTag, ciphertext] = encrypted.split('.')
    const replacement = iv.at(0) === 'A' ? 'B' : 'A'
    const tampered = `${replacement}${iv.slice(1)}.${authTag}.${ciphertext}`

    expect(decryptSession(tampered, key, session.expiresAt - 1)).toBeUndefined()
  })

  test('拒絕已過期的工作階段', () => {
    const encrypted = encryptSession(session, key)

    expect(decryptSession(encrypted, key, session.expiresAt)).toBeUndefined()
  })
})

function encryptRawSession(payload: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])

  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString('base64url'))
    .join('.')
}
