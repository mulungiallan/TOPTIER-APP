// src/app/api/admin-actions/route.ts
// Admin write API - 8 actions: impersonate, suspend_user, generate_signal,
// override_signal, create_coupon, dismiss_report, warn_user, ban_user
//
// NOTE: This file is added WITHOUT touching the existing /api/admin GET route.
// The existing route stays as-is for read-only stats.

import { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'
import { db } from '@/lib/db'
import {
  successResponse,
  errorResponse,
  generateToken,
  getJwtSecret,
} from '@/lib/auth'
import { emailService } from '@/lib/services/email'
import { notifyUser, notifyUsers } from '@/lib/services/notifications'
import { requireAdmin } from '@/lib/admin-guard'
import { ManagedCopyService } from '@/lib/services/managed-copy'
import { escapeHtml } from '@/lib/security'

// NOTE: The JWT secret comes from the shared auth module. There is no
// hardcoded fallback — missing secret is a fatal misconfiguration.
// Lazily resolved to avoid throwing during build-time module init.
let _jwtSecret: string | null = null
function getJwtSecretLazy(): string {
  if (_jwtSecret === null) _jwtSecret = getJwtSecret()
  return _jwtSecret
}

function requireString(body: Record<string, unknown>, field: string): string | null {
  const val = body[field]
  if (typeof val !== 'string' || val.trim() === '') return field
  return null
}

async function logAdminAction(adminId: string, action: string, details: Record<string, unknown>) {
  try {
    await db.adminAuditLog.create({
      data: {
        adminId,
        action,
        target: String(details?.targetUserId || details?.signalId || details?.reportId || details?.code || ''),
        details: JSON.stringify(details),
      },
    })
  } catch (e) {
    console.error('Failed to log admin action:', e)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { error, user } = await requireAdmin(request)
    if (error) return error
    if (!user) return errorResponse('Forbidden: Admin access required', 403)

    const body = await request.json()
    const { action } = body
    const adminId = user.id

    switch (action) {
      case 'impersonate':
        return await handleImpersonate(adminId, body)
      case 'suspend_user':
        return await handleSuspendUser(adminId, body)
      case 'generate_signal':
        return await handleGenerateSignal(adminId, body)
      case 'override_signal':
        return await handleOverrideSignal(adminId, body)
      case 'create_coupon':
        return await handleCreateCoupon(adminId, body)
      case 'dismiss_report':
        return await handleDismissReport(adminId, body)
      case 'deactivate_coupon':
        return await handleDeactivateCoupon(adminId, body)
      case 'warn_user':
        return await handleWarnUser(adminId, body)
      case 'ban_user':
        return await handleBanUser(adminId, body)
      case 'create_news':
        return await handleCreateNews(adminId, body)
      case 'delete_news':
        return await handleDeleteNews(adminId, body)
      case 'create_event':
        return await handleCreateEvent(adminId, body)
      case 'delete_event':
        return await handleDeleteEvent(adminId, body)
      case 'unban_user':
        return await handleUnbanUser(adminId, body)
      case 'settle_broker_copy':
        return await handleSettleBrokerCopy(adminId, body)
      case 'log_ad_revenue':
        return await handleLogAdRevenue(adminId, body)
      default:
        return errorResponse('Invalid action', 400)
    }
  } catch (error) {
    console.error('Admin action failed:', error)
    return errorResponse('Admin action failed', 500)
  }
}

// ─── Action 1: Impersonate a user ──────────────────────────────────────────────
async function handleImpersonate(adminId: string, body: any) {
  const { targetUserId } = body
  if (!targetUserId) return errorResponse('targetUserId required', 400)

  const target = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, name: true, role: true },
  })

  if (!target) return errorResponse('Target user not found', 404)

  // Prevent impersonating other admins or super_admins
  if (target.role === 'admin' || target.role === 'super_admin') {
    return errorResponse('Cannot impersonate admin or super_admin accounts', 403)
  }

  // Generate a short-lived impersonation token (1 hour) using both
  // our base64 token system AND a JWT for compatibility
  const impersonationToken = jwt.sign(
    { userId: target.id, impersonated: true, impersonatedBy: adminId },
    getJwtSecretLazy(),
    { expiresIn: '1h' }
  )

  // Also generate a short-lived app token (1 hour) so existing code works
  // but the impersonation session doesn't outlive the impersonation token.
  const appToken = generateToken(target.id, { expiresInMs: 60 * 60 * 1000 })

  await logAdminAction(adminId, 'IMPERSONATE', { targetUserId, targetEmail: target.email })

  return successResponse({
    appToken,
    targetUser: { id: target.id, email: target.email, name: target.name },
    expiresIn: '1h',
  })
}

