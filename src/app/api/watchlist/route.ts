import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const watchlists = await db.watchlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: { orderBy: { order: 'asc' } },
      },
    })

    return successResponse(watchlists)
  } catch (error) {
    console.error('Watchlist GET error:', error)
    return errorResponse('Failed to fetch watchlists', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { action } = body

    // Create a new watchlist
    if (action === 'create_list') {
      const { name } = body
      if (!name) {
        return errorResponse('Watchlist name is required', 400)
      }

      const watchlist = await db.watchlist.create({
        data: {
          userId,
          name,
          isDefault: false,
        },
        include: { items: true },
      })

      return successResponse(watchlist, 201)
    }

    // Add item to watchlist
    if (action === 'add_item') {
      const { watchlistId, asset, assetName } = body
      if (!watchlistId || !asset || !assetName) {
        return errorResponse('watchlistId, asset, and assetName are required', 400)
      }

      // Verify watchlist belongs to user
      const watchlist = await db.watchlist.findFirst({
        where: { id: watchlistId, userId },
      })
      if (!watchlist) {
        return errorResponse('Watchlist not found', 404)
      }

      // Check if asset already exists in the watchlist
      const existingItem = await db.watchlistItem.findFirst({
        where: { watchlistId, asset },
      })
      if (existingItem) {
        return errorResponse('Asset already in watchlist', 409)
      }

      // Get the next order number
      const maxOrder = await db.watchlistItem.findFirst({
        where: { watchlistId },
        orderBy: { order: 'desc' },
        select: { order: true },
      })

      const item = await db.watchlistItem.create({
        data: {
          watchlistId,
          asset,
          assetName,
          order: (maxOrder?.order ?? -1) + 1,
        },
      })

      return successResponse(item, 201)
    }

    return errorResponse('Invalid action. Use "create_list" or "add_item"', 400)
  } catch (error) {
    console.error('Watchlist POST error:', error)
    return errorResponse('Failed to process watchlist request', 500)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get('itemId')
    const watchlistId = searchParams.get('watchlistId')

    if (itemId) {
      // Remove a specific item from watchlist
      const item = await db.watchlistItem.findFirst({
        where: { id: itemId },
        include: { watchlist: true },
      })

      if (!item || item.watchlist.userId !== userId) {
        return errorResponse('Item not found', 404)
      }

      await db.watchlistItem.delete({ where: { id: itemId } })
      return successResponse({ deleted: true })
    }

    if (watchlistId) {
      // Delete entire watchlist
      const watchlist = await db.watchlist.findFirst({
        where: { id: watchlistId, userId },
      })

      if (!watchlist) {
        return errorResponse('Watchlist not found', 404)
      }

      if (watchlist.isDefault) {
        return errorResponse('Cannot delete default watchlist', 400)
      }

      await db.watchlist.delete({ where: { id: watchlistId } })
      return successResponse({ deleted: true })
    }

    return errorResponse('Provide itemId or watchlistId parameter', 400)
  } catch (error) {
    console.error('Watchlist DELETE error:', error)
    return errorResponse('Failed to delete watchlist item', 500)
  }
}
