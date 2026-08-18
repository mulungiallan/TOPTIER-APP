/**
 * Stripe Checkout / Billing Portal API
 * POST /api/stripe/checkout  — create checkout session
 * POST /api/stripe/portal    — billing portal session
 * GET  /api/stripe/invoices  — list user invoices
 * POST /api/stripe/refund    — admin-only refund
 *
 * Drop into: src/app/api/stripe/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { stripe, PLANS, createCheckoutSession, createBillingPortalSession, listInvoices, createRefund } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const invoices = await listInvoices(user.stripeCustomerId || "");
    return NextResponse.json({
      success: true,
      data: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        amountPaid: inv.amount_paid,
        currency: inv.currency,
        status: inv.status,
        created: new Date(inv.created * 1000).toISOString(),
        pdfUrl: inv.invoice_pdf,
        hostedUrl: inv.hosted_invoice_url,
      })),
    });
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

    // ---------- CHECKOUT ----------
    if (action === "checkout") {
      const { plan } = body;
      const planConfig = PLANS[plan as keyof typeof PLANS];
      if (!planConfig?.stripePriceId) {
        return NextResponse.json({ success: false, error: "Invalid plan" }, { status: 400 });
      }

      // Ensure customer exists
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: user.id },
        });
        customerId = customer.id;
        await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
      }

      const session = await createCheckoutSession({
        customerId,
        priceId: planConfig.stripePriceId,
        successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/settings?upgrade=success`,
        cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/settings?upgrade=cancelled`,
        trialDays: 7,
      });

      return NextResponse.json({ success: true, url: session.url });
    }

    // ---------- BILLING PORTAL ----------
    if (action === "portal") {
      if (!user.stripeCustomerId) {
        return NextResponse.json({ success: false, error: "No active subscription" }, { status: 400 });
      }
      const session = await createBillingPortalSession(
        user.stripeCustomerId,
        `${process.env.NEXT_PUBLIC_APP_URL}/settings`
      );
      return NextResponse.json({ success: true, url: session.url });
    }

    // ---------- REFUND (admin only) ----------
    if (action === "refund") {
      if (user.role !== "ADMIN") {
        return NextResponse.json({ success: false, error: "Admin only" }, { status: 403 });
      }
      const { chargeId, amount, reason } = body;
      const refund = await createRefund({
        chargeId,
        amount,
        reason: reason || "requested_by_customer",
        metadata: { refundedBy: user.id },
      });
      return NextResponse.json({ success: true, data: { id: refund.id, status: refund.status } });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("[/api/stripe] Error:", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
