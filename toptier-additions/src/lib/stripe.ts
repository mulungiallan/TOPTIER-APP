/**
 * Stripe Integration — Subscription management, invoices, refunds
 * Drop into: src/lib/stripe.ts
 *
 * Requires: npm install stripe
 * Get keys: https://dashboard.stripe.com/apikeys
 */

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder", {
  apiVersion: "2024-06-20",
  typescript: true,
});

export { stripe };

// ============ PRODUCT/PRICE CONFIG ============
export const PLANS = {
  FREE: {
    id: "free",
    name: "Free",
    price: 0,
    features: ["3 signals per day", "Basic charts", "Community access"],
  },
  PRO: {
    id: "pro",
    name: "Pro",
    price: 29,
    stripePriceId: process.env.STRIPE_PRICE_PRO || "price_pro_monthly",
    features: ["Unlimited signals", "AI screenshot analyzer", "Push notifications", "Advanced charts", "Paper trading"],
  },
  ELITE: {
    id: "elite",
    name: "Elite",
    price: 99,
    stripePriceId: process.env.STRIPE_PRICE_ELITE || "price_elite_monthly",
    features: ["Everything in Pro", "Backtesting", "Copy trading", "Priority support", "API access", "Custom alerts"],
  },
} as const;

export type PlanId = keyof typeof PLANS;

// ============ CUSTOMER MANAGEMENT ============
export async function createCustomer(user: { id: string; email: string; name?: string }): Promise<Stripe.Customer> {
  return await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: user.id },
  });
}

export async function getCustomer(customerId: string): Promise<Stripe.Customer | null> {
  try {
    return await stripe.customers.retrieve(customerId) as Stripe.Customer;
  } catch {
    return null;
  }
}

// ============ SUBSCRIPTION MANAGEMENT ============
export async function createSubscription(params: {
  customerId: string;
  priceId: string;
  trialDays?: number;
  couponId?: string;
}): Promise<Stripe.Subscription> {
  return await stripe.subscriptions.create({
    customer: params.customerId,
    items: [{ price: params.priceId }],
    trial_period_days: params.trialDays,
    coupon: params.couponId,
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    expand: ["latest_invoice.payment_intent"],
  });
}

export async function cancelSubscription(subscriptionId: string, cancelAtPeriodEnd = true): Promise<Stripe.Subscription> {
  return await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: cancelAtPeriodEnd,
  });
}

export async function upgradeSubscription(subscriptionId: string, newPriceId: string): Promise<Stripe.Subscription> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const oldItemId = subscription.items.data[0].id;

  return await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: oldItemId, price: newPriceId }],
    proration_behavior: "create_prorations",
  });
}

export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return await stripe.subscriptions.retrieve(subscriptionId, { expand: ["customer", "latest_invoice"] });
}

// ============ BILLING PORTAL ============
export async function createBillingPortalSession(customerId: string, returnUrl: string): Promise<Stripe.BillingPortal.Session> {
  return await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

// ============ CHECKOUT ============
export async function createCheckoutSession(params: {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
}): Promise<Stripe.Checkout.Session> {
  return await stripe.checkout.sessions.create({
    customer: params.customerId,
    payment_method_types: ["card"],
    line_items: [{ price: params.priceId, quantity: 1 }],
    mode: "subscription",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    subscription_data: params.trialDays ? { trial_period_days: params.trialDays } : undefined,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
  });
}

// ============ INVOICES ============
export async function listInvoices(customerId: string, limit = 24): Promise<Stripe.Invoice[]> {
  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit,
  });
  return invoices.data;
}

export async function getInvoice(invoiceId: string): Promise<Stripe.Invoice> {
  return await stripe.invoices.retrieve(invoiceId);
}

export async function downloadInvoice(invoiceId: string): Promise<Buffer> {
  const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["invoice_pdf"] });
  if (!invoice.invoice_pdf) throw new Error("No PDF available");
  const res = await fetch(invoice.invoice_pdf);
  return Buffer.from(await res.arrayBuffer());
}

// ============ REFUNDS ============
export async function createRefund(params: {
  chargeId?: string;
  paymentIntentId?: string;
  amount?: number;       // partial refund in cents
  reason?: "duplicate" | "fraudulent" | "requested_by_customer";
  metadata?: Record<string, string>;
}): Promise<Stripe.Refund> {
  return await stripe.refunds.create({
    charge: params.chargeId,
    payment_intent: params.paymentIntentId,
    amount: params.amount,
    reason: params.reason,
    metadata: params.metadata,
  });
}

// ============ FAILED PAYMENT RETRY ============
// Configure in Stripe Dashboard > Billing > Settings > Smart Retries
// Or manually retry an invoice:
export async function retryInvoice(invoiceId: string): Promise<Stripe.Invoice> {
  return await stripe.invoices.pay(invoiceId, { expand: ["payment_intent"] });
}

// ============ WEBHOOK HANDLER ============
export async function handleWebhookEvent(event: Stripe.Event, handlers?: {
  onSubscriptionCreated?: (sub: Stripe.Subscription) => Promise<void>;
  onSubscriptionUpdated?: (sub: Stripe.Subscription) => Promise<void>;
  onSubscriptionDeleted?: (sub: Stripe.Subscription) => Promise<void>;
  onInvoicePaid?: (invoice: Stripe.Invoice) => Promise<void>;
  onInvoiceFailed?: (invoice: Stripe.Invoice) => Promise<void>;
  onPaymentFailed?: (invoice: Stripe.Invoice) => Promise<void>;
}): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      // Save subscription to DB
      break;
    case "customer.subscription.created":
      if (handlers?.onSubscriptionCreated) {
        await handlers.onSubscriptionCreated(event.data.object as Stripe.Subscription);
      }
      break;
    case "customer.subscription.updated":
      if (handlers?.onSubscriptionUpdated) {
        await handlers.onSubscriptionUpdated(event.data.object as Stripe.Subscription);
      }
      break;
    case "customer.subscription.deleted":
      if (handlers?.onSubscriptionDeleted) {
        await handlers.onSubscriptionDeleted(event.data.object as Stripe.Subscription);
      }
      break;
    case "invoice.paid":
      if (handlers?.onInvoicePaid) {
        await handlers.onInvoicePaid(event.data.object as Stripe.Invoice);
      }
      break;
    case "invoice.payment_failed":
      if (handlers?.onInvoiceFailed || handlers?.onPaymentFailed) {
        const invoice = event.data.object as Stripe.Invoice;
        await handlers.onInvoiceFailed?.(invoice);
        await handlers.onPaymentFailed?.(invoice);
      }
      break;
    default:
      // Unhandled event — log for monitoring
      console.log(`[Stripe] Unhandled event: ${event.type}`);
  }
}
