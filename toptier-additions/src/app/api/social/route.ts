/**
 * Social API Routes
 * GET  /api/social/feed                — get social feed
 * POST /api/social/post                — create post
 * POST /api/social/like                — like/unlike post
 * POST /api/social/comment             — comment on post
 * POST /api/social/follow              — follow/unfollow user
 * GET  /api/social/leaderboard?period=month — get leaderboard
 * POST /api/social/copy-trading        — enable/disable copy trading
 *
 * Drop into: src/app/api/social/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import {
  getFeed, createPost, likePost, unlikePost, commentOnPost,
  followTrader, unfollowTrader, getLeaderboard,
  enableCopyTrading, disableCopyTrading,
} from "@/lib/social-trading";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const endpoint = searchParams.get("endpoint") || "feed";
    const page = parseInt(searchParams.get("page") || "1");

    if (endpoint === "feed") {
      const posts = await getFeed(user.id, page);
      return NextResponse.json({ success: true, data: posts });
    }

    if (endpoint === "leaderboard") {
      const period = (searchParams.get("period") || "month") as "week" | "month" | "all";
      const leaderboard = await getLeaderboard(period);
      return NextResponse.json({ success: true, data: leaderboard });
    }

    if (endpoint === "following") {
      const following = await prisma.follow.findMany({
        where: { followerId: user.id },
        include: { following: { select: { id: true, name: true, image: true, bio: true, followersCount: true } } },
      });
      return NextResponse.json({ success: true, data: following.map((f) => f.following) });
    }

    return NextResponse.json({ success: false, error: "Unknown endpoint" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    if (action === "post") {
      const post = await createPost({
        userId: user.id,
        content: body.content,
        attachedSignalId: body.attachedSignalId,
        attachedChartUrl: body.attachedChartUrl,
      });
      return NextResponse.json({ success: true, data: post });
    }

    if (action === "like") {
      await likePost(user.id, body.postId);
      return NextResponse.json({ success: true });
    }

    if (action === "unlike") {
      await unlikePost(user.id, body.postId);
      return NextResponse.json({ success: true });
    }

    if (action === "comment") {
      const comment = await commentOnPost(user.id, body.postId, body.content);
      return NextResponse.json({ success: true, data: comment });
    }

    if (action === "follow") {
      await followTrader(user.id, body.userId);
      return NextResponse.json({ success: true });
    }

    if (action === "unfollow") {
      await unfollowTrader(user.id, body.userId);
      return NextResponse.json({ success: true });
    }

    if (action === "copy-trading-enable") {
      await enableCopyTrading(user.id, body.traderId, {
        allocationUsd: body.allocationUsd,
        maxPositions: body.maxPositions,
        copyStopLoss: body.copyStopLoss,
        copyTakeProfit: body.copyTakeProfit,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "copy-trading-disable") {
      await disableCopyTrading(user.id, body.traderId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
