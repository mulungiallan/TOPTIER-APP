// src/lib/totp.ts
// Minimal, dependency-free TOTP (RFC 6238) compatible with Google/Microsoft
// Authenticator — used for admin 2FA. Base32-encodes secrets with the standard
// 26-letter alphabet, HMAC-SHA1 with the current Unix 30-second step.

import { createHmac, randomBytes } from 'crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateBase32Secret(bytes = 20): string {
  const buf = randomBytes(bytes)
  let out = ''
  let bits = 0
  let value = 0
  for (const b of buf) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '')
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const ch of clean) {
    const idx = B32.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeUIntBE(Math.floor(counter / 0x100000000), 0, 4)
  msg.writeUIntBE(counter % 0x100000000, 4, 4)
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const offset = h[h.length - 1] & 0x0f
  const code =
    ((h[offset] & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) << 8) |
    (h[offset + 3] & 0xff)
  return String(code % 1000000).padStart(6, '0')
}

export function verifyTotp(secret: string, code: string, window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false
  const step = Math.floor(Date.now() / 1000 / 30)
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, step + i) === code) return true
  }
  return false
}

export function otpauthUrl(secret: string, label: string, issuer = 'TOPTIER'): string {
  const enc = encodeURIComponent
  return `otpauth://totp/${enc(issuer)}:${enc(label)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`
}

export function qrDataUrl(otpauth: string): string {
  // Terminal/panel-friendly: encode as a text "QR as URL" hint. Real QR rendering
  // happens client-side; this exposes the canonical otpauth URI for a QR lib.
  return otpauth
}