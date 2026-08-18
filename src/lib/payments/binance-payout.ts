import { createHmac } from 'node:crypto'

// ─── Binance USDT withdrawal (automatic payout) ─────────────────────────────
// Works only when BINANCE_API_KEY / BINANCE_API_SECRET are configured on the
// server. Without keys this returns a clear "not configured" result and the
// payout request stays pending for a manual transfer.

const API_KEY = process.env.BINANCE_API_KEY
const API_SECRET = process.env.BINANCE_API_SECRET

// Withdrawals are hard-gated behind an explicit opt-in. Merely having Binance
// keys configured can never trigger an automatic transfer without this flag.
const WITHDRAWALS_ENABLED = process.env.BINANCE_WITHDRAWALS_ENABLED === 'true'

export const binanceConfigured = () => Boolean(API_KEY && API_SECRET)

export const binanceWithdrawEnabled = () => binanceConfigured() && WITHDRAWALS_ENABLED

export interface BinanceWithdrawOptions {
  address: string
  network: string // TRC20 | BEP20
  amount: number
  memo?: string
}

export interface BinanceWithdrawResult {
  ok: boolean
  withdrawId?: string
  error?: string
}

function sign(query: string): string {
  return createHmac('sha256', API_SECRET as string).update(query).digest('hex')
}

export async function binanceWithdrawUSDT(opts: BinanceWithdrawOptions): Promise<BinanceWithdrawResult> {
  if (!binanceConfigured()) {
    return { ok: false, error: 'BINANCE_API_KEY not configured — payout requires a manual transfer.' }
  }

  const network = opts.network.toUpperCase()
  if (network !== 'TRC20' && network !== 'BEP20') {
    return { ok: false, error: `Unsupported network "${opts.network}". Use TRC20 or BEP20 for USDT.` }
  }

  const params: Record<string, string> = {
    coin: 'USDT',
    network,
    address: opts.address.trim(),
    amount: opts.amount.toFixed(2),
    timestamp: String(Date.now()),
    recvWindow: '10000',
  }
  if (opts.memo) params.memo = opts.memo

  const query = new URLSearchParams(params).toString()
  const url = `https://api.binance.com/sapi/v1/capital/withdraw/apply?${query}&signature=${sign(query)}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': API_KEY as string,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: json.msg || `Binance error ${res.status}` }
    }
    return { ok: true, withdrawId: json.id ? String(json.id) : undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Binance network error' }
  }
}

export interface BinanceWithdrawRecord {
  id: string
  status: number // 0 email sent | 1 cancelled | 2 awaiting approval | 3 rejected | 4 processing | 5 failure | 6 completed
  statusDesc?: string
  txId?: string
  amount?: string
  coin?: string
  network?: string
}

// Signed query of recent withdrawals. Pass `id` (the withdraw id returned by
// binanceWithdrawUSDT) to fetch one; omit it to fetch the recent history.
export async function binanceWithdrawHistory(id?: string): Promise<BinanceWithdrawRecord[]> {
  if (!binanceConfigured()) return []

  const params: Record<string, string> = {
    timestamp: String(Date.now()),
    recvWindow: '10000',
  }
  if (id) params.id = id

  const query = new URLSearchParams(params).toString()
  const url = `https://api.binance.com/sapi/v1/capital/withdraw/history?${query}&signature=${sign(query)}`

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-MBX-APIKEY': API_KEY as string },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !Array.isArray(json)) return []
    return json.map((r) => ({
      id: r.id != null ? String(r.id) : '',
      status: Number(r.status) || 0,
      statusDesc: r.statusDesc ? String(r.statusDesc) : undefined,
      txId: r.txId ? String(r.txId) : undefined,
      amount: r.amount != null ? String(r.amount) : undefined,
      coin: r.coin ? String(r.coin) : undefined,
      network: r.network ? String(r.network) : undefined,
    }))
  } catch {
    return []
  }
}
