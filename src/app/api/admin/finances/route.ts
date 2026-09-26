// Admin finances dashboard — P&L summary (income semantics live in
// src/lib/services/expenses.ts) plus recent expense rows for the Finances tab.

import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'
import { getFinanceSummary, listExpenses } from '@/lib/services/expenses'

export async function GET(request: NextRequest) {
  try {
    const { error, user } = await requireAdmin(request)
    if (error) return error
    if (!user) return errorResponse('Admin access required', 403)

    const [summary, expenses] = await Promise.all([getFinanceSummary(), listExpenses(200)])

    return successResponse({ summary, expenses })
  } catch (error) {
    console.error('Admin finances GET error:', error)
    return errorResponse('Failed to fetch finances', 500)
  }
}