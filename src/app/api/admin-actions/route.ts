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
import { requirePermission, ADMIN_ROLES, adminCan } from '@/lib/admin-permissions'
import { ManagedCopyService } from '@/lib/services/managed-copy'
import { escapeHtml } from '@/lib/security'
import { fireOps } from '@/lib/ops-notify'

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

function permForAction(action: string): string | null {
  const map: Record<string, string> = {
    impersonate: 'impersonate',
    run_job: 'system.jobs',
    suspend_user: 'users.write',
    warn_user: 'users.write',
    ban_user: 'users.write',
    unban_user: 'users.write',
    bulk_action: 'users.write',
    set_user_role: 'users.admin',
    reset_user_2fa: 'users.write',
    force_logout: 'users.admin',
    delete_user: 'users.gdpr',
    set_subscription: 'users.admin',
    generate_signal: 'signals.write',
    override_signal: 'signals.write',
    expire_signals: 'signals.write',
    approve_payout: 'payments.payout',
    reject_payout: 'payments.payout',
    mark_payout_paid: 'payments.payout',
    refund_transaction: 'payments.write',
    record_earning: 'payments.write',
    log_ad_revenue: 'payments.write',
    create_coupon: 'content.write',
    bulk_create_coupons: 'content.write',
    deactivate_coupon: 'content.write',
    dismiss_report: 'tickets.manage',
    ticket_assign: 'tickets.manage',
    ticket_reply: 'tickets.manage',
    approve_review: 'content.write',
    reject_review: 'content.write',
    create_news: 'content.write',
    delete_news: 'content.write',
    create_event: 'content.write',
    delete_event: 'content.write',
    process_data_deletion: 'users.gdpr',
    settle_broker_copy: 'payments.write',
  }
  return map[action] ?? null
}

