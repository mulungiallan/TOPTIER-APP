/**
 * NextAuth.js Configuration with Social Providers + 2FA + Email Verification
 * Drop into: src/lib/auth.ts (replaces or extends your existing auth)
 *
 * Requires: npm install next-auth @next-auth/prisma-adapter otpauth qrcode
 *
 * Add these env vars:
 *   NEXTAUTH_URL=http://localhost:3000
 *   NEXTAUTH_SECRET=<run: openssl rand -base64 32>
 *   GOOGLE_CLIENT_ID=...
 *   GOOGLE_CLIENT_SECRET=...
 *   GITHUB_CLIENT_ID=...
 *   GITHUB_CLIENT_SECRET=...
 *   TWITTER_CLIENT_ID=...
 *   TWITTER_CLIENT_SECRET=...
 *   EMAIL_SERVER=smtp://user:pass@smtp.gmail.com:587
 *   EMAIL_FROM=TOPTIER <noreply@toptier.app>
 */

import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import TwitterProvider from "next-auth/providers/twitter";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";
import * as otpauth from "otpauth";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  jwt: { maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/login",
    signUp: "/register",
    error: "/login",
    verifyRequest: "/verify-email",
  },
  providers: [
    // ---------- Google ----------
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      allowDangerousEmailAccountLinking: true,
    }),

    // ---------- GitHub ----------
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      allowDangerousEmailAccountLinking: true,
    }),

    // ---------- Twitter/X ----------
    TwitterProvider({
      clientId: process.env.TWITTER_CLIENT_ID || "",
      clientSecret: process.env.TWITTER_CLIENT_SECRET || "",
      version: "2.0",
      allowDangerousEmailAccountLinking: true,
    }),

    // ---------- Email (magic link) ----------
    EmailProvider({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM,
      maxAge: 24 * 60 * 60,
    }),

    // ---------- Credentials (existing email/password) ----------
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        twoFactorCode: { label: "2FA Code", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
          include: { twoFactor: true, sessions: true },
        });

        if (!user || !user.password) return null;
        if (!user.emailVerified) {
          throw new Error("Please verify your email before logging in");
        }

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;

        // Check 2FA
        if (user.twoFactor?.enabled) {
          if (!credentials.twoFactorCode) {
            throw new Error("2FA_REQUIRED");
          }
          const valid = verifyTOTP(credentials.twoFactorCode, user.twoFactor.secret);
          if (!valid) {
            // Check backup codes
            const backupMatch = user.twoFactor.backupCodes.includes(credentials.twoFactorCode);
            if (!backupMatch) throw new Error("Invalid 2FA code");
            // Remove used backup code
            await prisma.twoFactor.update({
              where: { userId: user.id },
              data: {
                backupCodes: user.twoFactor.backupCodes.filter((c) => c !== credentials.twoFactorCode),
              },
            });
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account, profile }) {
      // Allow OAuth sign-in (auto-verify email for trusted providers)
      if (account?.provider !== "credentials") {
        return true;
      }
      return true;
    },

    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
      }
      if (account?.provider) {
        token.provider = account.provider;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },

  events: {
    async createUser({ user }) {
      // Auto-create related records for new users
      await prisma.paperAccount.create({
        data: { userId: user.id, balance: 100000 },
      }).catch(() => {});

      // Send welcome email
      // ...
    },
    async signIn({ user, isNewUser }) {
      if (user) {
        // Track session device
        // (Done in API route where we have request headers)
      }
    },
  },
};

export const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };

// ============ TOTP UTILITIES ============
export function generateTOTPSecret(email: string): { secret: string; uri: string } {
  const secret = new otpauth.Secret({ size: 20 }).base32;
  const totp = new otpauth.TOTP({
    issuer: "TOPTIER",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  return { secret, uri: totp.toString() };
}

export function verifyTOTP(token: string, secret: string): boolean {
  const totp = new otpauth.TOTP({
    issuer: "TOPTIER",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 6)).join("-").toUpperCase()
  );
}
