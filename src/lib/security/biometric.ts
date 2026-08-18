// ─── Biometric Authentication (WebAuthn) Helper ─────────────────────────────
// Uses the WebAuthn API to register platform authenticators (Touch ID, Face ID,
// Windows Hello, security keys) and verify them for passwordless login.
//
// Security: the CHALLENGE must come from the server. Call register/verify with
// the challenge returned by the /api/security/biometric/*begin endpoints. The
// assertion + registration data are verified server-side in
// /src/lib/security/webauthn.ts.

// Base64URL ↔ ArrayBuffer utilities (browser-safe)
function bufToB64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let str = ''
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i])
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBuf(b64url: string): ArrayBuffer {
  const padded = b64url + '='.repeat((4 - (b64url.length % 4)) % 4)
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// ─── Device credential registry (localStorage) ───────────────────────────────
// Tells the login page which credentials this device can sign in with.

const STORAGE_KEY = 'toptier-biometric-credentials'

export function getStoredCredentialIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function rememberCredential(credentialId: string): void {
  try {
    const ids = getStoredCredentialIds()
    if (!ids.includes(credentialId)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids, credentialId]))
    }
  } catch (e: any) {
    console.warn('[Biometric] Failed to persist credential:', e?.message)
  }
}

export function forgetCredential(credentialId: string): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(getStoredCredentialIds().filter((id) => id !== credentialId))
    )
  } catch (e: any) {
    console.warn('[Biometric] Failed to remove credential:', e?.message)
  }
}

// Fallback client-side challenge generator (only used if a server challenge is
// unavailable — the server rejects registrations/assertions whose challenge it
// did not issue, so this never silently degrades security).
function generateChallenge(): ArrayBuffer {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return arr.buffer
}

// Deterministic, synchronous user handle derived from the account id so the same
// account always maps to the same WebAuthn user handle on this device.
function generateUserId(seed: string): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(seed)
  const out = new Uint8Array(new ArrayBuffer(32))
  out.set(bytes.subarray(0, 32))
  for (let i = 0; i < bytes.length; i++) {
    out[i % 32] = (out[i % 32] + bytes[i]) & 0xff
  }
  return out
}

export interface BiometricRegistrationResult {
  credentialId: string
  publicKey: string
  clientDataJSON: string
  authenticatorData: string
  deviceType: string
  transports: string
  nickname?: string
}

export interface BiometricVerifyResult {
  credentialId: string
  success: boolean
  authenticatorData: string
  clientDataJSON: string
  signature: string
}

export class BiometricService {
  static isSupported(): boolean {
    if (typeof window === 'undefined') return false
    return !!(
      window.PublicKeyCredential &&
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    )
  }

  static async isPlatformAuthenticatorAvailable(): Promise<boolean> {
    if (!this.isSupported()) return false
    try {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    } catch {
      return false
    }
  }

  /**
   * Register a new biometric credential for a user.
   * Pass the server-issued `serverChallenge` (base64url) from
   * POST /api/security/biometric/register/begin.
   */
  static async register(
    userId: string,
    nickname?: string,
    serverChallenge?: string
  ): Promise<BiometricRegistrationResult> {
    if (!this.isSupported()) {
      throw new Error('WebAuthn is not supported in this browser')
    }
    if (!serverChallenge) {
      throw new Error('A server-issued challenge is required to register a biometric')
    }

    const publicKey: PublicKeyCredentialCreationOptions = {
      challenge: b64urlToBuf(serverChallenge),
      rp: {
        name: 'TOPTIER',
        // id will default to the current domain
      },
      user: {
        id: generateUserId(userId),
        name: userId,
        displayName: nickname || `TOPTIER user ${userId.slice(0, 8)}`,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
        requireResidentKey: false,
      },
    }

    const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null
    if (!credential) throw new Error('Credential creation was cancelled')

    const raw = credential as PublicKeyCredential & {
      response: AuthenticatorAttestationResponse & { getPublicKey?: () => ArrayBuffer | null }
    }
    const response = raw.response
    const publicKeyBytes = response.getPublicKey ? response.getPublicKey() : null
    if (!publicKeyBytes) {
      throw new Error(
        'This browser does not expose the credential public key. Please try Chrome or Edge.'
      )
    }

    return {
      credentialId: bufToB64url(credential.rawId),
      publicKey: bufToB64url(publicKeyBytes),
      clientDataJSON: bufToB64url(response.clientDataJSON),
      authenticatorData: bufToB64url(response.getAuthenticatorData()),
      deviceType: 'platform',
      transports: JSON.stringify(response.getTransports ? response.getTransports() : []),
      nickname: nickname || `Authenticator ${new Date().toLocaleDateString()}`,
    }
  }

  /**
   * Verify a biometric credential — returns assertion data to be verified
   * server-side. Pass the server-issued `serverChallenge` (base64url) from
   * POST /api/security/biometric/authenticate/begin.
   */
  static async verify(credentialIdB64url: string, serverChallenge?: string): Promise<BiometricVerifyResult> {
    if (!this.isSupported()) {
      throw new Error('WebAuthn is not supported in this browser')
    }
    if (!serverChallenge) {
      throw new Error('A server-issued challenge is required to authenticate with biometrics')
    }

    const publicKey: PublicKeyCredentialRequestOptions = {
      challenge: b64urlToBuf(serverChallenge),
      timeout: 60000,
      userVerification: 'required',
      allowCredentials: [{
        id: b64urlToBuf(credentialIdB64url),
        type: 'public-key',
        transports: ['internal', 'hybrid'],
      }],
    }

    const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null
    if (!assertion) throw new Error('Authentication was cancelled')

    const response = assertion.response as AuthenticatorAssertionResponse
    return {
      credentialId: bufToB64url(assertion.rawId),
      success: true,
      authenticatorData: bufToB64url(response.authenticatorData),
      clientDataJSON: bufToB64url(response.clientDataJSON),
      signature: bufToB64url(response.signature),
    }
  }
}