export async function POST(request: NextRequest) {
  try {
    const { error, user } = await requireAdmin(request)
    if (error) return error
    if (!user) return errorResponse('Forbidden: Admin access required', 403)

    const body = await request.json()
    const { action } = body
    const adminId = user.id

    // RBAC gate: every action maps to a permission; the admin's role must hold it.
    const actionPerm = permForAction(action)
    if (actionPerm && !adminCan(user.role, actionPerm as any)) {
      return errorResponse(`Forbidden: role "${user.role}" lacks permission "${actionPerm}"`, 403)
    }

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
      // ── RBAC / account management (files: admin-permissions) ──
      case 'set_user_role':
        return await handleSetUserRole(adminId, body)
      case 'reset_user_2fa':
        return await handleResetUser2fa(adminId, body)
      case 'force_logout':
        return await handleForceLogout(adminId, body)
      case 'delete_user':
        return await handleDeleteUser(adminId, body)
      case 'set_subscription':
        return await handleSetSubscription(adminId, body)
      case 'bulk_action':
        return await handleBulkAction(adminId, body)
      // ── Payments / ledger ──
      case 'approve_payout':
        return await handleApprovePayout(adminId, body)
      case 'reject_payout':
        return await handleRejectPayout(adminId, body)
      case 'mark_payout_paid':
        return await handleMarkPayoutPaid(adminId, body)
      case 'refund_transaction':
        return await handleRefundTransaction(adminId, body)
      case 'record_earning':
        return await handleRecordEarning(adminId, body)
      // ── Trading ops ──
      case 'expire_signals':
        return await handleExpireSignals(adminId, body)
      case 'run_job':
        return await handleRunJob(adminId, body)
      // ── Content / support ──
      case 'bulk_create_coupons':
        return await handleBulkCreateCoupons(adminId, body)
      case 'ticket_assign':
        return await handleTicketAssign(adminId, body)
      case 'ticket_reply':
        return await handleTicketReply(adminId, body)
      case 'approve_review':
        return await handleReviewModeration(adminId, body, 'approved')
      case 'reject_review':
        return await handleReviewModeration(adminId, body, 'rejected')
      // ── Compliance ──
      case 'process_data_deletion':
        return await handleProcessDataDeletion(adminId, body)
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
      tokenVersion: { increment: 1 },
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
      tokenVersion: { increment: 1 },
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
      {
        action: 'set_user_role',
        description: 'Change a user role (owner/super_admin/admin/moderator/support/analyst/read_only)',
        requiredFields: ['userId', 'role'],
        optionalFields: ['reason'],
      },
      {
        action: 'reset_user_2fa',
        description: 'Clear a user two-factor secret and force re-setup',
        requiredFields: ['userId'],
        optionalFields: ['reason'],
      },
      {
        action: 'force_logout',
        description: 'Invalidate a user sessions everywhere',
        requiredFields: ['userId'],
        optionalFields: ['reason'],
      },
      {
        action: 'delete_user',
        description: 'Soft-delete a user account and open/approve a GDPR deletion request',
        requiredFields: ['userId'],
        optionalFields: ['reason'],
      },
      {
        action: 'set_subscription',
        description: 'Grant/adjust a subscription tier and billing window',
        requiredFields: ['userId'],
        optionalFields: ['tier', 'plan', 'startDate', 'endDate'],
      },
      {
        action: 'bulk_action',
        description: 'Apply ban|suspend|unban|warn to many users at once',
        requiredFields: ['userIds[]', 'action'],
        optionalFields: ['reason', 'duration (days, for suspend)'],
      },
      {
        action: 'approve_payout',
        description: 'Move a payout request into processing',
        requiredFields: ['payoutId'],
        optionalFields: ['reason'],
      },
      {
        action: 'reject_payout',
        description: 'Reject/fail a payout request',
        requiredFields: ['payoutId'],
        optionalFields: ['reason'],
      },
      {
        action: 'mark_payout_paid',
        description: 'Mark a payout request as paid (with optional tx hash)',
        requiredFields: ['payoutId'],
        optionalFields: ['txHash'],
      },
      {
        action: 'refund_transaction',
        description: 'Refund a payment and write a reverse ledger entry',
        requiredFields: ['transactionId'],
        optionalFields: ['reason'],
      },
      {
        action: 'record_earning',
        description: 'Manually record a platform earning (premium_payment|copy_fee|bot_profit_share|referral_revenue|ads_revenue)',
        requiredFields: ['source', 'amount'],
        optionalFields: ['currency', 'reference'],
      },
      {
        action: 'expire_signals',
        description: 'Expire all active signals past their expiry date',
      },
      {
        action: 'run_job',
        description: 'Run a background job manually (signals|expire|prune_notifications)',
        requiredFields: ['job'],
      },
      {
        action: 'bulk_create_coupons',
        description: 'Generate many coupon codes at once',
        requiredFields: ['count', 'discountType', 'discountAmount'],
        optionalFields: ['prefix', 'maxUses', 'expiresAt', 'minPlan'],
      },
      {
        action: 'ticket_assign',
        description: 'Set priority/status/assignee on a support ticket',
        requiredFields: ['ticketId'],
        optionalFields: ['priority', 'status', 'assigneeId'],
      },
      {
        action: 'ticket_reply',
        description: 'Reply to a support ticket (notifies the user)',
        requiredFields: ['ticketId', 'message'],
      },
      {
        action: 'approve_review',
        description: 'Approve a community review',
        requiredFields: ['reviewId'],
        optionalFields: ['reason'],
      },
      {
        action: 'reject_review',
        description: 'Reject a community review',
        requiredFields: ['reviewId'],
        optionalFields: ['reason'],
      },
      {
        action: 'process_data_deletion',
        description: 'Approve or reject a GDPR data-deletion request',
        requiredFields: ['requestId', 'action'],
        optionalFields: ['reason'],
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

// ─── RBAC / account management ───────────────────────────────────────────────

async function handleSetUserRole(adminId: string, body: any) {
  const { userId, role, reason } = body
  if (!userId) return errorResponse('userId required', 400)
  if (!ADMIN_ROLES.includes(role)) return errorResponse(`role must be one of: ${ADMIN_ROLES.join(', ')}`, 400)

  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return errorResponse('User not found', 404)
  if (target.role === 'owner') return errorResponse('Cannot change the owner role', 403)
  if (target.role === 'super_admin') return errorResponse('Protected account', 403)
  const requester = await db.user.findUnique({ where: { id: adminId }, select: { role: true } })
  if ((role === 'super_admin' || role === 'owner') && requester?.role !== 'super_admin' && requester?.role !== 'owner') {
    return errorResponse('Only super_admin or owner can grant super_admin/owner roles', 403)
  }

  await db.user.update({ where: { id: userId }, data: { role } })
  await logAdminAction(adminId, 'SET_USER_ROLE', { targetUserId: userId, from: target.role, to: role, reason: reason || null })
  fireOps('Role changed', { adminId, userId, from: target.role, to: role })

  return successResponse({ userId, role, from: target.role })
}

async function handleResetUser2fa(adminId: string, body: any) {
  const { userId, reason } = body
  if (!userId) return errorResponse('userId required', 400)
  const target = await db.user.update({
    where: { id: userId },
    data: { twoFactorSecret: null, twoFactorEnabled: false },
    select: { id: true, email: true, twoFactorEnabled: true },
  })
  await notifyUser(userId, {
    type: 'system',
    title: '2FA Reset',
    message: 'Your two-factor authentication was reset by support. Please re-enable it from your profile settings.',
    actionUrl: '/settings',
  })
  await logAdminAction(adminId, 'RESET_USER_2FA', { targetUserId: userId, reason: reason || null })
  return successResponse(target)
}

async function handleForceLogout(adminId: string, body: any) {
  const { userId, reason } = body
  if (!userId) return errorResponse('userId required', 400)
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isBanned: true } })
  if (!target) return errorResponse('User not found', 404)

  await db.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  })
  const pushed = await notifyUser(userId, {
    type: 'system',
    title: 'Signed out from all devices',
    message: 'Your session was ended by support. Please sign in again.',
    actionUrl: '/login',
  })
  await logAdminAction(adminId, 'FORCE_LOGOUT', { targetUserId: userId, reason: reason || null })
  return successResponse({ userId: target.id, notified: pushed.delivered })
}

