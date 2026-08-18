/**
 * GET /api/calendar
 * Query params: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Drop into: src/app/api/calendar/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { calendarService } from "@/lib/calendar-service";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const events = await calendarService.getEvents(startDate, endDate);

    return NextResponse.json({
      success: true,
      data: events,
      count: events.length,
    });
  } catch (e: any) {
    console.error("[/api/calendar] Error:", e);
    return NextResponse.json(
      { success: false, error: e.message || "Failed to fetch calendar" },
      { status: 500 }
    );
  }
}
