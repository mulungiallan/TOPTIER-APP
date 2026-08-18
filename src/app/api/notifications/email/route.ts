// src/app/api/notifications/email/route.ts
// Email notification API - allows triggering emails for alerts, signals, etc.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { emailService } from '@/lib/services/email'
import { notifyUser } from '@/lib/services/notifications'
import { marketDataService } from '@/lib/services/market-data'

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { action } = body

    switch (action) {
      case 'send_alert': {
        const { alertId } = body
        if (!alertId) return errorResponse('alertId required', 400)

        const alert = await db.priceAlert.findUnique({
          where: { id: alertId },
          include: { user: { select: { email: true, name: true } } },
        })

        if (!alert) return errorResponse('Alert not found', 404)
        // IDOR guard: only the alert owner may trigger its email
        if (alert.userId !== userId) return errorResponse('You do not have access to this alert', 403)
        if (!alert.user?.email) return errorResponse('User has no email on file', 400)

        const priceData = await marketDataService.getPrice(alert.asset)
        const currentPrice = priceData?.price
        if (!currentPrice) {
          return errorResponse(
            `No live price available for ${alert.asset} — cannot confirm alert trigger. Try again later.`,
            503
          )
        }

        const emailResult = await emailService.sendAlertEmail(
          alert.user.email,
          {
            asset: alert.asset,
            condition: alert.alertType as 'above' | 'below',
            targetPrice: alert.targetPrice,
          },
          currentPrice
        )

        // Also create an in-app notification (+ push per prefs). Email is skipped
        // here because the dedicated AlertEmail was already sent above.
        await notifyUser(alert.userId, {
          type: 'price_alert',
          title: `Price Alert: ${alert.asset}`,
          message: `${alert.asset} reached ${alert.alertType} ${alert.targetPrice} (current: ${currentPrice})`,
          actionUrl: '/alerts',
        }, { skipEmail: true })

        return successResponse({ emailResult, alert: { ...alert, currentPrice } })
      }

      case 'send_signal': {
        const { signalId, recipientEmail } = body
        if (!signalId) return errorResponse('signalId required', 400)

        const signal = await db.signal.findUnique({ where: { id: signalId } })
        if (!signal) return errorResponse('Signal not found', 404)

        // Anti-relay guard: emails may only be sent to the authenticated user's
        // own address — this endpoint is not an open relay.
        const me = await db.user.findUnique({
          where: { id: userId },
          select: { email: true },
        })
        const targetEmail = recipientEmail || me?.email
        if (!targetEmail) return errorResponse('recipientEmail required', 400)
        if (me?.email && targetEmail.toLowerCase() !== me.email.toLowerCase()) {
          return errorResponse('You can only send signals to your own email address', 403)
        }

        const emailResult = await emailService.sendSignalEmail(targetEmail, {
          asset: signal.asset,
          direction: signal.type as 'BUY' | 'SELL',
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit1: signal.takeProfit1,
          confidence: signal.confidence,
          strategy: signal.strategy,
          timeframe: signal.timeframe,
          reason: signal.reason,
        })

        return successResponse({ emailResult, signalId })
      }

      case 'send_welcome': {
        const user = await db.user.findUnique({
          where: { id: userId },
          select: { email: true, name: true },
        })

        if (!user?.email) return errorResponse('User has no email on file', 400)

        const emailResult = await emailService.sendWelcomeEmail(user.email, user.name || 'Trader')
        return successResponse({ emailResult })
      }

      case 'send_weekly_report': {
        const user = await db.user.findUnique({
          where: { id: userId },
          select: { email: true, name: true },
        })

        if (!user?.email) return errorResponse('User has no email on file', 400)

        // Compute weekly stats from resolved signals
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        const resolvedSignals = await db.signal.findMany({
          where: {
            resolvedAt: { gte: weekAgo },
            status: { in: ['hit_tp', 'hit_sl'] },
          },
          select: { status: true, asset: true, confidence: true },
        })

        const wins = resolvedSignals.filter(s => s.status === 'hit_tp').length
        const losses = resolvedSignals.filter(s => s.status === 'hit_sl').length
        const total = resolvedSignals.length
        const winRate = total > 0 ? (wins / total) * 100 : 0
        const pnl = wins * 100 - losses * 50 // Simplified estimate

        const emailResult = await emailService.sendWeeklyReport(user.email, {
          name: user.name || 'Trader',
          totalSignals: total,
          winRate,
          wins,
          losses,
          pnl,
          topAsset: resolvedSignals[0]?.asset,
        })

        return successResponse({ emailResult, stats: { total, winRate, wins, losses, pnl } })
      }

      case 'send_password_reset': {
        const { email, resetToken } = body
        if (!email || !resetToken) {
          return errorResponse('email and resetToken required', 400)
        }

        // Anti-abuse guard: you may only reset your own password from this endpoint
        const me = await db.user.findUnique({
          where: { id: userId },
          select: { email: true },
        })
        if (!me?.email || email.toLowerCase() !== me.email.toLowerCase()) {
          return errorResponse('You can only request a password reset for your own account', 403)
        }

        const emailResult = await emailService.sendPasswordResetEmail(email, resetToken)
        return successResponse({ emailResult })
      }

      default:
        return errorResponse(
          'Invalid action. Valid: send_alert, send_signal, send_welcome, send_weekly_report, send_password_reset',
          400
        )
    }
  } catch (error) {
    console.error('Email notification API error:', error)
    return errorResponse('Failed to send email notification', 500)
  }
}

// GET - returns email service status
export async function GET(request: NextRequest) {
  const userId = getUserIdFromRequest(request)
  if (!userId) return errorResponse('Unauthorized', 401)

  return successResponse({
    configured: !!process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM || 'notifications@toptier.app',
    actions: ['send_alert', 'send_signal', 'send_welcome', 'send_weekly_report', 'send_password_reset'],
  })
}