async function handleDeleteUser(adminId: string, body: any) {
  const { userId, reason } = body
  if (!userId) return errorResponse('userId required', 400)
  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return errorResponse('User not found', 404)
  if (adminCan(target.role, 'panel.access')) return errorResponse('Cannot delete an admin account', 403)

  // Soft-delete + revoke sessions + open GDPR request (keyed by email).
  await db.user.update({
    where: { id: userId },
    data: { deletedAt: new Date(), isBanned: true, tokenVersion: { increment: 1 } },
  })
  await db.dataDeletionRequest.upsert({
    where: { id: `pending_${target.email}` as any },
    update: { status: 'completed' },
    create: { email: target.email, status: 'completed', reason },
  }).catch(async () => {
    // Email may not have a unique constraint; create a fresh one if upsert fails.
    await db.dataDeletionRequest.create({
      data: { email: target.email, status: 'completed', reason },
    })
  })
  await logAdminAction(adminId, 'DELETE_USER', { targetUserId: userId, reason: reason || null })
  fireOps('User deleted', { adminId, userId, email: target.email })

  return successResponse({ deleted: true, userId })
}

async function handleSetSubscription(adminId: string, body: any) {
  const { userId, tier, plan, startDate, endDate } = body
  if (!userId) return errorResponse('userId required', 400)
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
  if (!target) return errorResponse('User not found', 404)

  const data: Record<string, unknown> = { updatedAt: new Date() }
  if (tier) data.subscriptionTier = tier
  if (plan) data.plan = plan
  const start = startDate ? new Date(startDate) : null
  const end = endDate ? new Date(endDate) : null
  if (start) {
    data.trialStartDate = start
    data.subscriptionStartDate = start
  }
  if (end) data.subscriptionEndDate = end

  const updated = await db.user.update({ where: { id: userId }, data, select: { id: true, email: true, subscriptionTier: true, plan: true } })
  await notifyUser(userId, {
    type: 'subscription',
    title: 'Account plan updated',
    message: `Your account plan was updated by support to ${tier || plan}.`,
    actionUrl: '/pricing',
  })
  await logAdminAction(adminId, 'SET_SUBSCRIPTION', { targetUserId: userId, tier: tier || null, plan: plan || null, endDate: end ? end.toISOString() : null })
  return successResponse(updated)
}

