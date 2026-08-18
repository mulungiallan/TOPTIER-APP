// ─── Server-side WebAuthn (biometric) verification ────────────────────────────
// This module runs ONLY on the server (API routes). It provides:
//   - server-generated challenges (never trust a client-supplied challenge)
//   - COSE public-key parsing (EC2 / RSA) into WebCrypto keys
//   - registration validation (webauthn.create)
//   - assertion verification (webauthn.get) with rpId hash, flags and the
//     signature counter for clone detection.
//
// The client `BiometricService` in /src/lib/security/biometric.ts calls back
// into these routes; both must stay in sync on field names.

// ─── Base64URL helpers (Node) ────────────────────────────────────────────────

function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const buf = Buffer.from(b64, 'base64')
  const out = new Uint8Array(buf.byteLength)
  out.set(buf)
  return out
}

function bytesToBase64Url(bytes: Uint8Array | ArrayBuffer): string {
  const buf = bytes instanceof Uint8Array ? Buffer.from(bytes) : Buffer.from(new Uint8Array(bytes))
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateChallenge(): string {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return bytesToBase64Url(arr)
}

function bufferEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0
}

// ─── Challenge store ──────────────────────────────────────────────────────────
// In-memory challenge registry. Fine for the single-process standalone server;
// each challenge is single-use and expires after 5 minutes.

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const challenges = new Map<string, { challenge: string; exp: number }>()

export function storeChallenge(key: string): string {
  const challenge = generateChallenge()
  challenges.set(key, { challenge, exp: Date.now() + CHALLENGE_TTL_MS })
  return challenge
}

/** Returns and invalidates the stored challenge for `key` (null if expired/absent). */
export function consumeChallenge(key: string): string | null {
  const entry = challenges.get(key)
  if (!entry) return null
  challenges.delete(key)
  if (Date.now() > entry.exp) return null
  return entry.challenge
}

// ─── Minimal CBOR decoder (enough for COSE keys) ─────────────────────────────

type CborValue =
  | number
  | bigint
  | string
  | boolean
  | null
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>

function decodeCbor(data: Uint8Array): CborValue {
  let offset = 0

  const readHead = (): { major: number; info: number } => {
    if (offset >= data.length) throw new Error('CBOR: unexpected end of input')
    const initial = data[offset++]
    return { major: initial >> 5, info: initial & 0x1f }
  }

  const readLength = (info: number): number => {
    if (info < 24) return info
    if (info === 24) return data[offset++]
    if (info === 25) {
      const v = (data[offset] << 8) | data[offset + 1]
      offset += 2
      return v
    }
    if (info === 26) {
      let v = 0
      for (let i = 0; i < 4; i++) v = v * 256 + (data[offset + i] ?? 0)
      offset += 4
      return v >>> 0
    }
    if (info === 27) {
      let v = BigInt(0)
      const base = BigInt(256)
      for (let i = 0; i < 8; i++) v = v * base + BigInt(data[offset + i] ?? 0)
      offset += 8
      const n = Number(v)
      if (n > Number.MAX_SAFE_INTEGER) throw new Error('CBOR: integer too large')
      return n
    }
    throw new Error(`CBOR: invalid length info ${info}`)
  }

  const readBytes = (): Uint8Array => {
    const len = readLength(readHead().info)
    const bytes = data.slice(offset, offset + len)
    offset += len
    return bytes
  }

  const readItem = (): CborValue => {
    const { major, info } = readHead()

    switch (major) {
      case 0:
        return readLength(info)
      case 1:
        return -1 - readLength(info)
      case 2:
        return readBytes()
      case 3:
        return new TextDecoder().decode(readBytes())
      case 4: {
        if (info === 31) {
          const arr: CborValue[] = []
          while (data[offset] !== 0xff) arr.push(readItem())
          offset++
          return arr
        }
        const len = readLength(info)
        const arr: CborValue[] = []
        for (let i = 0; i < len; i++) arr.push(readItem())
        return arr
      }
      case 5: {
        const map = new Map<CborValue, CborValue>()
        if (info === 31) {
          while (data[offset] !== 0xff) {
            const k = readItem()
            const v = readItem()
            map.set(k, v)
          }
          offset++
          return map
        }
        const len = readLength(info)
        for (let i = 0; i < len; i++) {
          const k = readItem()
          const v = readItem()
          map.set(k, v)
        }
        return map
      }
      case 6:
        readLength(info)
        return readItem()
      case 7:
        if (info === 20) return false
        if (info === 21) return true
        if (info === 22) return null
        if (info === 23) return null
        if (info === 25) {
          offset += 2
          return 0
        }
        if (info === 26) {
          offset += 4
          return 0
        }
        if (info === 27) {
          offset += 8
          return 0
        }
        throw new Error(`CBOR: unsupported simple value ${info}`)
      default:
        throw new Error(`CBOR: unsupported major type ${major}`)
    }
  }

  const result = readItem()
  if (offset !== data.length) throw new Error('CBOR: trailing bytes')
  return result
}

