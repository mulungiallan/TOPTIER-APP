import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'
import { getAvailableBalance } from '@/lib/payouts'
import { binanceWithdrawEnabled, binanceWithdrawUSDT } from '@/lib/payments/binance-payout'

function maskAddress(address: string): string {
  if (address.length <= 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export async function POST(request: NextRequest) {
  try {
    const { error } = await requireAdmin(request)
    if (error) return error

    const body = await request.json()
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return errorResponse('A valid amount is required', 400)
    }

    const balance = await getAvailableBalance()
    if (amount > balance.available) {
      return errorResponse(`Insufficient balance. Available: $${balance.available.toFixed(2)}`, 400)
    }

    const accountId = typeof body.accountId === 'string' ? body.accountId : undefined
    const account = accountId
      ? await db.payoutAccount.findUnique({ where: { id: accountId } })
      : await db.payoutAccount.findFirst({ where: { isDefault: true } })

    if (!account) {
      return errorResponse('No payout account set. Configure a Binance or bank account first.', 400)
    }

    let details: any = {}
    try { details = JSON.parse(account.details) } catch {
      return errorResponse('Payout account details are corrupted. Please reconfigure your payout account.', 400)
    }

    let destination: string
    if (account.method === 'binance') {
      destination = `${maskAddress(details.address)} (${String(details.network || 'TRC20').toUpperCase()})`
    } else {
      destination = `${details.bankName} •••• ${String(details.accountNumber).slice(-4)}`
    }

    const payout = await db.payoutRequest.create({
      data: {
        accountId: account.id,
        method: account.method,
        destination,
        amount,
        fee: 0,
        netAmount: amount,
      },
    })

    // Automatic instant payout via Binance ONLY when withdrawals are explicitly
    // enabled (BINANCE_WITHDRAWALS_ENABLED=true). Otherwise the request stays
    // queued for a manual transfer — keys alone can never move funds.
    if (account.method === 'binance' && binanceWithdrawEnabled()) {
      const result = await binanceWithdrawUSDT({
        address: details.address,
        network: String(details.network || 'TRC20').toUpperCase(),
        amount,
        memo: details.memo,
      })

      if (result.ok) {
        await db.payoutRequest.update({
          where: { id: payout.id },
          data: { status: 'processing', txHash: result.withdrawId || null },
        })
        return successResponse({
          request: { ...payout, status: 'processing', txHash: result.withdrawId || null },
          automatic: true,
          message: `USDT transfer submitted to Binance (${destination}). Funds are on their way.`,
        })
      }

      await db.payoutRequest.update({
        where: { id: payout.id },
        data: { status: 'failed', failureReason: result.error || 'Binance withdrawal failed' },
      })
      return errorResponse(
        result.error || 'Binance withdrawal failed — request kept as failed. Check your Binance API keys.',
        400
      )
    }

    if (account.method === 'binance') {
      return successResponse({
        request: payout,
        automatic: false,
        message: `Withdrawal ${destination} is ready to send. Transfer ${amount.toFixed(2)} USDT to the address above from your Binance wallet.`,
      })
    }

    return successResponse({
      request: payout,
      automatic: false,
      message: 'Bank payout queued. Process through your bank portal once confirmed.',
    })
  } catch (err) {
    console.error('Payout withdraw error:', err)
    return errorResponse('Failed to create payout', 500)
  }
}
