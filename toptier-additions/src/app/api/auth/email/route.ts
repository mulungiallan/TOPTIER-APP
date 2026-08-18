/**
 * Email Verification API
 * POST /api/auth/email/verify    — verify email with token
 * POST /api/auth/email/resend    — resend verification email
 *
 * Drop into: src/app/api/auth/email/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { randomBytes } from "crypto";
import nodemailer from "nodemailer";

const transporter = process.env.EMAIL_SERVER
  ? nodemailer.createTransport(process.env.EMAIL_SERVER)
  : null;

async function sendVerificationEmail(email: string, token: string) {
  if (!transporter) {
    console.warn("EMAIL_SERVER not configured — skipping email send");
    return;
  }
  const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/verify-email?token=${token}`;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "TOPTIER <noreply@toptier.app>",
    to: email,
    subject: "Verify your TOPTIER account",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #00d4ff;">Welcome to TOPTIER!</h1>
        <p>Please verify your email address to activate your account.</p>
        <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #00d4ff; color: #000; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 16px 0;">
          Verify Email
        </a>
        <p style="color: #888; font-size: 12px;">Or copy this link: ${verifyUrl}</p>
        <p style="color: #888; font-size: 12px;">This link expires in 24 hours.</p>
      </div>
    `,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, token } = body;

    // ---------- VERIFY ----------
    if (action === "verify") {
      if (!token) return NextResponse.json({ success: false, error: "Token required" }, { status: 400 });

      const verification = await prisma.emailVerification.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!verification) {
        return NextResponse.json({ success: false, error: "Invalid token" }, { status: 400 });
      }
      if (verification.expiresAt < new Date()) {
        return NextResponse.json({ success: false, error: "Token expired" }, { status: 400 });
      }

      await prisma.user.update({
        where: { id: verification.userId },
        data: { emailVerified: new Date() },
      });
      await prisma.emailVerification.delete({ where: { token } });

      return NextResponse.json({ success: true });
    }

    // ---------- RESEND ----------
    if (action === "resend") {
      const user = await getAuthUser(req);
      if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      if (user.emailVerified) {
        return NextResponse.json({ success: false, error: "Email already verified" }, { status: 400 });
      }

      // Invalidate old tokens
      await prisma.emailVerification.deleteMany({ where: { userId: user.id } });

      const newToken = randomBytes(32).toString("hex");
      await prisma.emailVerification.create({
        data: {
          userId: user.id,
          token: newToken,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      await sendVerificationEmail(user.email, newToken);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("[/api/auth/email] Error:", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
