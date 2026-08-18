/**
 * GET /api/news
 * Query params: ?category=forex|stocks|crypto|commodities|economy|general
 *
 * Drop into: src/app/api/news/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { newsService } from "@/lib/news-service";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category") || undefined;

    const news = await newsService.getNews(category);

    return NextResponse.json({
      success: true,
      data: news,
      count: news.length,
      cached: true,
    });
  } catch (e: any) {
    console.error("[/api/news] Error:", e);
    return NextResponse.json(
      { success: false, error: e.message || "Failed to fetch news" },
      { status: 500 }
    );
  }
}
