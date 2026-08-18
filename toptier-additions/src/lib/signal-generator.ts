/**
 * AI Signal Generator
 * Drop into: src/lib/signal-generator.ts
 *
 * Generates trading signals using technical indicators (no external AI API needed).
 * Computes multiple indicators and uses weighted scoring to produce BUY/SELL signals
 * with confidence levels and risk parameters.
 *
 * Indicators used:
 *  - EMA crossover (9/21/50)
 *  - RSI (14)
 *  - MACD
 *  - Bollinger Bands
 *  - ATR (for stop-loss sizing)
 *  - Stochastic Oscillator
 */

import { cache, cacheKeys } from "./cache";

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GeneratedSignal {
  id: string;
  pair: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number;
  takeProfit3: number;
  confidence: number;          // 0-1
  riskRewardRatio: number;
  indicators: {
    ema9: number;
    ema21: number;
    ema50: number;
    rsi: number;
    macd: number;
    macdSignal: number;
    macdHistogram: number;
    bbUpper: number;
    bbMiddle: number;
    bbLower: number;
    atr: number;
    stochastic: number;
  };
  reasons: string[];           // Human-readable reasons
  timeframe: string;
  createdAt: string;
  expiresAt: string;
}

// ============== INDICATOR CALCULATIONS ==============

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values[0];
  result.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine.slice(-9), 9);
  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalLine[signalLine.length - 1];
  return { macd: macdVal, signal: signalVal, histogram: macdVal - signalVal };
}

function bollingerBands(closes: number[], period = 20, stdDev = 2) {
  if (closes.length < period) {
    const last = closes[closes.length - 1];
    return { upper: last * 1.02, middle: last, lower: last * 0.98 };
  }
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: middle + stdDev * sd, middle, lower: middle - stdDev * sd };
}

function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0.001;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function stochastic(candles: Candle[], period = 14): number {
  if (candles.length < period) return 50;
  const slice = candles.slice(-period);
  const highest = Math.max(...slice.map((c) => c.high));
  const lowest = Math.min(...slice.map((c) => c.low));
  const current = candles[candles.length - 1].close;
  if (highest === lowest) return 50;
  return ((current - lowest) / (highest - lowest)) * 100;
}

// ============== SIGNAL GENERATION ==============

interface SignalScore {
  direction: "BUY" | "SELL";
  score: number;
  reasons: string[];
}

function computeScore(candles: Candle[]): SignalScore {
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];

  const ema9Arr = ema(closes, 9);
  const ema21Arr = ema(closes, 21);
  const ema50Arr = ema(closes, 50);
  const ema9 = ema9Arr[ema9Arr.length - 1];
  const ema21 = ema21Arr[ema21Arr.length - 1];
  const ema50 = ema50Arr[ema50Arr.length - 1];

  const rsiVal = rsi(closes);
  const macdData = macd(closes);
  const bb = bollingerBands(closes);
  const stochasticVal = stochastic(candles);

  let bullScore = 0;
  let bearScore = 0;
  const reasons: string[] = [];

  // EMA trend
  if (ema9 > ema21 && ema21 > ema50) {
    bullScore += 25;
    reasons.push("EMA 9/21/50 bullish alignment");
  } else if (ema9 < ema21 && ema21 < ema50) {
    bearScore += 25;
    reasons.push("EMA 9/21/50 bearish alignment");
  } else if (ema9 > ema21) {
    bullScore += 10;
    reasons.push("EMA 9 above EMA 21");
  } else {
    bearScore += 10;
    reasons.push("EMA 9 below EMA 21");
  }

  // RSI
  if (rsiVal < 30) {
    bullScore += 20;
    reasons.push(`RSI oversold (${rsiVal.toFixed(1)})`);
  } else if (rsiVal > 70) {
    bearScore += 20;
    reasons.push(`RSI overbought (${rsiVal.toFixed(1)})`);
  } else if (rsiVal > 55) {
    bullScore += 10;
    reasons.push(`RSI bullish (${rsiVal.toFixed(1)})`);
  } else if (rsiVal < 45) {
    bearScore += 10;
    reasons.push(`RSI bearish (${rsiVal.toFixed(1)})`);
  }

  // MACD
  if (macdData.histogram > 0 && macdData.macd > macdData.signal) {
    bullScore += 20;
    reasons.push("MACD bullish crossover");
  } else if (macdData.histogram < 0 && macdData.macd < macdData.signal) {
    bearScore += 20;
    reasons.push("MACD bearish crossover");
  }

  // Bollinger Bands
  if (last < bb.lower) {
    bullScore += 15;
    reasons.push("Price below lower Bollinger Band (oversold)");
  } else if (last > bb.upper) {
    bearScore += 15;
    reasons.push("Price above upper Bollinger Band (overbought)");
  }

  // Stochastic
  if (stochasticVal < 20) {
    bullScore += 10;
    reasons.push(`Stochastic oversold (${stochasticVal.toFixed(1)})`);
  } else if (stochasticVal > 80) {
    bearScore += 10;
    reasons.push(`Stochastic overbought (${stochasticVal.toFixed(1)})`);
  }

  const totalScore = bullScore + bearScore;
  const direction: "BUY" | "SELL" = bullScore >= bearScore ? "BUY" : "SELL";
  const winnerScore = Math.max(bullScore, bearScore);
  const confidence = totalScore > 0 ? winnerScore / totalScore : 0.5;

  return { direction, score: winnerScore, reasons };
}

