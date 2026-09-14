// Client for the Python "Trading Signals Engine" side-service (FastAPI).
// The engine owns alert + notification state persisted on a mounted volume
// (/data/db/trading_app.db), so alerts survive the web app's restarts/deploys.

const TRADING_SIGNALS_URL =
  process.env.TRADING_SIGNALS_URL || 'http://127.0.0.1:8000'

export class TradingSignalsError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function tsFetch<T = any>(
  path: string,
  init?: RequestInit
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${TRADING_SIGNALS_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      cache: 'no-store',
    })
  } catch (err) {
    throw new TradingSignalsError('Signal engine unreachable', 503)
  }

  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail ?? detail
    } catch {}
    throw new TradingSignalsError(String(detail), res.status)
  }

  return res.json() as Promise<T>
}

export type EngineMarket = 'stock' | 'crypto' | 'forex'

export interface EngineAlert {
  id: number
  user_id: string
  market: string
  symbol: string
  condition_type: string
  field: string
  comparator: string
  threshold: number
  category: string
  sound: string
  vibration: string
  linked_order_id: number | null
  status: string
  created_at: string
  triggered_at: string | null
  triggered_value: number | null
  note: string
}

export interface EngineNotification {
  id: number
  user_id: string
  alert_id: number | null
  title: string
  body: string
  sound: string
  vibration: string
  priority: string
  payload: Record<string, unknown> | null
  delivered: number
  created_at: string
  delivered_at: string | null
}

// ─── Alerts ────────────────────────────────────────────────────────────────────

export async function listAlerts(
  userId: string,
  status?: string,
  category?: string
): Promise<EngineAlert[]> {
  const params = new URLSearchParams({ user_id: userId })
  if (status) params.set('status', status)
  if (category) params.set('category', category)
  return tsFetch<EngineAlert[]>(`/alerts?${params.toString()}`)
}

interface BaseAlertInput {
  market: string
  symbol: string
  sound: string
  vibration: string
  user_id: string
}

export async function createPriceAlert(input: BaseAlertInput & {
  condition: 'above' | 'below'
  threshold: number
  note?: string
}): Promise<EngineAlert> {
  return tsFetch<EngineAlert>('/alerts', {
    method: 'POST',
    body: JSON.stringify({
      market: input.market,
      symbol: input.symbol,
      condition_type: input.condition === 'above' ? 'price_above' : 'price_below',
      threshold: input.threshold,
      field: 'close',
      comparator: input.condition === 'above' ? '>' : '<',
      user_id: input.user_id,
      sound: input.sound,
      vibration: input.vibration,
      note: input.note || '',
    }),
  })
}

export async function createTpSlAlert(input: BaseAlertInput & {
  side: 'buy' | 'sell'
  entry_price: number
  take_profit_price?: number
  stop_loss_price?: number
  linked_order_id?: number | null
}): Promise<EngineAlert[]> {
  return tsFetch<EngineAlert[]>('/alerts/tp-sl', {
    method: 'POST',
    body: JSON.stringify({
      market: input.market,
      symbol: input.symbol,
      side: input.side,
      entry_price: input.entry_price,
      take_profit_price: input.take_profit_price ?? null,
      stop_loss_price: input.stop_loss_price ?? null,
      user_id: input.user_id,
      sound: input.sound,
      vibration: input.vibration,
      linked_order_id: input.linked_order_id ?? null,
    }),
  })
}

const INDICATOR_FIELDS = [
  'rsi_14', 'macd', 'macd_signal', 'macd_hist', 'sma_20', 'sma_50',
  'sma_200', 'ema_12', 'ema_26', 'bb_upper', 'bb_lower', 'atr_14', 'close',
]
export { INDICATOR_FIELDS }

export async function createIndicatorAlert(input: BaseAlertInput & {
  field: string
  comparator: '>' | '<'
  threshold: number
  note?: string
}): Promise<EngineAlert> {
  return tsFetch<EngineAlert>('/alerts', {
    method: 'POST',
    body: JSON.stringify({
      market: input.market,
      symbol: input.symbol,
      condition_type: 'indicator',
      threshold: input.threshold,
      field: input.field,
      comparator: input.comparator,
      user_id: input.user_id,
      sound: input.sound,
      vibration: input.vibration,
      note: input.note || '',
    }),
  })
}

const SIGNAL_STRATEGIES = [
  'trend_following', 'mean_reversion', 'momentum', 'swing_trading',
  'scalping', 'stat_arbitrage', 'market_making_bias', 'breakout',
  'composite', 'consensus',
]
export { SIGNAL_STRATEGIES }

export async function createSignalAlert(input: BaseAlertInput & {
  strategy_name: string
  target_value: number
  note?: string
}): Promise<EngineAlert> {
  return tsFetch<EngineAlert>('/alerts/signal', {
    method: 'POST',
    body: JSON.stringify({
      market: input.market,
      symbol: input.symbol,
      strategy_name: input.strategy_name,
      target_value: input.target_value,
      user_id: input.user_id,
      sound: input.sound,
      vibration: input.vibration,
      note: input.note || '',
    }),
  })
}

export async function cancelAlert(alertId: number): Promise<EngineAlert> {
  return tsFetch<EngineAlert>(`/alerts/${alertId}/cancel`, { method: 'POST' })
}

export async function checkAlerts(userId: string): Promise<EngineAlert[]> {
  return tsFetch<EngineAlert[]>(`/alerts/check?user_id=${encodeURIComponent(userId)}`, {
    method: 'POST',
  })
}

// ─── Notifications ─────────────────────────────────────────────────────────────

export async function getPendingNotifications(userId: string): Promise<EngineNotification[]> {
  return tsFetch<EngineNotification[]>(`/notifications/pending?user_id=${encodeURIComponent(userId)}`)
}

export async function getNotificationHistory(userId: string, limit = 50): Promise<EngineNotification[]> {
  return tsFetch<EngineNotification[]>(`/notifications/history?user_id=${encodeURIComponent(userId)}&limit=${limit}`)
}

export async function ackNotification(notificationId: number): Promise<unknown> {
  return tsFetch(`/notifications/${notificationId}/ack`, { method: 'POST' })
}