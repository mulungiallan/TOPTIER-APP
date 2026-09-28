/**
 * Python parity tests for the portfolio-level strategies (#11, #12, #13, #21,
 * #28) plus the PCA stat-arb basket (#22).
 *
 * These take wide price frames rather than a single OHLCV frame, so they are
 * driven from the fixture's `multi` section: real AAPL/GOOGL/MSFT closes inner-
 * aligned with SPY as the benchmark. Expectations again come from the unmodified
 * reference library (`tools/gen_reference_fixture.py`).
 *
 * #22 is covered in its own describe block because it is a rolling PCA
 * eigenproblem, so it is compared with a floating-point tolerance rather than
 * exactly.
 */

import { describe, expect, it } from "vitest";
import reference from "../python-reference.json";
import { Series } from "../series";
import {
  s11RelativeStrengthRotation,
  s12NewHighMomentum,
  s13DualMomentum,
  s21PairsTrading,
  s22StatArbBasket,
  s28SectorMeanReversion,
  Wide,
} from "./multi-asset";

type FixtureColumn = (number | null)[];
interface MultiFixture {
  assets: string[];
  columns: Record<string, FixtureColumn>;
}
const fixture = reference as unknown as {
  multi: MultiFixture;
  strategies: Record<string, FixtureColumn>;
};
const m = fixture.multi;
const mcol = m.columns as unknown as Record<string, (number | boolean)[]>;

const mnum = (col: string): Series => mcol[col].map((v) => (v === null ? NaN : Number(v)));

const ts: number[] = mnum("_ts");
const prices: Wide = {};
for (const a of m.assets) prices[a] = mnum(`px_${a}`);
const bench: Series = mnum("px_BENCH");

/** Discrete per-bar output (0/+1/-1, or weights) must match exactly. */
function assertExact(name: string, actual: Series) {
  const want = mcol[name];
  if (!want) throw new Error(`fixture has no recorded output named "${name}"`);
  expect(actual.length, `${name}: bar-count`).toBe(want.length);
  const bad: number[] = [];
  for (let i = 0; i < want.length; i++) if (actual[i] !== want[i]) bad.push(i);
  expect(bad.slice(0, 10), `${name}: ${bad.length}/${want.length} mismatched bars`).toEqual([]);
}

/** Boolean masks must match exactly. */
function assertMask(name: string, actual: boolean[]) {
  const want = mcol[name];
  if (!want) throw new Error(`fixture has no recorded output named "${name}"`);
  const bad: number[] = [];
  for (let i = 0; i < want.length; i++) if (actual[i] !== Boolean(want[i])) bad.push(i);
  expect(bad.slice(0, 10), `${name}: ${bad.length}/${want.length} mismatched bars`).toEqual([]);
}

/**
 * Fractional values (e.g. equal weights of 1/3) must be compared with a
 * tolerance: the fixture rounds every float to 6 decimals, so an exact check
 * would fail on any value that is not a whole number.
 */
function assertApprox(name: string, actual: Series) {
  const want = mcol[name];
  if (!want) throw new Error(`fixture has no recorded output named "${name}"`);
  expect(actual.length, `${name}: bar-count`).toBe(want.length);
  const bad: number[] = [];
  for (let i = 0; i < want.length; i++) {
    if (Math.abs(actual[i] - Number(want[i])) > 1e-6) bad.push(i);
  }
  expect(bad.slice(0, 10), `${name}: ${bad.length}/${want.length} mismatched bars`).toEqual([]);
}

