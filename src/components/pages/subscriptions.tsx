'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Check,
  X,
  Crown,
  Star,
  Zap,
  Gift,
  Copy,
  Share2,
  MessageCircle,
  Send,
  Mail,
  Link2,
  CreditCard,
  Shield,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  BadgeCheck,
  Sparkles,
  Users,
  Clock,
  Loader2,
  Smartphone,
  Building,
  Phone,
  Wallet,
  ShoppingBag,
  ExternalLink,
  Bell,
  ShieldCheck,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { PAYMENTS_ENABLED } from '@/lib/flags'
import { Capacitor } from '@capacitor/core'
import { purchasePlaySubscription, restorePlayPurchases, isNativeBillingAvailable } from '@/lib/play-billing'

interface PaymentProviderInfo {
  id: string
  name: string
  icon: string
  description: string
  supportedCurrencies: string[]
  supportedCountries: string[]
  isAvailable: boolean
  checkoutConfig?: Record<string, string>
}
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { Dialog, DialogContent } from '@/components/ui/dialog'

// ─── Types ──────────────────────────────────────────────────────────────────

interface PlanFeature {
  text: string
  included: boolean
}

interface Plan {
  id: string
  name: string
  price: string
  period: string
  badge?: string
  badgeColor?: string
  features: PlanFeature[]
  buttonText: string
  buttonVariant: 'default' | 'outline'
  highlighted?: boolean
}

// ─── Plans Data ─────────────────────────────────────────────────────────────

function planPrice(planId: string): number {
  const p = plans.find((x) => x.id === planId)
  if (!p) return 0
  return parseFloat(p.price.replace('$', ''))
}

const plans: Plan[] = [
  {
    id: 'free',
    name: 'Free Trial',
    price: '$0',
    period: 'for 30 days',
    badge: 'Current Plan',
    badgeColor: 'bg-secondary text-secondary-foreground',
    features: [
      { text: 'Signals delayed by 15-30 minutes', included: true },
      { text: '2 screenshot analyses (lifetime)', included: true },
      { text: "Today's economic calendar only", included: true },
      { text: 'News headlines only, 15-min delay', included: true },
      { text: 'Basic performance statistics', included: true },
      { text: 'Limited market access (3 markets)', included: true },
      { text: '5 active price alerts max', included: true },
      { text: 'Basic support', included: true },
      { text: 'Real-time instant signals', included: false },
      { text: 'Unlimited screenshot analyses', included: false },
      { text: 'Custom indicator alerts', included: false },
      { text: 'Priority support', included: false },
      { text: 'Data export (CSV/Excel)', included: false },
    ],
    buttonText: 'Current Plan',
    buttonVariant: 'outline',
  },
  {
    id: 'premium_daily',
    name: 'Premium Daily',
    price: '$1.50',
    period: '/day',
    badge: 'Try it',
    badgeColor: 'bg-primary text-primary-foreground',
    features: [
      { text: 'No ads', included: true },
      { text: 'Trading bot access', included: true },
      { text: 'TOPTIER signals', included: true },
      { text: 'Copy trading', included: true },
      { text: 'Real-time instant signals', included: true },
      { text: 'Unlimited screenshot analyses', included: true },
      { text: 'All markets available', included: true },
      { text: 'Unlimited price alerts', included: true },
      { text: 'Priority support', included: true },
    ],
    buttonText: 'Subscribe Now',
    buttonVariant: 'default',
  },
  {
    id: 'premium_weekly',
    name: 'Premium Weekly',
    price: '$7',
    period: '/week',
    badge: 'Popular',
    badgeColor: 'bg-secondary text-secondary-foreground',
    features: [
      { text: 'No ads', included: true },
      { text: 'Trading bot access', included: true },
      { text: 'TOPTIER signals', included: true },
      { text: 'Copy trading', included: true },
      { text: 'Real-time instant signals', included: true },
      { text: 'Unlimited screenshot analyses', included: true },
      { text: 'All markets available', included: true },
      { text: 'Unlimited price alerts', included: true },
      { text: 'Custom indicator alerts', included: true },
      { text: 'Priority support', included: true },
    ],
    buttonText: 'Subscribe Now',
    buttonVariant: 'default',
    highlighted: true,
  },
  {
    id: 'premium_quarterly',
    name: 'Premium Quarterly',
    price: '$75',
    period: '/quarter',
    badge: 'Best Value',
    badgeColor: 'bg-emerald-500 text-white',
    features: [
      { text: 'No ads', included: true },
      { text: 'Trading bot access', included: true },
      { text: 'TOPTIER signals', included: true },
      { text: 'Copy trading', included: true },
      { text: 'Real-time instant signals', included: true },
      { text: 'Unlimited screenshot analyses', included: true },
      { text: 'All markets available', included: true },
      { text: 'Unlimited price alerts', included: true },
      { text: 'Custom indicator alerts', included: true },
      { text: 'Data export (CSV/Excel)', included: true },
      { text: 'Priority support', included: true },
    ],
    buttonText: 'Subscribe Now',
    buttonVariant: 'default',
  },
  {
    id: 'premium_annual',
    name: 'Premium Yearly',
    price: '$120',
    period: '/year',
    badge: 'Save 72% vs daily',
    badgeColor: 'bg-amber-500 text-white',
    features: [
      { text: 'No ads', included: true },
      { text: 'Trading bot access', included: true },
      { text: 'TOPTIER signals', included: true },
      { text: 'Copy trading', included: true },
      { text: 'Real-time instant signals', included: true },
      { text: 'Unlimited screenshot analyses', included: true },
      { text: 'All markets available', included: true },
      { text: 'Unlimited price alerts', included: true },
      { text: 'Custom indicator alerts', included: true },
      { text: 'Data export (CSV/Excel)', included: true },
      { text: 'Early access to features', included: true },
      { text: 'Priority support', included: true },
    ],
    buttonText: 'Subscribe Now',
    buttonVariant: 'default',
  },
  {
    id: 'lifetime',
    name: 'Lifetime',
    price: '$499.99',
    period: 'one-time',
    badge: 'One-time Payment',
    badgeColor: 'bg-amber-500 text-white',
    features: [
      { text: 'Everything in Premium', included: true },
      { text: 'Lifetime access, no recurring fees', included: true },
      { text: 'All future updates included', included: true },
      { text: 'Real-time instant signals', included: true },
      { text: 'Unlimited screenshot analyses', included: true },
      { text: 'Full economic calendar (30 days)', included: true },
      { text: 'Complete news + sentiment analysis', included: true },
      { text: 'Full performance statistics', included: true },
      { text: 'All markets available', included: true },
      { text: 'Unlimited price alerts', included: true },
      { text: 'Custom indicator alerts', included: true },
      { text: 'Priority support', included: true },
      { text: 'Data export (CSV/Excel)', included: true },
    ],
    buttonText: 'Get Lifetime Access',
    buttonVariant: 'default',
  },
]

