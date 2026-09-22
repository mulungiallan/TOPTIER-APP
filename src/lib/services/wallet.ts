import { createHash, randomUUID } from 'crypto'
import { db } from '@/lib/db'

// ─── Coin / asset catalogue (mirrors trading_signals cash_wallet & crypto_wallet) ──
export const CASH_ASSETS = ['USD', 'EUR', 'KES', 'UGX', 'GBP'] as const
export const CRYPTO_ASSETS = ['BTC', 'ETH', 'USDT', 'SOL'] as const
export const TRADABLE_ASSETS = ['USD', 'EUR', 'KES', 'UGX', 'GBP', 'BTC', 'ETH', 'USDT', 'SOL']

export type Asset = string

// ─── Top-up charge ───────────────────────────────────────────────────────────
// The platform takes a charge out of every cash wallet top-up. The credited
// "available balance" is therefore the top-up amount MINUS this charge, and the
// charge is posted to the ledger as a visible Fee row (income for the house
// leg). Configurable via TOP_UP_CHARGE_PCT, defaults to 2%.
export function getTopUpChargePct(): number {
  const raw = Number(process.env.TOP_UP_CHARGE_PCT)
  if (Number.isFinite(raw) && raw >= 0 && raw <= 100) return raw
  return 2
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── Account helpers ───────────────────────────────────────────────────────────
async function findAccount(userId: string, asset: Asset, accountType: string) {
  return db.walletAccount.findUnique({
    where: { userId_asset_accountType: { userId, asset, accountType } },
  })
}

export async function getOrCreateAccount(userId: string, asset: Asset, accountType = 'user') {
  const existing = await findAccount(userId, asset, accountType)
  if (existing) return existing
  return db.walletAccount.create({ data: { userId, asset, accountType } })
}

// Spendable balance = running sum of the `user` legs only. The `house` legs are
// the external (Byzantine) counterparty; when both are summed the books net to
// zero, which is exactly what the double-entry ledger intends.
export async function getBalance(userId: string, asset: Asset): Promise<number> {
  const rows = await db.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(we."amount"), 0) as "total"
    FROM "WalletEntry" we
    JOIN "WalletAccount" wa ON wa."id" = we."accountId"
    WHERE wa."userId" = ${userId}
      AND wa."asset" = ${asset}
      AND wa."accountType" = 'user'
  `
  return rows[0] ? Math.round(Number(rows[0].total) * 1e8) / 1e8 : 0
}

export async function getAllBalances(userId: string): Promise<Record<string, number>> {
  const rows = await db.$queryRaw<{ asset: string; total: number }[]>`
    SELECT wa."asset", COALESCE(SUM(we."amount"), 0) as "total"
    FROM "WalletAccount" wa
    LEFT JOIN "WalletEntry" we ON we."accountId" = wa."id"
    WHERE wa."userId" = ${userId} AND wa."accountType" = 'user'
    GROUP BY wa."asset"
  `
  const out: Record<string, number> = {}
  for (const { asset, total } of rows) out[asset] = Math.round(Number(total) * 1e8) / 1e8
  return out
}

// ─── Double-entry posting engine (mirror of ledger.py) ─────────────────────────
export interface Posting {
  accountId: string
  amount: number // +ve credit, -ve debit
}

export async function postTransaction(opts: {
  txType: string
  posting: Posting[]
  reference?: string | null
  memo?: string | null
  status?: 'pending' | 'posted' | 'failed' | 'reversed'
}): Promise<{ id: string; doubled: boolean }> {
  const { txType, posting, reference = null, memo = null, status = 'posted' } = opts
  if (!posting.length) throw new Error('Empty posting')
  // Idempotency: the same external reference/type never double-posts.
  if (reference) {
    const existing = await db.walletTransaction.findFirst({
      where: { txType, reference },
      select: { id: true },
    })
    if (existing) return { id: existing.id, doubled: false }
  }
  const total = posting.reduce((s, p) => s + p.amount, 0)
  if (Math.abs(total) > 1e-6) {
    throw new Error(`Unbalanced ledger entry (sum=${total})`)
  }
  const tx = await db.walletTransaction.create({
    data: {
      txType,
      reference,
      memo,
      status,
      postedAt: status === 'posted' ? new Date() : null,
      entries: { create: posting.map((p) => ({ accountId: p.accountId, amount: p.amount })) },
    },
    select: { id: true },
  })
  return { id: tx.id, doubled: true }
}

// Live double-entry health check: every transaction posting must sum to zero.
export async function verifyBooksBalance(): Promise<{ balanced: boolean; unbalancedTransactions: string[] }> {
  const rows = await db.$queryRaw<{ id: string; sum: number }[]>`
    SELECT wt."id", COALESCE(SUM(we."amount"), 0) as "sum"
    FROM "WalletTransaction" wt
    LEFT JOIN "WalletEntry" we ON we."transactionId" = wt."id"
    GROUP BY wt."id"
  `
  const unbalancedTransactions = rows.filter((r) => Math.abs(Number(r.sum)) > 1e-6).map((r) => r.id)
  return { balanced: unbalancedTransactions.length === 0, unbalancedTransactions }
}

// ─── Cash wallet (mirror of cash_wallet.py) ───────────────────────────────────
export async function depositCash(opts: {
  userId: string
  asset: Asset
  amount: number
  reference?: string | null
  memo?: string | null
}): Promise<{ status: string; newBalance: number; id?: string }> {
  const { userId, asset, amount, reference = null, memo = null } = opts
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid deposit amount')
  const user = await getOrCreateAccount(userId, asset, 'user')
  const house = await getOrCreateAccount(userId, asset, 'house')
  const ref = reference || `mock_dep_${randomUUID().slice(0, 8)}`
  const { id, doubled } = await postTransaction({
    txType: 'deposit',
    reference: ref,
    memo: memo || `Cash deposit ${asset}`,
    posting: [
      { accountId: user.id, amount },
      { accountId: house.id, amount: -amount },
    ],
  })
  return {
    status: doubled ? 'completed' : 'already_processed',
    newBalance: await getBalance(userId, asset),
    id,
  }
}

/**
 * Credit a completed wallet top-up bought via a payment provider. The pending
 * PaymentTransaction's description carries the credit instruction in the form
 * WALLET_FUND|<asset>|<amount>. The ledger reference is the provider's order
 * tracking id, so re-delivery (IPN + callback racing) can never double-credit.
 */
export async function fulfillWalletFunding(
  transaction: { id: string; userId: string; description: string | null; orderTrackingId: string | null },
  extra?: { paymentMethod?: string }
): Promise<{ fulfilled: boolean; reason?: string }> {
  // Only ever credit a transaction that is still pending. Once claimed, this
  // function is a no-op — otherwise re-delivery with a new reference could
  // post an extra deposit.
  const existing = await db.paymentTransaction.findFirst({
    where: { id: transaction.id },
    select: { status: true },
  })
  if (!existing || existing.status !== 'pending') {
    return { fulfilled: false, reason: 'already_processed' }
  }

  const marker = (transaction.description || '').match(/^WALLET_FUND\|([A-Z]{3})\|([\d.]+)/)
  if (!marker) {
    return { fulfilled: false, reason: 'invalid_marker' }
  }
  const asset = marker[1]
  const creditAmount = Number(marker[2])
  if (!CASH_ASSETS.includes(asset as (typeof CASH_ASSETS)[number])) {
    return { fulfilled: false, reason: 'unsupported_asset' }
  }
  if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
    return { fulfilled: false, reason: 'invalid_amount' }
  }

  // Credit first (idempotent by reference), then claim the transaction so a
  // concurrent IPN/callback either duplicates a no-op or skips entirely.
  await depositCash({
    userId: transaction.userId,
    asset,
    amount: creditAmount,
    reference: transaction.orderTrackingId,
    memo: `Wallet top-up${extra?.paymentMethod ? ` via ${extra.paymentMethod}` : ''}`,
  })

  // Apply the top-up charge: user balance becomes gross − charge, booked as a
  // Fee row so the "minus charges" net is explicit and auditable.
  const chargePct = getTopUpChargePct()
  if (chargePct > 0 && transaction.orderTrackingId) {
    const fee = roundMoney((creditAmount * chargePct) / 100)
    if (fee > 0 && fee < creditAmount) {
      const user = await getOrCreateAccount(transaction.userId, asset, 'user')
      const house = await getOrCreateAccount(transaction.userId, asset, 'house')
      await postTransaction({
        txType: 'fee',
        reference: `${transaction.orderTrackingId}_fee`,
        memo: `Top-up charge (${chargePct}%)`,
        posting: [
          { accountId: user.id, amount: -fee },
          { accountId: house.id, amount: fee },
        ],
      })
    }
  }

  await db.paymentTransaction.updateMany({
    where: { id: transaction.id, status: 'pending' },
    data: {
      status: 'completed',
      ...(extra?.paymentMethod ? { paymentMethod: extra.paymentMethod } : {}),
    },
  })
  return { fulfilled: true }
}

export async function withdrawCash(opts: {
  userId: string
  asset: Asset
  amount: number
  reference?: string | null
  memo?: string | null
}): Promise<{ status: string; newBalance: number; id?: string }> {
  const { userId, asset, amount, reference = null, memo = null } = opts
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid withdrawal amount')
  const balance = await getBalance(userId, asset)
  if (balance < amount) throw new Error('insufficient_balance')
  const user = await getOrCreateAccount(userId, asset, 'user')
  const house = await getOrCreateAccount(userId, asset, 'house')
  const ref = reference || `mock_wd_${randomUUID().slice(0, 8)}`
  const { id, doubled } = await postTransaction({
    txType: 'withdrawal',
    reference: ref,
    memo: memo || `Cash withdrawal ${asset}`,
    posting: [
      { accountId: house.id, amount },
      { accountId: user.id, amount: -amount },
    ],
  })
  return {
    status: doubled ? 'completed' : 'already_processed',
    newBalance: await getBalance(userId, asset),
    id,
  }
}

// ─── Crypto wallet (mirror of crypto_wallet.py) ───────────────────────────────
export async function getDepositAddress(userId: string, asset: Asset): Promise<string> {
  const existing = await db.cryptoDepositAddress.findUnique({
    where: { userId_asset: { userId, asset } },
  })
  if (existing) return existing.address
  // Deterministic mock address, matching the Python provider's shape:
  // mock_<asset>_<24 hex chars> — never a real on-chain address.
  const digest = createHash('sha256').update(`toptier|custody|${userId}|${asset}`).digest('hex').slice(0, 24)
  const address = `mock_${asset.toLowerCase()}_${digest}`
  await db.cryptoDepositAddress.create({
    data: { userId, asset, address, providerRef: `mock_custody_${randomUUID().slice(0, 8)}` },
  })
  return address
}

export async function creditCryptoDeposit(opts: {
  userId: string
  asset: Asset
  amount: number
  reference?: string | null
  memo?: string | null
}): Promise<{ status: string; newBalance: number; id?: string }> {
  const { userId, asset, amount, reference = null, memo = null } = opts
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid deposit amount')
  if (!reference) throw new Error('Missing reference')
  // txType 'transfer' + the external reference (on-chain tx hash, or the
  // provider payment key) keeps network deposits idempotent.
  const { id, doubled } = await postTransaction({
    txType: 'transfer',
    reference,
    memo: memo || `Crypto deposit ${asset}`,
    posting: [
      { accountId: (await getOrCreateAccount(userId, asset, 'user')).id, amount },
      { accountId: (await getOrCreateAccount(userId, asset, 'house')).id, amount: -amount },
    ],
  })
  return {
    status: doubled ? 'completed' : 'already_processed',
    newBalance: await getBalance(userId, asset),
    id,
  }
}

export async function withdrawCrypto(opts: {
  userId: string
  asset: Asset
  amount: number
  toAddress: string
  memo?: string | null
}): Promise<{ status: string; newBalance: number; id?: string }> {
  const { userId, asset, amount, toAddress, memo = null } = opts
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid withdrawal amount')
  const validAddress =
    /^mock_[a-z0-9]{1,64}$/i.test(toAddress) || // mock custody address
    /^bc1[a-z0-9]{20,80}$/i.test(toAddress) || // bech32 (segwit)
    /^0x[a-f0-9]{40}$/i.test(toAddress) || // EVM
    /^[1-9A-HJ-NP-Za-km-z]{25,62}$/.test(toAddress) // legacy base58
  if (!validAddress) throw new Error('invalid_address')
  const balance = await getBalance(userId, asset)
  if (balance < amount) throw new Error('insufficient_balance')
  const user = await getOrCreateAccount(userId, asset, 'user')
  const house = await getOrCreateAccount(userId, asset, 'house')
  const { id, doubled } = await postTransaction({
    txType: 'withdrawal',
    reference: `mock_cw_${randomUUID().slice(0, 8)}`,
    memo: memo || `Crypto withdrawal ${asset} → ${toAddress}`,
    posting: [
      { accountId: house.id, amount },
      { accountId: user.id, amount: -amount },
    ],
  })
  return {
    status: doubled ? 'completed' : 'already_processed',
    newBalance: await getBalance(userId, asset),
    id,
  }
}

// ─── Trade settlement (an X↔Y swap + optional fee; 5-legged balanced posting) ──
export async function settleTrade(opts: {
  userId: string
  buyAsset: Asset
  buyQty: number
  sellAsset: Asset
  sellCost: number
  fee?: number
  reference?: string
  memo?: string | null
}): Promise<{ id: string; doubled: boolean }> {
  const { userId, buyAsset, buyQty, sellAsset, sellCost, fee = 0, reference, memo = null } = opts
  if (buyAsset === sellAsset) throw new Error('Cannot trade an asset for itself')
  if (!Number.isFinite(buyQty) || buyQty <= 0 || !Number.isFinite(sellCost) || sellCost < 0 || fee < 0) {
    throw new Error('Invalid trade')
  }
  const balance = await getBalance(userId, sellAsset)
  if (balance < sellCost + fee) throw new Error('insufficient_balance')

  const buyUser = await getOrCreateAccount(userId, buyAsset, 'user')
  const buyHouse = await getOrCreateAccount(userId, buyAsset, 'house')
  const sellUser = await getOrCreateAccount(userId, sellAsset, 'user')
  const sellHouse = await getOrCreateAccount(userId, sellAsset, 'house')

  const posting: Posting[] = [
    // BTC bought: user +qty, house −qty (BTC flows in from the market)
    { accountId: buyUser.id, amount: buyQty },
    { accountId: buyHouse.id, amount: -buyQty },
    // USD spent: user −cost, house +cost (USD flows out to the market)
    { accountId: sellUser.id, amount: -sellCost },
    { accountId: sellHouse.id, amount: sellCost },
  ]
  if (fee > 0) {
    posting.push({ accountId: sellUser.id, amount: -fee })
    posting.push({ accountId: sellHouse.id, amount: fee })
  }
  return postTransaction({
    txType: 'trade_settlement',
    reference: reference || `trade_${randomUUID().slice(0, 12)}`,
    memo: memo || `Trade: ${buyQty} ${buyAsset} for ${sellCost} ${sellAsset}${fee ? ` (fee ${fee})` : ''}`,
    posting,
  })
}

// ─── History + overview ────────────────────────────────────────────────────────
export async function getTransactionHistory(userId: string, asset?: Asset, limit = 50) {
  return db.walletTransaction.findMany({
    where: {
      entries: { some: { account: { userId, asset: asset || undefined } } },
    },
    include: {
      entries: { include: { account: { select: { asset: true, accountType: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

// Consolidated bundle for the header chip + wallet page.
export async function getWalletOverview(userId: string) {
  const balances = await getAllBalances(userId)
  return { balances, ledger: await verifyBooksBalance() }
}