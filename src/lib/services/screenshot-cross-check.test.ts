import { describe, expect, it } from "vitest";

import {
  CrossCheckVerdict,
  StructureSignal,
  decideVerdict,
  normalizeAsset,
  normalizeTimeframe,
} from "@/lib/services/screenshot-cross-check";

const ENGINE_BUY = {
  direction: "BUY" as const,
  score: 0.82,
  confidence: 0.7,
  reason: "EMA cross + ADX trend",
};
const ENGINE_SELL = { ...ENGINE_BUY, direction: "SELL" as const };

function sig(direction: 1 | -1, barsAgo = 0, name = "Double top / bottom"): StructureSignal {
  return { name, direction, barsAgo };
}

function decide(
  aiSignal: "BUY" | "SELL" | "HOLD",
  engineResult: { direction: "BUY" | "SELL"; score: number; confidence: number; reason: string } | null,
  structures: StructureSignal[] = [],
  candlesticks: StructureSignal[] = []
) {
  return decideVerdict({
    aiSignal,
    engineResult,
    structures,
    candlesticks,
    indicators: null,
    asset: "EUR/USD",
    timeframe: "60",
    bars: 120,
    checkedAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("normalizeAsset", () => {
  it("passes through the app's native BASE/QUOTE forex form", () => {
    expect(normalizeAsset("EUR/USD")).toBe("EUR/USD");
    expect(normalizeAsset("GBP/JPY")).toBe("GBP/JPY");
  });

  it("is case and whitespace insensitive", () => {
    expect(normalizeAsset("  btc/usd ")).toBe("BTC/USD");
    expect(normalizeAsset("ethusdt")).toBe("ETH/USD");
  });

  it("normalises crypto quote currency to USD", () => {
    expect(normalizeAsset("BTC")).toBe("BTC/USD");
    expect(normalizeAsset("BTCUSDT")).toBe("BTC/USD");
    expect(normalizeAsset("XBT")).toBe("BTC/USD");
    expect(normalizeAsset("BITCOIN")).toBe("BTC/USD");
  });

  it("maps metals to the futures contract Yahoo actually quotes", () => {
    expect(normalizeAsset("XAUUSD")).toBe("GC=F");
    expect(normalizeAsset("GOLD")).toBe("GC=F");
    expect(normalizeAsset("SILVER")).toBe("SI=F");
  });

  it("maps index aliases to the cash index, not a futures proxy", () => {
    // The platform quotes cash indices, so a screenshot of the DAX/SPX/NDX
    // level must be checked against the same series - not NQ=F or ES=F, which
    // sit a few points away and would fabricate a false mismatch.
    expect(normalizeAsset("NAS100")).toBe("^NDX");
    expect(normalizeAsset("NASDAQ")).toBe("^NDX");
    expect(normalizeAsset("US30")).toBe("^DJI");
    expect(normalizeAsset("US500")).toBe("^GSPC");
    expect(normalizeAsset("SPX500")).toBe("^GSPC");
    expect(normalizeAsset("SPX")).toBe("^GSPC");
    expect(normalizeAsset("GER40")).toBe("^GDAXI");
    expect(normalizeAsset("UK100")).toBe("^FTSE");
  });

  it("returns null for an unmappable asset rather than guessing", () => {
    // A near-miss must not silently verify against the wrong instrument.
    expect(normalizeAsset("SOMETHING")).toBeNull();
    expect(normalizeAsset("")).toBeNull();
    expect(normalizeAsset(null)).toBeNull();
    expect(normalizeAsset(undefined)).toBeNull();
  });
});

describe("normalizeTimeframe", () => {
  it("maps intraday labels to minute resolutions", () => {
    expect(normalizeTimeframe("1m")).toBe("1");
    expect(normalizeTimeframe("M15")).toBe("15");
    expect(normalizeTimeframe("30 MIN")).toBe("30");
    expect(normalizeTimeframe("1hour")).toBe("60");
  });

  it("maps higher timeframes", () => {
    expect(normalizeTimeframe("1D")).toBe("D");
    expect(normalizeTimeframe("daily")).toBe("D");
    expect(normalizeTimeframe("1W")).toBe("W");
    expect(normalizeTimeframe("monthly")).toBe("M");
  });

  it("maps 4H onto the closest honest resolution", () => {
    // There is no native 4H candle, so hourly is the truthful fallback.
    expect(normalizeTimeframe("4H")).toBe("60");
  });

  it("returns null for an unrecognised timeframe", () => {
    expect(normalizeTimeframe("3 years")).toBeNull();
    expect(normalizeTimeframe(null)).toBeNull();
  });
});

describe("decideVerdict", () => {
  it("confirms when the model and engine agree", () => {
    const r = decide("BUY", ENGINE_BUY);
    expect(r.verdict).toBe<CrossCheckVerdict>("AGREES");
    expect(r.summary).toContain("Confirmed");
    expect(r.engine?.direction).toBe("BUY");
  });

  it("flags a conflict when the model contradicts the engine", () => {
    const r = decide("SELL", ENGINE_BUY);
    expect(r.verdict).toBe("CONFLICTS");
    expect(r.summary).toContain("Not confirmed");
    // The engine's own view is still surfaced so the user can judge.
    expect(r.engine?.direction).toBe("BUY");
  });

  it("is symmetric for sells", () => {
    expect(decide("SELL", ENGINE_SELL).verdict).toBe("AGREES");
    expect(decide("BUY", ENGINE_SELL).verdict).toBe("CONFLICTS");
  });

  it("does not treat a bearish model call on a bullish engine as confirmed", () => {
    // Guard against a sign error that would flip every SELL verdict.
    const r = decide("SELL", ENGINE_SELL, [sig(1, 1)]);
    expect(r.verdict).toBe("CONFLICTS");
  });

  it("reports a conflict when structure points against an otherwise agreeing call", () => {
    const r = decide("BUY", ENGINE_BUY, [sig(-1, 1)]);
    expect(r.verdict).toBe("CONFLICTS");
    expect(r.summary).toContain("points the other way");
  });

  it("confirms when structure corroborates the call", () => {
    const r = decide("BUY", ENGINE_BUY, [sig(1, 2, "Cup & handle")]);
    expect(r.verdict).toBe("AGREES");
    expect(r.summary).toContain("cup & handle");
  });

  it("accepts agreement when no structure is detected at all", () => {
    const r = decide("BUY", ENGINE_BUY, [], []);
    expect(r.verdict).toBe("AGREES");
    expect(r.summary).toContain("no chart structure was detected");
  });

  it("adds up structure and candle signals before deciding", () => {
    // Bullish structure + bullish candle = net bullish, agrees with BUY.
    const ok = decide("BUY", ENGINE_BUY, [sig(1, 3)], [sig(1, 0, "Engulfing")]);
    expect(ok.verdict).toBe("AGREES");
  });

  it("treats an exactly offsetting pair as no net structure, not a conflict", () => {
    // One bullish + one bearish nets to zero. Zero means "the chart structure is
    // not telling us anything", so it must not be reported as disagreement.
    const tie = decide("BUY", ENGINE_BUY, [sig(1, 3)], [sig(-1, 0, "Engulfing")]);
    expect(tie.verdict).toBe("AGREES");
  });

  it("conflicts when bearish structure outvotes a bullish candle", () => {
    const r = decide("BUY", ENGINE_BUY, [sig(-1, 3), sig(-1, 5, "Head & shoulders")], [
      sig(1, 0, "Engulfing"),
    ]);
    expect(r.verdict).toBe("CONFLICTS");
    expect(r.summary).toContain("points the other way");
  });

  it("treats a HOLD as neutral rather than confirmed", () => {
    const r = decide("HOLD", ENGINE_BUY);
    expect(r.verdict).toBe("NEUTRAL");
    expect(r.summary).toContain("Model held");
  });

  it("reports insufficient data for a HOLD with nothing on the tape", () => {
    const r = decide("HOLD", null, [], []);
    expect(r.verdict).toBe("INSUFFICIENT_DATA");
  });

  it("reports insufficient data when there is nothing at all to go on", () => {
    const r = decide("BUY", null);
    expect(r.verdict).toBe("INSUFFICIENT_DATA");
    expect(r.summary).toContain("Nothing on real");
  });

  describe("when the engine abstains (no view)", () => {
    it("still confirms a call that chart structure supports", () => {
      // Regression: an abstaining engine used to discard real structure evidence
      // and report "unverified" on a clearly signposted setup.
      const r = decide("BUY", null, [sig(1, 0, "Triangle / wedge break")]);
      expect(r.verdict).toBe("AGREES");
      expect(r.summary).toContain("Confirmed by chart structure");
      expect(r.engine).toBeNull();
    });

    it("still contradicts a call that structure opposes", () => {
      const r = decide("BUY", null, [sig(-1, 2, "Double top / bottom")]);
      expect(r.verdict).toBe("CONFLICTS");
      expect(r.summary).toContain("leans the other way");
    });

    it("returns NEUTRAL, not a false conflict, when signals offset", () => {
      const r = decide("BUY", null, [sig(1, 1)], [sig(-1, 0, "Engulfing")]);
      expect(r.verdict).toBe("NEUTRAL");
      expect(r.summary).toContain("mixed");
    });

    it("is symmetric for sells", () => {
      expect(decide("SELL", null, [sig(-1, 0)]).verdict).toBe("AGREES");
      expect(decide("SELL", null, [sig(1, 0)]).verdict).toBe("CONFLICTS");
    });

    it("still reports insufficient data with no structure either", () => {
      expect(decide("BUY", null, [], []).verdict).toBe("INSUFFICIENT_DATA");
    });

    it("uses structure, not a stale engine, for a HOLD", () => {
      const r = decide("HOLD", null, [sig(1, 0, "Cup & handle")]);
      expect(r.verdict).toBe("NEUTRAL");
      expect(r.summary).toContain("cup & handle");
    });
  });
});
