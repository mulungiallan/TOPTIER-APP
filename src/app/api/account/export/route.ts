import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

// GET /api/account/export
// GDPR / CCPA: returns a portable JSON archive of the authenticated user's
// personal data (Art. 20 GDPR — data portability). Sensitive credentials are
// excluded.
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        profilePicture: true,
        dateOfBirth: true,
        country: true,
        role: true,
        subscriptionTier: true,
        plan: true,
        onboardingCompleted: true,
        referralCode: true,
        referredBy: true,
        referralCount: true,
        tradingStyle: true,
        riskLevel: true,
        preferredMarkets: true,
        preferredSessions: true,
        notificationPrefs: true,
        language: true,
        darkMode: true,
        analyticsOptOut: true,
        isEmailVerified: true,
        twoFactorEnabled: true,
        createdAt: true,
      },
    })

    if (!user) {
      return errorResponse('Account not found', 404)
    }

    const [
      signals,
      screenshotAnalyses,
      watchlists,
      priceAlerts,
      customAlerts,
      signalFilters,
      notifications,
      activityLogs,
      badges,
      bookmarkedArticles,
      calendarReminders,
      signalComments,
      signalReactions,
      supportTickets,
      paymentTransactions,
      referralRewards,
      educationProgress,
      consentRecords,
      posts,
      postLikes,
      postComments,
      follows,
      conversations,
      directMessages,
      groupsOwned,
      groupMemberships,
      competitionsCreated,
      competitionEntries,
      paperTrades,
      copyTrades,
      pricePredictions,
      backtests,
      patternDetections,
      strategies,
      pushSubscriptions,
      biometricCredentials,
      orders,
      analyses,
    ] = await Promise.all([
      db.signal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 500 }),
      db.screenshotAnalysis.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      db.watchlist.findMany({
        where: { userId },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.priceAlert.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      db.customAlert.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      db.signalFilter.findMany({ where: { userId }, take: 50 }),
      db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      db.activityLog.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 500 }),
      db.userBadge.findMany({ where: { userId }, take: 100 }),
      db.bookmarkedArticle.findMany({ where: { userId }, take: 200 }),
      db.calendarReminder.findMany({ where: { userId }, take: 200 }),
      db.signalComment.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 500 }),
      db.signalReaction.findMany({ where: { userId }, take: 500 }),
      db.supportTicket.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      db.paymentTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      db.referralReward.findMany({ where: { userId }, take: 100 }),
      db.educationProgress.findMany({ where: { userId }, take: 100 }),
      db.consentRecord.findMany({ where: { userId }, take: 50 }),
      db.post.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 500 }),
      db.postLike.findMany({ where: { userId }, take: 500 }),
      db.comment.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 500 }),
      db.follow.findMany({
        where: { OR: [{ followerId: userId }, { followingId: userId }] },
        take: 500,
      }),
      db.conversation.findMany({
        where: { OR: [{ participant1Id: userId }, { participant2Id: userId }] },
        take: 100,
      }),
      db.directMessage.findMany({
        where: { senderId: userId },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      db.group.findMany({ where: { ownerId: userId }, take: 50 }),
      db.groupMember.findMany({ where: { userId }, take: 100 }),
      db.competition.findMany({ where: { creatorId: userId }, take: 50 }),
      db.competitionEntry.findMany({ where: { userId }, take: 100 }),
      db.paperTrade.findMany({ where: { userId }, orderBy: { openedAt: 'desc' }, take: 200 }),
      db.copyTrade.findMany({
        where: { OR: [{ followerId: userId }, { traderId: userId }] },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      db.pricePrediction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      db.backtest.findMany({
        where: { userId },
        include: { trades: { take: 100 } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.patternDetection.findMany({ where: { userId }, orderBy: { detectedAt: 'desc' }, take: 200 }),
      db.strategy.findMany({ where: { userId }, take: 50 }),
      db.pushSubscription.findMany({ where: { userId }, take: 10 }),
      db.biometricCredential.findMany({ where: { userId }, take: 10 }),
      db.order.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      db.analysis.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ])

    const archive = {
      exportedAt: new Date().toISOString(),
      format: 'TOPTIER data export v1',
      profile: user,
      signals,
      screenshotAnalyses,
      watchlists,
      priceAlerts,
      customAlerts,
      signalFilters,
      notifications,
      activityLogs,
      badges,
      bookmarkedArticles,
      calendarReminders,
      signalComments,
      signalReactions,
      supportTickets,
      paymentTransactions,
      referralRewards,
      educationProgress,
      consentRecords,
      posts,
      postLikes,
      postComments,
      follows,
      conversations,
      directMessages,
      groupsOwned,
      groupMemberships,
      competitionsCreated,
      competitionEntries,
      paperTrades,
      copyTrades,
      pricePredictions,
      backtests,
      patternDetections,
      strategies,
      pushSubscriptions,
      biometricCredentials,
      orders,
      analyses,
    }

    return successResponse(archive)
  } catch (error) {
    console.error('Account export error:', error)
    return errorResponse('Failed to export data', 500)
  }
}
