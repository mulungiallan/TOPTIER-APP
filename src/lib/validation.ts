// Shared request-validation schemas (Zod).
// Used by API route handlers to validate incoming JSON bodies/query params
// BEFORE touching the DB or business logic. Every route should parse its
// input through one of these or a route-specific zod schema. Never trust raw
// `body` values — the old codebase was vulnerable to inconsistent manual
// checks (NaN-parsing, unbounded limits, etc.).

import { z } from "zod";

// ─── Common field schemas ───────────────────────────────────────────────────
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(254);

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const idSchema = z.string().min(1).max(64);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  page: z.coerce.number().int().min(1).nullish(),
});

// ─── Auth ───────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  action: z.literal("login"),
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  action: z.literal("register"),
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().max(100).nullable().optional(),
  dateOfBirth: z.string().max(20).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  referralCode: z.string().trim().max(32).optional(),
});

export const authRouteSchema = z.discriminatedUnion("action", [
  loginSchema,
  registerSchema,
]);

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

export const socialAuthSchema = z.object({
  provider: z.enum(['google', 'apple']),
  token: z.string().min(20, 'Invalid social token').max(8192),
  name: z.string().trim().max(100).nullable().optional(),
});

// ─── Payments ───────────────────────────────────────────────────────────────
// The payment-init route uses `planType` (trial | premium_monthly |
// premium_annual | lifetime, plus a-la-carte products signals_monthly |
// bot_quarterly | remove_ads). Keep this in sync with the route's local schema.
export const paymentInitSchema = z.object({
  provider: z.enum(["stripe", "paypal", "paystack", "flutterwave", "mpesa", "airtel", "mtn", "revenuecat", "pesapal", "bank", "wallet"]),
  planType: z.enum(["trial", "premium_daily", "premium_weekly", "premium_quarterly", "premium_annual", "lifetime", "signals_monthly", "bot_quarterly", "remove_ads", "mentorship_physical", "mentorship_online", "ebook"]),
  couponCode: z.string().trim().max(64).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

// Admin → user email broadcast (announcement to a targeted set of users).
// `title` is the email subject, `message` the plain-text body (blank line =
// paragraph break, "- " = bullet, "# " = heading).
export const broadcastAudienceSchema = z.enum([
  'all',
  'verified',
  'premium',
  'trial',
  'free',
  'signals',
  'bot',
  'joined_after',
]);

export const broadcastEmailSchema = z.object({
  title: z.string().trim().min(1, 'Subject is required').max(140),
  message: z.string().trim().min(1, 'Message is required').max(5000),
  actionUrl: z.union([z.string().trim().url('Action URL must be a valid link').max(500), z.literal('')]).optional(),
  actionLabel: z.string().trim().max(50).optional(),
  audience: broadcastAudienceSchema.default('all'),
  // Only used when audience === 'joined_after' (users who signed up on/after this).
  joinedAfter: z.union([z.string().trim().date('Joined-after must be YYYY-MM-DD'), z.literal('')]).optional(),
  // When true, only deliver to the calling admin (used by the "send test" button).
  testOnly: z.boolean().optional().default(false),
});

// Idempotency: a client retry of a "create campaign" POST must not spawn a
// second campaign. Optional key; the route stores it as the campaign id.
export const broadcastCreateSchema = broadcastEmailSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(64).optional(),
});

// E-Book admin save (create/update) — content is markdown; chapters are hinted
// by lines starting with "## ". Slug is the stable URL-ish identifier.
export const ebookSaveSchema = z.object({
  id: z.string().optional(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, 'Slug must be lowercase letters, numbers and dashes (2–64 chars)'),
  title: z.string().trim().min(1, 'Title is required').max(120),
  author: z.string().trim().max(80).optional(),
  coverColor: z.string().trim().max(20).optional(),
  emoji: z.string().trim().max(16).optional(),
  description: z.string().trim().min(1, 'Description is required').max(600),
  category: z.string().trim().max(30).optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  price: z.coerce.number().positive().max(100).optional(),
  isActive: z.coerce.boolean().optional(),
  content: z.string().min(1, 'Book content is required').max(2_000_000, 'Book content is too large'),
});

// Wallet top-up flow. Pesapal bills in KES, so the charge currency is always
// KES; USD and UGX are converted at the checkout rate. EUR/GBP top-ups are not
// offered (their charge conversion is ambiguous).
export const walletFundSchema = z.object({
  asset: z.enum(["USD", "KES", "UGX"]),
  amount: z.coerce.number().finite().positive(),
  provider: z.enum(["pesapal", "mpesa", "airtel", "mtn", "bank"]).optional(),
  phone: z.string().trim().min(1).max(32).optional(),
  bank: z.string().trim().min(1).max(64).optional(),
  reference: z.string().trim().min(1).max(128).optional(),
});

// Real on-chain wallet deposit via NOWPayments.
export const cryptoDepositSchema = z.object({
  asset: z.enum(["BTC", "ETH", "USDT", "SOL"]),
  amount: z.coerce.number().finite().positive(),
});

// ─── Admin actions ──────────────────────────────────────────────────────────
export const adminBanSchema = z.object({
  action: z.enum(["ban_user", "suspend_user", "unban_user"]),
  userId: idSchema,
  reason: z.string().trim().max(500).optional(),
  duration: z.coerce.number().int().min(1).max(365).optional(),
});

// ─── Generic helpers ────────────────────────────────────────────────────────
export interface ValidationResult<T> {
  success: true;
  data: T;
}

/**
 * Parse an unknown JSON body with a zod schema. Returns the typed data on
 * success or a human-readable error message on failure.
 */
export function validateBody<T>(schema: z.ZodType<T>, body: unknown): ValidationResult<T> | { success: false; error: string } {
  const result = schema.safeParse(body);
  if (result.success) return { success: true, data: result.data };
  const message = result.error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
  return { success: false, error: message };
}

/** Parse query params (URLSearchParams or a Record) into a schema. */
export function validateQuery<T>(schema: z.ZodType<T>, source: URLSearchParams | Record<string, unknown>): ValidationResult<T> | { success: false; error: string } {
  const raw: Record<string, unknown> = source instanceof URLSearchParams
    ? Object.fromEntries(source.entries())
    : source;
  return validateBody(schema, raw);
}