// ─── COSE key → WebCrypto key ─────────────────────────────────────────────────

const COSE_KTY_EC2 = 2
const COSE_KTY_RSA = 3
const COSE_ALG_ES256 = -7
const COSE_ALG_RS256 = -257
const COSE_CRV_P256 = 1

export interface ParsedCoseKey {
  key: CryptoKey
  verifyAlgorithm: AlgorithmIdentifier
}

function toInt(v: CborValue | undefined): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  return null
}

export async function parseCosePublicKey(coseBase64Url: string): Promise<ParsedCoseKey> {
  const bytes = base64UrlToBytes(coseBase64Url)
  let parsed: CborValue
  try {
    parsed = decodeCbor(bytes)
  } catch (e) {
    throw new Error(`Invalid COSE key: ${e instanceof Error ? e.message : 'decode failed'}`)
  }
  if (!(parsed instanceof Map)) throw new Error('Invalid COSE key: expected a map')

  const kty = toInt(parsed.get(1))
  const alg = toInt(parsed.get(3))

  if (kty === COSE_KTY_EC2) {
    const crv = toInt(parsed.get(-1))
    const x = parsed.get(-2)
    const y = parsed.get(-3)
    if (crv !== COSE_CRV_P256) throw new Error('Unsupported EC curve: only P-256')
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
      throw new Error('Invalid EC key coordinates')
    }
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToBase64Url(x),
      y: bytesToBase64Url(y),
      ext: false,
    }
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
    return {
      key,
      verifyAlgorithm: { name: 'ECDSA', hash: 'SHA-256' } as EcdsaParams,
    }
  }

  if (kty === COSE_KTY_RSA) {
    const n = parsed.get(-1)
    const e = parsed.get(-2)
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) {
      throw new Error('Invalid RSA key modulus/exponent')
    }
    const jwk = {
      kty: 'RSA',
      n: bytesToBase64Url(n),
      e: bytesToBase64Url(e),
      ext: false,
    }
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    )
    return { key, verifyAlgorithm: { name: 'RSASSA-PKCS1-v1_5' } }
  }

  throw new Error(`Unsupported COSE key type: ${kty} (alg ${alg})`)
}

// ─── Verification helpers ─────────────────────────────────────────────────────

interface AssertionInput {
  clientDataJSONB64: string
  authenticatorDataB64: string
  signatureB64: string
  storedPublicKeyB64: string
  expectedChallenge: string
  expectedOrigin: string
  rpId: string
  expectedCounter: number
}

