/**
 * Stripe singleton for the new Packages system.
 * Reuses the same STRIPE_SECRET_KEY env var as the legacy payment gateway.
 */

import Stripe from 'stripe'

let instance: Stripe | null = null

export function getStripe(): Stripe {
  if (!instance) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not configured')
    }
    instance = new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
  }
  return instance
}

export const STRIPE_APP_URL = process.env.NEXT_PUBLIC_APP_URL || ''
