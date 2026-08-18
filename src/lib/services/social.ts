// ─── Social Services: Social Feed, Leaderboards, Competitions, Messaging, Groups ─
import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma'

// Lazy backfill: existing CopyTrader rows created under the old DEFAULT 0 for
// platformFeePct need to be updated to the current default (10%). Only runs once
// (no-ops once all rows are >= 10).
let _backfillRan = false
export async function backfillCopyTraderFees() {
  if (_backfillRan) return
  _backfillRan = true
  await db.$executeRaw`UPDATE CopyTrader SET platformFeePct = 10 WHERE platformFeePct = 0`
}

// ────────────────────────────────────────────────────────────────────────────
// Social Feed
// ────────────────────────────────────────────────────────────────────────────

export interface SocialFeedPost {
  id: string
  userId: string
  userName: string | null
  userAvatar: string | null
  content: string
  type: string
  tags: string | null
  likes: number
  comments: number
  shares: number
  createdAt: string
  likedByMe?: boolean
}

export class SocialFeedService {
  static async createPost(userId: string, content: string, type: string = 'general', tags?: string): Promise<SocialFeedPost> {
    const post = await db.post.create({
      data: { userId, content, type, tags },
      include: { user: { select: { name: true, profilePicture: true } } },
    })
    return {
      id: post.id,
      userId: post.userId,
      userName: post.user.name,
      userAvatar: post.user.profilePicture,
      content: post.content,
      type: post.type,
      tags: post.tags,
      likes: post.likes,
      comments: post.comments,
      shares: post.shares,
      createdAt: post.createdAt.toISOString(),
    }
  }

  static async getFeed(userId: string, limit: number = 20, offset: number = 0): Promise<SocialFeedPost[]> {
    // Get posts from followed users + popular posts
    const follows = await db.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    })
    const followedIds = follows.map((f) => f.followingId)
    followedIds.push(userId) // include own posts

    const posts = await db.post.findMany({
      where: {
        OR: [
          { userId: { in: followedIds } },
          { type: 'signal' },
          { likes: { gt: 5 } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        user: { select: { name: true, profilePicture: true } },
        postLikes: { where: { userId }, select: { id: true } },
      },
    })

    return posts.map((p) => ({
      id: p.id,
      userId: p.userId,
      userName: p.user.name,
      userAvatar: p.user.profilePicture,
      content: p.content,
      type: p.type,
      tags: p.tags,
      likes: p.likes,
      comments: p.comments,
      shares: p.shares,
      createdAt: p.createdAt.toISOString(),
      likedByMe: p.postLikes.length > 0,
    }))
  }

  static async getCommunityPosts(userId: string, tag?: string, limit: number = 20, offset: number = 0): Promise<SocialFeedPost[]> {
    const posts = await db.post.findMany({
      where: {
        visibility: 'public',
        ...(tag ? { tags: { contains: tag } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        user: { select: { name: true, profilePicture: true } },
        postLikes: { where: { userId }, select: { id: true } },
      },
    })

    return posts.map((p) => ({
      id: p.id,
      userId: p.userId,
      userName: p.user.name,
      userAvatar: p.user.profilePicture,
      content: p.content,
      type: p.type,
      tags: p.tags,
      likes: p.likes,
      comments: p.comments,
      shares: p.shares,
      createdAt: p.createdAt.toISOString(),
      likedByMe: p.postLikes.length > 0,
    }))
  }

  static async likePost(userId: string, postId: string): Promise<void> {
    const existing = await db.postLike.findUnique({ where: { userId_postId: { userId, postId } } })
    if (existing) return
    await db.$transaction([
      db.postLike.create({ data: { userId, postId } }),
      db.post.update({ where: { id: postId }, data: { likes: { increment: 1 } } }),
    ])
  }

  static async unlikePost(userId: string, postId: string): Promise<void> {
    const result = await db.$transaction([
      db.postLike.deleteMany({ where: { userId, postId } }),
    ])
    const deleted = result[0] as { count: number }
    if (deleted && deleted.count > 0) {
      await db.post.update({ where: { id: postId }, data: { likes: { decrement: 1 } } })
    }
  }

  static async commentPost(userId: string, postId: string, content: string) {
    return db.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: { userId, postId, content },
        include: { user: { select: { name: true, profilePicture: true } } },
      })
      await tx.post.update({ where: { id: postId }, data: { comments: { increment: 1 } } })
      return comment
    })
  }

  static async getComments(postId: string, limit = 50) {
    return db.comment.findMany({
      where: { postId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { id: true, name: true, profilePicture: true } } },
    })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Copy Trading
