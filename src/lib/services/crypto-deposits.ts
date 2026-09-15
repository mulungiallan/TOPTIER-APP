// Crypto deposit orchestration (NOWPayments-backed).
//
// A user requests a deposit: we ask NOWPayments to mint a per-payment deposit
// address (POST /v1/payment), record it as a CryptoDeposit, and show the
// address + exact amount to send. Confirmation arrives either via our IPN
// webhook or the wallet page polling the provider status endpoint; the ledger
// is credited EXACTLY once per payment because creditCryptoDeposit is keyed by
// creditReference (`nowpayments_<payment_id>`).

import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { CRYPTO_ASSETS, creditCryptoDeposit } from '@/lib/services/wallet'
import {
  binancePayoutAddress,
  createCryptoPayment,
  getMinAmount,
  getPaymentStatus,
  nowpaymentsConfigured,
} from '@/lib/payments/nowpayments'
import { env } from '@/lib/env'

// Statuses from which the deposit will never become payable.
const TERMINAL_STATUSES = ['finished', 'expired', 'failed', 'refunded', 'cancelled']

export function isOpenDepositStatus(status: string): boolean {
  return !TERMINAL_STATUSES.includes(status)
}

function creditReferenceFor(paymentId: string): string {
  return `nowpayments_${paymentId}`
}

export interface CryptoDepositDto {
  id: string
  asset: string
  amount: number
  payAddress: string
  payAmount: number | null
  paymentId: string
  status: string
  creditedAt: string | null
  createdAt: string
}

interface StoredDeposit {
  id: string
  userId: string
  asset: string
  amount: number
  payAddress: string
  payAmount: number | null
  paymentId: string
  status: string
  creditReference: string
  creditedAt: Date | null
  metadata: string | null
  createdAt: Date
}

interface StatusSnapshot {
  paymentStatus: string
  payAmount?: number | null
}

function toDto(deposit: StoredDeposit & { creditedAt: Date | null }): CryptoDepositDto {
  return {
    id: deposit.id,
    asset: deposit.asset,
    amount: deposit.amount,
    payAddress: deposit.payAddress,
    payAmount: deposit.payAmount,
    paymentId: deposit.paymentId,
    status: deposit.status,
    creditedAt: deposit.creditedAt ? deposit.creditedAt.toISOString() : null,
    createdAt: deposit.createdAt.toISOString(),
  }
}

export async function createCryptoDepositRequest(opts: {
  userId: string
  asset: string
  amount: number
}): Promise<CryptoDepositDto> {
  const { userId, asset, amount } = opts
  if (!CRYPTO_ASSETS.includes(asset as (typeof CRYPTO_ASSETS)[number])) {
    throw new Error('Unsupported crypto asset')
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid deposit amount')
  }
  if (!nowpaymentsConfigured()) {
    throw new Error('Crypto deposits are not configured yet')
  }

  const minAmount = await getMinAmount(asset)
  if (minAmount > 0 && amount < minAmount) {
    throw new Error(`Deposit is below the ${asset} minimum (${minAmount})`)
  }

  const orderId = `crpt_${randomBytes(10).toString('hex')}` // <= 40 chars
  const payoutAddress = binancePayoutAddress(asset)
  const payment = await createCryptoPayment({
    asset,
    amount,
    orderId,
    ipnCallbackUrl: `${env.appUrl}/api/wallet/crypto/ipn`,
    payoutAddress,
  })

  const deposit = await db.cryptoDeposit.create({
    data: {
      userId,
      asset,
      amount,
      payAddress: payment.payAddress,
      payAmount: payment.payAmount,
      paymentId: payment.paymentId,
      status: payment.paymentStatus || 'waiting',
      creditReference: creditReferenceFor(payment.paymentId),
      metadata: JSON.stringify({
        priceAmount: payment.priceAmount,
        priceCurrency: payment.priceCurrency,
        payCurrency: payment.payCurrency,
        ...(payoutAddress ? { settlement: 'binance' } : {}),
      }),
    },
  })

  return toDto(deposit)
}