async function handleBulkAction(adminId: string, body: any) {
  const { userIds, action, reason, duration } = body
  const ids: string[] = Array.isArray(userIds) ? userIds.filter(Boolean) : []
  if (ids.length === 0) return errorResponse('userIds[] required', 400)
  if (!['ban', 'suspend', 'unban', 'warn'].includes(action)) return errorResponse('action must be ban|suspend|unban|warn', 400)

  const targets = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, role: true } })
  const safe = targets.filter((t) => !adminCan(t.role, 'panel.access'))
  const excluded = targets.length - safe.length

  if (action === 'ban') {
    await db.user.updateMany({
      where: { id: { in: safe.map((t) => t.id) } },
      data: { isBanned: true, banReason: `BANNED | Reason: ${reason || 'Bulk ban'}` },
    })
    for (const t of safe) {
      await notifyUser(t.id, { type: 'system', title: 'Account Banned', message: `Your account has been banned. Reason: ${reason || 'Violation of terms'}`, actionUrl: '/support' }).catch(() => {})
    }
    await db.user.updateMany({ where: { id: { in: safe.map((t) => t.id) } }, data: { tokenVersion: { increment: 1 } } })
  } else if (action === 'suspend') {
    const days = parseInt(duration) || 7
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    await db.user.updateMany({
      where: { id: { in: safe.map((t) => t.id) } },
      data: { isBanned: true, banReason: `SUSPENDED until ${until.toISOString()} | Reason: ${reason || 'Bulk suspension'}` },
    })
    for (const t of safe) {
      await notifyUser(t.id, { type: 'system', title: 'Account Suspended', message: `Your account was suspended for ${days} days. Reason: ${reason || 'Violation of terms'}`, actionUrl: '/support' }).catch(() => {})
    }
  } else if (action === 'unban') {
    await db.user.updateMany({
      where: { id: { in: safe.map((t) => t.id) } },
      data: { isBanned: false, banReason: null },
    })
  } else if (action === 'warn') {
    for (const t of safe) {
      await notifyUser(t.id, { type: 'system', title: 'Warning from TOPTIER Team', message: reason || 'You have received a warning.', actionUrl: '/support' }).catch(() => {})
    }
  }

  await logAdminAction(adminId, 'BULK_ACTION', { action, count: safe.length, excluded, reason: reason || null, userIds: safe.map((t) => t.id) })
  return successResponse({ action, applied: safe.length, excluded })
}

// ─── Payments / ledger ───────────────────────────────────────────────────────

async function handleApprovePayout(adminId: string, body: any) {
  const { payoutId, reason } = body
  if (!payoutId) return errorResponse('payoutId required', 400)
  const req = await db.payoutRequest.findUnique({ where: { id: payoutId } })
  if (!req) return errorResponse('Payout request not found', 404)

  const updated = await db.payoutRequest.update({ where: { id: payoutId }, data: { status: 'processing' } })
  await logAdminAction(adminId, 'APPROVE_PAYOUT', { payoutId, amount: req.amount, reason: reason || null })
  fireOps('Payout approved', { adminId, payoutId, amount: req.amount, method: req.method })

  return successResponse(updated)
}

async function handleRejectPayout(adminId: string, body: any) {
  const { payoutId, reason } = body
  if (!payoutId) return errorResponse('payoutId required', 400)
  const req = await db.payoutRequest.findUnique({ where: { id: payoutId } })
  if (!req) return errorResponse('Payout request not found', 404)
  if (req.status === 'paid') return errorResponse('Cannot reject an already-paid payout', 400)

  const updated = await db.payoutRequest.update({ where: { id: payoutId }, data: { status: 'failed', failureReason: reason || 'Rejected by admin' } })
  await logAdminAction(adminId, 'REJECT_PAYOUT', { payoutId, amount: req.amount, reason: reason || null })
  fireOps('Payout rejected', { adminId, payoutId, amount: req.amount, reason: reason || null })

  return successResponse(updated)
}

async function handleMarkPayoutPaid(adminId: string, body: any) {
  const { payoutId, txHash } = body
  if (!payoutId) return errorResponse('payoutId required', 400)
  const req = await db.payoutRequest.findUnique({ where: { id: payoutId } })
  if (!req) return errorResponse('Payout request not found', 404)

  const updated = await db.payoutRequest.update({
    where: { id: payoutId },
    data: { status: 'paid', txHash: txHash || null, paidAt: new Date() },
  })
  await logAdminAction(adminId, 'MARK_PAYOUT_PAID', { payoutId, txHash: txHash || null })
  return successResponse(updated)
}

