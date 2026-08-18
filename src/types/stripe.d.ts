declare module 'stripe' {
  namespace Stripe {
    type ApiVersion = '2025-05-27.basil' | '2026-05-27.dahlia'

    interface MetadataObject {
      [key: string]: string | number | null | undefined
    }

    interface ApiError {
      type: string
      code?: string
      decline_code?: string
      doc_url?: string
      message?: string
      param?: string
      charge?: string
    }

    interface Customer {
      id: string
      object: 'customer'
      address?: object | null
      balance?: number
      created: number
      currency?: string
      default_source?: string | null
      description?: string | null
      email?: string | null
      metadata: MetadataObject
      name?: string | null
      phone?: string | null
    }

    interface Subscription {
      id: string
      object: 'subscription'
      cancel_at?: number | null
      canceled_at?: number | null
      current_period_end: number
      current_period_start: number
      customer: string | Customer
      metadata: MetadataObject
      status: string
      items: { object: 'list'; data: SubscriptionItem[] }
    }

    interface SubscriptionItem {
      id: string
      object: 'subscription_item'
      price?: Price
      quantity?: number
    }

    interface Price {
      id: string
      object: 'price'
      active: boolean
      currency: string
      metadata: MetadataObject
      nickname?: string | null
      product?: string | Product | null
      recurring?: { interval: string; interval_count: number } | null
      unit_amount?: number | null
    }

    interface Product {
      id: string
      object: 'product'
      active: boolean
      description?: string | null
      metadata: MetadataObject
      name: string
    }

    interface Invoice {
      id: string
      object: 'invoice'
      amount_due: number
      amount_paid: number
      customer: string | Customer
      customer_email?: string
      hosted_invoice_url?: string
      invoice_pdf?: string
      metadata: MetadataObject
      payment_intent?: string | PaymentIntent
      status: string
      subscription?: string | Subscription
      parent?: {
        subscription_details?: { subscription?: string | Subscription }
      }
      lines: { object: 'list'; data: InvoiceLineItem[] }
    }

    interface InvoiceLineItem {
      id: string
      amount: number
      description?: string
      metadata: MetadataObject
      price?: Price
    }

    interface PaymentIntent {
      id: string
      object: 'payment_intent'
      amount: number
      currency: string
      customer?: string | Customer | null
      metadata: MetadataObject
      status: string
      payment_method?: string | PaymentMethod | null
    }

    interface PaymentMethod {
      id: string
      object: 'payment_method'
      type: string
      customer?: string | Customer | null
      metadata: MetadataObject
    }

    interface Event {
      id: string
      object: 'event'
      type: string
      api_version: string
      created: number
      data: { object: object; previous_attributes?: object }
      livemode: boolean
      request: { id?: string | null; idempotency_key?: string | null } | null
    }

    interface Refund {
      id: string
      object: 'refund'
      amount: number
      payment_intent: string | PaymentIntent
      reason: string | null
      status: string
      metadata?: MetadataObject
    }

    interface WebhookEndpoint {
      id: string
      object: 'webhook_endpoint'
      url: string
      secret?: string
    }

    interface FileObject {
      id: string
      object: 'file'
      filename: string
      purpose: string
      size: number
      type: string
      url: string
    }

    interface LineItem {
      id: string
      amount_total?: number
      description?: string
      metadata?: MetadataObject
      price?: Price
      quantity?: number
    }

    // ─── Checkout namespace (used as Stripe.Checkout.Session, etc.) ──────────
    namespace Checkout {
      interface Session {
        id: string
        object: 'checkout.session'
        cancel_url?: string
        client_reference_id?: string
        customer?: string | Customer
        amount_total?: number
        currency?: string
        line_items?: { object: 'list'; data: LineItem[] }
        metadata: MetadataObject
        mode?: string
        payment_intent?: string | PaymentIntent
        payment_status?: string
        success_url?: string
        subscription?: string | Subscription
        url?: string
      }

      namespace SessionCreateParams {
        interface LineItem {
          price?: string
          price_data?: {
            currency: string
            product_data: { name: string; description?: string; images?: string[] }
            unit_amount: number
          }
          quantity: number
        }
      }
    }
  }

  class Stripe {
    static webhooks: {
      constructEvent(
        payload: string | Buffer,
        sigHeader: string,
        secret: string,
        tolerance?: number,
        apiVersion?: string,
      ): Stripe.Event
    }

    customers: {
      create(params?: object, options?: object): Promise<Stripe.Customer>
      retrieve(id: string, options?: object): Promise<Stripe.Customer>
      update(id: string, params?: object, options?: object): Promise<Stripe.Customer>
      del(id: string, options?: object): Promise<{ id: string; object: string }>
    }

    checkout: {
      sessions: {
        create(params?: object, options?: object): Promise<Stripe.Checkout.Session>
        retrieve(id: string, options?: object): Promise<Stripe.Checkout.Session>
      }
    }

    subscriptions: {
      create(params?: object, options?: object): Promise<Stripe.Subscription>
      retrieve(id: string, options?: object): Promise<Stripe.Subscription>
      update(id: string, params?: object, options?: object): Promise<Stripe.Subscription>
      cancel(id: string, options?: object): Promise<Stripe.Subscription>
      list(params?: object, options?: object): Promise<{ object: 'list'; data: Stripe.Subscription[] }>
    }

    invoices: {
      create(params?: object, options?: object): Promise<Stripe.Invoice>
      retrieve(id: string, options?: object): Promise<Stripe.Invoice>
    }

    paymentIntents: {
      create(params?: object, options?: object): Promise<Stripe.PaymentIntent>
      retrieve(id: string, options?: object): Promise<Stripe.PaymentIntent>
      confirm(id: string, params?: object, options?: object): Promise<Stripe.PaymentIntent>
      capture(id: string, params?: object, options?: object): Promise<Stripe.PaymentIntent>
    }

    refunds: {
      create(params?: object, options?: object): Promise<Stripe.Refund>
    }

    constructor(apiKey: string, options?: {
      apiVersion?: Stripe.ApiVersion
      typescript?: boolean
      timeout?: number
      maxNetworkRetries?: number
    })

    webhooks: {
      constructEvent(
        payload: string | Buffer,
        sigHeader: string,
        secret: string,
        tolerance?: number,
        apiVersion?: string,
      ): Stripe.Event
    }
  }

  export = Stripe
}
