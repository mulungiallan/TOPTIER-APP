// Google Play Billing client (via RevenueCat Capacitor SDK).
// Purchase flow for the native shell. No-ops in the browser / PWA.
// Server-side entitlement verification lives in /api/billing/play/verify.
import { Capacitor } from '@capacitor/core'

export const PLAY_CANCELLED = 'PURCHASED_CANCELLED'

export interface PlayPurchaseToken {
  productId: string
  purchaseToken: string
  outcome: 'PURCHASED' | 'PURCHASED_CANCELLED' | 'RESTORED'
}

const PRODUCT_IDS: Record<string, { android: string; env: string }> = {
  'premium-monthly': {
    android: 'toptier_premium_monthly',
    env: 'REVENUECAT_ANDROID_MONTHLY',
  },
  'premium-annual': {
    android: 'toptier_premium_annual',
    env: 'REVENUECAT_ANDROID_ANNUAL',
  },
  lifetime: {
    android: 'toptier_lifetime',
    env: 'REVENUECAT_ANDROID_LIFETIME',
  },
}

function getProductId(planId: string): string {
  const conf = PRODUCT_IDS[planId]
  if (!conf) throw new Error(`No Google Play product mapped for plan "${planId}"`)
  return process.env[conf.env] || conf.android
}

async function purchases() {
  if (!Capacitor.isNativePlatform()) return null
  const mod = await import('@revenuecat/purchases-capacitor')
  return mod.Purchases as typeof import('@revenuecat/purchases-capacitor').Purchases
}

async function productCategory() {
  const mod = await import('@revenuecat/purchases-capacitor')
  return mod.PRODUCT_CATEGORY
}

export function isNativeBillingAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

export async function configurePlayBilling(planId: string, appUserId?: string): Promise<{ productId: string }> {
  if (!isNativeBillingAvailable()) throw new Error('Play Billing is only available in the native app')
  const Purchases = await purchases()
  if (!Purchases) throw new Error('Play Billing bridge unavailable')
  const apiKey = process.env.NEXT_PUBLIC_REVENUECAT_PUBLIC_KEY
  if (!apiKey) throw new Error('NEXT_PUBLIC_REVENUECAT_PUBLIC_KEY is not configured')
  const { isConfigured } = await Purchases.isConfigured()
  if (!isConfigured) {
    await Purchases.configure({ apiKey, appUserID: appUserId })
  }
  return { productId: getProductId(planId) }
}

export async function purchasePlaySubscription(planId: string, appUserId?: string): Promise<PlayPurchaseToken> {
  const { productId } = await configurePlayBilling(planId, appUserId)
  const Purchases = await purchases()
  if (!Purchases) return { productId, purchaseToken: '', outcome: PLAY_CANCELLED }

  const { products } = await Purchases.getProducts({ productIdentifiers: [productId], type: (await productCategory()).SUBSCRIPTION })
  const product = products.find(p => p.identifier === productId)
  if (!product) throw new Error(`Product "${productId}" not found in RevenueCat. Create it in the dashboard.`)

  try {
    const res = await Purchases.purchaseStoreProduct({ product })
    return {
      productId,
      purchaseToken: res.transaction?.purchaseToken || '',
      outcome: res.productIdentifier ? 'PURCHASED' : PLAY_CANCELLED,
    }
  } catch (err: unknown) {
    const code = (err as { code?: unknown })?.code
    if (code === 1 /* PURCHASE_CANCELLED_ERROR */) {
      return { productId, purchaseToken: '', outcome: PLAY_CANCELLED }
    }
    throw err
  }
}

export async function restorePlayPurchases(appUserId?: string): Promise<PlayPurchaseToken[]> {
  if (!isNativeBillingAvailable()) return []
  const Purchases = await purchases()
  if (!Purchases) return []
  await configurePlayBilling('premium-monthly', appUserId)
  const { customerInfo } = await Purchases.restorePurchases()
  return (customerInfo.activeSubscriptions || []).map((pid) => ({
    productId: pid,
    purchaseToken: customerInfo.subscriptionsByProductIdentifier?.[pid]?.storeTransactionId || '',
    outcome: 'RESTORED' as const,
  }))
}

export async function getActivePlayEntitlements(appUserId?: string): Promise<{ productId: string; expiresDate?: string | null }[]> {
  if (!isNativeBillingAvailable()) return []
  const Purchases = await purchases()
  if (!Purchases) return []
  await configurePlayBilling('premium-monthly', appUserId)
  const { customerInfo } = await Purchases.getCustomerInfo()
  return (customerInfo.activeSubscriptions || []).map((pid) => ({
    productId: pid,
    expiresDate: customerInfo.subscriptionsByProductIdentifier?.[pid]?.expiresDate || null,
  }))
}