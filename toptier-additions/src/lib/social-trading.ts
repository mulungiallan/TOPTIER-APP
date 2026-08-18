/**
 * Social Trading Service
 * Drop into: src/lib/social-trading.ts
 *
 * Features: Follow traders, copy trades, leaderboards, social feed.
 */

import { prisma } from "./prisma";

// ============ FOLLOWING ============
export async function followTrader(followerId: string, traderId: string): Promise<void> {
  if (followerId === traderId) throw new Error("Cannot follow yourself");

  await prisma.follow.upsert({
    where: { followerId_followingId: { followerId, followingId: traderId } },
    create: { followerId, followingId: traderId },
    update: {},
  });

  // Update counts
  await prisma.user.update({
    where: { id: traderId },
    data: { followersCount: { increment: 1 } },
  });
  await prisma.user.update({
    where: { id: followerId },
    data: { followingCount: { increment: 1 } },
  });
}

export async function unfollowTrader(followerId: string, traderId: string): Promise<void> {
  await prisma.follow.deleteMany({
    where: { followerId, followingId: traderId },
  });

  await prisma.user.update({
    where: { id: traderId },
    data: { followersCount: { decrement: 1 } },
  });
  await prisma.user.update({
    where: { id: followerId },
    data: { followingCount: { decrement: 1 } },
  });
}

export async function getFollowing(userId: string) {
  const follows = await prisma.follow.findMany({
    where: { followerId: userId },
    include: { following: { select: { id: true, name: true, image: true, bio: true, followersCount: true } } },
  });
  return follows.map((f) => f.following);
}

export async function getFollowers(userId: string) {
  const follows = await prisma.follow.findMany({
    where: { followingId: userId },
    include: { follower: { select: { id: true, name: true, image: true } } },
  });
  return follows.map((f) => f.follower);
}

// ============ COPY TRADING ============
export async function enableCopyTrading(followerId: string, traderId: string, params: {
  allocationUsd: number;
  maxPositions?: number;
  copyStopLoss?: boolean;
  copyTakeProfit?: boolean;
}): Promise<void> {
  await prisma.copyTradeConfig.upsert({
    where: { followerId_traderId: { followerId, traderId } },
    create: {
      followerId,
      traderId,
      allocationUsd: params.allocationUsd,
      maxPositions: params.maxPositions || 5,
      copyStopLoss: params.copyStopLoss ?? true,
      copyTakeProfit: params.copyTakeProfit ?? true,
      active: true,
    },
    update: {
      allocationUsd: params.allocationUsd,
      maxPositions: params.maxPositions,
      copyStopLoss: params.copyStopLoss,
      copyTakeProfit: params.copyTakeProfit,
      active: true,
    },
  });
}

export async function disableCopyTrading(followerId: string, traderId: string): Promise<void> {
  await prisma.copyTradeConfig.updateMany({
    where: { followerId, traderId },
    data: { active: false },
  });
}

// Called when a trader opens a position — replicate to all followers
export async function replicateTradeToFollowers(traderId: string, trade: {
  pair: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  size: number;
  stopLoss?: number;
  takeProfit?: number;
}): Promise<void> {
  const configs = await prisma.copyTradeConfig.findMany({
    where: { traderId, active: true },
  });

  for (const config of configs) {
    // Calculate scaled position size based on allocation vs trader's typical size
    const scaledSize = trade.size * (config.allocationUsd / 10000); // simple scaling

    try {
      await prisma.paperPosition.create({
        data: {
          userId: config.followerId,
          pair: trade.pair,
          direction: trade.direction,
          size: scaledSize,
          entryPrice: trade.entryPrice,
          currentPrice: trade.entryPrice,
          stopLoss: config.copyStopLoss ? trade.stopLoss : null,
          takeProfit: config.copyTakeProfit ? trade.takeProfit : null,
          pnl: 0,
          pnlPercent: 0,
          margin: (scaledSize * trade.entryPrice) / 30,
          status: "OPEN",
          openedAt: new Date(),
          copiedFromId: traderId,
        },
      });
    } catch (e) {
      console.error(`Failed to replicate trade to ${config.followerId}:`, e);
    }
  }
}

