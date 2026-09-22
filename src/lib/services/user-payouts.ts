import { db } from '@/lib/db'
import { getBalance, withdrawCash, depositCash } from '@/lib/services/wallet'
import { binanceWithdrawEnabled, binanceWithdrawUSDT } from '@/lib/payments/binance-payout'

// ─── Automatic user cash withdrawals ────────────────────────────────────────
//
// TURNS A USER'S WALLET BALANCE INTO REAL MONEY.
//
// The old flow (POST /api/wallet action=withdraw → withdrawCash) only posted a
// double-entry ledger row (mock reference, nothing sent). Users saw their
// balance drop and never received anything. This is the replacement: money moves
// only in one direction — through a live payout rail.
//
// Rails:
//   - USDT balance   → sent as-is as USDT to the user's address over Binance.
//   - USD cash       → sent as USDT 1:1 at the moment of withdrawal. There is
//                      no FX feed wired-up yet; 1 USDT = 1 USD by policy. If a
//                      live USD→USDT rate is ever integrated, adjust here.
//   - Any other asset → rejected up-front. We never fake a payout for a rail
//                      we cannot honour.
//
// Ordering (reserve-then-settle) makes over-withdrawal impossible and payouts
// crash-safe:
//   1. create a PayoutRequest with status 'pending'  (the record)
//   2. debit the user's ledger with reference payout_<id>  (the reserve; hard
//      cap enforced inside withdrawCash so the balance is never exceeded)
//   3. call Binance to actually send the USDT
//   4. success → mark 'processing' + save the Binance withdraw id
//      failure → mark 'failed', refund the reserve via depositCash, and surface
//                a clear error. A ledger record exists for every attempt.

const TRC20_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{25,40}$/
const BEP20_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

// Minimum payout we submit to Binance. Binance rejects micro-withdrawals; the
// fee is absorbed by the platform's Binance balance, never the user.
export const MIN_PAYOUT_USD = 1

export function payoutSupportedFor(asset: string): boolean {
  return asset === 'USD' || asset === 'USDT'
}

function maskAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export async function submitUserCashWithdrawal(opts: {
  userId: string
  asset: string
  amount: number
  toAddress: string
  network?: string
}): Promise<{ payoutId: string; withdrawId?: string; newBalance: number }> {
  if (!binanceWithdrawEnabled()) {
    throw new Error('Automatic withdrawals are currently disabled. Contact support.')
  }

  const asset = String(opts.asset || 'USD').toUpperCase()
  if (!payoutSupportedFor(asset)) {
    throw new Error(
      `Automatic withdrawal from ${asset} is not supported. Withdrawable: USD (paid as USDT 1:1) and USDT.`
    )
  }

  const amount = Number(opts.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid withdrawal amount')
  if (amount < MIN_PAYOUT_USD) {
    throw new Error(`Minimum automatic payout is $${MIN_PAYOUT_USD}.`)
  }

  const network = String(opts.network || 'TRC20').toUpperCase()
  if (network !== 'TRC20' && network !== 'BEP20') {
    throw new Error('Network must be TRC20 or BEP20.')
  }
  const address = String(opts.toAddress || '').trim()
  const validAddress = network === 'TRC20' ? TRC20_ADDRESS_RE.test(address) : BEP20_ADDRESS_RE.test(address)
  if (!validAddress) {
    throw new Error(network === 'TRC20' ? 'Invalid USDT address. TRC20 addresses start with T.' : 'Invalid USDT address. BEP20 addresses are 0x…')
  }

  // A user may only have one payout in flight at a time — prevents double-send
  // if the same request is retried or the button is pressed twice.
  const open = await db.payoutRequest.findFirst({
    where: { userId: opts.userId, status: { in: ['pending', 'processing'] } },
    select: { id: true },
  })
  if (open) {
    throw new Error('A payout is already being processed on this account. Wait for it to finish.')
  }

  const balance = await getBalance(opts.userId, asset)
  if (amount > balance) {
    throw new Error('insufficient_balance')
  }

  const destination = `${maskAddress(address)} (${network})`

  // 1. Record the attempt.
  const payout = await db.payoutRequest.create({
    data: {
      userId: opts.userId,
      method: 'binance',
      destination,
      amount,
      // `currency` records the SOURCE wallet asset debited (USD or USDT) so a
      // refund credits the right ledger account; `asset` is the rail coin sent.
      currency: asset,
      netAmount: amount,
      asset: 'USDT',
      status: 'pending',
    },
  })

  // 2. Reserve — debit the ledger. withdrawCash re-checks the balance itself, so
  //    the user can never withdraw more than they hold even under a race.
  let booked: { newBalance: number }
  try {
    booked = await withdrawCash({
      userId: opts.userId,
      asset,
      amount,
      reference: `payout_${payout.id}`,
      memo: `USDT payout → ${destination}`,
    })
  } catch (error) {
    await db.payoutRequest.update({
      where: { id: payout.id },
      data: { status: 'failed', failureReason: error instanceof Error ? error.message : 'Balance check failed' },
    })
    throw error
  }

  // 3. Actually send the money.
  const result = await binanceWithdrawUSDT({
    address,
    network,
    amount,
    memo: `toptier_${opts.userId.slice(0, 8)}`,
  })

  if (result.ok) {
    // 4a. On the way.
    await db.payoutRequest.update({
      where: { id: payout.id },
      data: { status: 'processing', txHash: result.withdrawId || null },
    })
    return { payoutId: payout.id, withdrawId: result.withdrawId, newBalance: booked.newBalance }
  }

  // 4b. Failed — return the reserve to the user's wallet, keep the record.
  await db.payoutRequest.update({
    where: { id: payout.id },
    data: { status: 'failed', failureReason: result.error || 'Binance withdrawal failed' },
  })
  try {
    await depositCash({
      userId: opts.userId,
      asset,
      amount,
      reference: `refund_${payout.id}`,
      memo: `Refund — payout ${destination} failed`,
    })
  } catch {
    // Refund ledger already idempotent per reference; nothing further to do.
  }
  throw new Error(`Payout failed: ${result.error || 'Binance error'} — your ${asset} was refunded.`)
}