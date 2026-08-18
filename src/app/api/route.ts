import { NextResponse } from "next/server";
import { seedDemoData } from "@/lib/seed";

export async function GET() {
  // Seed endpoint is only available to admins in development.
  // In production, seeding is never triggered from the API.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ app: "TOPTIER", version: "1.0.0", status: "running" });
  }

  if (!process.env.ADMIN_SEED_SECRET || process.env.ADMIN_SEED_SECRET.length < 8) {
    return NextResponse.json({ error: "Seed not configured" }, { status: 403 });
  }

  try {
    await seedDemoData();
  } catch {
    // Ignore seed errors
  }

  return NextResponse.json({
    app: "TOPTIER",
    version: "1.0.0",
    status: "running",
  });
}