// TOPTIER Payment Providers List API
// Returns available payment providers for the frontend

import { successResponse } from '@/lib/auth'
import { getAvailableProviders } from '@/lib/payments/registry'

export async function GET() {
  try {
    const providers = getAvailableProviders()
    return successResponse({ providers })
  } catch (error) {
    console.error('Payment providers GET error:', error)
    return Response.json({ error: 'Failed to fetch payment providers' }, { status: 500 })
  }
}