export async function getCryptoDeposit(depositId: string, userId: string): Promise<CryptoDepositDto | null> {
  const deposit = await db.cryptoDeposit.findUnique({ where: { id: depositId } })
  if (!deposit || deposit.userId !== userId) return null
  return toDto(deposit)
}

export async function listCryptoDeposits(userId: string, limit = 20): Promise<CryptoDepositDto[]> {
  const deposits = await db.cryptoDeposit.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return deposits.map(toDto)
}

/**
 * Credit a confirmed deposit, idempotently. Only ever credits when the
 * provider reports `finished` and the deposit has not been credited yet — a
 * concurrent IPN + status poll can both reach this and the ledger still posts
 * once because the reference is fixed.
 */
export async function creditConfirmedCryptoDeposit(deposit: StoredDeposit): Promise<{ credited: boolean }> {
  if (deposit.creditedAt) {
    return { credited: false }
  }
  try {
    await creditCryptoDeposit({
      userId: deposit.userId,
      asset: deposit.asset,
      amount: deposit.amount,
      reference: deposit.creditReference,
      memo: `Crypto deposit ${deposit.asset} via NOWPayments`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'credit failed'
    if (message !== 'already_processed') throw error
    // The ledger reference already exists (IPN/status race) — the funds are
    // safely posted, so the deposit can be marked credited.
  }
  return { credited: true }
}

/**
 * Apply a provider status snapshot (IPN webhook or status poll) to the stored
 * deposit and credit the wallet once payment is finished.
 */
export async function reconcileCryptoDeposit(
  paymentId: string,
  snapshot: StatusSnapshot | null
): Promise<CryptoDepositDto | null> {
  const deposit = await db.cryptoDeposit.findUnique({ where: { paymentId } })
  if (!deposit) return null
  return reconcileStoredDeposit(deposit, snapshot)
}

async function reconcileStoredDeposit(deposit: StoredDeposit, snapshot: StatusSnapshot | null): Promise<CryptoDepositDto> {
  const status = snapshot?.paymentStatus || deposit.status
  const payAmount = snapshot?.payAmount != null ? snapshot.payAmount : deposit.payAmount

  const prevMetadata = deposit.metadata ? (JSON.parse(deposit.metadata) as Record<string, unknown>) : {}
  const data: { status: string; payAmount: number | null; metadata: string; creditedAt?: Date } = {
    status,
    payAmount,
    metadata: JSON.stringify({
      ...prevMetadata,
      ...(snapshot ? { lastStatus: snapshot.paymentStatus, lastPolledAt: new Date().toISOString() } : {}),
    }),
  }

  if (status === 'finished') {
    const { credited } = await creditConfirmedCryptoDeposit(deposit)
    if (credited) data.creditedAt = new Date()
  }

  const updated = await db.cryptoDeposit.update({ where: { id: deposit.id }, data })
  return toDto(updated)
}

/**
 * Poll the provider for the current payment status and reconcile. Called by the
 * wallet page while a deposit is still open so a missed IPN can never strand
 * funds — if the provider reports finished, the wallet is credited here.
 */
export async function pollAndReconcileCryptoDeposit(
  depositId: string,
  userId: string
): Promise<CryptoDepositDto | null> {
  const deposit = await db.cryptoDeposit.findUnique({ where: { id: depositId } })
  if (!deposit || deposit.userId !== userId) return null
  if (deposit.creditedAt || !isOpenDepositStatus(deposit.status)) {
    return toDto(deposit)
  }
  if (!nowpaymentsConfigured()) return toDto(deposit)

  const snapshot = await getPaymentStatus(deposit.paymentId)
  if (!snapshot) return toDto(deposit)

  return reconcileStoredDeposit(deposit, {
    paymentStatus: snapshot.paymentStatus,
    payAmount: snapshot.payAmount,
  })
}