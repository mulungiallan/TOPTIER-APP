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

// ─── Payments ───────────────────────────────────────────────────────────────
// The payment-init route uses `planType` (trial | premium_monthly |
// premium_annual | lifetime). Keep this in sync with the route's local schema.
export const paymentInitSchema = z.object({
  provider: z.enum(["stripe", "paypal", "paystack", "flutterwave", "mpesa", "revenuecat"]),
  planType: z.enum(["trial", "premium_monthly", "premium_annual", "lifetime"]),
  couponCode: z.string().trim().max(64).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
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