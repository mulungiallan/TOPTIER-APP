import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { CopyTradingService } from '@/lib/services/social'
import { ManagedCopyService } from '@/lib/services/managed-copy'
import { isReferralUnlocked, REFERRAL_LOCK_MESSAGE } from '@/lib/referral-gate'

// GET /api/copy-trading — following/followers/trades/providers/provider/settlements/manager
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'following'

    let data
    if (view === 'followers') {
      data = await CopyTradingService.getFollowers(userId)
    } else if (view === 'trades') {
      data = await CopyTradingService.getCopyTrades(userId)
    } else if (view === 'providers') {
      data = await CopyTradingService.listProviders()
    } else if (view === 'provider') {
      data = await CopyTradingService.getProvider(userId)
    } else if (view === 'settlements') {
      data = await CopyTradingService.getMySettlements(userId)
    } else if (view === 'manager') {
      data = await ManagedCopyService.getManagerDashboard(userId)
    } else {
      data = await CopyTradingService.getFollowing(userId)
    }
    return successResponse({ data })
  } catch (error) {
    console.error('Copy trading GET error:', error)
    return errorResponse('Failed to fetch copy trading data', 500)
  }
}

// POST /api/copy-trading — follow / unfollow / copy / provider / close / manager / allocation
//   + risk management: rebalance / reconcile / resume-hardstop
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    if (!(await isReferralUnlocked(userId))) {
      return errorResponse(REFERRAL_LOCK_MESSAGE, 403)
    }

    const body = await request.json()
    const { action, traderId, autoCopy, copyRatio, maxPositionSize, trade } = body

    if (action === 'follow') {
      const result = await CopyTradingService.followTrader(userId, traderId, {
        autoCopy,
        copyRatio,
        maxPositionSize,
        declaredBalanceUsd: body.declaredBalanceUsd != null ? Number(body.declaredBalanceUsd) : undefined,
        connectionId: body.connectionId || undefined,
        termsAccepted: body.termsAccepted === true,
      })
      return successResponse({ follow: result }, 201)
    }
    if (action === 'unfollow') {
      if (!traderId) return errorResponse('traderId is required', 400)
      const result = await CopyTradingService.unfollowTrader(userId, traderId, body.closeOpenTrades === true)
      return successResponse(result)
    }
    if (action === 'copy') {
      if (!traderId) return errorResponse('traderId is required', 400)
      const result = await CopyTradingService.copyTrade(userId, traderId, trade)
      return successResponse({ copyTrade: result }, 201)
    }
    if (action === 'provider') {
      const result = await CopyTradingService.upsertProvider(userId, {
        handle: body.handle,
        bio: body.bio,
        copyFeePct: body.copyFeePct,
      })
      return successResponse({ provider: result }, 201)
    }
    if (action === 'close') {
      const exitPrice = Number(body.exitPrice)
      if (!Number.isFinite(exitPrice)) return errorResponse('A valid exit price is required', 400)
      const result = await CopyTradingService.closeCopyTrade(userId, body.copyTradeId, exitPrice)
      return successResponse(result)
    }

    // ── PAMM/MAM managed-account actions ────────────────────────────────
    if (action === 'manager') {
      if (!body.connectionId) return errorResponse('connectionId is required', 400)
      const result = await ManagedCopyService.registerManager(userId, {
        connectionId: body.connectionId,
        profitSharePct: body.profitSharePct != null ? Number(body.profitSharePct) : undefined,
        brokerSettled: body.brokerSettled != null ? Boolean(body.brokerSettled) : undefined,
        minAllocationPct: body.minAllocationPct != null ? Number(body.minAllocationPct) : undefined,
        maxAllocationPct: body.maxAllocationPct != null ? Number(body.maxAllocationPct) : undefined,
        minAccountBalanceUsd: body.minAccountBalanceUsd != null ? Number(body.minAccountBalanceUsd) : undefined,
        lotsPer100Usd: body.lotsPer100Usd != null ? Number(body.lotsPer100Usd) : undefined,
        brokerAccountLabel: body.brokerAccountLabel,
        brokerAccountLogin: body.brokerAccountLogin,
        // Risk management settings
        maxRiskPerTradePct: body.maxRiskPerTradePct != null ? Number(body.maxRiskPerTradePct) : undefined,
        maxConcurrentTrades: body.maxConcurrentTrades != null ? Number(body.maxConcurrentTrades) : undefined,
        marginBudgetPct: body.marginBudgetPct != null ? Number(body.marginBudgetPct) : undefined,
        drawdownSoftPausePct: body.drawdownSoftPausePct != null ? Number(body.drawdownSoftPausePct) : undefined,
        accountWideHardStopPct: body.accountWideHardStopPct != null ? Number(body.accountWideHardStopPct) : undefined,
        maxSymbolExposurePct: body.maxSymbolExposurePct != null ? Number(body.maxSymbolExposurePct) : undefined,
        maxAssetClassExposurePct: body.maxAssetClassExposurePct != null ? Number(body.maxAssetClassExposurePct) : undefined,
        weekendCryptoCapPct: body.weekendCryptoCapPct != null ? Number(body.weekendCryptoCapPct) : undefined,
        newsBlackoutMinutes: body.newsBlackoutMinutes != null ? Number(body.newsBlackoutMinutes) : undefined,
        // Per-asset-class sizing
        forexBaseLotsPer100Usd: body.forexBaseLotsPer100Usd != null ? Number(body.forexBaseLotsPer100Usd) : undefined,
        forexMinLotSize: body.forexMinLotSize != null ? Number(body.forexMinLotSize) : undefined,
        forexMaxLots: body.forexMaxLots != null ? Number(body.forexMaxLots) : undefined,
        forexMaxRiskPct: body.forexMaxRiskPct != null ? Number(body.forexMaxRiskPct) : undefined,
        metalsBaseLotsPer100Usd: body.metalsBaseLotsPer100Usd != null ? Number(body.metalsBaseLotsPer100Usd) : undefined,
        metalsMinLotSize: body.metalsMinLotSize != null ? Number(body.metalsMinLotSize) : undefined,
        metalsMaxLots: body.metalsMaxLots != null ? Number(body.metalsMaxLots) : undefined,
        metalsMaxRiskPct: body.metalsMaxRiskPct != null ? Number(body.metalsMaxRiskPct) : undefined,
        cryptoBaseLotsPer100Usd: body.cryptoBaseLotsPer100Usd != null ? Number(body.cryptoBaseLotsPer100Usd) : undefined,
        cryptoMinLotSize: body.cryptoMinLotSize != null ? Number(body.cryptoMinLotSize) : undefined,
        cryptoMaxLots: body.cryptoMaxLots != null ? Number(body.cryptoMaxLots) : undefined,
        cryptoMaxRiskPct: body.cryptoMaxRiskPct != null ? Number(body.cryptoMaxRiskPct) : undefined,
      })
      return successResponse({ manager: result }, 201)
    }
    if (action === 'unlink-manager') {
      await ManagedCopyService.unlinkManager(userId)
      return successResponse({ unlinked: true })
    }
    if (action === 'allocation') {
      if (!traderId) return errorResponse('traderId is required', 400)
      const pct = Number(body.allocationPct)
      if (!Number.isFinite(pct)) return errorResponse('A valid allocationPct is required', 400)
      const result = await ManagedCopyService.setAllocation(userId, traderId, pct, {
        declaredBalanceUsd: body.declaredBalanceUsd != null ? Number(body.declaredBalanceUsd) : undefined,
        termsAccepted: body.termsAccepted === true,
      })
      return successResponse({ follow: result }, 201)
    }
    if (action === 'settle-broker') {
      const result = await ManagedCopyService.settleProviderFeesToBroker(userId)
      return successResponse(result)
    }
    if (action === 'pause' || action === 'resume') {
      if (!traderId) return errorResponse('traderId is required', 400)
      const result = await ManagedCopyService.setFollowStatus(userId, traderId, action === 'pause' ? 'paused' : 'active')
      return successResponse({ follow: result })
    }

    // ── Risk management actions ─────────────────────────────────────────

    // Rule #6: Trigger monthly rebalancing
    if (action === 'rebalance') {
      const result = await ManagedCopyService.rebalanceProvider(userId)
      return successResponse(result)
    }

    // Rule #7: Trigger daily reconciliation / drift check
    if (action === 'reconcile') {
      const result = await ManagedCopyService.reconcileDrift(userId)
      return successResponse(result)
    }

    // Rule #5: Resume after account-wide hard stop (requires manual review)
    if (action === 'resume-hardstop') {
      const result = await ManagedCopyService.resumeAfterHardStop(userId)
      return successResponse(result)
    }

    return errorResponse('Invalid action', 400)
  } catch (error) {
    console.error('Copy trading POST error:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to perform copy trading action', 500)
  }
}