// ─── Action 2: Suspend a user ──────────────────────────────────────────────────
async function handleSuspendUser(adminId: string, body: any) {
  const { userId, duration, reason } = body
  if (!userId) return errorResponse('userId required', 400)

  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return errorResponse('User not found', 404)

  // We use isBanned + banReason + a stored suspension end date in the banReason field
  // since the existing schema doesn't have a dedicated suspendedUntil column.
  const durationDays = parseInt(duration) || 7
  const suspendedUntil = new Date()
  suspendedUntil.setDate(suspendedUntil.getDate() + durationDays)

  const suspensionText = `SUSPENDED until ${suspendedUntil.toISOString()} | Reason: ${reason || 'Violation of terms'}`

  const updated = await db.user.update({
    where: { id: userId },
    data: {
      isBanned: true,
      banReason: suspensionText,
    },
    select: { id: true, email: true, name: true, isBanned: true, banReason: true },
  })

  // Create notification for the suspended user
  await notifyUser(userId, {
    type: 'system',
    title: 'Account Suspended',
    message: `Your account has been suspended for ${durationDays} day(s). Reason: ${reason || 'Violation of terms'}`,
    actionUrl: '/support',
  })

  await logAdminAction(adminId, 'SUSPEND_USER', {
    targetUserId: userId,
    duration: durationDays,
    reason: reason || 'Violation of terms',
    suspendedUntil: suspendedUntil.toISOString(),
  })

  return successResponse({
    ...updated,
    suspendedUntil: suspendedUntil.toISOString(),
    reason: reason || 'Violation of terms',
  })
}

// ─── Action 3: Generate a signal (admin override) ──────────────────────────────
async function handleGenerateSignal(adminId: string, body: any) {
  const {
    asset,
    type,
    direction,
    entryPrice,
    stopLoss,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    confidence,
    strategy,
    timeframe,
    marketType,
    reason,
    tradingSession,
  } = body

  const signalType = type || direction
  if (!asset || !signalType || !entryPrice || !stopLoss || !takeProfit1) {
    return errorResponse(
      'Missing required fields: asset, type (or direction), entryPrice, stopLoss, takeProfit1',
      400
    )
  }

  const entry = parseFloat(entryPrice)
  const sl = parseFloat(stopLoss)
  const tp1 = parseFloat(takeProfit1)
  const rr = Math.abs(tp1 - entry) / Math.max(Math.abs(entry - sl), 0.0001)

  const signal = await db.signal.create({
    data: {
      type: signalType.toUpperCase().startsWith('BUY') || signalType.toUpperCase() === 'LONG'
        ? 'BUY'
        : signalType.toUpperCase().startsWith('SELL') || signalType.toUpperCase() === 'SHORT'
        ? 'SELL'
        : signalType.toUpperCase(),
      asset,
      entryPrice: entry,
      stopLoss: sl,
      takeProfit1: tp1,
      takeProfit2: takeProfit2 ? parseFloat(takeProfit2) : null,
      takeProfit3: takeProfit3 ? parseFloat(takeProfit3) : null,
      riskRewardRatio: Math.round(rr * 100) / 100,
      confidence: parseInt(confidence) || 70,
      strategy: strategy || 'admin_generated',
      timeframe: timeframe || '1H',
      reason: reason || `Admin-generated signal for ${asset}`,
      status: 'active',
      marketType: marketType || 'forex',
      tradingSession: tradingSession || null,
      expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      userId: adminId,
    },
  })

  // Broadcast to all users via notification (in-app + push + email per user prefs).
  // Type 'signal' maps to the 'new-signal' preference.
  const signalUsers = await db.user.findMany({
    where: { isBanned: false },
    select: { id: true, email: true, notificationPrefs: true },
    take: 1000, // cap to avoid huge fan-out
  })
  await notifyUsers(signalUsers, {
    type: 'signal',
    title: `New ${signal.type} Signal: ${signal.asset}`,
    message: `${signal.type} ${signal.asset} @ ${signal.entryPrice} (confidence: ${signal.confidence}%)`,
    actionUrl: '/signals',
  }).catch(e => console.error('Bulk signal notification failed:', e))

  await logAdminAction(adminId, 'GENERATE_SIGNAL', { signalId: signal.id, asset, type: signal.type })

  return successResponse(signal, 201)
}

