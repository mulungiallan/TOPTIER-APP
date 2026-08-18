/**
 * Backtesting Engine
 * Drop into: src/lib/backtester.ts
 *
 * Tests trading strategies against historical price data.
 * Strategy = function(candles, index) → { action: 'BUY'|'SELL'|'HOLD', size, sl?, tp? }
 *
 * Metrics: total return, win rate, max drawdown, Sharpe ratio, profit factor.
 */

import { signalGenerator, Candle } from "./signal-generator";

export interface BacktestTrade {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  direction: "BUY" | "SELL";
  size: number;
  pnl: number;
  pnlPercent: number;
  reason: "manual" | "stop_loss" | "take_profit" | "end_of_data";
  holdingBars: number;
  entryDate: string;
  exitDate: string;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  metrics: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalReturn: number;        // percentage
    totalPnl: number;
    averageWin: number;
    averageLoss: number;
    profitFactor: number;       // gross profit / gross loss
    maxDrawdown: number;        // percentage
    sharpeRatio: number;
    sortinoRatio: number;
    averageHoldingBars: number;
    longestWinStreak: number;
    longestLossStreak: number;
  };
  equityCurve: { index: number; date: string; equity: number }[];
  parameters: BacktestParams;
}

export interface BacktestParams {
  symbol: string;
  startingCapital: number;
  positionSizePercent: number; // % of capital per trade
  allowShort: boolean;
  maxConcurrentPositions: number;
  stopLossPct?: number;        // 0.02 = 2%
  takeProfitPct?: number;      // 0.04 = 4%
  timeframe: string;
}

type Strategy = (candles: Candle[], index: number) =>
  | { action: "BUY" | "SELL"; size: number; reason: string }
  | { action: "HOLD"; reason?: string };

// ============== BUILT-IN STRATEGIES ==============

export const strategies = {
  // EMA crossover strategy
  emaCross: (candles: Candle[], index: number) => {
    if (index < 50) return { action: "HOLD" as const };
    const closes = candles.slice(0, index + 1).map((c) => c.close);
    const ema9 = ema(closes, 9).slice(-1)[0];
    const ema21 = ema(closes, 21).slice(-1)[0];
    const ema50 = ema(closes, 50).slice(-1)[0];
    if (ema9 > ema21 && ema21 > ema50) {
      return { action: "BUY" as const, size: 1, reason: "EMA bullish alignment" };
    }
    if (ema9 < ema21 && ema21 < ema50) {
      return { action: "SELL" as const, size: 1, reason: "EMA bearish alignment" };
    }
    return { action: "HOLD" as const };
  },

  // RSI mean reversion
  rsiReversion: (candles: Candle[], index: number) => {
    if (index < 14) return { action: "HOLD" as const };
    const closes = candles.slice(0, index + 1).map((c) => c.close);
    const rsiVal = rsi(closes, 14);
    if (rsiVal < 30) return { action: "BUY" as const, size: 1, reason: "RSI oversold" };
    if (rsiVal > 70) return { action: "SELL" as const, size: 1, reason: "RSI overbought" };
    return { action: "HOLD" as const };
  },

  // Breakout strategy
  breakout: (candles: Candle[], index: number) => {
    if (index < 20) return { action: "HOLD" as const };
    const slice = candles.slice(index - 20, index);
    const high = Math.max(...slice.map((c) => c.high));
    const low = Math.min(...slice.map((c) => c.low));
    const current = candles[index].close;
    if (current > high * 0.999) return { action: "BUY" as const, size: 1, reason: "Breakout above 20-bar high" };
    if (current < low * 1.001) return { action: "SELL" as const, size: 1, reason: "Breakout below 20-bar low" };
    return { action: "HOLD" as const };
  },

  // Signal-generator-based (uses indicators from signal-generator module)
  signalGenerator: (candles: Candle[], index: number) => {
    if (index < 50) return { action: "HOLD" as const };
    const slice = candles.slice(0, index + 1);
    const closes = slice.map((c) => c.close);
    const last = closes[closes.length - 1];
    const ema9 = ema(closes, 9).slice(-1)[0];
    const ema21 = ema(closes, 21).slice(-1)[0];
    const ema50 = ema(closes, 50).slice(-1)[0];
    const rsiVal = rsi(closes, 14);
    const macdData = macd(closes);

    let bull = 0, bear = 0;
    if (ema9 > ema21 && ema21 > ema50) bull += 2;
    else if (ema9 < ema21 && ema21 < ema50) bear += 2;
    if (rsiVal < 30) bull += 1; else if (rsiVal > 70) bear += 1;
    if (macdData.histogram > 0) bull += 1; else if (macdData.histogram < 0) bear += 1;

    if (bull > bear + 1) return { action: "BUY" as const, size: 1, reason: "Multi-indicator bullish" };
    if (bear > bull + 1) return { action: "SELL" as const, size: 1, reason: "Multi-indicator bearish" };
    return { action: "HOLD" as const };
  },
};

