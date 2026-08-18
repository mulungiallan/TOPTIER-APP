// src/lib/bot-crypto.ts
// AES-256-GCM encryption for MetaTrader account passwords at rest.
//
// Broker passwords are a user's most sensitive secret here: the account
// controls real money. We never store them in plaintext, and we never send
// them to the browser. A per-field random 12-byte IV + auth tag means the
// same password always produces different ciphertext, and any tampering is
// detected at decrypt time.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

function getSecretKey(): Buffer {
  const secret = process.env.BOT_CREDENTIALS_SECRET || process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('BOT_CREDENTIALS_SECRET is required in production to encrypt broker credentials.')
    }
    // Dev: derive a stable key from a fixed constant so encrypted data survives restarts.
    // Using randomBytes() here would orphan all encrypted broker passwords on every restart.
    return createHash('sha256').update('toptier-dev-only-do-not-use-in-production').digest()
  }
  return createHash('sha256').update(secret).digest()
}

/** Encrypt a plaintext string. Returns `iv:ciphertext:authTag`, all base64. */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return ''
  const key = getSecretKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')].join(':')
}

/** Decrypt a string produced by encryptSecret. Returns '' on any failure. */
export function decryptSecret(stored: string): string {
  if (!stored) return ''
  try {
    const [ivB64, dataB64, tagB64] = stored.split(':')
    if (!ivB64 || !dataB64 || !tagB64) return ''
    const key = getSecretKey()
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}
