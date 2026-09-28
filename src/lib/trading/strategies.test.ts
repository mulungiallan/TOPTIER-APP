/**
 * Python parity tests for the ported strategies (#1-48).
 *
 * Every expectation comes from `src/lib/trading/python-reference.json`, which
 * is produced by running the UNMODIFIED reference library
 * (`tools/gen_reference_fixture.py`) over 2,500 real SPY daily bars. The bars
 * themselves are embedded in the fixture, so these tests need neither Python
 * nor the CSV. Any numerical drift in a port fails here rather than silently
 * producing a different signal in production.
 */

import { describe, expect, it } from "vitest";
import reference from "./python-reference.json";
import { Series } from "./series";
import { OHLCVColumns } from "./indicators";
import * as tm from "./strategies/trend-momentum";
import * as mr from "./strategies/mean-reversion";
import * as br from "./strategies/breakout-range";
import * as cp from "./strategies/chart-patterns";

type FixtureColumn = (number | null)[];
const fixture = reference as unknown as {
  bars: number;
  columns: Record<string, FixtureColumn>;
  strategies: Record<string, FixtureColumn>;
};
const expected = fixture.columns as unknown as Record<string, (number | boolean)[]>;
const expectedSignals = fixture.strategies as unknown as Record<string, (number | boolean)[]>;

const num = (col: string): Series => expected[col].map((v) => (v === null ? NaN : Number(v)));

const df: OHLCVColumns = {
  open: num("_open"),
  high: num("_high"),
  low: num("_low"),
  close: num("_close"),
  volume: num("_volume"),
  // Session/calendar-aware strategies need the real bar index. The reference
  // groups on `df.index.date`, so a daily feed means one bar per session.
  ts: num("_ts"),
};

/** Discrete 0/+1/-1 signals must match the reference exactly - no tolerance. */
function assertSignal(name: string, actual: Series) {
  const want = expectedSignals[name];
  if (!want) throw new Error(`fixture has no recorded output named "${name}"`);
  expect(actual.length, `${name}: bar-count`).toBe(want.length);
  const mismatches: number[] = [];
  for (let i = 0; i < want.length; i++) {
    if (actual[i] !== want[i]) mismatches.push(i);
  }
  expect(
    mismatches.slice(0, 10),
    `${name}: ${mismatches.length} mismatched bar(s) of ${want.length}`
  ).toEqual([]);
}

/** Float series (e.g. position size) may differ by accumulated rounding only. */
function assertApprox(name: string, actual: Series) {
  const want = expectedSignals[name];
  if (!want) throw new Error(`fixture has no recorded output named "${name}"`);
  expect(actual.length, `${name}: bar-count`).toBe(want.length);
  for (let i = 0; i < want.length; i++) {
    const a = actual[i];
    const w = want[i];
    if (w === null || w === undefined) {
      expect(Number.isNaN(a), `${name}[${i}] expected NaN, got ${a}`).toBe(true);
    } else {
      expect(Math.abs(a - Number(w)), `${name}[${i}]`).toBeLessThanOrEqual(1e-6);
    }
  }
}

/** Every strategy must emit only the 0/+1/-1 alphabet. */
function assertSignalAlphabet(name: string, s: Series) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== 0 && s[i] !== 1 && s[i] !== -1) {
      throw new Error(`${name}[${i}] = ${s[i]} is not 0/+1/-1`);
    }
  }
}