// ────────────────────────────────────────────────────────────────────────────

export class CopyTradingService {
  static async followTrader(
    followerId: string,
    traderId: string,
    opts?: { autoCopy?: boolean; copyRatio?: number; maxPositionSize?: number; declaredBalanceUsd?: number; connectionId?: string; termsAccepted?: boolean }
  ) {
    if (followerId === traderId) throw new Error('Cannot follow yourself')

    const trader = await db.copyTrader.findUnique({ where: { userId: traderId } })
    if (!trader) throw new Error('Copy trader not found')

    const existing = await db.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId: traderId } },
    })

    if (!existing) {
      // New follow: the user must agree to the Copy Trading Terms & Conditions
      // and run an account of at least the trader's minimum size (min $100).
      if (opts?.termsAccepted !== true) {
        throw new Error('You must agree to the Copy Trading Terms & Conditions before following')
      }
      const balance = Number(opts?.declaredBalanceUsd) || 0
      const minBalance = trader.minAccountBalanceUsd || 100
      if (balance < minBalance) {
        throw new Error(`Copy trading requires an account of at least $${minBalance.toFixed(2)}`)
      }
    }

    // Validate connection belongs to the follower if provided
    if (opts?.connectionId) {
      const conn = await db.botConnection.findUnique({ where: { id: opts.connectionId } })
      if (!conn || conn.userId !== followerId) {
        throw new Error('Invalid broker account connection')
      }
    }

    const follow = await db.follow.upsert({
      where: { followerId_followingId: { followerId, followingId: traderId } },
      create: {
        followerId,
        followingId: traderId,
        autoCopy: opts?.autoCopy ?? true,
        copyRatio: opts?.copyRatio ?? 1.0,
        maxPositionSize: opts?.maxPositionSize ?? 1000,
        declaredBalanceUsd: Number(opts?.declaredBalanceUsd) || existing?.declaredBalanceUsd || null,
        connectionId: opts?.connectionId || null,
        termsAccepted: true,
        termsAcceptedAt: new Date(),
      },
      update: {
        autoCopy: opts?.autoCopy ?? true,
        copyRatio: opts?.copyRatio ?? 1.0,
        maxPositionSize: opts?.maxPositionSize ?? 1000,
        ...(opts?.connectionId ? { connectionId: opts.connectionId } : {}),
      },
    })
    await this.syncFollowerCount(traderId)
    return follow
  }

  static async unfollowTrader(followerId: string, traderId: string, closeOpenTrades = false) {
    // Close open copy trades if requested
    if (closeOpenTrades) {
      const openTrades = await db.copyTrade.findMany({
        where: { followerId, traderId, status: 'open' },
      })
      for (const trade of openTrades) {
        // Force-close at the entry price (no profit/loss) — the real PnL is on the broker
        await db.copyTrade.update({
          where: { id: trade.id },
          data: { status: 'closed', closedAt: new Date() },
        })
      }
    }
    const result = await db.follow.deleteMany({ where: { followerId, followingId: traderId } })
    if (result.count > 0) await this.syncFollowerCount(traderId)
    return { unfollowed: result.count > 0, closedTrades: closeOpenTrades }
  }

  private static async syncFollowerCount(traderId: string) {
    const provider = await db.copyTrader.findUnique({ where: { userId: traderId } })
    if (!provider) return
    const count = await db.follow.count({ where: { followingId: traderId } })
    await db.copyTrader.update({ where: { id: provider.id }, data: { totalFollowers: count } })
  }

  static async getFollowing(userId: string) {
    const follows = await db.follow.findMany({
      where: { followerId: userId },
      include: {
        following: {
          select: {
            id: true, name: true, profilePicture: true,
            subscriptionTier: true, referralCount: true,
          },
        },
        connection: {
          select: { label: true, brokerName: true, platform: true, login: true },
        },
      },
    })
    return follows
  }

  static async getFollowers(userId: string) {
    return db.follow.findMany({
      where: { followingId: userId },
      include: {
        follower: { select: { id: true, name: true, profilePicture: true } },
      },
    })
  }

  static async copyTrade(followerId: string, traderId: string, trade: {
    symbol: string; direction: string; size: number; entryPrice: number
    stopLoss?: number; takeProfit?: number; sourceSignalId?: string
  }) {
    const follow = await db.follow.findFirst({
      where: { followerId, followingId: traderId, autoCopy: true },
    })
    if (!follow) return null

    const positionSize = Math.min(trade.size * follow.copyRatio, follow.maxPositionSize)
    return db.copyTrade.create({
      data: {
        followerId,
        traderId,
        sourceSignalId: trade.sourceSignalId,
        symbol: trade.symbol,
        direction: trade.direction,
        size: positionSize,
        entryPrice: trade.entryPrice,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        status: 'open',
      },
    })
  }

  static async getCopyTrades(userId: string, limit = 50) {
    return db.copyTrade.findMany({
      where: { followerId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { trader: { select: { name: true, profilePicture: true } } },
    })
  }

  // ── Copy trader provider profile ─────────────────────────────────────────

  static async upsertProvider(userId: string, data: { handle: string; bio?: string; copyFeePct?: number }) {
    await backfillCopyTraderFees()
    const handle = data.handle.trim()
    if (!handle) throw new Error('A public handle is required')
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(handle)) {
      throw new Error('Handle must be 3-24 characters (letters, numbers, underscores)')
    }
    const existing = await db.copyTrader.findUnique({ where: { handle } })
    if (existing && existing.userId !== userId) {
      throw new Error('That handle is already taken')
    }
    const fee = data.copyFeePct != null ? Math.min(100, Math.max(0, data.copyFeePct)) : 50
    return db.copyTrader.upsert({
      where: { userId },
      create: {
        userId,
        handle,
        bio: data.bio || null,
        copyFeePct: fee,
        minAccountBalanceUsd: 100,
        lotsPer100Usd: 0.01,
        status: 'approved',
      },
      update: {
        handle,
        bio: data.bio ?? undefined,
        copyFeePct: fee,
      },
    })
  }

  static async getProvider(userId: string) {
    const provider = await db.copyTrader.findUnique({
      where: { userId },
      include: {
        _count: { select: { settlements: true } },
      },
    })
    if (!provider) return null
    const [dueAgg, paidAgg] = await Promise.all([
      db.copySettlement.aggregate({
        where: { traderId: provider.id, status: 'due' },
        _sum: { providerAmount: true },
      }),
      db.copySettlement.aggregate({
        where: { traderId: provider.id, status: 'paid' },
        _sum: { providerAmount: true },
      }),
    ])
    const [platDueAgg, platPaidAgg] = await Promise.all([
      db.copySettlement.aggregate({
        where: { traderId: provider.id, status: 'due' },
        _sum: { platformAmount: true },
      }),
      db.copySettlement.aggregate({
        where: { traderId: provider.id, status: 'paid' },
        _sum: { platformAmount: true },
      }),
    ])
    return {
      ...provider,
      brokerEarned: {
        due: dueAgg._sum.providerAmount || 0,
        paid: paidAgg._sum.providerAmount || 0,
      },
      platformEarned: {
        due: platDueAgg._sum.platformAmount || 0,
        paid: platPaidAgg._sum.platformAmount || 0,
      },
    }
  }

  static async listProviders() {
    const providers = await db.copyTrader.findMany({
      where: { status: 'approved' },
      orderBy: { realizedPnl: 'desc' },
      take: 50,
      include: {
        user: { select: { id: true, name: true, profilePicture: true } },
      },
    })
    const providerIds = providers.map(p => p.userId)
    const [followerCounts, winCounts, lossCounts] = await Promise.all([
      db.follow.groupBy({
        by: ['followingId'],
        where: { followingId: { in: providerIds } },
        _count: true,
      }),
      db.copySettlement.groupBy({
        by: ['traderId'],
        where: { traderId: { in: providers.map(p => p.id) }, grossProfit: { gt: 0 } },
        _count: true,
      }),
      db.copySettlement.groupBy({
        by: ['traderId'],
        where: { traderId: { in: providers.map(p => p.id) }, grossProfit: { lt: 0 } },
        _count: true,
      }),
    ])
    const followerMap = new Map(followerCounts.map(f => [f.followingId, f._count]))
    const winMap = new Map(winCounts.map(w => [w.traderId, w._count]))
    const lossMap = new Map(lossCounts.map(l => [l.traderId, l._count]))

    return providers.map((p) => {
      const totalFollowers = followerMap.get(p.userId) || 0
      const wins = winMap.get(p.id) || 0
      const losses = lossMap.get(p.id) || 0
      const totalClosed = wins + losses
      return {
        id: p.id,
        userId: p.userId,
        handle: p.handle,
        bio: p.bio,
        copyFeePct: p.copyFeePct,
        platformFeePct: p.platformFeePct,
        minAccountBalanceUsd: p.minAccountBalanceUsd,
        lotsPer100Usd: p.lotsPer100Usd,
        status: p.status,
        totalFollowers,
        realizedPnl: p.realizedPnl,
        trades: totalClosed,
        winRate: totalClosed > 0 ? Math.round((wins / totalClosed) * 1000) / 10 : 0,
        user: p.user,
      }
    })
  }

  static async getMySettlements(userId: string, limit = 50) {
    return db.copySettlement.findMany({
      where: { trader: { userId } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        trader: { select: { handle: true } },
        follower: { select: { name: true } },
      },
    })
  }

  // ── Closing a copy trade + profit settlement ─────────────────────────────

  static async closeCopyTrade(followerId: string, copyTradeId: string, exitPrice: number) {
    const trade = await db.copyTrade.findUnique({ where: { id: copyTradeId } })
    if (!trade) throw new Error('Copy trade not found')
    if (trade.followerId !== followerId) throw new Error('Not your copy trade')
    if (trade.status !== 'open') throw new Error('Copy trade is already closed')

    const pnl = trade.direction === 'BUY'
      ? (exitPrice - trade.entryPrice) * trade.size
      : (trade.entryPrice - exitPrice) * trade.size

    const settlementId = `copy_${trade.id}`
    const traderProfile = await db.copyTrader.findUnique({ where: { userId: trade.traderId } })
    const providerFeePct = traderProfile?.copyFeePct ?? 30
    const platformFeePct = traderProfile?.platformFeePct ?? 10

    // Settlement only applies on positive gross profit.
    const grossProfit = pnl > 0 ? pnl : 0
    const platformAmount = Math.round(grossProfit * (platformFeePct / 100) * 100) / 100
    const providerAmount = Math.round(grossProfit * (providerFeePct / 100) * 100) / 100

    const ops: Array<Prisma.PrismaPromise<unknown>> = [
      db.copyTrade.update({
        where: { id: trade.id },
        data: { status: 'closed', exitPrice, pnl: Math.round(pnl * 100) / 100 },
      }),
    ]

    if (traderProfile) {
      ops.push(
        db.copySettlement.create({
          data: {
            traderId: traderProfile.id,
            followerId,
            copyTradeId: trade.id,
            grossProfit: Math.round(grossProfit * 100) / 100,
            providerFeePct,
            platformFeePct,
            providerAmount,
            platformAmount,
            status: 'due',
          },
        })
      )
      ops.push(
        db.copyTrader.update({
          where: { id: traderProfile.id },
          data: { realizedPnl: { increment: Math.round(pnl * 100) / 100 } },
        })
      )
      if (platformAmount > 0) {
        ops.push(
          db.platformEarning.create({
            data: {
              source: 'copy_fee',
              amount: platformAmount,
              reference: settlementId,
            },
          })
        )
      }
    }

    await db.$transaction(ops)
    return { trade: { ...trade, status: 'closed', exitPrice, pnl: Math.round(pnl * 100) / 100 }, pnl: Math.round(pnl * 100) / 100 }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Leaderboards
// ────────────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  id: string
  name: string | null
  avatar: string | null
  totalTrades: number
  winRate: number
  totalProfit: number
  rank: number
}

