/**
 * screenshot-cross-check.ts
 *
 * Independent, deterministic verification of a vision model's chart read.
 *
 * The screenshot analyser hands an image to a VLM and returns a signal. That
 * signal is a guess about pixels. This module re-derives the same question from
 * actual market data: it fetches real OHLCV bars for the asset and timeframe the
 * model claimed to be looking at, runs the platform's own multi-timeframe signal
 * engine over them, and additionally runs the chart-structure detectors ported
 * from the reference strategy library (`src/lib/trading/patterns.ts`).
 *
 * It then reports whether the model's call is corroborated. That is the point:
 * the VLM cannot see the real series, so when its call agrees with the tape the
 * user gets independent support, and when it disagrees the UI can say so instead
 * of presenting an unverifiable number.
 *
 * Design constraints:
 *   - Never throws. A cross-check failure must not break the analysis the user
 *     actually paid for; it degrades to INSUFFICIENT_DATA.
 *   - No AI/LLM cost, no extra quota consumption.
 *   - Read-only. It never mutates the AI verdict, it only annotates it.
 */

import {
  CandleResolution,
  HistoricalCandle,
  liveMarketData,
} from '@/lib/services/live-market-data'
import {
  CandleInput,
  StyleId,
  analyzeSignal,
  computeIndicators,
} from '@/lib/services/signal-engine'
import {
  cupAndHandle,
  doubleTopBottom,
  engulfing,
  hammerShootingStar,
  headAndShoulders,
  morningEveningStar,
  threeSoldiersCrows,
  triangleWedgeBreakout,
} from '@/lib/trading/patterns'
import { toColumns } from '@/lib/trading/indicators'

export type CrossCheckVerdict = 'AGREES' | 'CONFLICTS' | 'NEUTRAL' | 'INSUFFICIENT_DATA'

/** A single chart-structure detection, newest first in the returned array. */
export interface StructureSignal {
  name: string
  /** +1 bullish / -1 bearish, matching the strategy library's convention. */
  direction: 1 | -1
  /** How many bars ago the signal fired. 0 = on the most recent bar. */
  barsAgo: number
}

export interface CrossCheckResult {
  verdict: CrossCheckVerdict
  summary: string
  asset: string | null
  timeframe: string | null
  /** The platform engine's own read on real bars, when it had enough data. */
  engine: {
    direction: 'BUY' | 'SELL'
    score: number
    confidence: number
    reason: string
  } | null
  indicators: {
    close: number
    ema20: number
    ema50: number
    rsi14: number
    adx14: number
    atr14: number
    macdHist: number
    supertrendDirection: number
  } | null
  structures: StructureSignal[]
  candlesticks: StructureSignal[]
  bars: number
  checkedAt: string
}

const MIN_BARS = 60
const FETCH_COUNT = 120
/** How many recent bars to scan for candlestick signals. */
const CANDLE_SCAN_WINDOW = 10

/**
 * Vision models emit free text. Map the common shapes onto the slash/caret
 * symbols `liveMarketData` already understands, so we reuse its Yahoo map and
 * Finnhub routing instead of duplicating provider knowledge.
 */
const ASSET_ALIASES: Record<string, string> = {
  // Crypto - VLM output is inconsistent about separators and quote currency.
  BTC: 'BTC/USD',
  BTCUSD: 'BTC/USD',
  BTCUSDT: 'BTC/USD',
  XBT: 'BTC/USD',
  BITCOIN: 'BTC/USD',
  ETH: 'ETH/USD',
  ETHUSD: 'ETH/USD',
  ETHUSDT: 'ETH/USD',
  ETHEREUM: 'ETH/USD',
  SOL: 'SOL/USD',
  SOLUSD: 'SOL/USD',
  XRP: 'XRP/USD',
  BNB: 'BNB/USD',
  DOGE: 'DOGE/USD',
  // Metals - "XAUUSD" is the spot code, GC=F the futures contract Yahoo quotes.
  XAUUSD: 'GC=F',
  XAU: 'GC=F',
  GOLD: 'GC=F',
  XAGUSD: 'SI=F',
  SILVER: 'SI=F',
  // Indices.
  US30: '^DJI',
  DJI30: '^DJI',
  DOW: '^DJI',
  NASDAQ: '^NDX',
  NAS100: '^NDX',
  NAS100USD: '^NDX',
  US100: '^NDX',
  US500: '^GSPC',
  SPX500: '^GSPC',
  SPX: '^GSPC',
  SP500: '^GSPC',
  GER40: '^GDAXI',
  UK100: '^FTSE',
  // Equities / ETFs a trader would screenshot.
  SPY: 'SPY',
  QQQ: 'QQQ',
  AAPL: 'AAPL',
  TSLA: 'TSLA',
  NVDA: 'NVDA',
  MSFT: 'MSFT',
  AMZN: 'AMZN',
  META: 'META',
  GOOG: 'GOOG',
}

