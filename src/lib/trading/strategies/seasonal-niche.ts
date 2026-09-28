/**
 * Strategies #95-100 - Behavioral, Seasonal & Niche.
 *
 * Faithful port of `strategies/seasonal_niche.py`.
 *
 * Four of the six are pure CALENDAR strategies: they never look at a price
 * level, only at the bar timestamp, so they take an `index` array of epoch-ms
 * rather than a price series. That is a property of the reference, not a
 * simplification - #95, #97 and #98 are unconditional long-in-a-window rules
 * with no exit logic and no volatility filter, and their edge (if any) is small
 * enough that costs usually consume it. They are here because the reference
 * implements them and because they are an honest counterweight to the trend
 * strategies elsewhere in the library.
 */

import { Series, percentile } from "../series";
import { Wide } from "./multi-asset";
import { utcDay, utcMonth, utcYear } from "./fundamental-macro";

const MS_PER_DAY = 86_400_000;

// ─── #95 ──────────────────────────────────────────────────────────────────────
/** "Sell in May": long November-April, flat May-October. */
export function s95SellInMay(index: number[]): Series {
  return index.map((ts) => {
    const m = utcMonth(ts);
    return m >= 11 || m <= 4 ? 1 : 0;
  });
}

// ─── #96 ──────────────────────────────────────────────────────────────────────
/**
 * The January effect: hold the small-cap basket from 20 December through the end
 * of January. Returns a 0/1 weight per asset, so the caller decides the sizing.
 */
export function s96JanuaryEffect(
  index: number[],
  smallCapPrices: Wide
): Record<string, Series> {
  const inWindow = index.map((ts) => {
    const m = utcMonth(ts);
    return (m === 12 && utcDay(ts) >= 20) || m === 1;
  });
  const out: Record<string, Series> = {};
  // The reference only reads the frame's index and column names, never a price.
  for (const asset of Object.keys(smallCapPrices)) out[asset] = inWindow.map((v) => (v ? 1 : 0));
  return out;
}

// ─── #97 ──────────────────────────────────────────────────────────────────────
/**
 * The Santa Claus rally: the last five December sessions and the first two
 * January sessions.
 *
 * Both halves are taken only when enough bars exist - a December with four
 * sessions in it (or a January that starts mid-week) contributes nothing for the
 * missing side rather than a truncated window.
 */
export function s97SantaClausRally(index: number[]): Series {
  const signal: Series = new Array(index.length).fill(0);
  const years = [...new Set(index.map(utcYear))].sort((a, b) => a - b);
  for (const y of years) {
    const dec: number[] = [];
    const jan: number[] = [];
    for (let i = 0; i < index.length; i++) {
      const ts = index[i];
      if (utcYear(ts) === y && utcMonth(ts) === 12) dec.push(i);
      if (utcYear(ts) === y + 1 && utcMonth(ts) === 1) jan.push(i);
    }
    if (dec.length >= 5) for (const i of dec.slice(-5)) signal[i] = 1;
    if (jan.length >= 2) for (const i of jan.slice(0, 2)) signal[i] = 1;
  }
  return signal;
}

// ─── #98 ──────────────────────────────────────────────────────────────────────
/** Turn of the month: the last session of each month and its first three. */
export function s98TurnOfMonth(index: number[]): Series {
  const signal: Series = new Array(index.length).fill(0);
  const months: { key: string; bars: number[] }[] = [];
  for (let i = 0; i < index.length; i++) {
    const key = `${utcYear(index[i])}-${utcMonth(index[i])}`;
    const last = months[months.length - 1];
    if (last && last.key === key) last.bars.push(i);
    else months.push({ key, bars: [i] });
  }
  for (const { bars } of months) {
    signal[bars[bars.length - 1]] = 1;
    for (const i of bars.slice(0, 3)) signal[i] = 1;
  }
  return signal;
}

// ─── #99 ──────────────────────────────────────────────────────────────────────
/** One reported insider transaction, as a real filings feed would deliver it. */
export interface InsiderTransaction {
  /** Trade date, epoch-ms. */
  date: number;
  ticker: string;
  transactionType: "buy" | "sell";
  valueUsd: number;
}

/** A qualifying buy and the window over which its signal is considered active. */
export interface InsiderBuySignal {
  ticker: string;
  date: number;
  /** `date` plus the lookback, in epoch-ms. */
  signalEnd: number;
}

/**
 * Clone qualifying insider BUYS: any buy at or above `minTransactionUsd`,
 * annotated with the end of the window in which its signal is still active.
 *
 * Institutional 13F holdings are reported quarterly with a lag, so a real feed
 * has to account for that delay; the reference's own docstring flags it.
 */
export function s99InsiderInstitutionalCloning(
  insiderTransactions: InsiderTransaction[],
  minTransactionUsd = 100_000,
  lookbackDays = 10
): InsiderBuySignal[] {
  return insiderTransactions
    .filter((t) => t.transactionType === "buy" && t.valueUsd >= minTransactionUsd)
    .map((t) => ({
      ticker: t.ticker,
      date: t.date,
      signalEnd: t.date + lookbackDays * MS_PER_DAY,
    }));
}

// ─── #100 ─────────────────────────────────────────────────────────────────────
/**
 * Contrarian sentiment: buy extreme FEAR, stand aside from extreme complacency.
 *
 * The reference's orientation is preserved and is worth being explicit about -
 * the high reading is treated as fear (VIX-like) and the low reading as
 * complacency (put/call-ratio-like), so an inverted indicator needs its own
 * thresholds rather than a flag on this function.
 */
export function s100ContrarianSentiment(
  sentimentIndicator: Series,
  lookback = 252,
  lowPercentile = 10,
  highPercentile = 90
): Series {
  const lowTh = rollingPercentile(sentimentIndicator, lookback, lowPercentile);
  const highTh = rollingPercentile(sentimentIndicator, lookback, highPercentile);
  return sentimentIndicator.map((v, i) => (v > highTh[i] ? 1 : v < lowTh[i] ? -1 : 0));
}

/**
 * `rolling(lookback).apply(np.percentile)` - a NaN in the window poisons the
 * result, which is what pandas' default `min_periods=lookback` enforces.
 */
function rollingPercentile(s: Series, window: number, q: number): Series {
  const out: Series = new Array(s.length).fill(NaN);
  for (let i = window - 1; i < s.length; i++) {
    out[i] = percentile(s.slice(i - window + 1, i + 1), q);
  }
  return out;
}