export class LeaderboardService {
  static async getTopTraders(period: 'week' | 'month' | 'all' = 'month', limit = 10): Promise<LeaderboardEntry[]> {
    const dateFilter = this.getDateFilter(period)

    // Aggregate from closed signals
    const traders = await db.user.findMany({
      where: {
        signals: {
          some: { createdAt: { gte: dateFilter }, status: { in: ['hit_tp', 'hit_sl', 'expired'] } },
        },
      },
      select: {
        id: true, name: true, profilePicture: true,
        signals: {
          where: { createdAt: { gte: dateFilter }, status: { in: ['hit_tp', 'hit_sl', 'expired'] } },
          select: { status: true, resultType: true, entryPrice: true, resultPrice: true },
        },
      },
      take: 200,
    })

    const results = traders.map((t) => {
      const total = t.signals.length
      const wins = t.signals.filter((s) => s.status === 'hit_tp').length
      const winRate = total > 0 ? (wins / total) * 100 : 0
      const profit = t.signals.reduce((sum, s) => {
        if (!s.resultPrice) return sum
        const diff = (s.resultPrice - s.entryPrice) / s.entryPrice * 100
        return sum + (s.status === 'hit_tp' ? Math.abs(diff) : -Math.abs(diff))
      }, 0)
      return {
        id: t.id,
        name: t.name,
        avatar: t.profilePicture,
        totalTrades: total,
        winRate: Math.round(winRate * 10) / 10,
        totalProfit: Math.round(profit * 100) / 100,
        rank: 0,
      }
    })

    results.sort((a, b) => b.winRate - a.winRate || b.totalProfit - a.totalProfit)
    results.forEach((r, i) => { r.rank = i + 1 })
    return results.slice(0, limit)
  }

