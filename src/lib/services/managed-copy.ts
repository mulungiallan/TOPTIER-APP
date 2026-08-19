// src/lib/services/managed-copy.ts
// PAMM/MAM-style managed copy trading with advanced risk management.
//
// Implements ALL 7 rules from copytrading feature.txt:
//   1. Risk-normalized position sizing (not lot-normalized)
//   2. Per-provider concurrent trade caps + margin reservation
//   3. Correlation and conflict rules (per-symbol, per-asset-class exposure)
//   4. Time-based rules (weekend/gap, news blackout)
//   5. Drawdown circuit breakers (per-provider soft pause, account-wide hard stop)
//   6. Scheduled rebalancing
//   7. Daily reconciliation / drift detection

import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma'
import {
  computeProgressiveLots, computeRiskNormalizedLots, computeSLDistance,
  computeRiskPct, getAssetClass, getAssetSizingConfig, isWeekendGapWindow,
  isNewsBlackoutWindow, wouldExceedSymbolCap, wouldExceedAssetClassCap,
  computeNetExposure,
} from '@/lib/copy-lots'
import type { AssetClass } from '@/lib/copy-lots'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round2 = (v: number) => Math.round(v * 100) / 100

// ─── Symbol notional approximation ───────────────────────────────────────
// For exposure cap checks: rough USD notional per lot.
// Forex ≈ $100k, metals ≈ $200k, crypto varies widely.
function notionalPerLot(symbol: string): number {
  const cls = getAssetClass(symbol)
  if (cls === 'crypto') return 50000  // conservative for small cryptos
  if (cls === 'metals') return 200000 // XAUUSD ≈ $200k/lot
  return 100000 // standard forex lot
}

export interface MasterTradeEvent {
  ticket: string
  symbol: string
  timeframe?: string | null
  direction: string
  lots: number
  entryPrice: number
  stopLoss?: number | null
  takeProfit?: number | null
  closePrice?: number | null
  profit?: number
  result?: string | null
  openTime?: string | number | Date
  closeTime?: string | number | Date
  riskAmount?: number | null
  strategy?: unknown
}

