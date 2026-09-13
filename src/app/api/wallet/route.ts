import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse } from '@/lib/auth'
import {
  CASH_ASSETS,
  CRYPTO_ASSETS,
  depositCash,
  withdrawCash,
  getDepositAddress,
  creditCryptoDeposit,
  withdrawCrypto,
  settleTrade,
  getWalletOverview,
  getTransactionHistory,
  getBalance,
} from '@/lib/services/wallet'

// GET /api/wallet
// Full wallet overview: balances, mock deposit addresses, ledger health and the
// user's recent posting history. Lightweight enough for both the header chip
// and the Wallet page.
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { id: true })
    if (!auth.user) return errorResponse(auth.error || 'Unauthorized', 401)
    const userId = auth.user.id

    const [overview, transactions] = await Promise.all([
      getWalletOverview(userId),
      getTransactionHistory(userId),
    ])

    return successResponse({
      balances: overview.balances,
      addresses: overview.addresses,
      ledger: overview.ledger,
      assets: {
        cash: CASH_ASSETS,
        crypto: CRYPTO_ASSETS,
      },
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
//   deposit:  { asset, amount, memo? }
//   withdraw: { asset, amount, memo? }
//   crypto-deposit-address: { asset }
//   crypto-credit:  { asset, amount, txHash }   (on-chain deposit callback)
//   crypto-withdraw: { asset, amount, toAddress }
//   trade-settle:    { buyAsset, buyQty, sellAsset, sellCost, fee? }
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { id: true })
    if (!auth.user) return errorResponse(auth.error || 'Unauthorized', 401)
    const userId = auth.user.id

    const body = (await request.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>
    const action = String(body.action || '')
    const amount = Number(body.amount ?? 0)
    const { asset, toAddress, txHash, memo } = body

    let result: unknown
    switch (action) {
      case 'deposit': {
        result = await depositCash({
          userId,
          asset: String(asset || 'USD'),
          amount,
          memo: memo && typeof memo === 'string' ? memo : null,
        })
        break
      }
      case 'withdraw': {
        result = await withdrawCash({
          userId,
          asset: String(asset || 'USD'),
          amount,
          memo: memo && typeof memo === 'string' ? memo : null,
        })
        break
      }
      case 'crypto-deposit-address': {
        result = { address: await getDepositAddress(userId, String(asset || 'BTC')) }
        break
      }
      case 'crypto-credit': {
        result = await creditCryptoDeposit({
          userId,
          asset: String(asset || 'BTC'),
          amount,
          txHash: String(txHash || ''),
          memo: memo && typeof memo === 'string' ? memo : null,
        })
        break
      }
      case 'crypto-withdraw': {
        result = await withdrawCrypto({
          userId,
          asset: String(asset || 'BTC'),
          amount,
          toAddress: String(toAddress || ''),
          memo: memo && typeof memo === 'string' ? memo : null,
        })
        break
      }
      case 'trade-settle': {
        result = await settleTrade({
          userId,
          buyAsset: String(body.buyAsset || ''),
          buyQty: Number(body.buyQty || 0),
          sellAsset: String(body.sellAsset || ''),
          sellCost: Number(body.sellCost || 0),
          fee: Number(body.fee || 0),
        })
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