// ============== PRICE DATA FETCH ==============

async function fetchCandles(symbol: string): Promise<Candle[]> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      `No market data API key configured for ${symbol}. ` +
      "Set ALPHA_VANTAGE_API_KEY to enable real candle data."
    );
  }

  try {
    const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${symbol.slice(0, 3)}&to_symbol=${symbol.slice(3, 6)}&interval=60min&apikey=${apiKey}&outputsize=compact`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`AV fetch ${res.status}`);
    const data = await res.json();
    const series = data["Time Series FX (60min)"] || data["Time Series (60min)"];
    if (!series) throw new Error("No series in response");

    const candles: Candle[] = Object.entries(series)
      .map(([ts, ohlc]: [string, any]) => ({
        timestamp: new Date(ts).getTime(),
        open: parseFloat(ohlc["1. open"]),
        high: parseFloat(ohlc["2. high"]),
        low: parseFloat(ohlc["3. low"]),
        close: parseFloat(ohlc["4. close"]),
        volume: 0,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    return candles.slice(-100); // last 100 candles
  } catch (e) {
    throw new Error(
      `Failed to fetch candle data for ${symbol}: ${e instanceof Error ? e.message : "Unknown error"}. ` +
      "Check your ALPHA_VANTAGE_API_KEY and try again."
    );
  }
}

// Synthetic candles for demo/dev — random-walk with realistic price levels
function generateSyntheticCandles(symbol: string): Candle[] {
  const basePrices: Record<string, number> = {
    "EURUSD": 1.0850,
    "GBPUSD": 1.2700,
    "USDJPY": 149.50,
    "AUDUSD": 0.6600,
    "USDCAD": 1.3500,
    "USDCHF": 0.8800,
    "NZDUSD": 0.6100,
    "XAUUSD": 2030.00,
    "BTCUSD": 67000.00,
    "ETHUSD": 3500.00,
  };
  const base = basePrices[symbol] || 100;
  const candles: Candle[] = [];
  let prev = base;
  const now = Date.now();
  for (let i = 100; i >= 0; i--) {
    const change = (Math.random() - 0.5) * base * 0.005;
    const open = prev;
    const close = prev + change;
    const high = Math.max(open, close) + Math.random() * base * 0.002;
    const low = Math.min(open, close) - Math.random() * base * 0.002;
    candles.push({
      timestamp: now - i * 3600 * 1000,
      open, high, low, close,
      volume: Math.random() * 10000,
    });
    prev = close;
  }
  return candles;
}

// ============== PUBLIC API ==============

export const signalGenerator = {
  async generate(symbol: string, timeframe = "1H"): Promise<GeneratedSignal> {
    const key = cacheKeys.signalGenerated(symbol);
    return cache.remember<GeneratedSignal>(key, 120, async () => {
      const candles = await fetchCandles(symbol);
      if (candles.length < 50) throw new Error("Insufficient data");

      const closes = candles.map((c) => c.close);
      const last = closes[closes.length - 1];
      const score = computeScore(candles);
      const atrVal = atr(candles);

      // Risk sizing: SL = 1.5 * ATR, TP = 2.5x SL
      const slDistance = Math.max(atrVal * 1.5, last * 0.003);
      const tp1Distance = slDistance * 1.5;
      const tp2Distance = slDistance * 2.5;
      const tp3Distance = slDistance * 4;

      const isBuy = score.direction === "BUY";
      const entry = last;
      const stopLoss = isBuy ? entry - slDistance : entry + slDistance;
      const takeProfit = isBuy ? entry + tp1Distance : entry - tp1Distance;
      const takeProfit2 = isBuy ? entry + tp2Distance : entry - tp2Distance;
      const takeProfit3 = isBuy ? entry + tp3Distance : entry - tp3Distance;

      const indicators = {
        ema9: ema(closes, 9).slice(-1)[0],
        ema21: ema(closes, 21).slice(-1)[0],
        ema50: ema(closes, 50).slice(-1)[0],
        rsi: rsi(closes),
        ...macd(closes),
        ...bollingerBands(closes),
        atr: atrVal,
        stochastic: stochastic(candles),
      };

      const confidence = Math.min(0.95, Math.max(0.5, score.score / 100));

      return {
        id: `sig-gen-${symbol}-${Date.now()}`,
        pair: symbol,
        direction: score.direction,
        entryPrice: entry,
        stopLoss,
        takeProfit,
        takeProfit2,
        takeProfit3,
        confidence,
        riskRewardRatio: tp1Distance / slDistance,
        indicators,
        reasons: score.reasons,
        timeframe,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      };
    });
  },

  async generateBatch(symbols: string[]): Promise<GeneratedSignal[]> {
    const results = await Promise.allSettled(symbols.map((s) => this.generate(s)));
    return results
      .filter((r): r is PromiseFulfilledResult<GeneratedSignal> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((s) => s.confidence >= (parseFloat(process.env.SIGNAL_CONFIDENCE_THRESHOLD || "0.65")));
  },
};