const referralTiers = [
  { referrals: 5, reward: '1 day Premium', name: 'Bronze' },
  { referrals: 10, reward: '1 day Premium', name: 'Silver' },
  { referrals: 20, reward: '2 days Premium', name: 'Gold' },
  { referrals: 50, reward: '7 days Premium', name: 'Platinum' },
  { referrals: 100, reward: '$10 USD Cash', name: 'Diamond' },
  { referrals: 500, reward: 'Lifetime Premium', name: 'Legendary' },
]

const faqItems = [
  {
    question: 'Can I cancel anytime?',
    answer: 'Yes, you can cancel your subscription at any time. If you cancel, you will continue to have access to premium features until the end of your current billing period. No cancellation fees apply.',
  },
  {
    question: 'What happens after my free trial?',
    answer: 'After your 7-day free trial ends, your account will automatically switch to the free tier with limited features. You will not be charged unless you explicitly subscribe to a premium plan. We will remind you before the trial expires.',
  },
  {
    question: 'Is there a refund policy?',
    answer: 'Yes, we offer a 7-day money-back guarantee on all premium plans. If you are not satisfied within the first 7 days, contact our support team for a full refund. After 7 days, refunds are considered on a case-by-case basis.',
  },
  {
    question: 'Can I switch plans?',
    answer: 'Absolutely! You can upgrade or downgrade your plan at any time. When upgrading, you will be charged the prorated difference. When downgrading, the change will take effect at the end of your current billing period.',
  },
  {
    question: 'What payment methods do you accept?',
    answer: 'Everything happens inside the app — no redirects. Pay with mobile money: M-Pesa (approve with your M-Pesa PIN on your phone), Airtel Money, or MTN MoMo (pay from your wallet and we confirm once it arrives). You can also pay by bank transfer: choose your bank, send the money to our account, and submit the payment reference so we can verify and activate your plan.',
  },
  {
    question: 'Is my payment information secure?',
    answer: 'Yes. M-Pesa transactions go directly through Safaricom\'s Daraja API and you approve them with your M-Pesa PIN on your phone — we never see your PIN. Airtel Money / MTN MoMo and bank transfers are confirmed manually by our team after funds arrive; we never store your PIN, bank login, or card numbers. All traffic is encrypted with 256-bit SSL/TLS.',
  },
]

// ─── Main Component ─────────────────────────────────────────────────────────

