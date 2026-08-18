import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

// DELETE /api/account/delete
// GDPR / CCPA: permanent erasure of the authenticated account and ALL related
// personal data. Runs in a single transaction so either everything is removed
// or nothing is.
export async function DELETE(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) {
      return errorResponse('Account not found', 404)
    }

    // Children are deleted before their parents because SQLite enforces
    // foreign keys. Signal.userId is nullable so existing signals are
    // preserved (SetNull) — historical market signals are not personal data.
    // PostLike and Comment on the user's posts must also be cleaned up
    // (other users' references to the user's posts).
    await db.$transaction([
      db.directMessage.deleteMany({
        where: { conversation: { OR: [{ participant1Id: userId }, { participant2Id: userId }] } },
      }),
      db.conversation.deleteMany({
        where: { OR: [{ participant1Id: userId }, { participant2Id: userId }] },
      }),
      db.groupMember.deleteMany({
        where: { OR: [{ userId }, { group: { ownerId: userId } }] },
      }),
      db.group.deleteMany({ where: { ownerId: userId } }),
      db.competitionEntry.deleteMany({
        where: { OR: [{ userId }, { competition: { creatorId: userId } }] },
      }),
      db.competition.deleteMany({ where: { creatorId: userId } }),
      db.postLike.deleteMany({ where: { post: { userId } } }),
      db.comment.deleteMany({ where: { post: { userId } } }),
      db.postLike.deleteMany({ where: { userId } }),
      db.comment.deleteMany({ where: { userId } }),
      db.post.deleteMany({ where: { userId } }),
      db.backtestTrade.deleteMany({ where: { backtest: { userId } } }),
      db.backtest.deleteMany({ where: { userId } }),
      db.copyTrade.deleteMany({ where: { OR: [{ followerId: userId }, { traderId: userId }] } }),
      db.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followingId: userId }] } }),
      db.order.deleteMany({ where: { userId } }),
      db.analysis.deleteMany({ where: { userId } }),
      db.screenshotAnalysis.deleteMany({ where: { userId } }),
      db.watchlist.deleteMany({ where: { userId } }),
      db.priceAlert.deleteMany({ where: { userId } }),
      db.customAlert.deleteMany({ where: { userId } }),
      db.signalFilter.deleteMany({ where: { userId } }),
      db.notification.deleteMany({ where: { userId } }),
      db.activityLog.deleteMany({ where: { userId } }),
      db.userBadge.deleteMany({ where: { userId } }),
      db.bookmarkedArticle.deleteMany({ where: { userId } }),
      db.calendarReminder.deleteMany({ where: { userId } }),
      db.signalComment.deleteMany({ where: { userId } }),
      db.signalReaction.deleteMany({ where: { userId } }),
      db.supportTicket.deleteMany({ where: { userId } }),
      db.paymentTransaction.deleteMany({ where: { userId } }),
      db.referralReward.deleteMany({ where: { OR: [{ userId }, { referredUserId: userId }] } }),
      db.educationProgress.deleteMany({ where: { userId } }),
      db.consentRecord.deleteMany({ where: { userId } }),
      db.paperTrade.deleteMany({ where: { userId } }),
      db.pricePrediction.deleteMany({ where: { userId } }),
      db.patternDetection.deleteMany({ where: { userId } }),
      db.strategy.deleteMany({ where: { userId } }),
      db.pushSubscription.deleteMany({ where: { userId } }),
      db.biometricCredential.deleteMany({ where: { userId } }),
      db.user.delete({ where: { id: userId } }),
    ])

    return successResponse({ deleted: true })
  } catch (error) {
    console.error('Account delete error:', error)
    return errorResponse('Failed to delete account', 500)
  }
}
