/**
 * Stripe Webhook Handler
 * POST /api/stripe/webhook
 *
 * Drop into: src/app/api/stripe/webhook/route.ts
 * Configure webhook in Stripe Dashboard → https://dashboard.stripe.com/webhooks
 * Add events: checkout.session.completed, customer.subscription.*, invoice.*
 */

import { NextRequest, NextResponse } from "next/server";
import { stripe, handleWebhookEvent } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature or secret" }, { status: 400 });
  }

  let event;
  try {
    const body = await req.text();
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  try {
    await handleWebhookEvent(event, {
      onSubscriptionCreated: async (sub) => {
        const customerId = sub.customer as string;
        const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
        if (!user) return;

        const planId = sub.items.data[0]?.price?.id || "";
        const plan = planId === process.env.STRIPE_PRICE_ELITE ? "ELITE" : "PRO";

        await prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionPlan: plan,
            subscriptionStatus: sub.status,
            subscriptionId: sub.id,
            trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
            currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
          },
        });
      },

      onSubscriptionUpdated: async (sub) => {
        const customerId = sub.customer as string;
        const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
        if (!user) return;

        const priceId = sub.items.data[0]?.price?.id;
        const plan = priceId === process.env.STRIPE_PRICE_ELITE ? "ELITE" : "PRO";

        await prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionPlan: sub.status === "active" ? plan : "FREE",
            subscriptionStatus: sub.status,
            currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
            canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
          },
        });
      },

      onSubscriptionDeleted: async (sub) => {
        const customerId = sub.customer as string;
        await prisma.user.updateMany({
          where: { stripeCustomerId: customerId },
          data: {
            subscriptionPlan: "FREE",
            subscriptionStatus: "canceled",
            subscriptionId: null,
          },
        });
      },

      onInvoicePaid: async (invoice) => {
        // Record payment in DB
        const customerId = invoice.customer as string;
        const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
        if (!user) return;

        await prisma.payment.create({
          data: {
            userId: user.id,
            stripeInvoiceId: invoice.id,
            amount: invoice.amount_paid,
            currency: invoice.currency,
            status: "PAID",
            description: `Invoice ${invoice.number}`,
            paidAt: new Date(),
          },
        }).catch(() => {/* Payment may already exist */});
      },

      onPaymentFailed: async (invoice) => {
        const customerId = invoice.customer as string;
        const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
        if (!user) return;

        await prisma.payment.create({
          data: {
            userId: user.id,
            stripeInvoiceId: invoice.id,
            amount: invoice.amount_due,
            currency: invoice.currency,
            status: "FAILED",
            description: `Failed payment for invoice ${invoice.number}`,
          },
        }).catch(() => {});

        // Smart retries are configured in Stripe dashboard
        // Optionally send email notification to user
      },
    });

    return NextResponse.json({ received: true });
  } catch (e: any) {
    console.error("[Stripe Webhook] Handler error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