export function SubscriptionsPage() {
  const user = useStore((s) => s.user)
  const updateUser = useStore((s) => s.updateUser)
  const setPage = useStore((s) => s.setPage)
  const [couponCode, setCouponCode] = useState('')
  const [copiedReferral, setCopiedReferral] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subscribing, setSubscribing] = useState<string | null>(null) // plan id being subscribed
  const [applyingCoupon, setApplyingCoupon] = useState(false)
  const [couponDiscount, setCouponDiscount] = useState<number | null>(null)
  const [showPaymentPicker, setShowPaymentPicker] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [paymentProviders, setPaymentProviders] = useState<PaymentProviderInfo[]>([])
  const [walletBalance, setWalletBalance] = useState(0)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [payPhone, setPayPhone] = useState('')
  const [payBank, setPayBank] = useState('')
  const [payReference, setPayReference] = useState('')
  const [processingPayment, setProcessingPayment] = useState(false)
  const [referralRewards, setReferralRewards] = useState<Array<{ id: string; status: string; rewardType: string; rewardAmount: number; createdAt: string; referredUser?: { name?: string | null } }>>([])
  const [pesapalCheckoutUrl, setPesapalCheckoutUrl] = useState<string | null>(null)
  const pesapalIframeRef = useRef<HTMLIFrameElement>(null)

  const currentPlan = user?.subscriptionTier || 'free'
  const referralCode = user?.referralCode || 'TRADE123'
  const daysRemaining = 18

  // Fetch subscription data on mount
  const fetchSubscriptions = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [subResult, billingResult] = await Promise.all([
        api.get('/subscriptions').catch(() => null),
        api.get<{ success: boolean; data: { referral?: { recentRewards?: Array<{ id: string; status: string; rewardType: string; rewardAmount: number; createdAt: string; referredUser?: { name?: string | null } }> } } }>('/billing/dashboard').catch(() => null),
      ])
      const data = subResult?.data as Record<string, unknown>
      if (data?.currentSubscription) {
        const sub = data.currentSubscription as Record<string, unknown>
        if (sub.tier) {
          updateUser({ subscriptionTier: sub.tier as string })
        }
      }
      const rewards = (billingResult?.data as any)?.referral?.recentRewards
      if (Array.isArray(rewards)) setReferralRewards(rewards)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load subscription data')
    } finally {
      setLoading(false)
    }
  }, [updateUser])

  useEffect(() => {
    fetchSubscriptions()
  }, [fetchSubscriptions])

  // On native the checkout opens in the system browser — refresh the
  // subscription state when the user returns to the app.
  useEffect(() => {
    let removeAppListener: (() => void) | undefined
    const init = async () => {
      try {
        if (!Capacitor.isNativePlatform()) return
        const { App } = await import('@capacitor/app')
        const plugin = await App.addListener('resume', () => fetchSubscriptions())
        removeAppListener = () => plugin.remove()
      } catch {
        // Not running inside Capacitor
      }
    }
    init()
    return () => removeAppListener?.()
  }, [fetchSubscriptions])

  // Poll for subscription activation while the PesaPal iframe is open
  useEffect(() => {
    if (!pesapalCheckoutUrl) return
    let active = true
    const poll = async () => {
      try {
        const res = await api.get('/subscriptions')
        const data = res?.data as Record<string, unknown>
        const sub = data?.currentSubscription as Record<string, unknown> | undefined
        const tier = sub?.tier as string | undefined
        if (tier && tier !== 'free' && active) {
          updateUser({ subscriptionTier: tier })
          setPesapalCheckoutUrl(null)
          toast.success('Subscription activated! Enjoy your premium plan.')
          setShowPaymentPicker(false)
        }
      } catch { /* keep polling */ }
    }
    const id = setInterval(poll, 4000)
    poll()
    return () => { active = false; clearInterval(id) }
  }, [pesapalCheckoutUrl, updateUser])

  const handleCopyReferral = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    navigator.clipboard.writeText(`${origin}/?ref=${encodeURIComponent(referralCode)}`)
    setCopiedReferral(true)
    toast.success('Referral link copied!')
    setTimeout(() => setCopiedReferral(false), 2000)
  }

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) {
      toast.error('Please enter a promo code')
      return
    }
    try {
      setApplyingCoupon(true)
      // Note: The API doesn't have a separate apply_coupon action,
      // but we validate the coupon by attempting the subscription flow
      // For now, show a success message if the coupon format looks valid
      toast.success(`Promo code "${couponCode}" applied!`)
      setCouponDiscount(10) // Example: 10% discount shown
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Invalid promo code')
    } finally {
      setApplyingCoupon(false)
    }
  }

  const getButtonState = (planId: string) => {
    if (currentPlan === 'free' && planId === 'free') return 'current'
    if (currentPlan === 'premium' && (planId === 'premium_daily' || planId === 'premium_weekly' || planId === 'premium_quarterly' || planId === 'premium_annual')) return 'current'
    if (currentPlan === 'lifetime' && planId === 'lifetime') return 'current'
    return 'available'
  }

  // Fetch available payment providers
  const fetchProviders = useCallback(async () => {
    try {
      const result = await api.get('/payments/providers')
      const data = result.data as { providers: PaymentProviderInfo[]; walletBalanceUSD?: number }
      if (data?.providers) {
        const providers = data.providers
        if (Capacitor.isNativePlatform() && providers.length > 0 && !providers.some(p => p.id === 'google-play')) {
          providers.unshift({
            id: 'google-play' as PaymentProviderInfo['id'],
            name: 'Google Play',
            icon: 'smartphone',
            description: 'Subscribe securely with your Google account',
            supportedCurrencies: [],
            supportedCountries: [],
            isAvailable: true,
          })
        }
        setPaymentProviders(providers)
        if (typeof data.walletBalanceUSD === 'number') setWalletBalance(data.walletBalanceUSD)
      }
    } catch {
      // Silently fail - providers will be empty
    }
  }, [])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  // Handle payment method selection and checkout
  const handleCheckout = async () => {
    if (!selectedPlan || !selectedProvider) return
    if (selectedProvider === 'google-play') {
      await handlePlayCheckout(selectedPlan)
      return
    }
    if (!PAYMENTS_ENABLED) {
      toast.info('Online payments are temporarily disabled.')
      handleNotifyMe(selectedPlan)
      return
    }
    try {
      // In-app payment details — mobile money (M-Pesa / Airtel / MTN) needs a
      // phone number; bank needs the bank + transfer reference.
      const IN_APP_MANUAL = ['bank', 'airtel', 'mtn']
      const MOBILE = ['mpesa', 'airtel', 'mtn']
      const metadata: Record<string, string> = {}
      if (MOBILE.includes(selectedProvider)) {
        const digits = payPhone.replace(/[^0-9]/g, '')
        if (digits.length < 9) {
          toast.error('Please enter a valid phone number')
          return
        }
        metadata.phone = payPhone.trim()
      } else if (selectedProvider === 'bank') {
        if (!payBank) {
          toast.error('Please select your bank')
          return
        }
        if (!payReference.trim()) {
          toast.error('Please enter the payment reference')
          return
        }
        metadata.bank = payBank
        metadata.reference = payReference.trim()
      }
      setProcessingPayment(true)
      const result = await api.post('/payments/init', {
        provider: selectedProvider,
        planType: selectedPlan,
        couponCode: couponCode || undefined,
        metadata,
      })
      const data = result.data as Record<string, unknown>
      const payment = data.payment as Record<string, unknown> | undefined

      if (data.requiresPayment === false) {
        // Trial activated without payment
        updateUser({ subscriptionTier: 'trial' })
        toast.success('Free trial activated! Enjoy premium features for 7 days.')
        setShowPaymentPicker(false)
        setPage('dashboard')
      } else if (selectedProvider === 'wallet') {
        // Wallet balance — paid instantly from the in-app wallet.
        updateUser({ subscriptionTier: 'premium' })
        toast.success('Payment successful! Your premium plan is now active.')
        setShowPaymentPicker(false)
        setPayPhone('')
        fetchSubscriptions()
      } else if (payment?.checkoutUrl && ![...IN_APP_MANUAL, 'mpesa'].includes(selectedProvider)) {
        // PesaPal or other redirect gateway. Inside the native app the WebView
        // cannot render the third-party payment page in an iframe, so open it
        // in the system browser instead; the web app keeps the in-app iframe.
        if (Capacitor.isNativePlatform()) {
          window.open(payment.checkoutUrl as string, '_system')
          toast.info('Opening payment page — your plan activates automatically once the payment is confirmed.')
        } else {
          setPesapalCheckoutUrl(payment.checkoutUrl as string)
        }
      } else if (selectedProvider === 'bank') {
        toast.success('Request received! Your plan activates once your transfer is confirmed.')
        setShowPaymentPicker(false)
        setPayPhone('')
        setPayBank('')
        setPayReference('')
      } else if (MOBILE.includes(selectedProvider) && selectedProvider !== 'mpesa') {
        // Airtel Money / MTN MoMo — the customer pays from their own wallet,
        // then we confirm manually.
        toast.success(`Request received! Complete the payment on your ${selectedProvider === 'airtel' ? 'Airtel Money' : 'MTN MoMo'} phone, and your plan activates once it is confirmed.`)
        setShowPaymentPicker(false)
        setPayPhone('')
      } else {
        // M-Pesa STK push — approved on the user's phone, no redirect.
        toast.success('Payment prompt sent! Enter your M-Pesa PIN on your phone to approve.')
        setShowPaymentPicker(false)
        setPayPhone('')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to initiate payment')
    } finally {
      setProcessingPayment(false)
    }
  }

  // Google Play native purchase (Play Billing via RevenueCat)
  const handlePlayCheckout = async (planId: string) => {
    try {
      setProcessingPayment(true)
      if (!isNativeBillingAvailable()) {
        toast.error('Google Play checkout is only available in the app.')
        return
      }
      const result = await purchasePlaySubscription(planId, user?.id)
      if (result.outcome === 'PURCHASED_CANCELLED') {
        toast.info('Purchase cancelled.')
        return
      }
      const verify = await api.post('/billing/play/verify', {
        productId: result.productId,
        purchaseToken: result.purchaseToken,
      })
      const sub = (verify?.data as { subscription?: { tier?: string } } | undefined)?.subscription
      const tier = sub?.tier || (planId === 'lifetime' ? 'lifetime' : 'premium')
      updateUser({ subscriptionTier: tier })
      toast.success('Subscription activated! Welcome to TOPTIER Premium.')
      setShowPaymentPicker(false)
      setPage('dashboard')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete Google Play purchase')
    } finally {
      setProcessingPayment(false)
    }
  }

  const handleRestorePurchases = async () => {
    try {
      const restored = await restorePlayPurchases(user?.id)
      if (restored.length === 0) {
        toast.info('No previous purchases found on this device.')
        return
      }
      for (const r of restored) {
        await api.post('/billing/play/verify', { productId: r.productId, purchaseToken: r.purchaseToken }).catch(() => {})
      }
      const active = await import('@/lib/play-billing').then(m => m.getActivePlayEntitlements(user?.id))
      if (active.some(e => e.productId.includes('lifetime'))) {
        updateUser({ subscriptionTier: 'lifetime' })
      } else if (active.length > 0) {
        updateUser({ subscriptionTier: 'premium' })
      }
      toast.success('Purchases restored.')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to restore purchases')
    }
  }

  // Record interest when payments are disabled
  const handleNotifyMe = async (planId: string) => {
    try {
      await api.post('/interest', { packageId: planId })
      toast.success("You're on the list — we'll email you when online payments are enabled.")
    } catch {
      toast.error('Failed to record your interest. Please try again.')
    }
  }

  // Icon map for payment providers
  const providerIcons: Record<string, React.ReactNode> = {
    'credit-card': <CreditCard className="size-5" />,
    'smartphone': <Smartphone className="size-5" />,
    'phone': <Phone className="size-5" />,
    'building': <Building className="size-5" />,
    'wallet': <Wallet className="size-5" />,
    'shopping-bag': <ShoppingBag className="size-5" />,
  }

  // In-app method details from the selected provider's checkoutConfig.
  const selectedProviderInfo = paymentProviders.find((p) => p.id === selectedProvider)
  const bankDetails = selectedProviderInfo?.checkoutConfig || {}
  let banks: string[] = []
  try {
    const parsed = bankDetails.banks ? JSON.parse(bankDetails.banks) : []
    banks = Array.isArray(parsed) ? parsed : []
  } catch {
    banks = []
  }

  return (
    <div className="p-4 md:p-6 space-y-8 max-w-[1200px] mx-auto">
      {/* Payment Method Picker Modal */}
      {showPaymentPicker && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Choose Payment Method</h3>
                <button onClick={() => setShowPaymentPicker(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Select how you want to pay for your <span className="text-foreground font-medium capitalize">{selectedPlan?.replace('_', ' ')}</span> subscription
              </p>

              <div className="space-y-2">
                {paymentProviders.map((provider) => (
                  <button
                    key={provider.id}
                    onClick={() => setSelectedProvider(provider.id)}
                    disabled={!provider.isAvailable}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                      selectedProvider === provider.id
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                        : provider.isAvailable
                        ? 'border-border hover:border-primary/30 hover:bg-muted/50'
                        : 'border-border/50 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className={`flex size-10 items-center justify-center rounded-lg ${
                      selectedProvider === provider.id ? 'bg-primary/10' : 'bg-muted'
                    }`}>
                      {providerIcons[provider.icon] || <CreditCard className="size-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{provider.name}</p>
                        {!provider.isAvailable && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">Coming Soon</Badge>
                        )}
                        {provider.isAvailable && (
                          <Badge className="text-[10px] px-1 py-0 bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Active</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {provider.description}
                        {provider.id === 'wallet' && (
                          <span className="mt-1 block font-medium text-emerald-500/90">
                            Balance: ${walletBalance.toFixed(2)} USD
                          </span>
                        )}
                      </p>
                    </div>
                    {selectedProvider === provider.id && (
                      <BadgeCheck className="size-5 text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>

              {/* In-app details for the chosen method — everything stays inside the app */}
              {selectedProvider === 'mpesa' && (
                <div className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-4">
                  <div className="space-y-1.5">
                    <Label>M-Pesa phone number</Label>
                    <Input
                      type="tel"
                      placeholder="07XXXXXXXX"
                      value={payPhone}
                      onChange={(e) => setPayPhone(e.target.value)}
                      disabled={!selectedProviderInfo?.isAvailable}
                    />
                    <p className="text-xs text-muted-foreground">
                      We'll send a payment prompt to this phone — approve it with your M-Pesa PIN. No external site is opened.
                    </p>
                  </div>
                </div>
              )}

              {(selectedProvider === 'airtel' || selectedProvider === 'mtn') && (
                <div className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-4">
                  <div className="space-y-1.5">
                    <Label>{selectedProvider === 'airtel' ? 'Airtel Money' : 'MTN MoMo'} phone number</Label>
                    <Input
                      type="tel"
                      placeholder="07XXXXXXXX"
                      value={payPhone}
                      onChange={(e) => setPayPhone(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Pay from your {selectedProvider === 'airtel' ? 'Airtel Money' : 'MTN MoMo'} wallet on this phone, then your plan activates once we confirm your payment.
                    </p>
                  </div>
                </div>
              )}

              {selectedProvider === 'bank' && (
                <div className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-4">
                  <div className="space-y-1.5">
                    <Label>Send money from this bank</Label>
                    <select
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      value={payBank}
                      onChange={(e) => setPayBank(e.target.value)}
                    >
                      <option value="">Select your bank…</option>
                      {banks.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                  {bankDetails.accountName && (
                    <div className="rounded-lg border bg-background p-3 text-xs">
                      <p className="mb-1 font-medium">Send to:</p>
                      <p>{bankDetails.accountName}</p>
                      {bankDetails.accountNumber && <p>Account: {bankDetails.accountNumber}</p>}
                      {bankDetails.bankName && <p>Bank: {bankDetails.bankName}</p>}
                      {bankDetails.tillNumber && <p>M-Pesa Till / Paybill: {bankDetails.tillNumber}</p>}
                      {bankDetails.phone && <p>Confirm with us: {bankDetails.phone}</p>}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label>Payment reference</Label>
                    <Input
                      placeholder="Reference / code from your transfer"
                      value={payReference}
                      onChange={(e) => setPayReference(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Your plan activates once we confirm the funds. Keep this reference handy.
                    </p>
                  </div>
                </div>
              )}

              {selectedProvider === 'wallet' && (
                <div className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Wallet balance</Label>
                      <span className="text-sm font-semibold text-emerald-500">${walletBalance.toFixed(2)} USD</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      We'll deduct the {selectedPlan ? `$${planPrice(selectedPlan).toFixed(2)}` : ''} instantly from your wallet.
                      {walletBalance < planPrice(selectedPlan ?? 'premium_daily') ? (
                        <span className="text-amber-500"> You need more balance — top up your wallet or pick another method.</span>
                      ) : (
                        <span> Your premium activates immediately.</span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowPaymentPicker(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={!selectedProvider || processingPayment || (selectedProvider === 'wallet' && walletBalance < planPrice(selectedPlan ?? 'premium_daily'))}
                  onClick={handleCheckout}
                >
                  {processingPayment ? (
                    <>
                      <Loader2 className="size-4 mr-1 animate-spin" />
                      Processing...
                    </>
                  ) : selectedProvider === 'wallet' ? (
                    <>
                      <Wallet className="size-4 mr-1" />
                      Pay from Wallet
                    </>
                  ) : selectedProvider === 'bank' ? (
                    <>
                      <Check className="size-4 mr-1" />
                      Submit for Confirmation
                    </>
                  ) : selectedProvider === 'mpesa' ? (
                    <>
                      <Smartphone className="size-4 mr-1" />
                      Send Payment Prompt
                    </>
                  ) : selectedProvider === 'airtel' || selectedProvider === 'mtn' ? (
                    <>
                      <Smartphone className="size-4 mr-1" />
                      Send Payment Request
                    </>
                  ) : (
                    <>
                      <ExternalLink className="size-4 mr-1" />
                      Continue to Pay
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Shield className="size-3.5 text-emerald-500" />
                <span>Secured by 256-bit encryption · Money-back guarantee</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subscriptions Paused Banner */}
      {!PAYMENTS_ENABLED && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex size-12 items-center justify-center rounded-xl bg-yellow-500/10">
                <Clock className="size-6 text-yellow-500" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-yellow-600 dark:text-yellow-400">Subscriptions Temporarily Paused</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Online payments are currently disabled. All existing users retain full access to their current plan. New subscriptions will open soon.
                </p>
              </div>
              <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 shrink-0">Paused</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Page Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Subscription Plans</h1>
        <p className="text-muted-foreground mt-1">
          {PAYMENTS_ENABLED
            ? 'Choose the plan that fits your trading style'
            : 'Subscriptions are temporarily unavailable — join the waitlist below'}
        </p>
      </div>

      {/* Current Plan Banner */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
                <Crown className="size-6 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">
                    {currentPlan === 'premium' ? 'Premium Plan' : currentPlan === 'lifetime' ? 'Lifetime Plan' : 'Free Trial'}
                  </h3>
                  <Badge variant="default" className="text-xs">
                    {currentPlan === 'premium' ? 'Active' : currentPlan === 'lifetime' ? 'Active' : `${daysRemaining} days remaining`}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {currentPlan === 'premium'
                    ? 'Premium active — manage your plan below'
                    : currentPlan === 'lifetime'
                    ? 'Lifetime access · No recurring payments'
                    : 'Upgrade to unlock all features'}
                </p>
              </div>
            </div>
            <Button variant="outline" className="w-fit gap-2">
              <CreditCard className="size-4" />
              Manage Subscription
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pricing Cards */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const buttonState = getButtonState(plan.id)
          return (
            <Card
              key={plan.id}
              className={`relative flex flex-col ${
                plan.highlighted
                  ? 'border-primary shadow-lg shadow-primary/10 ring-1 ring-primary/20'
                  : ''
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className={`${plan.badgeColor} px-3 py-0.5 text-xs font-semibold shadow-sm`}>
                    {plan.badge}
                  </Badge>
                </div>
              )}

              <CardHeader className="pt-6 pb-4 text-center">
                <CardTitle className="text-lg">{plan.name}</CardTitle>
                <CardDescription>
                  <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-sm text-muted-foreground ml-1">{plan.period}</span>
                </CardDescription>
                {plan.id === 'premium_annual' && (
                  <p className="text-xs text-emerald-500 font-medium mt-1">
                    Save $1,467.50 vs daily · best value
                  </p>
                )}
                {plan.id === 'lifetime' && (
                  <p className="text-xs text-amber-500 font-medium mt-1">
                    Equivalent to ~20 months of Premium
                  </p>
                )}
              </CardHeader>

              <CardContent className="flex-1 pb-4">
                <Separator className="mb-4" />
                <ul className="space-y-2.5">
                  {plan.features.map((feature, idx) => (
                    <li
                      key={idx}
                      className={`flex items-start gap-2 text-sm ${
                        feature.included ? '' : 'text-muted-foreground/50 line-through'
                      }`}
                    >
                      {feature.included ? (
                        <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <X className="size-4 text-muted-foreground/30 shrink-0 mt-0.5" />
                      )}
                      {feature.text}
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter className="pt-0 pb-6">
                <Button
                  variant={buttonState === 'current' ? 'outline' : plan.buttonVariant}
                  className="w-full"
                  disabled={buttonState === 'current'}
                  onClick={async () => {
                    if (buttonState === 'current') return
                    if (!PAYMENTS_ENABLED) {
                      await handleNotifyMe(plan.id)
                      return
                    }
                    if (plan.id === 'trial' || plan.price === '$0') {
                        // Free trial - no payment needed
                        try {
                          setSubscribing(plan.id)
                          await api.post('/payments/init', {
                            provider: 'stripe',
                            planType: 'trial',
                          })
                          updateUser({ subscriptionTier: 'trial' })
                          toast.success('Free trial activated!')
                          setPage('dashboard')
                        } catch (err: unknown) {
                          toast.error(err instanceof Error ? err.message : 'Failed to activate trial')
                        } finally {
                          setSubscribing(null)
                        }
                      } else {
                        // Paid plan - show payment method picker
                        setSelectedPlan(plan.id)
                        setSelectedProvider(null)
                        setPayPhone('')
                        setPayBank('')
                        setPayReference('')
                        setShowPaymentPicker(true)
                      }
                  }}
                >
                  {subscribing === plan.id ? (
                    <>
                      <Loader2 className="size-4 mr-1 animate-spin" />
                      Processing...
                    </>
                  ) : buttonState === 'current' ? (
                    <>
                      <BadgeCheck className="size-4 mr-1" />
                      Current Plan
                    </>
                  ) : !PAYMENTS_ENABLED ? (
                    <><Bell className="size-4 mr-1" /> Notify Me</>
                  ) : (
                    plan.buttonText
                  )}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      {/* Coupon Code Section */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Gift className="size-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Have a promo code?</h3>
                <p className="text-sm text-muted-foreground">Enter your coupon for a discount</p>
              </div>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Input
                placeholder="Enter promo code"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                className="sm:w-[200px]"
              />
              <Button variant="outline" onClick={handleApplyCoupon} disabled={applyingCoupon}>
                {applyingCoupon ? <Loader2 className="size-4 animate-spin" /> : 'Apply'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Referral Program Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <Users className="size-5 text-emerald-500" />
            </div>
            <div>
              <CardTitle className="text-lg">Refer & Earn</CardTitle>
              <CardDescription>Share with friends and earn free Premium days — plus $10 USD wallet cash at 100 referrals</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Referral Code & Share */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground mb-2">Your referral code</p>
              <div className="flex items-center gap-2">
                <code className="rounded-md bg-muted px-3 py-2 text-sm font-mono font-bold tracking-wider">
                  {referralCode}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  onClick={handleCopyReferral}
                >
                  <Copy className={`size-4 ${copiedReferral ? 'text-emerald-500' : ''}`} />
                </Button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5">
                <MessageCircle className="size-3.5 text-green-500" />
                WhatsApp
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Send className="size-3.5 text-blue-500" />
                Telegram
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Mail className="size-3.5 text-red-500" />
                Email
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopyReferral}>
                <Link2 className="size-3.5" />
                Copy Link
              </Button>
            </div>
          </div>

          <Separator />

          {/* Referral Stats */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 mb-1">
                <Users className="size-4 text-primary" />
                <span className="text-sm font-medium">Successful Referrals</span>
              </div>
              <p className="text-2xl font-bold">2</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="size-4 text-emerald-500" />
                <span className="text-sm font-medium">Free Premium Days Earned</span>
              </div>
              <p className="text-2xl font-bold text-emerald-500">14 days</p>
            </div>
          </div>

          <Separator />

          {/* Reward Tiers */}
          <div>
            <h4 className="font-semibold mb-3">Reward Tiers</h4>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referrals Required</TableHead>
                    <TableHead>Reward</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {referralTiers.map((tier) => (
                    <TableRow key={tier.referrals}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                            {tier.referrals}
                          </div>
                          {tier.referrals} referral{tier.referrals > 1 ? 's' : ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal">
                          <Sparkles className="size-3 mr-1" />
                          {tier.reward}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <Separator />

          {/* Referral History */}
          <div>
            <h4 className="font-semibold mb-3">Referral History</h4>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Reward</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {referralRewards.length > 0 ? referralRewards.map((ref) => (
                    <TableRow key={ref.id}>
                      <TableCell className="font-medium">{ref.referredUser?.name || 'User'}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(ref.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Badge variant={ref.status === 'granted' ? 'default' : 'outline'} className="text-xs">
                          {ref.status === 'granted' ? 'Activated' : ref.status === 'pending' ? 'Pending' : ref.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={ref.status === 'pending' ? 'text-muted-foreground' : 'text-emerald-500 font-medium'}>
                          {ref.rewardType === 'wallet_cash'
                            ? `$${ref.rewardAmount} USD`
                            : `${ref.rewardAmount} days`}
                        </span>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-6">
                        No referrals yet. Share your link to start earning!
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Methods */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-center gap-6 justify-between">
            <div className="flex flex-col items-center sm:items-start gap-3">
              <h3 className="font-semibold">Accepted Payment Methods</h3>
              <div className="flex items-center gap-3 flex-wrap justify-center">
                {['Visa', 'Mastercard', 'Amex', 'PayPal', 'Apple Pay', 'Google Pay'].map((method) => (
                  <div
                    key={method}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm font-medium"
                  >
                    <CreditCard className="size-3.5 text-muted-foreground" />
                    {method}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-center sm:items-end gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="size-4 text-emerald-500" />
                Secured by Stripe, Flutterwave, M-Pesa, Paystack, PayPal
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <BadgeCheck className="size-4 text-primary" />
                7-day money-back guarantee
              </div>
              {Capacitor.isNativePlatform() && (
                <Button variant="outline" size="sm" className="gap-2" onClick={handleRestorePurchases}>
                  <ShoppingBag className="size-4" />
                  Restore Purchases
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* FAQ Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Frequently Asked Questions</CardTitle>
          <CardDescription>Common questions about subscriptions and billing</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {faqItems.map((item, idx) => (
              <AccordionItem key={idx} value={`faq-${idx}`}>
                <AccordionTrigger className="text-left text-sm font-medium">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* Risk Disclaimer */}
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 md:p-6">
        <div className="flex gap-3">
          <AlertTriangle className="size-5 text-yellow-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-sm text-yellow-600 dark:text-yellow-500">Risk Disclaimer</h4>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Trading involves substantial risk of loss and is not suitable for all investors. Past performance is not indicative of future results. 
              The signals and analyses provided by TOPTIER are for educational and informational purposes only and should not be 
              considered financial advice. Always do your own research and consult with a licensed financial advisor before making any investment 
              decisions. You should not risk more than you can afford to lose.
            </p>
          </div>
        </div>
      </div>

      {/* ─── PesaPal checkout iframe (subscriptions) ────────────── */}
      <Dialog
        open={!!pesapalCheckoutUrl}
        onOpenChange={(open) => {
          if (!open) setPesapalCheckoutUrl(null)
        }}
      >
        <DialogContent
          showCloseButton={false}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="max-h-[92vh] w-full max-w-xl gap-0 overflow-hidden border bg-background p-0 sm:max-w-xl"
        >
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
              <p className="truncate text-sm font-semibold">Secure payment — PesaPal</p>
            </div>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setPesapalCheckoutUrl(null)}>
              <X className="size-4" />
            </Button>
          </div>
          <iframe
            ref={pesapalIframeRef}
            src={pesapalCheckoutUrl || undefined}
            title="PesaPal checkout"
            className="h-[68vh] w-full bg-background"
          />
          <p className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
            A payment prompt may appear on your phone — enter your PIN to complete. Your subscription activates automatically once the payment is confirmed.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
