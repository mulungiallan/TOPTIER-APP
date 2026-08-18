/**
 * POST /api/screenshot-analyze
 * Body: { image: "base64string", mimeType?: "image/png" }
 *
 * Drop into: src/app/api/screenshot-analyze/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { screenshotAnalyzer } from "@/lib/screenshot-analyzer";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image, mimeType } = body;

    if (!image) {
      return NextResponse.json(
        { success: false, error: "Image is required" },
        { status: 400 }
      );
    }

    // Strip data URL prefix if present
    const base64 = image.replace(/^data:image\/\w+;base64,/, "");
    const type = mimeType || (image.startsWith("data:") ? image.split(";")[0].split(":")[1] : "image/png");

    const analysis = await screenshotAnalyzer.analyze(base64, type);

    return NextResponse.json({ success: true, data: analysis });
  } catch (e: any) {
    console.error("[/api/screenshot-analyze] Error:", e);
    return NextResponse.json(
      { success: false, error: e.message || "Failed to analyze screenshot" },
      { status: 500 }
    );
  }
}
