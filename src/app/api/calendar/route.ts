import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const impact = searchParams.get('impact') // high, medium, low
    const currency = searchParams.get('currency')
    const limit = parseInt(searchParams.get('limit') || '50')

    const where: Record<string, unknown> = {}

    if (startDate || endDate) {
      const eventDate: Record<string, Date> = {}
      if (startDate) eventDate.gte = new Date(startDate)
      if (endDate) eventDate.lte = new Date(endDate)
      where.eventDate = eventDate
    }

    if (impact) where.impactLevel = impact
    if (currency) where.currency = currency.toUpperCase()

    const events = await db.economicEvent.findMany({
      where,
      orderBy: { eventDate: 'asc' },
      take: limit,
    })

    return successResponse(events)
  } catch (error) {
    console.error('Calendar GET error:', error)
    // Return empty array instead of 500 so the UI doesn't crash
    return successResponse([])
  }
}
