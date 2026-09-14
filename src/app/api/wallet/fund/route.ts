// POST /api/wallet/fund
// Starts a real-money wallet top-up via a payment provider (PesaPal).
// Creates a pending PaymentTransaction tagged WALLET_FUND|<asset>|<amount>,
// initializes the provider order, and returns the checkout URL. On payment
// completion (PesaPal IPN/callback) the wallet is credited via depositCash.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse } from '@/lib/auth'
import { initializePayment } from '@/lib/payments/registry'
import { generateBankReference } from '@/lib/payments/bank'
import { getExchangeRate } from '@/lib/payments/exchange-rates'
import { countryNameToCode } from '@/lib/countries'
import { PAYMENTS_ENABLED } from '@/lib/flags'
import { validateBody, walletFundSchema } from '@/lib/validation'

export async function POST(request: NextRequest) {
  try {
    if (!PAYMENTS_ENABLED) {
      return errorResponse('Wallet top-ups are not open yet.', 503)
    }

    const auth = await authenticateRequest(request, { id: true })
    if (!auth.user) {
      return errorResponse(auth.error || 'Unauthorized', 401)
    }
    const userId = auth.user.id

    const body = await request.json()
    const parsed = validateBody(walletFundSchema, body)
    if (!parsed.success) {
      return errorResponse(parsed.error, 400)
    }

    const { asset, amount } = parsed.data
    const provider = parsed.data.provider || 'mpesa'

    // PesaPal bills in KES. USD and UGX are converted at the checkout rate;
    // KES passes through unchanged. No app-side limits are imposed — the
    // provider is the source of truth for any per-order caps.
    let chargedAmount = amount
    if (asset === 'USD') {
      chargedAmount = Number((amount * (await getExchangeRate('USD', 'KES', 153))).toFixed(2))
    } else if (asset === 'UGX') {
      chargedAmount = Number((amount * (await getExchangeRate('UGX', 'KES', 0.035))).toFixed(2))
    }
    if (!Number.isFinite(chargedAmount) || chargedAmount <= 0) {
      return errorResponse('Invalid top-up amount', 400)
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, phone: true, country: true },
    })
    if (!user) {
      return errorResponse('User not found', 404)
    }

    // Pending transaction; `description` carries the wallet credit instruction
    // (asset + amount in the asset's own units) consumed on completion.
    const transaction = await db.paymentTransaction.create({
      data: {
        userId,
        amount: chargedAmount,
        currency: 'KES',
        planType: 'wallet_fund',
        paymentProvider: provider,
        status: 'pending',
        description: `WALLET_FUND|${asset}|${amount}`,
      },
    })

    // In-app bank transfer: no gateway call — record intent + reference and
    // wait for manual admin confirmation before crediting the wallet.
    if (provider === 'bank') {
      const bankRef = generateBankReference()
      const bank = parsed.data.bank || ''
      const userRef = parsed.data.reference || ''
      await db.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          stripeSessionId: bankRef,
          description: `WALLET_FUND|${asset}|${amount}|bank:${bank}|ref:${userRef}`,
        },
      })

      return successResponse({
        transaction: {
          id: transaction.id,
          amount: chargedAmount,
          currency: 'KES',
          asset,
          creditAmount: amount,
          status: 'pending',
        },
        payment: {
          provider: 'bank',
          providerTransactionId: bankRef,
          reference: bankRef,
          status: 'pending',
          metadata: { bank, reference: userRef },
        },
      })
    }

    const result = await initializePayment(provider, {
      userId,
      userEmail: user.email || '',
      userName: user.name || 'TOPTIER User',
      planType: 'premium_monthly', // only feeds the order description; overridden via metadata
      amount: chargedAmount,
      currency: 'KES',
      metadata: {
        transactionId: transaction.id,
        phone: parsed.data.phone || user.phone || '',
        country: countryNameToCode(user.country),
        description: `TOPTIER wallet top-up (${amount} ${asset})`,
      },
    })

    await db.paymentTransaction.update({
      where: { id: transaction.id },
      data: { stripeSessionId: result.providerTransactionId },
    })

    return successResponse({
      transaction: {
        id: transaction.id,
        amount: chargedAmount,
        currency: 'KES',
        asset,
        creditAmount: amount,
        status: 'pending',
      },
      payment: result,
    })
  } catch (error) {
    console.error('Wallet fund POST error:', error)
    // Surface provider-side rejections (PesaPal account limits, invalid IPN,
    // etc.) so the user sees the real reason; keep internal errors generic.
    const message = error instanceof Error && error.message.startsWith('PesaPal:')
      ? error.message.slice('PesaPal: '.length)
      : 'Failed to start wallet top-up. Please try again.'
    return errorResponse(message, 500)
  }
}