describe("python parity: portfolio strategies", () => {
  it("fixture drives real multi-asset bars", () => {
    expect(m.assets).toEqual(["AAPL", "GOOGL", "MSFT"]);
    expect(ts.length).toBeGreaterThan(1000);
    expect(Object.keys(prices)).toHaveLength(3);
    expect(bench.length).toBe(ts.length);
  });

  describe("#11 relative-strength rotation", () => {
    it("weights are an equal-weight basket of the top-3 by 63-period return", () => {
      const w = s11RelativeStrengthRotation(prices, ts);
      for (const a of m.assets) assertApprox(`s11_${a}`, w[a]);
    });

    it("weights always sum to 1 once the lookback has warmed up", () => {
      const w = s11RelativeStrengthRotation(prices, ts);
      // Returns are NaN for the first 63 bars, so weights are 0 until the first
      // rebalance date at which at least one asset has a return.
      const firstNonZero = w[m.assets[0]].findIndex((v) => v !== 0);
      expect(firstNonZero).toBeGreaterThan(0);
      for (let i = firstNonZero; i < ts.length; i++) {
        const total = m.assets.reduce((s, a) => s + w[a][i], 0);
        expect(Math.abs(total - 1), `bar ${i} weight sum`).toBeLessThan(1e-9);
      }
    });

    it("only ever holds the top_k strongest assets", () => {
      const w = s11RelativeStrengthRotation(prices, ts, 63, 2);
      // With topK=2 only two assets can be non-zero at a time.
      for (let i = 0; i < ts.length; i++) {
        const held = m.assets.filter((a) => w[a][i] !== 0);
        expect(held.length, `bar ${i}`).toBeLessThanOrEqual(2);
      }
    });

    it("rebalances on quarter-end when asked, not just month-end", () => {
      // The reference passes `rebalance` straight to `resample`, so "Q" has to
      // bucket by quarter. The real fixture cannot show that: with 3 assets and
      // topK=3 the basket is always all three, so nothing ever changes hands.
      // Here leadership is made to flip every month instead - AAPL drifts up
      // through even months and down through odd ones, GOOGL does the opposite -
      // so a monthly rebalance flips the holding 12x a year and a quarterly one
      // only 4x, and every flip has to land on a quarter-end bar.
      const flip: Wide = { AAPL: [], GOOGL: [], FLAT: [] };
      const up = [100, 100];
      for (let i = 0; i < ts.length; i++) {
        const even = new Date(ts[i]).getUTCMonth() % 2 === 0;
        up[0] *= even ? 1.01 : 0.99;
        up[1] *= even ? 0.99 : 1.01;
        flip.AAPL.push(up[0]);
        flip.GOOGL.push(up[1]);
        flip.FLAT.push(100);
      }
      const held = (w: Wide): (string | null)[] => {
        const out: (string | null)[] = [];
        for (let i = 0; i < ts.length; i++) {
          const winners = Object.keys(w).filter((a) => w[a][i] !== 0);
          out.push(winners.length === 1 ? winners[0] : null);
        }
        return out;
      };
      const monthly = held(s11RelativeStrengthRotation(flip, ts, 20, 1, "M"));
      const quarterly = held(s11RelativeStrengthRotation(flip, ts, 20, 1, "Q"));
      const switches = (h: (string | null)[]): number =>
        h.reduce((n, asset, i) => (i > 0 && asset !== null && asset !== h[i - 1] ? n + 1 : n), 0);

      // Both rebalance on the same grid, so both hold exactly one asset at a
      // time from the first rebalance onwards; quarterly just does it less often.
      expect(switches(monthly)).toBeGreaterThan(switches(quarterly));
      for (let i = 1; i < ts.length; i++) {
        if (quarterly[i] === null || quarterly[i] === quarterly[i - 1]) continue;
        expect(new Date(ts[i]).getUTCMonth() % 3, `quarterly switch at bar ${i}`).toBe(2);
      }
    });
  });

  describe("#12 new-high momentum", () => {
    it("flags assets within 5% of their 252-period high", () => {
      const r = s12NewHighMomentum(prices);
      for (const a of m.assets) assertMask(`s12_${a}`, r[a]);
    });

    it("is false during the 252-bar warm-up", () => {
      const r = s12NewHighMomentum(prices);
      expect(r[m.assets[0]].slice(0, 251).every((v) => v === false)).toBe(true);
    });
  });

  describe("#13 dual momentum", () => {
    it("holds the asset, the benchmark, or cash", () => {
      assertExact("s13_signal", s13DualMomentum(prices.AAPL, bench));
    });

    it("never exceeds the 0/+1/-1 alphabet", () => {
      const s = s13DualMomentum(prices.AAPL, bench);
      for (const v of s) expect([0, 1, -1]).toContain(v);
    });
  });

  describe("#21 pairs trading", () => {
    it("signal A, opposite signal B, and the spread z-score all match", () => {
      const r = s21PairsTrading(prices.AAPL, prices.MSFT);
      assertExact("s21_signal_a", r.signalA);
      assertExact("s21_signal_b", r.signalB);
      const z = r.spreadZ;
      const want = mcol["s21_spread_z"];
      for (let i = 0; i < want.length; i++) {
        if (want[i] === null) expect(Number.isNaN(z[i]), `z[${i}]`).toBe(true);
        else expect(Math.abs(z[i] - Number(want[i])), `z[${i}]`).toBeLessThanOrEqual(1e-6);
      }
    });

    it("B is always the exact opposite leg of A", () => {
      const r = s21PairsTrading(prices.AAPL, prices.MSFT);
      for (let i = 0; i < r.signalA.length; i++) expect(r.signalB[i]).toBe(-r.signalA[i]);
    });
  });

  describe("#22 PCA stat-arb basket", () => {
    it("matches the reference per-asset signals", () => {
      const r = s22StatArbBasket(prices);
      for (const a of m.assets) assertExact(`s22_${a}`, r[a]);
    });

    it("stays flat through the lookback warm-up", () => {
      const r = s22StatArbBasket(prices);
      expect(r[m.assets[0]].slice(0, 60).every((v) => v === 0)).toBe(true);
    });
  });

  describe("#28 sector mean reversion", () => {
    it("flags assets that underperformed SPY by more than 5%", () => {
      const r = s28SectorMeanReversion(prices, bench);
      for (const a of m.assets) assertMask(`s28_${a}`, r[a]);
    });
  });
});