// ============== INDICATORS (mirrored for backtest) ==============
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
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function macd(closes: number[]) {
  if (closes.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine.slice(-9), 9);
  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalLine[signalLine.length - 1];
  return { macd: macdVal, signal: signalVal, histogram: macdVal - signalVal };
}

// ============== ENGINE ==============

export const backtester = {
  async run(
    params: BacktestParams,
    strategy: Strategy,
    candles: Candle[]
  ): Promise<BacktestResult> {
    let capital = params.startingCapital;
    let peakEquity = capital;
    let maxDD = 0;
    const trades: BacktestTrade[] = [];
    const equityCurve: BacktestResult["equityCurve"] = [];
    const openPositions: Array<{
      direction: "BUY" | "SELL";
      size: number;
      entryIndex: number;
      entryPrice: number;
      entryDate: string;
      stopLoss?: number;
      takeProfit?: number;
    }> = [];

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];

      // 1. Check SL/TP for open positions
      for (let j = openPositions.length - 1; j >= 0; j--) {
        const pos = openPositions[j];
        let exitPrice: number | null = null;
        let reason: BacktestTrade["reason"] = "end_of_data";

        if (pos.stopLoss) {
          if (pos.direction === "BUY" && candle.low <= pos.stopLoss) {
            exitPrice = pos.stopLoss; reason = "stop_loss";
          } else if (pos.direction === "SELL" && candle.high >= pos.stopLoss) {
            exitPrice = pos.stopLoss; reason = "stop_loss";
          }
        }
        if (pos.takeProfit && !exitPrice) {
          if (pos.direction === "BUY" && candle.high >= pos.takeProfit) {
            exitPrice = pos.takeProfit; reason = "take_profit";
          } else if (pos.direction === "SELL" && candle.low <= pos.takeProfit) {
            exitPrice = pos.takeProfit; reason = "take_profit";
          }
        }

        if (exitPrice !== null) {
          const pnl = pos.direction === "BUY"
            ? (exitPrice - pos.entryPrice) * pos.size
            : (pos.entryPrice - exitPrice) * pos.size;
          capital += pnl;
          trades.push({
            entryIndex: pos.entryIndex,
            exitIndex: i,
            entryPrice: pos.entryPrice,
            exitPrice,
            direction: pos.direction,
            size: pos.size,
            pnl,
            pnlPercent: (pnl / (pos.size * pos.entryPrice)) * 100,
            reason,
            holdingBars: i - pos.entryIndex,
            entryDate: new Date(candles[pos.entryIndex].timestamp).toISOString(),
            exitDate: new Date(candle.timestamp).toISOString(),
          });
          openPositions.splice(j, 1);
        }
      }

      // 2. Check strategy signal
      const signal = strategy(candles, i);
      if (signal.action !== "HOLD" && openPositions.length < params.maxConcurrentPositions) {
        if (signal.action === "SELL" && !params.allowShort) continue;
        const positionValue = capital * (params.positionSizePercent / 100);
        const size = positionValue / candle.close;
        openPositions.push({
          direction: signal.action,
          size,
          entryIndex: i,
          entryPrice: candle.close,
          entryDate: new Date(candle.timestamp).toISOString(),
          stopLoss: params.stopLossPct
            ? signal.action === "BUY"
              ? candle.close * (1 - params.stopLossPct)
              : candle.close * (1 + params.stopLossPct)
            : undefined,
          takeProfit: params.takeProfitPct
            ? signal.action === "BUY"
              ? candle.close * (1 + params.takeProfitPct)
              : candle.close * (1 - params.takeProfitPct)
            : undefined,
        });
      }

      // 3. Update equity
      const unrealized = openPositions.reduce((sum, p) => {
        const pnl = p.direction === "BUY"
          ? (candle.close - p.entryPrice) * p.size
          : (p.entryPrice - candle.close) * p.size;
        return sum + pnl;
      }, 0);
      const equity = capital + unrealized;
      equityCurve.push({ index: i, date: new Date(candle.timestamp).toISOString(), equity });

      if (equity > peakEquity) peakEquity = equity;
      const dd = (peakEquity - equity) / peakEquity * 100;
      if (dd > maxDD) maxDD = dd;
    }

    // Close any remaining positions at last candle
    const lastCandle = candles[candles.length - 1];
    for (const pos of openPositions) {
      const pnl = pos.direction === "BUY"
        ? (lastCandle.close - pos.entryPrice) * pos.size
        : (pos.entryPrice - lastCandle.close) * pos.size;
      capital += pnl;
      trades.push({
        entryIndex: pos.entryIndex,
        exitIndex: candles.length - 1,
        entryPrice: pos.entryPrice,
        exitPrice: lastCandle.close,
        direction: pos.direction,
        size: pos.size,
        pnl,
        pnlPercent: (pnl / (pos.size * pos.entryPrice)) * 100,
        reason: "end_of_data",
        holdingBars: candles.length - 1 - pos.entryIndex,
        entryDate: pos.entryDate,
        exitDate: new Date(lastCandle.timestamp).toISOString(),
      });
    }

    return this.computeMetrics(trades, equityCurve, params, capital);
  },

  computeMetrics(
    trades: BacktestTrade[],
    equityCurve: BacktestResult["equityCurve"],
    params: BacktestParams,
    finalCapital: number
  ): BacktestResult {
    const totalTrades = trades.length;
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const avgWin = wins.length ? grossProfit / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;

    // Sharpe ratio (simplified — using daily equity returns)
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const r = (equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity;
      returns.push(r);
    }
    const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const stdReturn = Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length);
    const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;
    const downside = returns.filter((r) => r < 0);
    const downsideStd = downside.length
      ? Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length)
      : 0;
    const sortino = downsideStd > 0 ? (avgReturn / downsideStd) * Math.sqrt(252) : 0;

    // Win/loss streaks
    let longestWin = 0, longestLoss = 0, currentWin = 0, currentLoss = 0;
    for (const t of trades) {
      if (t.pnl > 0) { currentWin++; currentLoss = 0; longestWin = Math.max(longestWin, currentWin); }
      else { currentLoss++; currentWin = 0; longestLoss = Math.max(longestLoss, currentLoss); }
    }

    const peakEquity = Math.max(...equityCurve.map((e) => e.equity));
    const maxDD = ((peakEquity - Math.min(...equityCurve.map((e) => e.equity))) / peakEquity) * 100;

    return {
      trades,
      metrics: {
        totalTrades,
        winningTrades: wins.length,
        losingTrades: losses.length,
        winRate: totalTrades ? wins.length / totalTrades : 0,
        totalReturn: ((finalCapital - params.startingCapital) / params.startingCapital) * 100,
        totalPnl,
        averageWin: avgWin,
        averageLoss: avgLoss,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
        maxDrawdown: maxDD,
        sharpeRatio: sharpe,
        sortinoRatio: sortino,
        averageHoldingBars: totalTrades ? trades.reduce((s, t) => s + t.holdingBars, 0) / totalTrades : 0,
        longestWinStreak: longestWin,
        longestLossStreak: longestLoss,
      },
      equityCurve,
      parameters: params,
    };
  },

  // Fetch historical candles via signal-generator's price fetcher
  async fetchHistory(symbol: string): Promise<Candle[]> {
    return await (await import("./signal-generator")).signalGenerator.generate(symbol).then(async () => {
      // Re-use fetchCandles via the public interface — but we need raw candles.
      // Since signal-generator doesn't expose candles, we fetch again here:
      const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
      if (!apiKey) return this.synthHistory(symbol);

      try {
        const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${symbol.slice(0, 3)}&to_symbol=${symbol.slice(3, 6)}&apikey=${apiKey}&outputsize=full`;
        const res = await fetch(url, { next: { revalidate: 3600 } });
        if (!res.ok) throw new Error(`AV ${res.status}`);
        const data = await res.json();
        const series = data["Time Series FX (Daily)"];
        if (!series) throw new Error("No series");
        const candles: Candle[] = Object.entries(series).map(([date, ohlc]: [string, any]) => ({
          timestamp: new Date(date).getTime(),
          open: parseFloat(ohlc["1. open"]),
          high: parseFloat(ohlc["2. high"]),
          low: parseFloat(ohlc["3. low"]),
          close: parseFloat(ohlc["4. close"]),
          volume: 0,
        })).sort((a, b) => a.timestamp - b.timestamp);
        return candles.slice(-365); // last 1 year
      } catch {
        return this.synthHistory(symbol);
      }
    });
  },

  synthHistory(symbol: string): Candle[] {
    const base: Record<string, number> = {
      "EURUSD": 1.0850, "GBPUSD": 1.2700, "USDJPY": 149.50,
      "XAUUSD": 2030, "BTCUSD": 67000,
    };
    const start = base[symbol] || 100;
    const candles: Candle[] = [];
    let prev = start;
    const now = Date.now();
    for (let i = 365; i >= 0; i--) {
      const trend = Math.sin(i / 30) * start * 0.02;
      const change = (Math.random() - 0.5) * start * 0.015 + trend * 0.1;
      const open = prev;
      const close = prev + change;
      const high = Math.max(open, close) + Math.random() * start * 0.005;
      const low = Math.min(open, close) - Math.random() * start * 0.005;
      candles.push({
        timestamp: now - i * 86400000,
        open, high, low, close,
        volume: Math.random() * 100000,
      });
      prev = close;
    }
    return candles;
  },
};
