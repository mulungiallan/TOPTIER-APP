// In-app "Bank Transfer" payment method for TOPTIER.
//
// Unlike the redirect gateways, Bank is fully manual: the customer chooses a
// bank, sends money to our account (details below), then submits the payment
// reference. No external page is opened. The transaction stays 'pending'
// until an admin confirms it (admin action `confirm_payment`).

import type {
  PaymentGateway,
  InitPaymentParams,
  InitPaymentResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  RefundParams,
  RefundResult,
} from './types'
import { env } from '@/lib/env'

// Banks offered in the "Pay by Bank" dropdown.
export const IN_APP_BANKS = [
  'Absa Bank',
  'Bank of Africa',
  'Co-operative Bank',
  'Diamond Trust Bank',
  'Equity Bank',
  'Family Bank',
  'I&M Bank',
  'KCB Bank',
  'NCBA Bank',
  'Standard Chartered',
  'Stanbic Bank',
  'M-Pesa / M-Pesa Agent',
  'Airtel Money',
  'MTN MoMo',
]

export function generateBankReference(): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `BNK${Date.now()}${rand}`
}

export function getBankCheckoutConfig(): Record<string, string> {
  return {
    accountName: env.bankAccountName || '',
    accountNumber: env.bankAccountNumber || '',
    bankName: env.bankName || '',
    tillNumber: env.bankTillNumber || '',
    phone: env.bankPaymentPhone || '',
    banks: JSON.stringify(IN_APP_BANKS),
  }
}

export const bankGateway: PaymentGateway = {
  provider: 'bank',
  name: 'bank',
  displayName: 'Bank Transfer',
  icon: 'building',
  supportedCurrencies: [],
  supportedCountries: [],
  description: 'Transfer from any bank, then confirm with your payment reference. Activated once we verify the funds.',

  async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    // Bank payments are manual by design: the /payments/init route records the
    // intent and returns the reference; nothing runs against a gateway.
    return {
      provider: 'bank',
      providerTransactionId: generateBankReference(),
      reference: generateBankReference(),
      status: 'pending',
      metadata: params.metadata,
    }
  },

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    return {
      status: 'pending', // manual — admin confirms when funds arrive
      amount: 0,
      currency: 'KES',
      planType: (params.metadata?.planType as InitPaymentParams['planType']) || 'premium_monthly',
      providerTransactionId: params.providerTransactionId || params.reference || '',
    }
  },

  async refundPayment(params: RefundParams): Promise<RefundResult> {
    return {
      refundId: `BNK_REFUND_${Date.now()}`,
      status: 'pending' as const,
      amount: params.amount || 0,
    }
  },

  getCheckoutConfig(): Record<string, string> {
    return getBankCheckoutConfig()
  },
}