// Unified Payment Gateway Types for TOPTIER
// All payment providers implement this interface

export type PaymentProvider = 'stripe' | 'flutterwave' | 'mpesa' | 'paystack' | 'paypal' | 'revenuecat'

export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded' | 'cancelled'

export type PlanType = 'free' | 'trial' | 'premium_monthly' | 'premium_annual' | 'lifetime'

export interface PaymentPlan {
  id: PlanType
  name: string
  price: number
  currency: string
  interval: string | null
  features: string[]
  limitations: string[]
}

export interface InitPaymentParams {
  userId: string
  userEmail: string
  userName: string
  planType: PlanType
  amount: number
  currency: string
  couponCode?: string
  metadata?: Record<string, string>
}

export interface InitPaymentResult {
  provider: PaymentProvider
  providerTransactionId: string
  checkoutUrl?: string      // URL to redirect user for payment
  clientSecret?: string     // Stripe client secret for frontend
  checkoutToken?: string    // PayPal order ID
  reference?: string        // Flutterwave/Paystack/M-Pesa reference
  status: PaymentStatus
  metadata?: Record<string, string>
}

export interface VerifyPaymentParams {
  provider: PaymentProvider
  providerTransactionId?: string
  reference?: string
  metadata?: Record<string, string>
}

export interface VerifyPaymentResult {
  status: PaymentStatus
  amount: number
  currency: string
  planType: PlanType
  providerTransactionId: string
  metadata?: Record<string, string>
}

export interface RefundParams {
  providerTransactionId: string
  amount?: number  // partial refund if specified
  reason?: string
  metadata?: Record<string, string>
}

export interface RefundResult {
  refundId: string
  status: 'pending' | 'completed' | 'failed'
  amount: number
}

export interface PaymentGateway {
  provider: PaymentProvider
  name: string
  displayName: string
  icon: string
  supportedCurrencies: string[]
  supportedCountries: string[]  // ISO country codes, empty = global
  description: string

  // Initialize a payment
  initializePayment(params: InitPaymentParams): Promise<InitPaymentResult>

  // Verify/confirm a payment (called by webhook or polling)
  verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult>

  // Refund a payment
  refundPayment(params: RefundParams): Promise<RefundResult>

  // Get provider-specific checkout config for frontend
  getCheckoutConfig(): Record<string, string>
}

// Provider registry for UI display
export interface PaymentProviderInfo {
  id: PaymentProvider
  name: string
  icon: string
  description: string
  supportedCurrencies: string[]
  supportedCountries: string[]
  isAvailable: boolean  // based on env vars being set
}
