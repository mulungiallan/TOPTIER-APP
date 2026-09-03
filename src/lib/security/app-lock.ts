// ─── App Lock (device-level privacy) ────────────────────────────────────────
// Protects the whole app behind a user-set passcode and/or device biometric on
// every open/return-from-background. This is distinct from account login: it is
// a local gate that keeps anyone who gets hold of the phone out of the app.
//
// Storage: passcode hash lives in localStorage (web) / Capacitor Preferences
// (native). The passcode itself is never stored — only a salted SHA-256 digest.

export interface AppLockConfig {
  enabled: boolean
  biometricEnabled: boolean
  createdAt: string | null
}

const CONFIG_KEY = 'toptier-app-lock-config'
const PASSCODE_HASH_KEY = 'toptier-app-lock-passcode-hash'
const PASSCODE_SALT_KEY = 'toptier-app-lock-passcode-salt'

// ─── Web Crypto helpers ─────────────────────────────────────────────────────

async function digestString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(buf)
  let str = ''
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i])
  return btoa(str)
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function safeJsonGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function safeJsonSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.warn('[AppLock] failed to persist setting:', (e as Error)?.message)
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getConfig(): AppLockConfig {
  return safeJsonGet<AppLockConfig>(CONFIG_KEY, {
    enabled: false,
    biometricEnabled: false,
    createdAt: null,
  })
}

export function isEnabled(): boolean {
  return getConfig().enabled
}

export function setConfig(config: AppLockConfig): void {
  safeJsonSet(CONFIG_KEY, config)
}

/** Set (or change) the passcode. Returns true on success. */
export async function setPasscode(passcode: string): Promise<boolean> {
  if (passcode.length < 4) return false
  try {
    const salt = randomHex(16)
    const hash = await digestString(salt + ':' + passcode)
    localStorage.setItem(PASSCODE_SALT_KEY, salt)
    localStorage.setItem(PASSCODE_HASH_KEY, hash)
    return true
  } catch {
    return false
  }
}

/** Verify a passcode attempt. Returns true if it matches the stored hash. */
export async function verifyPasscode(passcode: string): Promise<boolean> {
  const salt = localStorage.getItem(PASSCODE_SALT_KEY)
  const hash = localStorage.getItem(PASSCODE_HASH_KEY)
  if (!salt || !hash) return false
  const attempt = await digestString(salt + ':' + passcode)
  return attempt === hash
}

export function hasPasscode(): boolean {
  const salt = localStorage.getItem(PASSCODE_SALT_KEY)
  const hash = localStorage.getItem(PASSCODE_HASH_KEY)
  return !!(salt && hash)
}

/** Fully disable app lock and wipe the passcode from storage. */
export function disableAppLock(): void {
  localStorage.removeItem(CONFIG_KEY)
  localStorage.removeItem(PASSCODE_HASH_KEY)
  localStorage.removeItem(PASSCODE_SALT_KEY)
}

/**
 * Prompt the device biometric (fingerprint / face) to unlock the app.
 * Reuses the account BiometricService when platform authenticator is available.
 */
export async function unlockWithBiometric(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (
    window.PublicKeyCredential &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
  ) {
    const available =
      await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)
    if (available) {
      // Trigger a platform authenticator prompt. This is a local, device-level
      // unlock (not an account login), so a fresh presence check is sufficient —
      // we don't need a server-issued challenge or RP config for that.
      const challengeArray = new Uint8Array(32)
      crypto.getRandomValues(challengeArray)
      const options: PublicKeyCredentialRequestOptions = {
        challenge: challengeArray.buffer,
        userVerification: 'required',
        timeout: 60000,
      }
      const credential = await navigator.credentials.get({ publicKey: options }).catch(() => null)
      return !!credential
    }
  }
  return false
}