  private static getDateFilter(period: string): Date {
    const d = new Date()
    if (period === 'week') d.setDate(d.getDate() - 7)
    else if (period === 'month') d.setMonth(d.getMonth() - 1)
    else d.setFullYear(d.getFullYear() - 5)
    return d
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Competitions
// ────────────────────────────────────────────────────────────────────────────

export class CompetitionService {
  static async createCompetition(creatorId: string, data: {
    name: string; description?: string; type?: string
    startDate: string; endDate: string; entryFee?: number; maxParticipants?: number
  }) {
    return db.competition.create({
      data: {
        name: data.name,
        description: data.description,
        creatorId,
        type: data.type || 'win_rate',
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        entryFee: data.entryFee || 0,
        maxParticipants: data.maxParticipants,
        prizePool: 0,
        status: new Date(data.startDate) > new Date() ? 'upcoming' : 'active',
      },
    })
  }

  static async listCompetitions(status?: string) {
    return db.competition.findMany({
      where: status ? { status } : undefined,
      orderBy: { startDate: 'desc' },
      take: 50,
      include: {
        creator: { select: { name: true, profilePicture: true } },
        _count: { select: { entries: true } },
      },
    })
  }

  static async joinCompetition(competitionId: string, userId: string) {
    const competition = await db.competition.findUnique({
      where: { id: competitionId },
      include: { _count: { select: { entries: true } } },
    })
    if (!competition) throw new Error('Competition not found')
    if (competition.status !== 'active' && competition.status !== 'upcoming') {
      throw new Error('Competition is no longer accepting entries')
    }
    const existingEntry = await db.competitionEntry.findUnique({
      where: { competitionId_userId: { competitionId, userId } },
    }).catch(() => null)
    if (existingEntry) throw new Error('Already entered in this competition')
    if (competition.maxParticipants && competition._count.entries >= competition.maxParticipants) {
      throw new Error('Competition is full')
    }
    return db.competitionEntry.create({
      data: { competitionId, userId },
    })
  }

  static async getLeaderboard(competitionId: string) {
    return db.competitionEntry.findMany({
      where: { competitionId },
      orderBy: { rank: 'asc' },
      include: { user: { select: { name: true, profilePicture: true } } },
    })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Direct Messaging
// ────────────────────────────────────────────────────────────────────────────

export class DirectMessagingService {
  static async getOrCreateConversation(userA: string, userB: string) {
    const [p1, p2] = [userA, userB].sort()
    return db.conversation.upsert({
      where: { participant1Id_participant2Id: { participant1Id: p1, participant2Id: p2 } },
      create: { participant1Id: p1, participant2Id: p2 },
      update: {},
    })
  }

  static async listConversations(userId: string) {
    return db.conversation.findMany({
      where: {
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        participant1: { select: { id: true, name: true, profilePicture: true } },
        participant2: { select: { id: true, name: true, profilePicture: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, createdAt: true, senderId: true },
        },
      },
    })
  }

  static async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { participant1Id: true, participant2Id: true },
    })
    return !!conv && (conv.participant1Id === userId || conv.participant2Id === userId)
  }

  static async getMessages(conversationId: string, limit = 100) {
    return db.directMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: { sender: { select: { id: true, name: true, profilePicture: true } } },
    })
  }

  static async sendMessage(conversationId: string, senderId: string, content: string) {
    const [msg] = await Promise.all([
      db.directMessage.create({ data: { conversationId, senderId, content } }),
      db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }),
    ])
    return msg
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Groups
// ────────────────────────────────────────────────────────────────────────────

