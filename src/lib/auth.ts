import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto'
import jwt from 'jsonwebtoken'
import { db } from '@/lib/db'

// ─── Password hashing (scrypt with per-user random salt) ──────────────────────
// Format: scrypt$N$r$p$salt$hash — self-describing so parameters can be
// upgraded later without invalidating existing hashes.

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64
const SALT_LENGTH = 16

function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString('hex')
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString('hex')
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived}`
}

function verifyScrypt(password: string, salt: string, hashHex: string, params: {
  N: number
  r: number
  p: number
}): boolean {
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: params.N,
    r: params.r,
    p: params.p,
  })
  const expected = Buffer.from(hashHex, 'hex')
  return expected.length === derived.length && timingSafeEqual(derived, expected)
}

// Legacy verification for accounts created before the scrypt migration.
// Old format: sha256(password + 'trading-assistant-salt')
const LEGACY_SALT = 'trading-assistant-salt'
function verifyLegacySha256(password: string, hash: string): boolean {
  const computed = createHash('sha256').update(password + LEGACY_SALT).digest('hex')
  return computed === hash
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false

  if (storedHash.startsWith('scrypt$')) {
    const [, n, r, p, salt, hashHex] = storedHash.split('$')
    try {
      return verifyScrypt(password, salt, hashHex, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      })
    } catch {
      return false
    }
  }

  // Legacy unsalted/static-salted SHA-256 hash — allow login so old accounts
  // can authenticate once, then upgrade on next successful auth.
  return verifyLegacySha256(password, storedHash)
}

// Re-hash a password with the current scheme. Call after a successful login
// when the stored hash is the legacy format.
export function needsRehash(storedHash: string): boolean {
  return !storedHash.startsWith('scrypt$')
}

export function rehashPassword(password: string): string {
  return hashPassword(password)
}

// ─── JWT tokens ───────────────────────────────────────────────────────────────
// Real signed tokens (HS256). No forgeable base64 payloads.

export interface TokenPayload {
  userId: string
  tokenVersion: number
  exp: number
  iat: number
}

const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

let cachedDevJwtSecret: string | null = null

function getJwtSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT secret is not configured. Set NEXTAUTH_SECRET (or JWT_SECRET) in your environment before deploying.'
      )
    }
    // Dev convenience: generate once per process and cache it so
    // sign() and verify() use the same secret within a single process.
    if (!cachedDevJwtSecret) {
      cachedDevJwtSecret = randomBytes(48).toString('hex')
    }
    return cachedDevJwtSecret
  }
  return secret
}

export { getJwtSecret }

export function generateToken(userId: string, options?: { expiresInMs?: number; tokenVersion?: number }): string {
  const secret = getJwtSecret()
  const expiresInMs = options?.expiresInMs ?? TOKEN_TTL
  const tokenVersion = options?.tokenVersion ?? 0
  return jwt.sign({ userId, tokenVersion }, secret, { expiresIn: expiresInMs / 1000 })
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    if (!token || typeof token !== 'string') return null
    const secret = getJwtSecret()
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload
    if (!decoded || typeof decoded.userId !== 'string') return null
    return {
      userId: decoded.userId,
      tokenVersion: typeof decoded.tokenVersion === 'number' ? decoded.tokenVersion : 0,
      exp: (decoded.exp as number) ?? 0,
      iat: (decoded.iat as number) ?? 0,
    }
  } catch {
    return null
  }
}

// Generate a unique referral code
export function generateReferralCode(): string {
  return randomBytes(4).toString('hex').toUpperCase()
}

// Best-effort client IP from common proxy headers (Railway/Next), else null.
export function getRequestIp(request: Request): string | null {
  const via = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
  if (via) return via.split(',')[0].trim() || null
  return null
}

// Best-effort device/UA string for activity logging.
export function getRequestDevice(request: Request): string | null {
  const ua = request.headers.get('user-agent')
  return ua ? ua.slice(0, 500) : null
}

// Get user ID from request headers (Authorization Bearer JWT only).
// NOTE: there is intentionally NO `x-user-id` fallback — trusting a client
// supplied header would let any caller impersonate any user (including admins).
export function getUserIdFromRequest(request: Request): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim()
    if (token) {
      const decoded = verifyToken(token)
      if (decoded?.userId) return decoded.userId
    }
  }
  return null
}

// Full authentication: verify the JWT signature AND check that the user's
// tokenVersion still matches (so password changes / bans / forced logouts
// revoke previously-issued tokens). Returns the verified user or null.
// Prefer this over getUserIdFromRequest for any route that grants access to
// user data or money movement, so revocation actually takes effect.
export async function authenticateRequest(
  request: Request,
  select?: { id?: boolean; email?: boolean; name?: boolean; role?: boolean; tokenVersion?: boolean; isBanned?: boolean; isEmailVerified?: boolean; twoFactorEnabled?: boolean }
): Promise<{ user: any | null; error: string | null }> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { user: null, error: 'Authentication required' }
  }
  const token = authHeader.substring(7).trim()
  const decoded = verifyToken(token)
  if (!decoded?.userId) {
    return { user: null, error: 'Invalid or expired token' }
  }

  const user = await db.user.findUnique({
    where: { id: decoded.userId },
    select: select ?? { id: true, email: true, name: true, role: true, tokenVersion: true, isBanned: true },
  })
  if (!user) return { user: null, error: 'Account not found' }
  if (user.isBanned) return { user: null, error: 'Account has been banned' }
  if (user.tokenVersion !== decoded.tokenVersion) {
    // Token was issued before the user's tokenVersion was bumped (password
    // change, forced logout, ban). Reject it.
    return { user: null, error: 'Session has been revoked — please log in again' }
  }
  return { user, error: null }
}

// Alias for getUserIdFromRequest for convenience
export const getUserId = getUserIdFromRequest

// Standard API response helpers
export function successResponse(data: unknown, status = 200) {
  return Response.json({ success: true, data }, { status })
}

export function errorResponse(message: string, status = 400, details?: unknown) {
  return Response.json({ success: false, error: message, ...(details ? { details } : {}) }, { status })
}