export const ManagedCopyService = {
  // ─── Manager registration ────────────────────────────────────────────────

  async registerManager(
    userId: string,
    opts: {
      connectionId: string
      profitSharePct?: number
      brokerSettled?: boolean
      minAllocationPct?: number
      maxAllocationPct?: number
      minAccountBalanceUsd?: number
      lotsPer100Usd?: number
      brokerAccountLabel?: string
      brokerAccountLogin?: string
      // Risk management settings
      maxRiskPerTradePct?: number
      maxConcurrentTrades?: number
      marginBudgetPct?: number
      drawdownSoftPausePct?: number
      accountWideHardStopPct?: number
      maxSymbolExposurePct?: number
      maxAssetClassExposurePct?: number
      weekendCryptoCapPct?: number
      newsBlackoutMinutes?: number
      // Per-asset-class sizing
      forexBaseLotsPer100Usd?: number
      forexMinLotSize?: number
      forexMaxLots?: number
      forexMaxRiskPct?: number
      metalsBaseLotsPer100Usd?: number
      metalsMinLotSize?: number
      metalsMaxLots?: number
      metalsMaxRiskPct?: number
      cryptoBaseLotsPer100Usd?: number
      cryptoMinLotSize?: number
      cryptoMaxLots?: number
      cryptoMaxRiskPct?: number
    }
  ) {
    const connection = await db.botConnection.findFirst({ where: { id: opts.connectionId, userId } })
    if (!connection) throw new Error('Account not found or does not belong to you')

    const runningInstance = await db.botInstance.findFirst({
      where: { connectionId: connection.id, status: { in: ['running', 'starting'] } },
    })
    if (runningInstance) {
      throw new Error(
        'This account is currently running the trading bot. One account is used for one thing at a time — stop the bot first, or pick another account as your copy-trading MASTER.'
      )
    }

    const trader = await db.copyTrader.findUnique({ where: { userId } })
    if (!trader) throw new Error('Register a copy-trader profile first (Become a Trader tab)')

    const profitShare = opts.profitSharePct != null ? clamp(opts.profitSharePct, 0, 100) : trader.copyFeePct
    const minPct = opts.minAllocationPct != null ? clamp(opts.minAllocationPct, 0.1, 100) : trader.minAllocationPct
    const maxPct = opts.maxAllocationPct != null ? clamp(opts.maxAllocationPct, minPct, 100) : trader.maxAllocationPct
    const minBalance = opts.minAccountBalanceUsd != null ? Math.max(100, Number(opts.minAccountBalanceUsd) || 100) : trader.minAccountBalanceUsd
    const lotsPer100 = opts.lotsPer100Usd != null ? Math.max(0.001, Number(opts.lotsPer100Usd) || 0.01) : trader.lotsPer100Usd

    const brokerLabel = opts.brokerAccountLabel?.trim() || connection.label
    const brokerLogin = opts.brokerAccountLogin?.trim() || connection.login

    return db.copyTrader.update({
      where: { id: trader.id },
      data: {
        masterConnectionId: connection.id,
        brokerSettled: opts.brokerSettled ?? trader.brokerSettled,
        minAllocationPct: minPct,
        maxAllocationPct: maxPct,
        copyFeePct: profitShare,
        minAccountBalanceUsd: minBalance,
        lotsPer100Usd: lotsPer100,
        brokerAccountLabel: brokerLabel,
        brokerAccountLogin: brokerLogin,
        // Risk management settings
        maxRiskPerTradePct: opts.maxRiskPerTradePct != null ? clamp(opts.maxRiskPerTradePct, 0.1, 10) : trader.maxRiskPerTradePct,
        maxConcurrentTrades: opts.maxConcurrentTrades != null ? clamp(opts.maxConcurrentTrades, 1, 100) : trader.maxConcurrentTrades,
        marginBudgetPct: opts.marginBudgetPct != null ? clamp(opts.marginBudgetPct, 10, 100) : trader.marginBudgetPct,
        drawdownSoftPausePct: opts.drawdownSoftPausePct != null ? clamp(opts.drawdownSoftPausePct, 1, 50) : trader.drawdownSoftPausePct,
        accountWideHardStopPct: opts.accountWideHardStopPct != null ? clamp(opts.accountWideHardStopPct, 5, 50) : trader.accountWideHardStopPct,
        maxSymbolExposurePct: opts.maxSymbolExposurePct != null ? clamp(opts.maxSymbolExposurePct, 5, 100) : trader.maxSymbolExposurePct,
        maxAssetClassExposurePct: opts.maxAssetClassExposurePct != null ? clamp(opts.maxAssetClassExposurePct, 10, 100) : trader.maxAssetClassExposurePct,
        weekendCryptoCapPct: opts.weekendCryptoCapPct != null ? clamp(opts.weekendCryptoCapPct, 10, 100) : trader.weekendCryptoCapPct,
        newsBlackoutMinutes: opts.newsBlackoutMinutes != null ? clamp(opts.newsBlackoutMinutes, 0, 120) : trader.newsBlackoutMinutes,
        // Per-asset-class sizing
        forexBaseLotsPer100Usd: opts.forexBaseLotsPer100Usd != null ? Math.max(0.001, opts.forexBaseLotsPer100Usd) : trader.forexBaseLotsPer100Usd,
        forexMinLotSize: opts.forexMinLotSize != null ? Math.max(0.01, opts.forexMinLotSize) : trader.forexMinLotSize,
        forexMaxLots: opts.forexMaxLots != null ? Math.max(1, opts.forexMaxLots) : trader.forexMaxLots,
        forexMaxRiskPct: opts.forexMaxRiskPct != null ? clamp(opts.forexMaxRiskPct, 0.1, 10) : trader.forexMaxRiskPct,
        metalsBaseLotsPer100Usd: opts.metalsBaseLotsPer100Usd != null ? Math.max(0.001, opts.metalsBaseLotsPer100Usd) : trader.metalsBaseLotsPer100Usd,
        metalsMinLotSize: opts.metalsMinLotSize != null ? Math.max(0.01, opts.metalsMinLotSize) : trader.metalsMinLotSize,
        metalsMaxLots: opts.metalsMaxLots != null ? Math.max(1, opts.metalsMaxLots) : trader.metalsMaxLots,
        metalsMaxRiskPct: opts.metalsMaxRiskPct != null ? clamp(opts.metalsMaxRiskPct, 0.1, 10) : trader.metalsMaxRiskPct,
        cryptoBaseLotsPer100Usd: opts.cryptoBaseLotsPer100Usd != null ? Math.max(0.001, opts.cryptoBaseLotsPer100Usd) : trader.cryptoBaseLotsPer100Usd,
        cryptoMinLotSize: opts.cryptoMinLotSize != null ? Math.max(0.01, opts.cryptoMinLotSize) : trader.cryptoMinLotSize,
        cryptoMaxLots: opts.cryptoMaxLots != null ? Math.max(1, opts.cryptoMaxLots) : trader.cryptoMaxLots,
        cryptoMaxRiskPct: opts.cryptoMaxRiskPct != null ? clamp(opts.cryptoMaxRiskPct, 0.1, 10) : trader.cryptoMaxRiskPct,
      },
      include: { masterConnection: true },
    })
  },

  async unlinkManager(userId: string) {
    const trader = await db.copyTrader.findUnique({ where: { userId } })
    if (!trader) return null
    return db.copyTrader.update({ where: { id: trader.id }, data: { masterConnectionId: null } })
  },

  // ─── Follower allocation ─────────────────────────────────────────────────

  async setAllocation(
    followerId: string,
    traderId: string,
    allocationPct: number,
    opts?: { declaredBalanceUsd?: number; termsAccepted?: boolean }
  ) {
    if (followerId === traderId) throw new Error('Cannot allocate to yourself')
    const pct = clamp(Number(allocationPct) || 0, 0.1, 100)
    const trader = await db.copyTrader.findUnique({ where: { userId: traderId } })
    if (!trader) throw new Error('Copy trader not found')
    if (!trader.masterConnectionId) throw new Error('This trader has not linked a master account yet')

    const existing = await db.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId: traderId } },
    })

    if (!existing) {
      if (opts?.termsAccepted !== true) {
        throw new Error('You must agree to the Copy Trading Terms & Conditions before following')
      }
      const balance = Number(opts?.declaredBalanceUsd) || 0
      const minBalance = trader.minAccountBalanceUsd || 100
      if (balance < minBalance) {
        throw new Error(`Copy trading requires an account of at least $${minBalance.toFixed(2)}`)
      }
    }

    const bounded = clamp(pct, trader.minAllocationPct || 0.1, trader.maxAllocationPct || 100)
    const balance = Number(opts?.declaredBalanceUsd) || existing?.declaredBalanceUsd || null
    const follow = await db.follow.upsert({
      where: { followerId_followingId: { followerId, followingId: traderId } },
      create: {
        followerId,
        followingId: traderId,
        autoCopy: true,
        allocationPct: bounded,
        status: 'active',
        declaredBalanceUsd: balance,
        termsAccepted: true,
        termsAcceptedAt: new Date(),
      },
      update: {
        allocationPct: bounded,
        status: 'active',
        autoCopy: true,
        ...(balance != null ? { declaredBalanceUsd: balance } : {}),
      },
    })
    return {
      ...follow,
      allocationPct: bounded,
      note:
        bounded !== pct
          ? `Clamped to manager range ${trader.minAllocationPct}%–${trader.maxAllocationPct}%`
          : null,
    }
  },

  async setFollowStatus(followerId: string, traderId: string, status: 'active' | 'paused') {
    const follow = await db.follow.findFirst({ where: { followerId, followingId: traderId } })
    if (!follow) throw new Error('You are not following this trader')
    return db.follow.update({
      where: { id: follow.id },
      data: { status, autoCopy: status === 'active' },
    })
  },

  // ─── Circuit breaker management ──────────────────────────────────────────

  /**
   * Rule #5: Per-provider soft pause. If a provider's copied trades hit a
   * drawdown threshold (e.g. -8% of their allocated slice), auto-pause new
   * copies from just that provider — don't wait for it to drag the whole account.
   */
  async checkProviderDrawdown(traderId: string, followerId: string): Promise<{
    paused: boolean; reason?: string
  }> {
    const trader = await db.copyTrader.findUnique({ where: { id: traderId } })
    if (!trader) return { paused: false }

    const follow = await db.follow.findFirst({
      where: { followerId, followingId: trader.userId },
    })
    if (!follow || !follow.declaredBalanceUsd) return { paused: false }

    // Calculate this follower's realized P/L from this provider's trades
    const trades = await db.copyTrade.findMany({
      where: { followerId, traderId: trader.userId, status: 'closed' },
      select: { pnl: true, allocationPct: true },
    })

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
    const allocatedSlice = follow.declaredBalanceUsd * (follow.allocationPct / 100)
    if (allocatedSlice <= 0) return { paused: false }

    const drawdownPct = (totalPnl / allocatedSlice) * 100

    if (drawdownPct <= -trader.drawdownSoftPausePct) {
      // Auto-pause this follower from this provider
      await db.follow.update({
        where: { id: follow.id },
        data: { status: 'paused', autoCopy: false },
      })
      // Log the risk event
      await db.copyRiskEvent.create({
        data: {
          traderId: trader.id,
          followerId,
          eventType: 'provider_soft_pause',
          drawdownPct: round2(drawdownPct),
          thresholdPct: trader.drawdownSoftPausePct,
          details: JSON.stringify({ totalPnl, allocatedSlice, tradeCount: trades.length }),
        },
      })
      return { paused: true, reason: `Drawdown ${drawdownPct.toFixed(1)}% exceeded threshold ${trader.drawdownSoftPausePct}%` }
    }

    return { paused: false }
  },

  /**
   * Rule #5: Account-wide hard stop. A single non-negotiable number
   * (e.g. -15% master equity in a rolling week) that pauses ALL providers
   * and forces manual review before resuming.
   */
  async checkAccountWideDrawdown(traderId: string): Promise<{
    triggered: boolean; reason?: string
  }> {
    const trader = await db.copyTrader.findUnique({ where: { id: traderId } })
    if (!trader) return { triggered: false }

    // Check if hard stop is already active
    if (trader.hardStopActive) {
      return { triggered: true, reason: 'Hard stop already active — manual review required' }
    }

    // Calculate rolling 7-day P/L for all followers of this provider
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const trades = await db.copyTrade.findMany({
      where: {
        traderId: trader.userId,
        status: 'closed',
        closedAt: { gte: sevenDaysAgo },
      },
      select: { pnl: true },
    })

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0)

    // Get total equity across all followers
    const followers = await db.follow.findMany({
      where: { followingId: trader.userId, status: 'active' },
      select: { declaredBalanceUsd: true, allocationPct: true },
    })
    const totalEquity = followers.reduce((sum, f) => sum + (f.declaredBalanceUsd ?? 0), 0)
    if (totalEquity <= 0) return { triggered: false }

    const accountDrawdownPct = (totalPnl / totalEquity) * 100

    if (accountDrawdownPct <= -trader.accountWideHardStopPct) {
      // Pause ALL followers
      await db.follow.updateMany({
        where: { followingId: trader.userId, status: 'active' },
        data: { status: 'paused', autoCopy: false },
      })
      // Activate hard stop
      await db.copyTrader.update({
        where: { id: trader.id },
        data: {
          hardStopActive: true,
          hardStopActivatedAt: new Date(),
          currentDrawdownPct: round2(accountDrawdownPct),
        },
      })
      // Log the risk event
      await db.copyRiskEvent.create({
        data: {
          traderId: trader.id,
          eventType: 'account_hard_stop',
          drawdownPct: round2(accountDrawdownPct),
          thresholdPct: trader.accountWideHardStopPct,
          details: JSON.stringify({ totalPnl, totalEquity, followerCount: followers.length }),
        },
      })
      return { triggered: true, reason: `Account-wide drawdown ${accountDrawdownPct.toFixed(1)}% exceeded hard stop ${trader.accountWideHardStopPct}%` }
    }

    return { triggered: false }
  },

  /**
   * Manually resume after a hard stop (requires manual review as per spec).
   */
  async resumeAfterHardStop(userId: string) {
    const trader = await db.copyTrader.findUnique({ where: { userId } })
    if (!trader) throw new Error('Copy trader not found')
    if (!trader.hardStopActive) throw new Error('No active hard stop to resume from')

    // Reactivate all previously paused followers
    await db.follow.updateMany({
      where: { followingId: userId, status: 'paused' },
      data: { status: 'active', autoCopy: true },
    })

    // Clear hard stop
    await db.copyTrader.update({
      where: { id: trader.id },
      data: {
        hardStopActive: false,
        hardStopActivatedAt: null,
        currentDrawdownPct: 0,
      },
    })

    // Log the resume event
    await db.copyRiskEvent.create({
      data: {
        traderId: trader.id,
        eventType: 'account_resume',
        drawdownPct: 0,
        thresholdPct: trader.accountWideHardStopPct,
        details: JSON.stringify({ resumedBy: userId }),
      },
    })

    return { resumed: true }
  },

  // ─── Exposure tracking helpers ──────────────────────────────────────────

  /** Get all open copy trades for a given follower across all providers. */
  async getOpenTradesForFollower(followerId: string) {
    return db.copyTrade.findMany({
      where: { followerId, status: 'open' },
      select: { symbol: true, direction: true, size: true, traderId: true, entryPrice: true, stopLoss: true },
    })
  },

  /** Get all open copy trades for a given provider across all followers. */
  async getOpenTradesForProvider(traderId: string) {
    return db.copyTrade.findMany({
      where: { traderId, status: 'open', source: 'master' },
      select: { symbol: true, direction: true, size: true, followerId: true, entryPrice: true, stopLoss: true },
    })
  },

  // ─── Master mirroring (called by /api/bot/webhook) ───────────────────────

  /** Mirror a freshly-opened master trade to every active follower. */
  async mirrorMasterOpen(connectionId: string, ev: MasterTradeEvent) {
    const trader = await db.copyTrader.findUnique({ where: { masterConnectionId: connectionId } })
    if (!trader) return { mirrored: 0, skipped: 0, reasons: [] as string[] }

    const follows = await db.follow.findMany({
      where: { followingId: trader.userId, status: 'active', autoCopy: true },
    })
    if (follows.length === 0) return { mirrored: 0, skipped: 0, reasons: [] }

    const masterSize = Number(ev.lots) || 0
    const symbol = ev.symbol
    const direction = ev.direction
    const slDistance = computeSLDistance(Number(ev.entryPrice) || 0, ev.stopLoss)
    const now = new Date()
    let mirrored = 0
    let skipped = 0
    const reasons: string[] = []

    // ─── Pre-checks (apply to ALL followers) ──────────────────────────────

    // Rule #4: Time-based rules — weekend gap window for non-crypto
    const assetClass = getAssetClass(symbol)
    if (assetClass !== 'crypto' && isWeekendGapWindow(now)) {
      return { mirrored: 0, skipped: follows.length, reasons: ['Weekend gap window — forex/metals trades blocked'] }
    }

    // Rule #4: News blackout for metals/forex
    if ((assetClass === 'forex' || assetClass === 'metals') && isNewsBlackoutWindow(trader.newsBlackoutMinutes, now)) {
      return { mirrored: 0, skipped: follows.length, reasons: ['News blackout window — metals/forex trades blocked'] }
    }

    // Rule #5: Account-wide hard stop check
    const hardStop = await this.checkAccountWideDrawdown(trader.id)
    if (hardStop.triggered) {
      return { mirrored: 0, skipped: follows.length, reasons: [hardStop.reason || 'Account-wide hard stop active'] }
    }

    for (const f of follows) {
      if (f.allocationPct <= 0) continue

      // Rule #5: Per-provider drawdown check
      const drawdownCheck = await this.checkProviderDrawdown(trader.id, f.followerId)
      if (drawdownCheck.paused) {
        skipped++
        reasons.push(`Follower ${f.followerId}: ${drawdownCheck.reason}`)
        continue
      }

      // Rule #2: Per-provider concurrent trade cap
      const openCount = await db.copyTrade.count({
        where: { followerId: f.followerId, traderId: trader.userId, status: 'open', source: 'master' },
      })
      if (openCount >= trader.maxConcurrentTrades) {
        skipped++
        reasons.push(`Follower ${f.followerId}: concurrent trade cap ${trader.maxConcurrentTrades} reached`)
        continue
      }

      // Rule #2: Margin reservation — check if follower has enough margin budget
      if (f.declaredBalanceUsd && f.declaredBalanceUsd > 0) {
        const marginUsed = f.allocatedMarginUsd ?? 0
        const marginBudget = f.declaredBalanceUsd * (trader.marginBudgetPct / 100)
        const estNotional = notionalPerLot(symbol) * 0.01 // rough margin for min lot
        if (marginUsed + estNotional > marginBudget) {
          skipped++
          reasons.push(`Follower ${f.followerId}: margin budget exceeded`)
          continue
        }
      }

      // ─── Position sizing (per-asset-class) ─────────────────────────────

      let size: number
      let providerRiskPct: number | null = null
      let masterRiskPct: number | null = null

      // Get asset-class-specific sizing config (forex/metals/crypto each have
      // their own base lots, min/max lots, and risk cap)
      const sizing = getAssetSizingConfig(symbol, trader)

      if (f.declaredBalanceUsd != null && f.declaredBalanceUsd > 0) {
        // Rule #1: Risk-normalized sizing (primary mode)
        if (slDistance != null && slDistance > 0) {
          // We know the provider's lot size and SL distance, so we can compute their risk %
          // providerRiskPct is estimated from the master's own trade parameters
          providerRiskPct = computeRiskPct(masterSize, symbol, slDistance, f.declaredBalanceUsd)
          if (providerRiskPct != null) {
            const result = computeRiskNormalizedLots(
              providerRiskPct,
              f.declaredBalanceUsd,
              symbol,
              slDistance,
              {
                maxRiskPct: sizing.maxRiskPct,
                minLotSize: sizing.minLotSize,
                maxLots: sizing.maxLots,
              },
            )
            if (result.skipped) {
              skipped++
              reasons.push(`Follower ${f.followerId}: ${result.reason}`)
              continue
            }
            size = result.lots
            masterRiskPct = result.riskPct
          } else {
            // Fallback to progressive sizing with per-class tiers
            size = computeProgressiveLots(
              f.declaredBalanceUsd,
              sizing.baseLotsPer100Usd,
              sizing.maxLots,
              sizing.minLotSize,
              assetClass,
            )
          }
        } else {
          // No SL distance known — use progressive sizing with per-class tiers
          size = computeProgressiveLots(
            f.declaredBalanceUsd,
            sizing.baseLotsPer100Usd,
            sizing.maxLots,
            sizing.minLotSize,
            assetClass,
          )
        }
        size = round2(Math.min(size, f.maxPositionSize > 0 ? f.maxPositionSize : size))
        size = Math.max(sizing.minLotSize, size)
      } else {
        size = round2(masterSize * (f.allocationPct / 100))
      }
      if (size <= 0) continue

      // Rule #3: Correlation — per-symbol net exposure cap
      const followerTrades = await this.getOpenTradesForFollower(f.followerId)
      if (wouldExceedSymbolCap(followerTrades, symbol, direction, size, f.declaredBalanceUsd ?? 10000, trader.maxSymbolExposurePct)) {
        skipped++
        reasons.push(`Follower ${f.followerId}: per-symbol exposure cap exceeded for ${symbol}`)
        continue
      }

      // Rule #3: Correlation — per-asset-class net exposure cap
      if (wouldExceedAssetClassCap(followerTrades, symbol, direction, size, f.declaredBalanceUsd ?? 10000, trader.maxAssetClassExposurePct)) {
        skipped++
        reasons.push(`Follower ${f.followerId}: per-asset-class exposure cap exceeded for ${assetClass}`)
        continue
      }

      // Rule #4: Weekend crypto cap adjustment
      if (assetClass === 'crypto' && isWeekendGapWindow(now)) {
        // Even though crypto trades 24/7, apply tighter cap on weekends
        const weekendMultiplier = trader.weekendCryptoCapPct / 100
        size = round2(size * weekendMultiplier)
        if (size < 0.01) {
          skipped++
          reasons.push(`Follower ${f.followerId}: crypto weekend cap reduced size below minimum`)
          continue
        }
      }

      // Deduplicate
      const dup = await db.copyTrade.findFirst({
        where: { masterTicket: String(ev.ticket), followerId: f.followerId, status: 'open' },
      })
      if (dup) continue

      // Create the copy trade
      await db.$transaction(async (tx) => {
        await tx.copyTrade.create({
          data: {
            followerId: f.followerId,
            traderId: trader.userId,
            symbol: ev.symbol,
            direction: ev.direction,
            size,
            entryPrice: Number(ev.entryPrice) || 0,
            stopLoss: ev.stopLoss ?? undefined,
            takeProfit: ev.takeProfit ?? undefined,
            status: 'open',
            allocationPct: f.allocationPct,
            masterTicket: String(ev.ticket),
            source: 'master',
            providerRiskPct,
            masterRiskPct,
            assetClass,
          },
        })

        // Update concurrent trade count and margin allocation
        await tx.follow.update({
          where: { id: f.id },
          data: {
            concurrentTradeCount: { increment: 1 },
            allocatedMarginUsd: { increment: notionalPerLot(symbol) * (size / 100) },
          },
        })
      })
      mirrored++
    }
    return { mirrored, skipped, reasons }
  },

  /** Close mirrored follower trades when the master trade closes + settle fees. */
  async mirrorMasterClose(connectionId: string, ev: MasterTradeEvent) {
    const trader = await db.copyTrader.findUnique({ where: { masterConnectionId: connectionId } })
    if (!trader) return { settled: 0 }

    const ticket = String(ev.ticket)
    const open = await db.copyTrade.findMany({
      where: { masterTicket: ticket, traderId: trader.userId, status: 'open', source: 'master' },
    })
    if (open.length === 0) return { settled: 0 }

    const masterProfit = Number(ev.profit) || 0
    const masterSize = Number(ev.lots) || 1
    const providerFeePct = trader.copyFeePct
    const platformFeePct = trader.platformFeePct
    const brokerSettled = trader.brokerSettled
    const closeTime = ev.closeTime ? new Date(ev.closeTime) : new Date()
    let settled = 0

    for (const ct of open) {
      const ratio = masterSize > 0 ? ct.size / masterSize : 0
      const pnl = round2(masterProfit * ratio)
      const gross = pnl > 0 ? pnl : 0
      const providerAmount = round2(gross * (providerFeePct / 100))
      const platformAmount = round2(gross * (platformFeePct / 100))

      try {
        await db.$transaction(async (tx) => {
          await tx.copyTrade.update({
            where: { id: ct.id },
            data: {
              status: 'closed',
              exitPrice: ev.closePrice ?? undefined,
              pnl,
              closedAt: closeTime,
            },
          })

          // Decrement concurrent trade count and margin for the follower
          await tx.follow.updateMany({
            where: { followerId: ct.followerId, followingId: trader.userId },
            data: {
              concurrentTradeCount: { decrement: 1 },
              allocatedMarginUsd: { decrement: Math.max(0, ct.size * 1000) }, // rough estimate
            },
          })

          if (gross > 0) {
            await tx.copySettlement.create({
              data: {
                traderId: trader.id,
                followerId: ct.followerId,
                copyTradeId: ct.id,
                connectionId,
                grossProfit: gross,
                providerFeePct,
                platformFeePct,
                providerAmount,
                platformAmount,
                dedicatedAt: closeTime,
                settledBy: brokerSettled ? 'broker' : 'manual',
                source: 'master',
                status: brokerSettled ? 'paid' : 'due',
                paidAt: brokerSettled ? closeTime : null,
              },
            })
            if (platformAmount > 0) {
              await tx.platformEarning.create({
                data: {
                  source: 'copy_fee',
                  amount: platformAmount,
                  reference: `master_${ct.id}`,
                },
              })
            }
          }

          await tx.copyTrader.update({
            where: { id: trader.id },
            data: { realizedPnl: { increment: pnl } },
          })
        })
        settled++
      } catch (err) {
        console.error(`[ManagedCopy] Failed to close trade ${ct.id}:`, err)
      }
    }
    return { settled }
  },

  // ─── Rule #6: Rebalancing ──────────────────────────────────────────────

  /**
   * Scheduled re-weighting. Providers' own accounts grow/shrink at different
   * rates, so a ratio that was correct on day one drifts. Recalculate each
   * provider's actual contribution vs. intended weight and adjust.
   *
   * Should be called monthly (or on-demand from the manager dashboard).
   */
  async rebalanceProvider(userId: string) {
    const trader = await db.copyTrader.findUnique({ where: { userId } })
    if (!trader) throw new Error('Copy trader not found')

    const followers = await db.follow.findMany({
      where: { followingId: userId, status: 'active' },
    })

    // Calculate each follower's actual P/L contribution vs. their allocation weight
    const adjustments: Array<{ followerId: string; oldAlloc: number; newAlloc: number; reason: string }> = []

    for (const f of followers) {
      const trades = await db.copyTrade.findMany({
        where: { followerId: f.followerId, traderId: userId, status: 'closed' },
        select: { pnl: true, allocationPct: true },
      })

      const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
      const totalAllocation = trades.reduce((sum, t) => sum + t.allocationPct, 0)
      const avgAllocation = trades.length > 0 ? totalAllocation / trades.length : f.allocationPct

      // If a follower's actual contribution significantly differs from their
      // allocation weight, suggest an adjustment
      if (f.declaredBalanceUsd && f.declaredBalanceUsd > 0) {
        const expectedPnl = f.declaredBalanceUsd * (f.allocationPct / 100) * 0.01 // rough expectation
        const deviation = Math.abs(totalPnl - expectedPnl) / Math.max(Math.abs(expectedPnl), 1)

        if (deviation > 0.5) {
          // Suggest reducing allocation for underperformers, increasing for outperformers
          const direction = totalPnl > expectedPnl ? 1 : -1
          const newAlloc = clamp(f.allocationPct + direction * 2, trader.minAllocationPct, trader.maxAllocationPct)
          if (newAlloc !== f.allocationPct) {
            adjustments.push({
              followerId: f.followerId,
              oldAlloc: f.allocationPct,
              newAlloc,
              reason: `Performance deviation ${Math.round(deviation * 100)}%`,
            })
          }
        }
      }
    }

    // Apply adjustments
    for (const adj of adjustments) {
      await db.follow.updateMany({
        where: { followerId: adj.followerId, followingId: userId },
        data: { allocationPct: adj.newAlloc },
      })
    }

    // Update last rebalance timestamp
    await db.copyTrader.update({
      where: { id: trader.id },
      data: { lastRebalanceAt: new Date() },
    })

    return { rebalanced: adjustments.length, adjustments }
  },

  // ─── Rule #7: Reconciliation ────────────────────────────────────────────

  /**
   * Daily check: does each provider's realized contribution match what our
   * sizing rules intended? Drift here usually means a sizing bug or a
   * provider's behavior has changed without us noticing.
   */
  async reconcileDrift(userId: string) {
    const trader = await db.copyTrader.findUnique({ where: { userId } })
    if (!trader) throw new Error('Copy trader not found')

    const followers = await db.follow.findMany({
      where: { followingId: userId, status: 'active' },
      select: { followerId: true, declaredBalanceUsd: true, allocationPct: true },
    })

    const drifts: Array<{
      followerId: string
      expectedLots: number
      actualAvgLots: number
      driftPct: number
      flag: string
    }> = []

    for (const f of followers) {
      if (!f.declaredBalanceUsd || f.declaredBalanceUsd <= 0) continue

      // Get recent open trades to compare expected vs actual sizing
      const recentTrades = await db.copyTrade.findMany({
        where: { followerId: f.followerId, traderId: userId, source: 'master' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { size: true, providerRiskPct: true, masterRiskPct: true },
      })

      if (recentTrades.length === 0) continue

      const avgActualLots = recentTrades.reduce((sum, t) => sum + t.size, 0) / recentTrades.length
      const expectedLots = computeProgressiveLots(f.declaredBalanceUsd, trader.lotsPer100Usd)

      const driftPct = expectedLots > 0
        ? ((avgActualLots - expectedLots) / expectedLots) * 100
        : 0

      let flag = 'ok'
      if (Math.abs(driftPct) > 20) {
        flag = 'significant_drift'
      } else if (Math.abs(driftPct) > 10) {
        flag = 'moderate_drift'
      }

      drifts.push({
        followerId: f.followerId,
        expectedLots: round2(expectedLots),
        actualAvgLots: round2(avgActualLots),
        driftPct: round2(driftPct),
        flag,
      })
    }

    // Update last reconcile timestamp
    await db.copyTrader.update({
      where: { id: trader.id },
      data: { lastReconcileAt: new Date() },
    })

    return {
      reconciled: drifts.length,
      drifts,
      summary: {
        ok: drifts.filter(d => d.flag === 'ok').length,
        moderateDrift: drifts.filter(d => d.flag === 'moderate_drift').length,
        significantDrift: drifts.filter(d => d.flag === 'significant_drift').length,
      },
    }
  },

  // ─── Dashboards ──────────────────────────────────────────────────────────

  async getManagerDashboard(userId: string) {
    const trader = await db.copyTrader.findUnique({
      where: { userId },
      include: {
        masterConnection: { include: { _count: { select: { trades: true } } } },
      },
    })
    if (!trader) return null

    const [followers, dueAgg, paidAgg, openTrades, settlements, riskEvents] = await Promise.all([
      db.follow.findMany({
        where: { followingId: userId, status: 'active' },
        include: {
          follower: { select: { id: true, name: true, profilePicture: true } },
        },
      }),
      db.copySettlement.aggregate({
        where: { traderId: trader.id, status: 'due' },
        _sum: { providerAmount: true, platformAmount: true },
      }),
      db.copySettlement.aggregate({
        where: { traderId: trader.id, status: 'paid' },
        _sum: { providerAmount: true, platformAmount: true },
      }),
      db.copyTrade.findMany({
        where: { traderId: userId, status: 'open', source: 'master' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      db.copySettlement.findMany({
        where: { traderId: trader.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          follower: { select: { name: true } },
          connection: { select: { label: true, brokerName: true } },
        },
      }),
      db.copyRiskEvent.findMany({
        where: { traderId: trader.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ])

    // Compute aggregate exposure
    const totalLongLots = openTrades.filter(t => t.direction === 'BUY').reduce((s, t) => s + t.size, 0)
    const totalShortLots = openTrades.filter(t => t.direction === 'SELL').reduce((s, t) => s + t.size, 0)
    const netExposure = totalLongLots - totalShortLots

    // Per-symbol exposure breakdown
    const symbolExposure = new Map<string, { long: number; short: number }>()
    for (const t of openTrades) {
      const entry = symbolExposure.get(t.symbol) || { long: 0, short: 0 }
      if (t.direction === 'BUY') entry.long += t.size
      else entry.short += t.size
      symbolExposure.set(t.symbol, entry)
    }

    // Per-asset-class exposure breakdown
    const classExposure = new Map<string, { long: number; short: number }>()
    for (const t of openTrades) {
      const cls = getAssetClass(t.symbol)
      const entry = classExposure.get(cls) || { long: 0, short: 0 }
      if (t.direction === 'BUY') entry.long += t.size
      else entry.short += t.size
      classExposure.set(cls, entry)
    }

    return {
      trader: {
        ...trader,
        masterConnection: trader.masterConnection
          ? {
              id: trader.masterConnection.id,
              label: trader.masterConnection.label,
              brokerName: trader.masterConnection.brokerName,
              login: trader.masterConnection.login,
              platform: trader.masterConnection.platform,
              tradesCount: trader.masterConnection._count.trades,
            }
          : null,
      },
      followers,
      totals: {
        providerDue: dueAgg._sum.providerAmount || 0,
        providerPaid: paidAgg._sum.providerAmount || 0,
        platformDue: dueAgg._sum.platformAmount || 0,
        platformPaid: paidAgg._sum.platformAmount || 0,
      },
      openTrades,
      settlements,
      riskEvents,
      exposure: {
        totalLongLots,
        totalShortLots,
        netExposure,
        bySymbol: Object.fromEntries(symbolExposure),
        byAssetClass: Object.fromEntries(classExposure),
      },
    }
  },

  // ─── Payouts: copy-trading money goes to the BROKER account ─────────────

  async settleProviderFeesToBroker(userId: string) {
    const trader = await db.copyTrader.findUnique({ where: { userId } })
    if (!trader) throw new Error('Copy trader not found')
    if (!trader.masterConnectionId) {
      throw new Error('Link a master account first — your profit share is paid into your broker account')
    }

    const due = await db.copySettlement.findMany({
      where: { traderId: trader.id, status: 'due' },
      select: { id: true, providerAmount: true },
    })
    if (due.length === 0) return { settled: 0, amount: 0 }

    await db.copySettlement.updateMany({
      where: { id: { in: due.map((s) => s.id) }, status: 'due' },
      data: { status: 'paid', paidAt: new Date(), settledBy: 'broker' },
    })

    const amount = round2(due.reduce((a, s) => a + s.providerAmount, 0))
    return { settled: due.length, amount }
  },
}
