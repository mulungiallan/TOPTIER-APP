// In-app "Wallet Balance" payment method for TOPTIER.
//
// The user pays for premium directly from their in-app wallet cash balance
// (USD). No external gateway is involved and the subscription activates
// instantly — the /api/payments/init route handles the deduction + fulfillment
// in one shot (this gateway exists for registry/UI consistency).

import type {
  PaymentGateway,
  InitPaymentParams,
  InitPaymentResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  RefundParams,
  RefundResult,
} from './types'

export const walletGateway: PaymentGateway = {
  provider: 'wallet',
  name: 'wallet',
  displayName: 'Wallet Balance',
  icon: 'wallet',
  supportedCurrencies: ['USD'],
  supportedCountries: [],
  description: 'Pay instantly from your wallet balance — no external payment required.',

  async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    // The /api/payments/init route handles wallet deductions directly (it
    // needs DB + ledger access and must fulfill the subscription in the same
    // request). If this is ever reached, fail loudly rather than half-pay.
    throw new Error('Wallet payments are processed in-app — no gateway order needed.')
  },

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    return {
      status: 'completed', // wallet payments complete synchronously at init
      amount: 0,
      currency: 'USD',
      planType: (params.metadata?.planType as InitPaymentParams['planType']) || 'premium_monthly',
      providerTransactionId: params.providerTransactionId || params.reference || '',
    }
  },

  async refundPayment(params: RefundParams): Promise<RefundResult> {
    return {
      refundId: `WALLET_REFUND_${Date.now()}`,
      status: 'completed' as const,
      amount: params.amount || 0,
    }
  },

  getCheckoutConfig(): Record<string, string> {
    return {
      method: 'wallet',
    }
  },
}