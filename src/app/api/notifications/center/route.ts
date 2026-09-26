// src/app/api/notifications/center/route.ts
// In-app notification center. Serves the user's recent notifications (the bell
// dropdown + the instant popup poller) and lets them mark items as read.
//
// This is the app-level system backed by the `Notification` model (signals,
// signal_result, news, system, etc.). It is separate from the bot-engine's
// /api/notifications route, which answers to the mt5 bot's trading-signal flow.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import type { AppNotification } from '@/lib/store'

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const [notifications, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          isRead: true,
          actionUrl: true,
          createdAt: true,
        },
      }),
      db.notification.count({ where: { userId, isRead: false } }),
    ])

    const items: AppNotification[] = notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      isRead: n.isRead,
      actionUrl: n.actionUrl,
      createdAt: n.createdAt.toISOString(),
    }))

    return successResponse({ notifications: items, unreadCount })
  } catch (error) {
    console.error('Notifications center GET error:', error)
    return errorResponse('Failed to fetch notifications', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = (await request.json().catch(() => ({}))) as {
      id?: string
      readAll?: boolean
    }

    if (body.readAll) {
      await db.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      })
    } else if (typeof body.id === 'string' && body.id) {
      await db.notification.updateMany({
        where: { id: body.id, userId },
        data: { isRead: true },
      })
    }

    const unreadCount = await db.notification.count({ where: { userId, isRead: false } })
    return successResponse({ unreadCount })
  } catch (error) {
    console.error('Notifications center POST error:', error)
    return errorResponse('Failed to update notifications', 500)
  }
}