async function handleRefundTransaction(adminId: string, body: any) {
  const { transactionId, reason } = body
  if (!transactionId) return errorResponse('transactionId required', 400)
  const tx = await db.paymentTransaction.findUnique({ where: { id: transactionId } })
  if (!tx) return errorResponse('Transaction not found', 404)
  if (tx.status === 'refunded') return errorResponse('Transaction already refunded', 400)

  const [updated, earning] = await db.$transaction([
    db.paymentTransaction.update({ where: { id: transactionId }, data: { status: 'refunded' } }),
    db.platformEarning.create({ data: { source: 'premium_payment', amount: -tx.amount, currency: tx.currency, reference: `refund_${transactionId}`, status: 'available' } }),
  ])

  await notifyUser(tx.userId, {
    type: 'system',
    title: 'Refund issued',
    message: `A refund of ${tx.currency} ${tx.amount} was issued for your payment. ${reason || ''}`.trim(),
    actionUrl: '/support',
  }).catch(() => {})

  await logAdminAction(adminId, 'REFUND_TRANSACTION', { transactionId, amount: tx.amount, reason: reason || null })
  fireOps('Refund issued', { adminId, transactionId, userId: tx.userId, amount: tx.amount })

  return successResponse({ transaction: updated, ledgerEarningId: earning.id })
}

async function handleRecordEarning(adminId: string, body: any) {
  const { source, amount, currency, reference } = body
  if (!source || !amount) return errorResponse('source and amount required', 400)
  const num = Number(amount)
  if (!Number.isFinite(num)) return errorResponse('Invalid amount', 400)
  const allowed = ['premium_payment', 'copy_fee', 'bot_profit_share', 'referral_revenue', 'ads_revenue']
  if (!allowed.includes(source)) return errorResponse(`source must be one of: ${allowed.join(', ')}`, 400)

  const earning = await db.platformEarning.create({
    data: { source, amount: num, currency: currency || 'USD', reference: reference || `manual_${Date.now()}` },
  })
  await logAdminAction(adminId, 'RECORD_EARNING', { earningId: earning.id, source, amount: num })
  return successResponse(earning)
}

// ─── Trading ops ─────────────────────────────────────────────────────────────

async function handleExpireSignals(adminId: string, body: any) {
  const res = await db.signal.updateMany({
    where: { status: 'active', expiryDate: { lte: new Date() } },
    data: { status: 'expired', resolvedAt: new Date() },
  })
  await logAdminAction(adminId, 'EXPIRE_SIGNALS', { count: res.count })
  return successResponse({ expired: res.count })
}

async function handleRunJob(adminId: string, body: any) {
  const job = String(body.job || '')
  const startedAt = Date.now()
  let output: Record<string, unknown> = {}

  if (job === 'signals') {
    const { signalGenerator } = await import('@/lib/services/signal-generator')
    const ok = await signalGenerator.ensureSignals(true)
    output = { ok }
  } else if (job === 'expire') {
    const res = await db.signal.updateMany({ where: { status: 'active', expiryDate: { lte: new Date() } }, data: { status: 'expired' } })
    output = { expired: res.count }
  } else if (job === 'prune_notifications') {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const res = await db.notification.deleteMany({ where: { createdAt: { lt: cutoff }, isRead: true } })
    output = { deleted: res.count }
  } else if (job === 'bots_sync') {
    output = { note: 'Bot instances sync happens via the MT5 service; nothing to run server-side.' }
  } else {
    return errorResponse(`Unknown job: ${job}`, 400)
  }

  const ms = Date.now() - startedAt
  await logAdminAction(adminId, 'RUN_JOB', { job, ms, output })
  return successResponse({ job, ok: true, ms, output })
}

// ─── Content / support ───────────────────────────────────────────────────────

async function handleBulkCreateCoupons(adminId: string, body: any) {
  const { count, prefix, discountType, discountAmount, maxUses, expiresAt, minPlan } = body
  const n = Math.min(parseInt(count) || 1, 200)
  if (!discountType || !discountAmount) return errorResponse('discountType and discountAmount required', 400)

  const created: string[] = []
  const pre = String(prefix || 'TOPTIER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  for (let i = 0; i < n; i++) {
    const code = `${pre}-${Math.random().toString(36).toUpperCase().slice(2, 8)}`
    await db.couponCode.create({
      data: {
        code,
        discountType,
        discountAmount: parseFloat(discountAmount),
        maxUses: maxUses ? parseInt(maxUses) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        minPlan: minPlan || null,
        isActive: true,
      },
    })
    created.push(code)
  }
  await logAdminAction(adminId, 'BULK_CREATE_COUPONS', { count: created.length, discountType, discountAmount })
  return successResponse({ created })
}

