/**
 * 2FA Setup API — generates TOTP secret + QR code
 * POST /api/auth/2fa/setup    — generate secret + QR
 * POST /api/auth/2fa/verify   — verify code + enable 2FA
 * POST /api/auth/2fa/disable  — disable 2FA (requires current code)
 *
 * Drop into: src/app/api/auth/2fa/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { generateTOTPSecret, verifyTOTP, generateBackupCodes } from "@/lib/auth-config";
import QRCode from "qrcode";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action, code, secret: pendingSecret } = body;

    // ---------- SETUP: generate secret + QR ----------
    if (action === "setup") {
      const { secret, uri } = generateTOTPSecret(user.email);
      const qrDataUrl = await QRCode.toDataURL(uri, { width: 200, margin: 1 });

      return NextResponse.json({
        success: true,
        data: {
          secret,            // User must save this in authenticator app
          qrCode: qrDataUrl, // Data URL to display
          uri,               // otpauth:// URI
          backupCodes: generateBackupCodes(),
        },
      });
    }

    // ---------- VERIFY: enable 2FA ----------
    if (action === "verify") {
      if (!pendingSecret || !code) {
        return NextResponse.json({ success: false, error: "Secret and code required" }, { status: 400 });
      }
      const valid = verifyTOTP(code, pendingSecret);
      if (!valid) {
        return NextResponse.json({ success: false, error: "Invalid code" }, { status: 400 });
      }

      const backupCodes = generateBackupCodes();
      await prisma.twoFactor.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          secret: pendingSecret,
          backupCodes,
          enabled: true,
          enabledAt: new Date(),
        },
        update: {
          secret: pendingSecret,
          backupCodes,
          enabled: true,
          enabledAt: new Date(),
        },
      });

      return NextResponse.json({ success: true, data: { backupCodes } });
    }

    // ---------- DISABLE ----------
    if (action === "disable") {
      if (!code) {
        return NextResponse.json({ success: false, error: "Code required" }, { status: 400 });
      }
      const twoFactor = await prisma.twoFactor.findUnique({ where: { userId: user.id } });
      if (!twoFactor) return NextResponse.json({ success: false, error: "2FA not enabled" }, { status: 400 });

      const valid = verifyTOTP(code, twoFactor.secret) || twoFactor.backupCodes.includes(code);
      if (!valid) return NextResponse.json({ success: false, error: "Invalid code" }, { status: 400 });

      await prisma.twoFactor.delete({ where: { userId: user.id } });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("[/api/auth/2fa] Error:", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
