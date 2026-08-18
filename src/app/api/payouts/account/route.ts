import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'

function validBinanceDetails(d: any): string | null {
  if (!d?.address || typeof d.address !== 'string' || d.address.trim().length < 20) {
    return 'A valid USDT receiving address is required'
  }
  const network = String(d.network || 'TRC20').toUpperCase()
  if (network !== 'TRC20' && network !== 'BEP20') {
    return 'Network must be TRC20 or BEP20'
  }
  return null
}

function validBankDetails(d: any): string | null {
  if (!d?.accountName || !d?.accountNumber || !d?.bankName) {
    return 'Account name, account number and bank name are required'
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const { error } = await requireAdmin(request)
    if (error) return error

    const body = await request.json()
    const { method, details } = body

    if (method !== 'binance' && method !== 'bank') {
      return errorResponse('method must be "binance" or "bank"', 400)
    }

    const validationError =
      method === 'binance' ? validBinanceDetails(details) : validBankDetails(details)
    if (validationError) {
      return errorResponse(validationError, 400)
    }

    const account = await db.payoutAccount.upsert({
      where: { method },
      update: { details: JSON.stringify(details), isDefault: true },
      create: { method, details: JSON.stringify(details), isDefault: true },
    })

    // A single payout destination is supported — make this the only default.
    await db.payoutAccount.updateMany({
      where: { id: { not: account.id } },
      data: { isDefault: false },
    })

    return successResponse({ account: { id: account.id, method: account.method, details: JSON.parse(account.details) } })
  } catch (err) {
    console.error('Payout account error:', err)
    return errorResponse('Failed to save payout account', 500)
  }
}