export class GroupService {
  static async createGroup(ownerId: string, data: { name: string; description?: string; category?: string; isPrivate?: boolean }) {
    const group = await db.group.create({
      data: {
        name: data.name,
        description: data.description,
        ownerId,
        category: data.category || 'trading',
        isPrivate: data.isPrivate || false,
      },
    })
    // Owner becomes first member with role 'owner'
    await db.groupMember.create({
      data: { groupId: group.id, userId: ownerId, role: 'owner' },
    })
    return group
  }

  static async listGroups(category?: string) {
    return db.group.findMany({
      where: {
        AND: [
          category ? { category } : {},
          { isPrivate: false },
        ],
      },
      orderBy: { memberCount: 'desc' },
      take: 50,
      include: {
        owner: { select: { name: true, profilePicture: true } },
        _count: { select: { members: true } },
      },
    })
  }

  static async joinGroup(groupId: string, userId: string) {
    const group = await db.group.findUnique({ where: { id: groupId }, select: { isPrivate: true } })
    if (!group) throw new Error('Group not found')
    const existing = await db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } })
    if (existing) return existing
    const membership = await db.groupMember.create({ data: { groupId, userId } })
    await db.group.update({ where: { id: groupId }, data: { memberCount: { increment: 1 } } })
    return membership
  }

  static async leaveGroup(groupId: string, userId: string) {
    const result = await db.groupMember.deleteMany({ where: { groupId, userId } })
    if (result.count > 0) {
      await db.group.update({ where: { id: groupId }, data: { memberCount: { decrement: 1 } } })
    }
    return result
  }

  static async getUserGroups(userId: string) {
    const memberships = await db.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            owner: { select: { name: true, profilePicture: true } },
            _count: { select: { members: true } },
          },
        },
      },
    })
    return memberships.map((m) => ({ ...m.group, role: m.role, joinedAt: m.joinedAt }))
  }
}