// ─── Action 4: Override a signal ───────────────────────────────────────────────
async function handleOverrideSignal(adminId: string, body: any) {
  const { signalId, status, newTakeProfit1, newStopLoss, newConfidence, reason } = body
  if (!signalId) return errorResponse('signalId required', 400)

  const existing = await db.signal.findUnique({ where: { id: signalId } })
  if (!existing) return errorResponse('Signal not found', 404)

  const updateData: Record<string, unknown> = {}
  if (status) updateData.status = status
  if (newTakeProfit1) updateData.takeProfit1 = parseFloat(newTakeProfit1)
  if (newStopLoss) updateData.stopLoss = parseFloat(newStopLoss)
  if (newConfidence !== undefined) updateData.confidence = parseInt(newConfidence)
  if (status && ['hit_tp', 'hit_sl', 'expired'].includes(status)) {
    updateData.resolvedAt = new Date()
  }

  const updated = await db.signal.update({
    where: { id: signalId },
    data: updateData,
  })

  await logAdminAction(adminId, 'OVERRIDE_SIGNAL', {
    signalId,
    changes: updateData,
    reason: reason || 'No reason provided',
  })

  return successResponse({
    signal: updated,
    changes: updateData,
    overrideReason: reason || 'No reason provided',
  })
}

// ─── Action 5: Create a coupon code ────────────────────────────────────────────
async function handleCreateCoupon(adminId: string, body: any) {
  const {
    code,
    discountType,
    discountAmount,
    maxUses,
    maxPerUser,
    expiresAt,
    minPlan,
  } = body

  if (!code || !discountType || !discountAmount) {
    return errorResponse('Missing required fields: code, discountType, discountAmount', 400)
  }

  if (!['percentage', 'fixed'].includes(discountType)) {
    return errorResponse('discountType must be "percentage" or "fixed"', 400)
  }

  // Check if code already exists
  const existing = await db.couponCode.findUnique({ where: { code: code.toUpperCase() } })
  if (existing) {
    return errorResponse('Coupon code already exists', 400)
  }

  const coupon = await db.couponCode.create({
    data: {
      code: code.toUpperCase(),
      discountType,
      discountAmount: parseFloat(discountAmount),
      maxUses: maxUses ? parseInt(maxUses) : null,
      maxPerUser: maxPerUser ? parseInt(maxPerUser) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      minPlan: minPlan || null,
      isActive: true,
    },
  })

  await logAdminAction(adminId, 'CREATE_COUPON', {
    code: coupon.code,
    discountType,
    discountAmount,
  })

  return successResponse(coupon, 201)
}

// ─── Action 6: Dismiss a report (support ticket) ───────────────────────────────
async function handleDismissReport(adminId: string, body: any) {
  const { reportId, resolution, reason } = body
  if (!reportId) return errorResponse('reportId required', 400)

  // In our schema, support tickets are the closest to "reports"
  const ticket = await db.supportTicket.findUnique({ where: { id: reportId } })
  if (!ticket) return errorResponse('Report/ticket not found', 404)

  const updated = await db.supportTicket.update({
    where: { id: reportId },
    data: {
      status: 'closed',
    },
  })

  // Notify the reporter
  await notifyUser(ticket.userId, {
    type: 'system',
    title: 'Your report has been reviewed',
    message: resolution || `Your report has been dismissed. Reason: ${reason || 'Not specified'}`,
    actionUrl: '/support',
  })

  await logAdminAction(adminId, 'DISMISS_REPORT', {
    reportId,
    resolution: resolution || 'Dismissed',
    reason: reason || 'Not specified',
  })

  return successResponse({
    ticket: updated,
    dismissed: true,
    resolution: resolution || 'Dismissed',
  })
}