export function parseClientData(
  clientDataJSONB64: string,
  expectedType: 'webauthn.get' | 'webauthn.create',
  expectedChallenge: string,
  expectedOrigin: string
): Record<string, unknown> {
  let clientData: Record<string, unknown>
  try {
    clientData = JSON.parse(new TextDecoder().decode(base64UrlToBytes(clientDataJSONB64)))
  } catch {
    throw new Error('Invalid clientDataJSON')
  }
  if (clientData.type !== expectedType) {
    throw new Error(`Wrong clientData type: expected ${expectedType}, got ${clientData.type}`)
  }
  if (clientData.challenge !== expectedChallenge) {
    throw new Error('Challenge mismatch')
  }
  if (clientData.origin !== expectedOrigin) {
    throw new Error(`Origin mismatch: got ${clientData.origin}, expected ${expectedOrigin}`)
  }
  return clientData
}

export function parseAuthenticatorData(
  authenticatorDataB64: string,
  rpId: string,
  requireUserPresent: boolean
): { flags: number; counter: number } {
  const authData = base64UrlToBytes(authenticatorDataB64)
  if (authData.length < 37) throw new Error('authenticatorData too short')

  const flags = authData[32]
  if (requireUserPresent && (flags & 0x01) === 0) {
    throw new Error('User presence (UP) flag not set')
  }
  if ((flags & 0x40) === 0) {
    // Attested credential data should be present on registration
  }

  return { flags, counter: readUInt32BE(authData, 33) }
}

/**
 * Verify a WebAuthn assertion (biometric sign-in). Throws on any failure.
 * Returns the new signature counter to persist (clone detection).
 */
export async function verifyAssertion(input: AssertionInput): Promise<{ counter: number }> {
  const clientData = parseClientData(
    input.clientDataJSONB64,
    'webauthn.get',
    input.expectedChallenge,
    input.expectedOrigin
  )

  const authData = base64UrlToBytes(input.authenticatorDataB64)
  const { counter } = parseAuthenticatorData(input.authenticatorDataB64, input.rpId, true)

  // rpIdHash (first 32 bytes of authenticatorData) must equal SHA-256(rpId)
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.rpId))
  )
  if (!bufferEquals(authData.slice(0, 32), rpIdHash)) {
    throw new Error('rpIdHash mismatch')
  }

  // Clone detection: signature counter must increase (0 means "no counter").
  if (input.expectedCounter > 0 && counter > 0 && counter <= input.expectedCounter) {
    throw new Error('Replayed authentication (counter did not increase)')
  }

  // signed data = authenticatorData || SHA-256(clientDataJSON)
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', base64UrlToBytes(input.clientDataJSONB64))
  )
  const signedData = new Uint8Array(authData.length + clientDataHash.length)
  signedData.set(authData, 0)
  signedData.set(clientDataHash, authData.length)

  const { key, verifyAlgorithm } = await parseCosePublicKey(input.storedPublicKeyB64)
  const valid = await crypto.subtle.verify(
    verifyAlgorithm,
    key,
    base64UrlToBytes(input.signatureB64),
    signedData as BufferSource
  )
  if (!valid) throw new Error('Signature verification failed')

  void clientData
  return { counter }
}

/**
 * Validate the registration data sent back by the browser. Returns the
 * signature counter to persist for this credential.
 */
export async function verifyRegistration(input: {
  clientDataJSONB64: string
  authenticatorDataB64: string
  expectedChallenge: string
  expectedOrigin: string
  rpId: string
}): Promise<{ counter: number }> {
  parseClientData(input.clientDataJSONB64, 'webauthn.create', input.expectedChallenge, input.expectedOrigin)

  const authData = base64UrlToBytes(input.authenticatorDataB64)
  const { counter } = parseAuthenticatorData(input.authenticatorDataB64, input.rpId, true)

  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.rpId))
  )
  if (!bufferEquals(authData.slice(0, 32), rpIdHash)) {
    throw new Error('rpIdHash mismatch')
  }

  return { counter }
}

/** The RP ID (domain) WebAuthn uses — the hostname of the app's origin. */
export function getRpId(origin: string): string {
  try {
    return new URL(origin).hostname
  } catch {
    return origin
  }
}
