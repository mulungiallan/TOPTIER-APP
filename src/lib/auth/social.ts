import jwt from 'jsonwebtoken'
import { createPublicKey } from 'crypto'

type Jwk = { kty: string; kid: string; n: string; e: string; use?: string; alg?: string }

interface JwksResponse {
  keys: Jwk[]
}

interface ProviderConfig {
  jwksUri: string
  issuers: [string, ...string[]]
  audience: string
}

export interface SocialUserPayload {
  providerId: string
  email: string
  emailVerified: boolean
  name?: string
  picture?: string
}

const GOOGLE_CONFIG: ProviderConfig = {
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'] as [string, ...string[]],
  audience: process.env.GOOGLE_CLIENT_ID || '',
}

const APPLE_CONFIG: ProviderConfig = {
  jwksUri: 'https://appleid.apple.com/auth/keys',
  issuers: ['https://appleid.apple.com'] as [string, ...string[]],
  audience: process.env.APPLE_CLIENT_ID || '',
}

const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>()
const JWKS_TTL_MS = 6 * 60 * 60 * 1000

async function fetchJwks(uri: string): Promise<Jwk[]> {
  const cached = jwksCache.get(uri)
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys
  }

  const res = await fetch(uri, { next: { revalidate: 21600 } })
  if (!res.ok) throw new Error(`Failed to fetch JWKS from ${uri}: ${res.status}`)
  const data: JwksResponse = await res.json()

  jwksCache.set(uri, { keys: data.keys, fetchedAt: Date.now() })
  return data.keys
}

function importJwk(jwk: Jwk): string {
  const key = createPublicKey({ key: jwk, format: 'jwk' })
  return key.export({ type: 'spki', format: 'pem' }) as string
}

function getProviderConfig(provider: 'google' | 'apple'): ProviderConfig {
  if (provider === 'google') return GOOGLE_CONFIG
  return APPLE_CONFIG
}

export async function verifySocialToken(
  provider: 'google' | 'apple',
  token: string,
): Promise<SocialUserPayload> {
  const config = getProviderConfig(provider)
  if (!config.audience) {
    throw new Error(`Social login for ${provider} is not configured — set ${provider === 'google' ? 'GOOGLE_CLIENT_ID' : 'APPLE_CLIENT_ID'} in your environment`)
  }

  const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())
  const kid = header.kid as string
  if (!kid) throw new Error('Invalid token: missing kid in header')

  const keys = await fetchJwks(config.jwksUri)
  const jwk = keys.find((k) => k.kid === kid)
  if (!jwk) throw new Error(`No matching key found for kid: ${kid}`)

  const publicKey = importJwk(jwk)

  const payload = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: config.issuers,
    audience: config.audience,
  }) as Record<string, unknown>

  if (provider === 'google') {
    return normalizeGooglePayload(payload)
  }
  return normalizeApplePayload(payload)
}

export function normalizeGooglePayload(payload: Record<string, unknown>): SocialUserPayload {
  const sub = payload.sub as string
  const email = payload.email as string
  if (!sub || !email) throw new Error('Google token is missing required fields (sub, email)')
  return {
    providerId: sub,
    email,
    emailVerified: payload.email_verified === true,
    name: (payload.name as string) || undefined,
    picture: (payload.picture as string) || undefined,
  }
}

export function normalizeApplePayload(payload: Record<string, unknown>): SocialUserPayload {
  const sub = payload.sub as string
  const email = (payload.email as string) || ''
  if (!sub) throw new Error('Apple token is missing required field (sub)')
  if (!email) throw new Error('Apple token did not return an email — sign in again and allow email sharing')
  return {
    providerId: sub,
    email,
    emailVerified: payload.email_verified === true,
  }
}

export function isSocialLoginEnabled(): { google: boolean; apple: boolean } {
  return {
    google: !!process.env.GOOGLE_CLIENT_ID,
    apple: !!process.env.APPLE_CLIENT_ID,
  }
}