// ─── Action 6.5: Deactivate / reactivate a coupon code ─────────────────────────
async function handleDeactivateCoupon(adminId: string, body: any) {
  const { couponId, code, isActive } = body

  let coupon: Awaited<ReturnType<typeof db.couponCode.findUnique>> | null = null
  if (couponId) {
    coupon = await db.couponCode.findUnique({ where: { id: couponId } })
  } else if (code) {
    coupon = await db.couponCode.findUnique({ where: { code: code.toUpperCase() } })
  }
  if (!coupon) return errorResponse('Coupon not found', 404)

  const nextActive = isActive !== undefined ? Boolean(isActive) : !coupon.isActive
  const updated = await db.couponCode.update({
    where: { id: coupon.id },
    data: { isActive: nextActive },
  })

  await logAdminAction(adminId, nextActive ? 'ACTIVATE_COUPON' : 'DEACTIVATE_COUPON', {
    couponId: coupon.id,
    code: coupon.code,
    isActive: nextActive,
  })

  return successResponse(updated)
}

// ─── Action 7: Warn a user ─────────────────────────────────────────────────────
async function handleWarnUser(adminId: string, body: any) {
  const { userId, reason } = body
  if (!userId) return errorResponse('userId required', 400)

  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return errorResponse('User not found', 404)

  // Create a warning notification
  const warning = await notifyUser(userId, {
    type: 'system',
    title: 'Warning from TOPTIER Team',
    message: reason || 'You have received a warning for violating community guidelines.',
    actionUrl: '/support',
  })

  // Send email if available
  if (target.email) {
    try {
      await emailService.sendEmail({
        to: target.email,
        subject: 'Warning from TOPTIER Team',
        html: `
          <div style="font-family: Arial; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #f59e0b;">Warning Notice</h2>
            <p>Hi ${escapeHtml(target.name || 'User')},</p>
            <p>You have received a warning from the TOPTIER moderation team.</p>
            <p><strong>Reason:</strong> ${escapeHtml(reason || 'Violation of community guidelines')}</p>
            <p>Please review our <a href="${process.env.NEXT_PUBLIC_APP_URL || ''}/terms">Terms of Service</a> to avoid further action.</p>
            <p>If you believe this warning was issued in error, please <a href="${process.env.NEXT_PUBLIC_APP_URL || ''}/support">contact support</a>.</p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;" />
            <p style="font-size: 12px; color: #888;">TOPTIER Team</p>
          </div>
        `,
      })
    } catch (e) {
      console.error('Failed to send warning email:', e)
    }
  }

  await logAdminAction(adminId, 'WARN_USER', { targetUserId: userId, reason })

  return successResponse({
    warning: warning.notification,
    delivered: warning.delivered,
    warnedUser: { id: target.id, email: target.email, name: target.name },
  })
}

// ─── Action 8: Ban a user ──────────────────────────────────────────────────────
async function handleBanUser(adminId: string, body: any) {
  const { userId, reason } = body
  if (!userId) return errorResponse('userId required', 400)

  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return errorResponse('User not found', 404)

  // Prevent banning other admins
  if (target.role === 'admin' || target.role === 'super_admin') {
    return errorResponse('Cannot ban an admin user', 400)
  }

  const updated = await db.user.update({
    where: { id: userId },
    data: {
      isBanned: true,
      banReason: `BANNED | Reason: ${reason || 'Permanent ban for violation of terms'}`,
    },
    select: { id: true, email: true, name: true, isBanned: true, banReason: true },
  })

  // Notify the banned user
  await notifyUser(userId, {
    type: 'system',
    title: 'Account Banned',
    message: `Your account has been banned. Reason: ${reason || 'Violation of terms'}. Contact support if you believe this is an error.`,
    actionUrl: '/support',
  })

  // Send ban email
  if (target.email) {
    try {
      await emailService.sendEmail({
        to: target.email,
        subject: 'Your TOPTIER Account Has Been Banned',
        html: `
          <div style="font-family: Arial; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #ef4444;">Account Banned</h2>
            <p>Hi ${escapeHtml(target.name || 'User')},</p>
            <p>Your TOPTIER account has been permanently banned.</p>
            <p><strong>Reason:</strong> ${escapeHtml(reason || 'Violation of terms')}</p>
            <p>If you believe this action was taken in error, you may appeal by contacting <a href="${process.env.NEXT_PUBLIC_APP_URL || ''}/support">support</a>.</p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;" />
            <p style="font-size: 12px; color: #888;">TOPTIER Team</p>
          </div>
        `,
      })
    } catch (e) {
      console.error('Failed to send ban email:', e)
    }
  }

  await logAdminAction(adminId, 'BAN_USER', { targetUserId: userId, reason })

  return successResponse({
    ...updated,
    banned: true,
    reason: reason || 'Permanent ban for violation of terms',
  })
}