async function handleTicketAssign(adminId: string, body: any) {
  const { ticketId, priority, status, assigneeId } = body
  if (!ticketId) return errorResponse('ticketId required', 400)
  const ticket = await db.supportTicket.findUnique({ where: { id: ticketId } })
  if (!ticket) return errorResponse('Ticket not found', 404)

  const data: Record<string, unknown> = {}
  if (priority && ['low', 'medium', 'high', 'critical'].includes(priority)) data.priority = priority
  if (status && ['open', 'in_progress', 'resolved', 'closed'].includes(status)) data.status = status
  if (assigneeId) {
    const assignee = await db.user.findUnique({ where: { id: assigneeId }, select: { id: true, name: true, email: true } })
    if (!assignee) return errorResponse('Assignee not found', 404)
  }
  await db.supportTicket.update({ where: { id: ticketId }, data })

  await logAdminAction(adminId, 'TICKET_ASSIGN', { ticketId, priority: priority || null, status: status || null, assigneeId: assigneeId || null })
  return successResponse({ ticketId, ...data })
}

async function handleTicketReply(adminId: string, body: any) {
  const { ticketId, message } = body
  if (!ticketId) return errorResponse('ticketId required', 400)
  if (!message || !String(message).trim()) return errorResponse('message required', 400)
  const ticket = await db.supportTicket.findUnique({ where: { id: ticketId } })
  if (!ticket) return errorResponse('Ticket not found', 404)

  await db.supportTicket.update({ where: { id: ticketId }, data: { status: 'in_progress' } })
  const pushed = await notifyUser(ticket.userId, {
    type: 'system',
    title: `Support response: ${ticket.subject}`,
    message: String(message).slice(0, 500),
    actionUrl: '/support',
  })
  if (ticket.status === 'open') {
    await db.supportTicket.update({ where: { id: ticketId }, data: { status: 'in_progress' } })
  }

  await logAdminAction(adminId, 'TICKET_REPLY', { ticketId, message: String(message).slice(0, 300) })
  return successResponse({ replied: true, notified: pushed.delivered })
}

async function handleReviewModeration(adminId: string, body: any, next: 'approved' | 'rejected') {
  const { reviewId, reason } = body
  if (!reviewId) return errorResponse('reviewId required', 400)
  const review = await db.review.findUnique({ where: { id: reviewId } })
  if (!review) return errorResponse('Review not found', 404)

  const updated = await db.review.update({ where: { id: reviewId }, data: { status: next } })
  await notifyUser(review.userId, {
    type: 'system',
    title: next === 'approved' ? 'Your review was approved' : 'Your review was rejected',
    message: next === 'approved' ? 'Your review is now public.' : `Your review was not approved. ${reason || ''}`.trim(),
    actionUrl: '/community',
  }).catch(() => {})
  await logAdminAction(adminId, next === 'approved' ? 'APPROVE_REVIEW' : 'REJECT_REVIEW', { reviewId, reason: reason || null })

  return successResponse(updated)
}

// ─── Compliance ──────────────────────────────────────────────────────────────

async function handleProcessDataDeletion(adminId: string, body: any) {
  const { requestId, action, reason } = body
  if (!requestId) return errorResponse('requestId required', 400)
  if (!['approve', 'reject'].includes(action)) return errorResponse('action must be approve|reject', 400)

  const req = await db.dataDeletionRequest.findUnique({ where: { id: requestId } })
  if (!req) return errorResponse('Request not found', 404)

  if (action === 'approve') {
    // Find the requesting user by email.
    const requestingUser = await db.user.findFirst({ where: { email: req.email, deletedAt: null } })
    if (requestingUser) {
      await db.user.update({
        where: { id: requestingUser.id },
        data: { deletedAt: new Date(), isBanned: true, tokenVersion: { increment: 1 } },
      })
    }
    await db.dataDeletionRequest.update({ where: { id: requestId }, data: { status: 'completed', reason: reason || null } })
    fireOps('GDPR deletion approved', { adminId, requestId })
  } else {
    await db.dataDeletionRequest.update({ where: { id: requestId }, data: { status: 'completed', reason: reason || 'Rejected by admin' } })
  }

  await logAdminAction(adminId, 'PROCESS_DATA_DELETION', { requestId, action, reason: reason || null })
  return successResponse({ requestId, action })
}
