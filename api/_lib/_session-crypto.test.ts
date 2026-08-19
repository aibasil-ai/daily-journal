import { describe, expect, test } from 'vitest'
import { decryptSession, encryptSession } from './session-crypto'

const key = Buffer.alloc(32, 3)
const session = { sessionId: 'random-session-id-123', expiresAt: 1_000_000 }

describe('工作階段加密', () => {
  test('以 AES-GCM 加密後可還原原始工作階段', () => {
    const encrypted = encryptSession(session, key)

    expect(decryptSession(encrypted, key, session.expiresAt - 1)).toEqual(session)
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