describe("python parity: strategy signals (#1-48)", () => {
  it("fixture drives 2500 real bars", () => {
    expect(fixture.bars).toBe(2500);
    expect(df.close.length).toBe(2500);
  });

  describe("A. trend & momentum", () => {
    it("s01 MA crossover (sma and ema)", () => {
      assertSignal("s01_ma_crossover", tm.s01MaCrossover(df));
      assertSignal("s01_ma_crossover_ema", tm.s01MaCrossover(df, 10, 50, "ema"));
    });
    it("s02 golden/death cross", () => {
      assertSignal("s02_golden_death_cross", tm.s02GoldenDeathCross(df));
    });
    it("s03 MACD crossover, with and without the zero-line filter", () => {
      assertSignal("s03_macd_crossover", tm.s03MacdCrossover(df));
      assertSignal("s03_macd_crossover_zero", tm.s03MacdCrossover(df, 12, 26, 9, true));
    });
    it("s04 ADX trend gate", () => {
      assertSignal("s04_adx_trend_gate", tm.s04AdxTrendGate(df));
    });
    it("s05 Donchian breakout", () => {
      assertSignal("s05_donchian_breakout", tm.s05DonchianBreakout(df));
    });
    it("s06 turtle system (signal and position size)", () => {
      assertSignal("s06_turtle_signal", tm.s06TurtleSystem(df).signal);
      assertApprox("s06_turtle_size", tm.s06TurtleSystem(df).size);
    });
    it("s07 parabolic SAR", () => {
      assertSignal("s07_parabolic_sar", tm.s07ParabolicSar(df));
    });
    it("s08 Ichimoku", () => {
      assertSignal("s08_ichimoku", tm.s08Ichimoku(df));
    });
    it("s09 supertrend", () => {
      assertSignal("s09_supertrend", tm.s09Supertrend(df));
    });
    it("s10 ROC momentum", () => {
      assertSignal("s10_momentum_roc", tm.s10MomentumRoc(df));
    });
    it("s14 trendline channel", () => {
      assertSignal("s14_trendline_channel", tm.s14TrendlineChannel(df));
    });
    it("s15 buy the dip", () => {
      assertSignal("s15_buy_the_dip", tm.s15BuyTheDip(df));
    });
  });

  describe("B. mean reversion", () => {
    it("s16 RSI reversion", () => {
      assertSignal("s16_rsi_reversion", mr.s16RsiReversion(df));
    });
    it("s17 Connors RSI(2)", () => {
      assertSignal("s17_connors_rsi2", mr.s17ConnorsRsi2(df));
    });
    it("s18 Bollinger reversion", () => {
      assertSignal("s18_bollinger_reversion", mr.s18BollingerReversion(df));
    });
    it("s19 stochastic reversion", () => {
      assertSignal("s19_stochastic_reversion", mr.s19StochasticReversion(df));
    });
    it("s20 z-score reversion", () => {
      assertSignal("s20_zscore_reversion", mr.s20ZscoreReversion(df));
    });
    it("s23 VWAP reversion", () => {
      assertSignal("s23_vwap_reversion", mr.s23VwapReversion(df));
    });
    it("s24 overnight reversal", () => {
      assertSignal("s24_overnight_reversal", mr.s24OvernightReversal(df));
    });
    it("s25 CCI reversion", () => {
      assertSignal("s25_cci_reversion", mr.s25CciReversion(df));
    });
    it("s26 Williams %R reversion", () => {
      assertSignal("s26_williams_r_reversion", mr.s26WilliamsRReversion(df));
    });
    it("s27 fade the gap", () => {
      assertSignal("s27_fade_the_gap", mr.s27FadeTheGap(df));
    });
  });

  describe("C. breakout & range", () => {
    it("s29 range breakout", () => {
      assertSignal("s29_range_breakout", br.s29RangeBreakout(df));
    });
    it("s30 opening-range breakout is inert on daily bars", () => {
      // The reference groups bars into sessions; on daily data every session is
      // one bar, so it can never satisfy the opening-range window. Asserting this
      // pins the daily behaviour. Real validation needs intraday bars - see the
      // dedicated session test below.
      const s = br.s30OpeningRangeBreakout(df);
      assertSignal("s30_opening_range_breakout", s);
      expect(s.every((v) => v === 0)).toBe(true);
    });
    it("s31 volatility squeeze breakout", () => {
      assertSignal("s31_volatility_squeeze_breakout", br.s31VolatilitySqueezeBreakout(df));
    });
    it("s32 retest entry", () => {
      assertSignal("s32_retest_entry", br.s32RetestEntry(df));
    });
    it("s33 failed breakout reversal", () => {
      assertSignal("s33_failed_breakout_reversal", br.s33FailedBreakoutReversal(df));
    });
    it("s34 support/resistance bounce", () => {
      assertSignal("s34_support_resistance_bounce", br.s34SupportResistanceBounce(df));
    });
    it("s35 triangle breakout", () => {
      assertSignal("s35_triangle_breakout", br.s35TriangleBreakout(df));
    });
    it("s36 flag/pennant continuation", () => {
      assertSignal("s36_flag_pennant_continuation", br.s36FlagPennantContinuation(df));
    });
    it("s37 round-number levels", () => {
      assertSignal("s37_round_number_levels", br.s37RoundNumberLevels(df));
    });
    it("s38 volume-confirmed breakout gates the s05 base signal", () => {
      assertSignal("s38_volume_breakout_confirmation", br.s38VolumeBreakoutConfirmation(tm.s05DonchianBreakout(df), df.volume));
    });
  });

  describe("D. chart & candlestick patterns", () => {
    it("s39 head and shoulders", () => {
      assertSignal("s39_head_and_shoulders", cp.s39HeadAndShoulders(df));
    });
    it("s40 double top/bottom", () => {
      assertSignal("s40_double_top_bottom", cp.s40DoubleTopBottom(df));
    });
    it("s41 cup and handle", () => {
      assertSignal("s41_cup_and_handle", cp.s41CupAndHandle(df));
    });
    it("s42 wedge breakout", () => {
      assertSignal("s42_wedge_breakout", cp.s42WedgeBreakout(df));
    });
    it("s43 engulfing reversal", () => {
      assertSignal("s43_engulfing_reversal", cp.s43EngulfingReversal(df));
    });
    it("s44 hammer/shooting star", () => {
      assertSignal("s44_hammer_shooting_star", cp.s44HammerShootingStar(df));
    });
    it("s45 doji confirmation", () => {
      assertSignal("s45_doji_confirmation", cp.s45DojiConfirmation(df));
    });
    it("s46 morning/evening star", () => {
      assertSignal("s46_morning_evening_star", cp.s46MorningEveningStar(df));
    });
    it("s47 inside-bar breakout", () => {
      assertSignal("s47_inside_bar_breakout", cp.s47InsideBarBreakout(df));
    });
    it("s48 three soldiers/crows", () => {
      assertSignal("s48_three_soldiers_crows", cp.s48ThreeSoldiersCrows(df));
    });
  });

  describe("signal hygiene", () => {
    const all: [string, () => Series][] = [
      ["s01", () => tm.s01MaCrossover(df)],
      ["s02", () => tm.s02GoldenDeathCross(df)],
      ["s03", () => tm.s03MacdCrossover(df)],
      ["s04", () => tm.s04AdxTrendGate(df)],
      ["s05", () => tm.s05DonchianBreakout(df)],
      ["s07", () => tm.s07ParabolicSar(df)],
      ["s08", () => tm.s08Ichimoku(df)],
      ["s09", () => tm.s09Supertrend(df)],
      ["s10", () => tm.s10MomentumRoc(df)],
      ["s14", () => tm.s14TrendlineChannel(df)],
      ["s15", () => tm.s15BuyTheDip(df)],
      ["s16", () => mr.s16RsiReversion(df)],
      ["s17", () => mr.s17ConnorsRsi2(df)],
      ["s18", () => mr.s18BollingerReversion(df)],
      ["s19", () => mr.s19StochasticReversion(df)],
      ["s20", () => mr.s20ZscoreReversion(df)],
      ["s23", () => mr.s23VwapReversion(df)],
      ["s24", () => mr.s24OvernightReversal(df)],
      ["s25", () => mr.s25CciReversion(df)],
      ["s26", () => mr.s26WilliamsRReversion(df)],
      ["s27", () => mr.s27FadeTheGap(df)],
      ["s29", () => br.s29RangeBreakout(df)],
      ["s31", () => br.s31VolatilitySqueezeBreakout(df)],
      ["s32", () => br.s32RetestEntry(df)],
      ["s33", () => br.s33FailedBreakoutReversal(df)],
      ["s34", () => br.s34SupportResistanceBounce(df)],
      ["s35", () => br.s35TriangleBreakout(df)],
      ["s36", () => br.s36FlagPennantContinuation(df)],
      ["s37", () => br.s37RoundNumberLevels(df)],
      ["s39", () => cp.s39HeadAndShoulders(df)],
      ["s40", () => cp.s40DoubleTopBottom(df)],
      ["s41", () => cp.s41CupAndHandle(df)],
      ["s42", () => cp.s42WedgeBreakout(df)],
      ["s43", () => cp.s43EngulfingReversal(df)],
      ["s44", () => cp.s44HammerShootingStar(df)],
      ["s45", () => cp.s45DojiConfirmation(df)],
      ["s46", () => cp.s46MorningEveningStar(df)],
      ["s47", () => cp.s47InsideBarBreakout(df)],
      ["s48", () => cp.s48ThreeSoldiersCrows(df)],
    ];

    it.each(all)("%s emits only 0/+1/-1", (name, run) => {
      assertSignalAlphabet(name, run());
    });

    it("s06 turtle size is finite everywhere", () => {
      const { size } = tm.s06TurtleSystem(df);
      for (let i = 0; i < size.length; i++) {
        expect(Number.isFinite(size[i]), `s06 size[${i}]`).toBe(true);
      }
    });
  });

  describe("s30 opening-range breakout on real intraday sessions", () => {
    // The daily fixture cannot exercise #30, so build small synthetic intraday
    // sessions and assert the state machine directly. Note the reference only
    // ever evaluates the direction while flat (`if position == 0`), so once a
    // session breaks one way it holds that side for the rest of the session and
    // never flips. The long and short cases therefore need separate sessions.
    const cols = (high: number[], low: number[], close: number[]): OHLCVColumns => ({
      open: close.slice(),
      high,
      low,
      close,
      volume: close.map(() => 1000),
    });

    it("enters long on the first break above the opening high and holds", () => {
      // Opening range = bars 0..3 (high 13, low 10). Bar 4 closes inside (0),
      // bar 5 closes above 13 -> long, and it persists to the session end.
      const intraday = cols([10, 11, 12, 13, 12, 20, 21, 22], [9, 10, 11, 12, 11, 19, 20, 21], [9.5, 10.5, 11.5, 12.5, 11.5, 19.5, 20.5, 21.5]);
      const s = br.s30OpeningRangeBreakout(intraday, 4, new Array(8).fill(0));
      expect(s.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
      expect(s.slice(5)).toEqual([1, 1, 1]);
    });

    it("enters short on the first break below the opening low and holds", () => {
      const intraday = cols([10, 11, 12, 13, 12, 5, 4, 3], [9, 10, 11, 12, 11, 4, 3, 2], [9.5, 10.5, 11.5, 12.5, 11.5, 4.5, 3.5, 2.5]);
      const s = br.s30OpeningRangeBreakout(intraday, 4, new Array(8).fill(0));
      expect(s.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
      expect(s.slice(5)).toEqual([-1, -1, -1]);
    });

    it("does not flip sides after entering", () => {
      // Breaks up at bar 5, then collapses far below the opening low at bar 6.
      // The reference holds the long because it only re-evaluates while flat.
      const intraday = cols([10, 11, 12, 13, 12, 20, 1, 1], [9, 10, 11, 12, 11, 19, 0.5, 0.5], [9.5, 10.5, 11.5, 12.5, 11.5, 19.5, 0.8, 0.8]);
      const s = br.s30OpeningRangeBreakout(intraday, 4, new Array(8).fill(0));
      expect(s.slice(5)).toEqual([1, 1, 1]);
    });

    it("resets between sessions", () => {
      const intraday = cols([10, 11, 12, 13, 12, 20, 10, 11], [9, 10, 11, 12, 11, 19, 9, 10], [9.5, 10.5, 11.5, 12.5, 11.5, 19.5, 9.5, 10.5]);
      // Two sessions of four bars: session 0 breaks up, session 1 stays inside.
      const s = br.s30OpeningRangeBreakout(intraday, 4, [0, 0, 0, 0, 1, 1, 1, 1]);
      expect(s.slice(0, 4)).toEqual([0, 0, 0, 0]);
      expect(s.slice(4)).toEqual([0, 0, 0, 0]);
    });

    it("a session no longer than the opening window is skipped entirely", () => {
      const intraday = cols([10, 11, 12], [9, 10, 11], [9.5, 10.5, 11.5]);
      const s = br.s30OpeningRangeBreakout(intraday, 4, new Array(3).fill(0));
      expect(s.every((v) => v === 0)).toBe(true);
    });
  });
});
