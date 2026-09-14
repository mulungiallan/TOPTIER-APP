// TOPTIER Payment Providers List API
// Returns available payment providers for the frontend

import { successResponse } from '@/lib/auth'
import { getAvailableProviders } from '@/lib/payments/registry'
import { getBalance } from '@/lib/services/wallet'
import { verifyToken } from '@/lib/auth'

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const providers = getAvailableProviders()

    // Attach the caller's USD wallet balance to the wallet provider so the UI
    // can show how much they can spend. Unauthenticated calls get a 0 balance.
    let usdBalance = 0
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim()
      const decoded = verifyToken(token)
      if (decoded?.userId) {
        usdBalance = await getBalance(decoded.userId, 'USD')
      }
    }

    const walletProvider = providers.find((p) => p.id === 'wallet')
    if (walletProvider) {
      walletProvider.checkoutConfig = {
        ...(walletProvider.checkoutConfig || {}),
        balanceUSD: String(usdBalance),
      }
    }

    return successResponse({ providers, walletBalanceUSD: usdBalance })
  } catch (error) {
    console.error('Payment providers GET error:', error)
    return Response.json({ error: 'Failed to fetch payment providers' }, { status: 500 })
  }
}