// ============ LEADERBOARDS ============
export async function getLeaderboard(period: "week" | "month" | "all" = "month", limit = 100) {
  const since = period === "week"
    ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    : period === "month"
    ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    : new Date(0);

  const leaderboard = await prisma.user.findMany({
    where: {
      paperTrades: { some: { closedAt: { gte: since } } },
    },
    select: {
      id: true,
      name: true,
      image: true,
      followersCount: true,
      paperTrades: {
        where: { closedAt: { gte: since } },
        select: { pnl: true },
      },
    },
    take: limit,
  });

  return leaderboard
    .map((u) => {
      const totalPnl = u.paperTrades.reduce((s, t) => s + t.pnl, 0);
      const winRate = u.paperTrades.filter((t) => t.pnl > 0).length / (u.paperTrades.length || 1);
      return {
        id: u.id,
        name: u.name || "Anonymous",
        image: u.image,
        followersCount: u.followersCount,
        totalPnl,
        winRate,
        tradeCount: u.paperTrades.length,
      };
    })
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

// ============ SOCIAL FEED ============
export async function createPost(params: {
  userId: string;
  content: string;
  attachedSignalId?: string;
  attachedChartUrl?: string;
}): Promise<any> {
  return await prisma.post.create({
    data: {
      userId: params.userId,
      content: params.content,
      attachedSignalId: params.attachedSignalId,
      attachedChartUrl: params.attachedChartUrl,
      createdAt: new Date(),
    },
    include: {
      user: { select: { id: true, name: true, image: true } },
      _count: { select: { likes: true, comments: true } },
    },
  });
}

export async function getFeed(userId: string, page = 1, pageSize = 20) {
  // Get posts from user + everyone they follow
  const following = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });
  const userIds = [userId, ...following.map((f) => f.followingId)];

  return await prisma.post.findMany({
    where: { userId: { in: userIds } },
    include: {
      user: { select: { id: true, name: true, image: true, followersCount: true } },
      likes: { where: { userId }, select: { id: true } },
      _count: { select: { likes: true, comments: true } },
      comments: {
        take: 3,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, name: true, image: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
}

export async function likePost(userId: string, postId: string): Promise<void> {
  await prisma.like.upsert({
    where: { userId_postId: { userId, postId } },
    create: { userId, postId },
    update: {},
  });
}

export async function unlikePost(userId: string, postId: string): Promise<void> {
  await prisma.like.deleteMany({ where: { userId, postId } });
}

export async function commentOnPost(userId: string, postId: string, content: string): Promise<any> {
  return await prisma.comment.create({
    data: { userId, postId, content, createdAt: new Date() },
    include: { user: { select: { id: true, name: true, image: true } } },
  });
}

// ============ COMPETITIONS ============
export async function createCompetition(params: {
  name: string;
  description: string;
  startDate: Date;
  endDate: Date;
  startingCapital: number;
  entryFee?: number;
  prizes: { rank: number; amount: number }[];
}): Promise<any> {
  return await prisma.competition.create({ data: params });
}

export async function joinCompetition(competitionId: string, userId: string): Promise<void> {
  await prisma.competitionEntry.create({
    data: { competitionId, userId, joinedAt: new Date() },
  });
}

export async function getCompetitionLeaderboard(competitionId: string) {
  const entries = await prisma.competitionEntry.findMany({
    where: { competitionId },
    include: {
      user: { select: { id: true, name: true, image: true } },
      user: {
        select: {
          id: true, name: true, image: true,
          paperTrades: { select: { pnl: true, closedAt: true } },
        },
      },
    },
  });

  return entries
    .map((e) => {
      const totalPnl = (e.user as any).paperTrades.reduce((s: number, t: any) => s + t.pnl, 0);
      return {
        userId: e.user.id,
        name: e.user.name,
        image: e.user.image,
        totalPnl,
        rank: 0, // calculated after sort
      };
    })
    .sort((a, b) => b.totalPnl - a.totalPnl)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}