// ─── Action 9: Create a news article ─────────────────────────────────────────
async function handleCreateNews(adminId: string, body: any) {
  const { title, summary, content, source, url, sentiment, taggedAssets, category, publishedAt } = body
  if (!title || !source) {
    return errorResponse('Missing required fields: title, source', 400)
  }

  const article = await db.newsArticle.create({
    data: {
      title,
      summary: summary || null,
      content: content || null,
      source,
      url: url || null,
      sentiment: sentiment || 'neutral',
      taggedAssets: taggedAssets || null,
      category: category || null,
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
    },
  })

  await logAdminAction(adminId, 'CREATE_NEWS', { articleId: article.id, title, source })

  return successResponse(article, 201)
}

// ─── Action 10: Delete a news article ────────────────────────────────────────
async function handleDeleteNews(adminId: string, body: any) {
  const { articleId } = body
  if (!articleId) return errorResponse('articleId required', 400)

  const existing = await db.newsArticle.findUnique({ where: { id: articleId } })
  if (!existing) return errorResponse('Article not found', 404)

  await db.newsArticle.delete({ where: { id: articleId } })

  await logAdminAction(adminId, 'DELETE_NEWS', { articleId, title: existing.title })

  return successResponse({ deleted: true, articleId })
}

// ─── Action 11: Create an economic event ─────────────────────────────────────
async function handleCreateEvent(adminId: string, body: any) {
  const { eventName, eventDate, currency, impactLevel, previousValue, forecastValue, actualValue, eventType, description } = body
  if (!eventName || !eventDate || !currency) {
    return errorResponse('Missing required fields: eventName, eventDate, currency', 400)
  }

  const event = await db.economicEvent.create({
    data: {
      eventName,
      eventDate: new Date(eventDate),
      currency,
      impactLevel: impactLevel || 'medium',
      previousValue: previousValue || null,
      forecastValue: forecastValue || null,
      actualValue: actualValue || null,
      eventType: eventType || null,
      description: description || null,
    },
  })

  await logAdminAction(adminId, 'CREATE_EVENT', { eventId: event.id, eventName })

  return successResponse(event, 201)
}

// ─── Action 12: Delete an economic event ─────────────────────────────────────
async function handleDeleteEvent(adminId: string, body: any) {
  const { eventId } = body
  if (!eventId) return errorResponse('eventId required', 400)

  const existing = await db.economicEvent.findUnique({ where: { id: eventId } })
  if (!existing) return errorResponse('Event not found', 404)

  await db.economicEvent.delete({ where: { id: eventId } })

  await logAdminAction(adminId, 'DELETE_EVENT', { eventId, eventName: existing.eventName })

  return successResponse({ deleted: true, eventId })
}

// ─── Action 13: Unban / unsuspend a user ─────────────────────────────────────
async function handleUnbanUser(adminId: string, body: any) {
  const { userId } = body
  if (!userId) return errorResponse('userId required', 400)

  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return errorResponse('User not found', 404)

  const updated = await db.user.update({
    where: { id: userId },
    data: { isBanned: false, banReason: null },
    select: { id: true, email: true, name: true, isBanned: true, banReason: true },
  })

  await notifyUser(userId, {
    type: 'system',
    title: 'Account Reinstated',
    message: 'Your TOPTIER account has been reinstated. Welcome back!',
    actionUrl: '/dashboard',
  })

  await logAdminAction(adminId, 'UNBAN_USER', { targetUserId: userId, targetEmail: target.email })

  return successResponse({ ...updated, unbanned: true })
}

