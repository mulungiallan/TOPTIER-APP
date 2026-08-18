import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { StrategyBuilderService, type StrategyRule } from '@/lib/services/trading-ai'

// GET /api/strategies?scope=mine — list user strategies or public templates
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope') // 'mine' or 'public'

    if (scope === 'public') {
      const strategies = await StrategyBuilderService.listPublic()
      return successResponse({ strategies })
    }
    const strategies = await StrategyBuilderService.listUserStrategies(userId)
    return successResponse({ strategies })
  } catch (error) {
    console.error('Strategies GET error:', error)
    return errorResponse('Failed to fetch strategies', 500)
  }
}

// POST /api/strategies — create a new strategy
// PUT  /api/strategies?id=... — update strategy
// DELETE /api/strategies?id=... — delete strategy
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { name, description, market, timeframe, rules, isPublic } = body

    if (!name?.trim() || !market || !timeframe || !Array.isArray(rules)) {
      return errorResponse('name, market, timeframe, rules[] are required', 400)
    }

    const strategy = await StrategyBuilderService.create(userId, {
      name: name.trim(), description, market, timeframe,
      rules: rules as StrategyRule[], isPublic,
    })
    return successResponse({ strategy }, 201)
  } catch (error) {
    console.error('Strategies POST error:', error)
    return errorResponse('Failed to create strategy', 500)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return errorResponse('id is required', 400)

    const body = await request.json()
    const { name, description, rules, isPublic, performance } = body

    await StrategyBuilderService.update(id, userId, {
      name, description, rules, isPublic, performance,
    })
    return successResponse({ updated: true })
  } catch (error) {
    console.error('Strategies PUT error:', error)
    return errorResponse('Failed to update strategy', 500)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return errorResponse('id is required', 400)

    await StrategyBuilderService.delete(id, userId)
    return successResponse({ deleted: true })
  } catch (error) {
    console.error('Strategies DELETE error:', error)
    return errorResponse('Failed to delete strategy', 500)
  }
}