/**
 * Normalise a detected asset into a symbol the market data layer can quote.
 * Returns null when we cannot map it, rather than guessing a nearby instrument -
 * checking the wrong market against the model's call would manufacture false
 * agreement.
 */
export function normalizeAsset(raw: string | null | undefined): string | null {
  if (!raw) return null
  const key = raw.trim().toUpperCase().replace(/\s+/g, '')

  const direct = ASSET_ALIASES[key]
  if (direct) return direct

  // Already in the app's native "BASE/QUOTE" form (e.g. "EUR/USD").
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(key)) return key

  // "BTC/USD", "ETH/USDT" and friends.
  const slashed = key.match(/^([A-Z]{2,6})\/([A-Z]{3,5})$/)
  if (slashed) {
    const base = slashed[1]
    const quote = slashed[2]
    if (quote === 'USDT' || quote === 'USD' || quote === 'USDC') return `${base}/USD`
  }

  return null
}

/** Map a VLM timeframe label onto a provider candle resolution. */
export function normalizeTimeframe(raw: string | null | undefined): CandleResolution | null {
  if (!raw) return null
  const t = raw.trim().toUpperCase().replace(/[\s_-]/g, '')

  if (t === '1M' || t === 'M1' || t === '1MIN' || t === 'MIN1') return '1'
  if (t === '5M' || t === 'M5' || t === '5MIN' || t === 'MIN5') return '5'
  if (t === '15M' || t === 'M15' || t === '15MIN' || t === 'MIN15') return '15'
  if (t === '30M' || t === 'M30' || t === '30MIN' || t === 'MIN30') return '30'
  // 4H has no native resolution; hourly is the closest honest mapping.
  if (t === '1H' || t === 'H1' || t === '60M' || t === 'M60' || t === '1HOUR' || t === '4H' || t === 'H4') return '60'
  if (t === '1D' || t === 'D' || t === 'D1' || t === 'DAILY' || t === '1DAY') return 'D'
  if (t === '1W' || t === 'W' || t === 'W1' || t === 'WEEKLY') return 'W'
  if (t === '1MN' || t === 'MN1' || t === 'MONTHLY' || t === '1MONTH') return 'M'
  return null
}

/** Pick the engine style that matches the resolution the model reported. */
function styleFor(res: CandleResolution): StyleId {
  if (res === '1' || res === '5' || res === '15') return 'scalp'
  if (res === '30' || res === '60') return 'intraday_swing'
  return 'swing'
}

function toCandleInput(candles: HistoricalCandle[]): CandleInput[] {
  return candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }))
}

/** Collect the most recent non-zero reading of a 1/-1/0 signal series. */
function latestSignals(
  signal: number[],
  name: string,
  maxBarsBack = Number.POSITIVE_INFINITY
): StructureSignal[] {
  const out: StructureSignal[] = []
  for (let i = signal.length - 1; i >= 0; i--) {
    const v = signal[i];
    const barsAgo = signal.length - 1 - i
    if (barsAgo > maxBarsBack) break
    if (v === 1 || v === -1) {
      out.push({ name, direction: v, barsAgo })
      // One reading per detector is enough; the UI shows the freshest.
      break
    }
  }
  return out
}