// GET - returns the list of available admin actions
export async function GET(request: NextRequest) {
  const { error, user } = await requireAdmin(request)
  if (error) return error
  if (!user) return errorResponse('Forbidden: Admin access required', 403)

  return successResponse({
    actions: [
      {
        action: 'impersonate',
        description: 'Generate a temporary token to impersonate a user (1 hour)',
        requiredFields: ['targetUserId'],
      },
      {
        action: 'suspend_user',
        description: 'Temporarily suspend a user account',
        requiredFields: ['userId'],
        optionalFields: ['duration (days, default 7)', 'reason'],
      },
      {
        action: 'generate_signal',
        description: 'Create a new trading signal as admin',
        requiredFields: ['asset', 'type', 'entryPrice', 'stopLoss', 'takeProfit1'],
        optionalFields: ['takeProfit2', 'takeProfit3', 'confidence', 'strategy', 'timeframe', 'marketType', 'reason'],
      },
      {
        action: 'override_signal',
        description: 'Modify or close an existing signal',
        requiredFields: ['signalId'],
        optionalFields: ['status', 'newTakeProfit1', 'newStopLoss', 'newConfidence', 'reason'],
      },
      {
        action: 'create_coupon',
        description: 'Create a new discount coupon code',
        requiredFields: ['code', 'discountType (percentage|fixed)', 'discountAmount'],
        optionalFields: ['maxUses', 'maxPerUser', 'expiresAt', 'minPlan'],
      },
      {
        action: 'dismiss_report',
        description: 'Dismiss a support ticket / report',
        requiredFields: ['reportId'],
        optionalFields: ['resolution', 'reason'],
      },
      {
        action: 'deactivate_coupon',
        description: 'Toggle a coupon code active/inactive',
        requiredFields: [],
        optionalFields: ['couponId', 'code', 'isActive (boolean, defaults to toggle)'],
      },
      {
        action: 'warn_user',
        description: 'Send a warning notification + email to a user',
        requiredFields: ['userId'],
        optionalFields: ['reason'],
      },
      {
        action: 'ban_user',
        description: 'Permanently ban a user account',
        requiredFields: ['userId'],
        optionalFields: ['reason'],
      },
      {
        action: 'create_news',
        description: 'Create a news article',
        requiredFields: ['title', 'source'],
        optionalFields: ['summary', 'content', 'url', 'sentiment', 'taggedAssets', 'category', 'publishedAt'],
      },
      {
        action: 'delete_news',
        description: 'Delete a news article',
        requiredFields: ['articleId'],
      },
      {
        action: 'create_event',
        description: 'Create an economic calendar event',
        requiredFields: ['eventName', 'eventDate', 'currency'],
        optionalFields: ['impactLevel', 'previousValue', 'forecastValue', 'actualValue', 'eventType', 'description'],
      },
      {
        action: 'delete_event',
        description: 'Delete an economic calendar event',
        requiredFields: ['eventId'],
      },
      {
        action: 'unban_user',
        description: 'Reinstate a banned/suspended user account',
        requiredFields: ['userId'],
      },
      {
        action: 'settle_broker_copy',
        description: 'Mark all due copy-trading profit share for a provider as paid into their broker account',
        requiredFields: ['targetUserId'],
      },
      {
        action: 'log_ad_revenue',
        description: 'Manually log ad revenue (e.g. from Google AdSense) into the payout ledger',
        requiredFields: ['amount'],
      },
    ],
    note: 'POST to this endpoint with { action, ...fields } to execute.',
  })
}

// ─── Action: Settle copy-trading broker profit share ──────────────────────────
async function handleSettleBrokerCopy(adminId: string, body: any) {
  const { targetUserId } = body
  if (!targetUserId) return errorResponse('targetUserId required', 400)

  const result = await ManagedCopyService.settleProviderFeesToBroker(targetUserId)
  await logAdminAction(adminId, 'SETTLE_BROKER_COPY', { targetUserId, ...result })
  return successResponse(result)
}

// ─── Action: Log manual ad revenue ──────────────────────────────────────────
async function handleLogAdRevenue(adminId: string, body: any) {
  const { amount, currency, reference, description } = body
  const numAmount = Number(amount)
  if (!Number.isFinite(numAmount) || numAmount <= 0) return errorResponse('A positive amount is required', 400)

  const earning = await db.platformEarning.create({
    data: {
      source: 'ads_revenue',
      amount: numAmount,
      currency: currency || 'USD',
      reference: reference || `ad_revenue_${Date.now()}`,
    },
  })

  await logAdminAction(adminId, 'LOG_AD_REVENUE', {
    earningId: earning.id,
    amount: numAmount,
    currency: earning.currency,
    reference: earning.reference,
    description: description || null,
  })

  return successResponse({ earning, message: `Logged $${numAmount} ad revenue` })
}
