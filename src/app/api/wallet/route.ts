import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  CASH_ASSETS,
  CRYPTO_ASSETS,
  creditCryptoDeposit,
  getWalletOverview,
  getTransactionHistory,
  getBalance,
} from '@/lib/services/wallet'
import { submitUserCashWithdrawal, payoutSupportedFor } from '@/lib/services/user-payouts'
import { nowpaymentsConfigured } from '@/lib/payments/nowpayments'

// GET /api/wallet
// Full wallet overview: balances, ledger health and the user's recent posting
// history. Lightweight enough for both the header chip and the Wallet page.
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { id: true })
    if (!auth.user) return errorResponse(auth.error || 'Unauthorized', 401)
    const userId = auth.user.id

    const [overview, transactions, payments] = await Promise.all([
      getWalletOverview(userId),
      getTransactionHistory(userId),
      // User-facing payment/top-up history (PesaPal, bank, manual methods).
      db.paymentTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          amount: true,
          currency: true,
          planType: true,
          paymentMethod: true,
          paymentProvider: true,
          status: true,
          description: true,
          createdAt: true,
        },
      }),
    ])

    return successResponse({
      balances: overview.balances,
      ledger: overview.ledger,
      assets: {
        cash: CASH_ASSETS,
        crypto: CRYPTO_ASSETS,
      },
      cryptoDepositsEnabled: nowpaymentsConfigured(),
      payments,
      transactions: transactions.map((tx) => ({
        id: tx.id,
        txType: tx.txType,
        reference: tx.reference,
        status: tx.status,
        memo: tx.memo,
        postedAt: tx.postedAt,
        createdAt: tx.createdAt,
        legs: tx.entries.map((e) => ({
          asset: e.account.asset,
          accountType: e.account.accountType,
          amount: e.amount,
        })),
      })),
    })
  } catch (error) {
    console.error('Wallet overview GET error:', error)
    return errorResponse('Failed to fetch wallet', 500)
  }
}

// POST /api/wallet
// Money-movement actions. Every action posts a balanced double-entry ledger
// row (user leg + house clearing leg). Network-side references are idempotent.
//
// Body: { action, ...params }
//   withdraw:        { asset, amount, toAddress, network }
//                    AUTOMATIC real payout: USD is paid as USDT 1:1, USDT is
//                    sent as-is — both via Binance to the user's address. The
//                    ledger is reserved first (hard balance cap — never exceed)
//                    and the Binance send is attempted immediately; a failed
//                    send auto-refunds the reserve. Any other asset is rejected
//                    (no more mock "successful" withdrawals).
//   crypto-credit:   { asset, amount, txHash }   (ADMIN ONLY — manual on-chain
//                    deposit callback. Regular users deposit through the
//                    NOWPayments flow instead.)
//   crypto-withdraw: { asset, amount, toAddress, network }
//                    USDT only — an alias for withdraw. BTC/ETH/SOL reject.
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { id: true, role: true })
    if (!auth.user) return errorResponse(auth.error || 'Unauthorized', 401)
    const userId = auth.user.id

    const body = (await request.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>
    const action = String(body.action || '')
    const amount = Number(body.amount ?? 0)
    const { asset, toAddress, network, txHash, memo } = body

    let result: unknown
    switch (action) {
      case 'withdraw': {
        const wAsset = String(asset || 'USD').toUpperCase()
        if (!payoutSupportedFor(wAsset)) {
          return errorResponse(
            `Automatic withdrawal from ${wAsset} is not supported. Available: USD (paid as USDT 1:1) and USDT.`,
            400
          )
        }
        if (!toAddress || typeof toAddress !== 'string') {
          return errorResponse('A USDT receiving address is required to withdraw.', 400)
        }
        result = await submitUserCashWithdrawal({ userId, asset: wAsset, amount, toAddress, network: String(network || 'TRC20') })
        break
      }
      case 'crypto-credit': {
        const isAdmin = auth.user.role === 'admin' || auth.user.role === 'super_admin' || auth.user.role === 'owner'
        if (!isAdmin) return errorResponse('Forbidden', 403)
        result = await creditCryptoDeposit({
          userId,
          asset: String(asset || 'BTC'),
          amount,
          reference: String(txHash || ''),
          memo: memo && typeof memo === 'string' ? memo : null,
        })
        break
      }
      case 'crypto-withdraw': {
        const cAsset = String(asset || 'USDT').toUpperCase()
        if (cAsset !== 'USDT') {
          return errorResponse(
            `Automatic on-chain withdrawal for ${cAsset} is not available. Withdraw USDT only (paid automatically to your address).`,
            400
          )
        }
        if (!toAddress || typeof toAddress !== 'string') {
          return errorResponse('A USDT receiving address is required to withdraw.', 400)
        }
        result = await submitUserCashWithdrawal({ userId, asset: cAsset, amount, toAddress, network: String(network || 'TRC20') })
        break
      }
      default: {
        // Validate balances for a requested asset without mutating anything.
        if (asset) {
          result = { balance: await getBalance(userId, String(asset)) }
        } else {
          return errorResponse('Unknown wallet action', 400)
        }
      }
    }

    return successResponse(result, 200)
  } catch (error) {
    console.error('Wallet action error:', error)
    const message = error instanceof Error ? error.message : 'Wallet action failed'
    const status = message === 'insufficient_balance' ? 422 : message === 'invalid_address' ? 400 : 400
    return errorResponse(message, status)
  }
}