function insufficient(
  summary: string,
  asset: string | null,
  timeframe: string | null
): CrossCheckResult {
  return {
    verdict: 'INSUFFICIENT_DATA',
    summary,
    asset,
    timeframe,
    engine: null,
    indicators: null,
    structures: [],
    candlesticks: [],
    bars: 0,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * Verify an AI chart read against real market data.
 *
 * @param detectedAsset  Asset the model claimed to be looking at.
 * @param detectedTimeframe  Timeframe the model claimed.
 * @param aiSignal  The model's own call, so the verdict can compare.
 */
export async function crossCheckScreenshot(
  detectedAsset: string | null | undefined,
  detectedTimeframe: string | null | undefined,
  aiSignal: 'BUY' | 'SELL' | 'HOLD'
): Promise<CrossCheckResult> {
  const asset = normalizeAsset(detectedAsset)
  const timeframe = normalizeTimeframe(detectedTimeframe)
  const checkedAt = new Date().toISOString()

  if (!asset) {
    return insufficient(
      `Could not map "${detectedAsset ?? 'unknown asset'}" to a market we can verify, so this read is unverified.`,
      null,
      detectedTimeframe ?? null
    )
  }
  if (!timeframe) {
    return insufficient(
      `Could not map timeframe "${detectedTimeframe ?? 'unknown'}" to a candle size, so this read is unverified.`,
      asset,
      null
    )
  }

  let candles: HistoricalCandle[]
  try {
    candles = await liveMarketData.getHistoricalData(asset, timeframe, FETCH_COUNT)
  } catch {
    return insufficient(`No market data available for ${asset}.`, asset, timeframe)
  }

  if (!Array.isArray(candles) || candles.length < MIN_BARS) {
    return insufficient(
      `Only ${candles?.length ?? 0} bars of ${asset} history available; ${MIN_BARS} are needed to verify.`,
      asset,
      timeframe
    )
  }

  const input = toCandleInput(candles)
  const style = styleFor(timeframe)

  // ─── Platform signal engine on real bars ────────────────────────────────
  // confirm = null makes the engine reuse the entry series for its confirmation
  // pass, which keeps this to a single network fetch.
  const engineResult = analyzeSignal(input, null, style)
  const snap = computeIndicators(input)

  const indicators: CrossCheckResult['indicators'] = snap
    ? {
        close: snap.lastClose,
        ema20: snap.ema20,
        ema50: snap.ema50,
        rsi14: snap.rsi14,
        adx14: snap.adx14,
        atr14: snap.atr14,
        macdHist: snap.macdHist,
        // stNow is the supertrend direction (1 up / -1 down), not a price level.
        supertrendDirection: snap.extra.stNow,
      }
    : null

  // ─── Chart-structure detectors (ported strategy library) ────────────────
  const cols = toColumns(input)
  const structures: StructureSignal[] = [
    ...latestSignals(doubleTopBottom(cols), 'Double top / bottom'),
    ...latestSignals(headAndShoulders(cols), 'Head & shoulders'),
    ...latestSignals(triangleWedgeBreakout(cols), 'Triangle / wedge break'),
    ...latestSignals(cupAndHandle(cols), 'Cup & handle'),
  ].sort((a, b) => a.barsAgo - b.barsAgo)

  const candlesticks: StructureSignal[] = [
    ...latestSignals(engulfing(cols), 'Engulfing', CANDLE_SCAN_WINDOW),
    ...latestSignals(hammerShootingStar(cols), 'Hammer / shooting star', CANDLE_SCAN_WINDOW),
    ...latestSignals(morningEveningStar(cols), 'Morning / evening star', CANDLE_SCAN_WINDOW),
    ...latestSignals(threeSoldiersCrows(cols), 'Three soldiers / crows', CANDLE_SCAN_WINDOW),
  ].sort((a, b) => a.barsAgo - b.barsAgo)

  return decideVerdict({
    aiSignal,
    engineResult,
    structures,
    candlesticks,
    indicators,
    asset,
    timeframe,
    bars: candles.length,
    checkedAt,
  })
}

export interface VerdictInput {
  aiSignal: 'BUY' | 'SELL' | 'HOLD'
  engineResult: { direction: 'BUY' | 'SELL'; score: number; confidence: number; reason: string } | null
  structures: StructureSignal[]
  candlesticks: StructureSignal[]
  indicators: CrossCheckResult['indicators']
  asset: string
  timeframe: string
  bars: number
  checkedAt: string
}

/**
 * Pure verdict logic, split out from the I/O so it can be unit tested directly.
 * This is the part a user actually reads, so it gets tested without a network.
 */
export function decideVerdict(input: VerdictInput): CrossCheckResult {
  const { aiSignal, engineResult, structures, candlesticks, asset, timeframe } = input

  const independent = [...structures, ...candlesticks]
  const structureBias = independent.reduce((acc, s) => acc + s.direction, 0)

  const base = {
    asset,
    timeframe,
    indicators: input.indicators,
    structures,
    candlesticks,
    bars: input.bars,
    checkedAt: input.checkedAt,
  }

  const engine: CrossCheckResult['engine'] = engineResult
    ? {
        direction: engineResult.direction,
        score: engineResult.score,
        confidence: engineResult.confidence,
        reason: engineResult.reason,
      }
    : null

  if (aiSignal === 'HOLD') {
    // Nothing to contradict. Report what the tape says, without dressing a
    // neutral model read up as confirmation.
    if (!engineResult && independent.length === 0) {
      return {
        ...base,
        verdict: 'INSUFFICIENT_DATA',
        engine: null,
        summary: `No independent structure detected on ${asset} ${timeframe} bars.`,
      }
    }
    return {
      ...base,
      verdict: 'NEUTRAL',
      engine,
      summary: engineResult
        ? `Model held. The engine reads ${engineResult.direction} (${Math.round(
            engineResult.score * 100
          )}% score) on real ${asset} bars.`
        : independent.length > 0
          ? `Model held. No high-conviction engine view, but ${independent[0].name.toLowerCase()} fired ${independent[0].barsAgo} bar(s) ago.`
          : 'Model held, and no independent signal fired.',
    }
  }

  const aiBias = aiSignal === 'BUY' ? 1 : -1
  const freshest = independent[0]

  // ─── The engine abstained (no confluence above its score gate) ──────────
  // A silent engine is not an absence of evidence: the chart-structure
  // detectors still ran and may well corroborate. Falling straight through to
  // INSUFFICIENT_DATA here would throw away good evidence and tell a user their
  // clearly-signposted setup could not be verified.
  if (!engineResult) {
    if (independent.length === 0) {
      return {
        ...base,
        verdict: 'INSUFFICIENT_DATA',
        engine: null,
        summary: `Nothing on real ${asset} ${timeframe} bars to confirm or contradict this call.`,
      }
    }
    // Signals offset each other — genuinely mixed, so accuse neither side.
    if (structureBias === 0) {
      return {
        ...base,
        verdict: 'NEUTRAL',
        engine: null,
        summary: `Signals are mixed on ${asset} ${timeframe} bars, so this ${aiSignal} call could not be confirmed either way.`,
      }
    }
    const structureAgrees = Math.sign(structureBias) === aiBias
    return {
      ...base,
      verdict: structureAgrees ? 'AGREES' : 'CONFLICTS',
      engine: null,
      summary: structureAgrees
        ? `Confirmed by chart structure. The engine had no high-conviction view, but ${freshest.name.toLowerCase()} fired ${freshest.barsAgo} bar(s) ago on real ${asset} data.`
        : `Not confirmed. The engine had no view, but the detected chart structure (${freshest.name.toLowerCase()}, ${freshest.barsAgo} bar(s) ago) leans the other way.`,
    }
  }

  const agrees = engineResult.direction === aiSignal
  const structureAgrees =
    structureBias === 0 || Math.sign(structureBias) === (aiSignal === 'BUY' ? 1 : -1)

  if (agrees && structureAgrees) {
    return {
      ...base,
      verdict: 'AGREES',
      engine,
      summary:
        independent.length > 0
          ? `Confirmed. The engine reads ${engineResult.direction} and ${independent[0].name.toLowerCase()} fired ${independent[0].barsAgo} bar(s) ago on real ${asset} data.`
          : `Confirmed. The engine reads ${engineResult.direction} on real ${asset} ${timeframe} data, though no chart structure was detected.`,
    }
  }

  if (agrees && !structureAgrees) {
    return {
      ...base,
      verdict: 'CONFLICTS',
      engine,
      summary: `Partly confirmed. The engine agrees (${engineResult.direction}), but the detected chart structure points the other way.`,
    }
  }

  return {
    ...base,
    verdict: 'CONFLICTS',
    engine,
    summary: `Not confirmed. The model says ${aiSignal}, but the engine reads ${engineResult.direction} on real ${asset} ${timeframe} data.`,
  }
}
