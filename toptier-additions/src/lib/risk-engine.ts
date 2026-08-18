/**
 * Advanced Risk Management
 * Drop into: src/lib/risk-engine.ts
 *
 * Computes:
 *  - Value at Risk (VaR) — historical, parametric, Monte Carlo
 *  - Conditional VaR (Expected Shortfall)
 *  - Sharpe / Sortino / Calmar ratios
 *  - Maximum drawdown
 *  - Portfolio correlation matrix
 *  - Beta vs benchmark
 *  - Kelly criterion for position sizing
 *  - Stress testing scenarios
 */

export interface Returns {
  asset: string;
  returns: number[];   // daily returns
}

export interface Position {
  symbol: string;
  size: number;        // units/lots
  entryPrice: number;
  currentPrice: number;
  direction: "LONG" | "SHORT";
}

// ============ VaR (Value at Risk) ============

/** Historical VaR — uses empirical return distribution */
export function historicalVaR(returns: number[], confidence = 0.95, portfolioValue: number): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * sorted.length);
  const varReturn = sorted[index];
  return Math.abs(varReturn * portfolioValue);
}

/** Parametric VaR — assumes normal distribution */
export function parametricVaR(returns: number[], confidence = 0.95, portfolioValue: number): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const std = Math.sqrt(
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
  );
  const zScore = {
    0.90: 1.282,
    0.95: 1.645,
    0.99: 2.326,
  }[confidence as 0.9 | 0.95 | 0.99] || 1.645;
  return Math.abs((mean - zScore * std) * portfolioValue);
}

/** Monte Carlo VaR — simulates future prices using geometric Brownian motion */
export function monteCarloVaR(
  returns: number[],
  confidence = 0.95,
  portfolioValue: number,
  horizonDays = 1,
  simulations = 10000
): { var: number; cvar: number; simulatedReturns: number[] } {
  if (returns.length === 0) return { var: 0, cvar: 0, simulatedReturns: [] };

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const std = Math.sqrt(
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
  );

  const simulatedReturns: number[] = [];
  for (let i = 0; i < simulations; i++) {
    // Box-Muller transform for normal random
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    // Multi-period return (using drift + scaled volatility)
    const simReturn = mean * horizonDays + std * Math.sqrt(horizonDays) * z;
    simulatedReturns.push(simReturn);
  }

  simulatedReturns.sort((a, b) => a - b);
  const varIndex = Math.floor((1 - confidence) * simulations);
  const varReturn = simulatedReturns[varIndex];
  const varValue = Math.abs(varReturn * portfolioValue);

  // CVaR = average of returns below VaR threshold
  const tailReturns = simulatedReturns.slice(0, varIndex);
  const cvarReturn = tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length;
  const cvarValue = Math.abs(cvarReturn * portfolioValue);

  return { var: varValue, cvar: cvarValue, simulatedReturns };
}

// ============ PERFORMANCE RATIOS ============

export function sharpeRatio(returns: number[], riskFreeRate = 0.02): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const std = Math.sqrt(
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
  );
  if (std === 0) return 0;
  const dailyRf = riskFreeRate / 252;
  return ((mean - dailyRf) / std) * Math.sqrt(252);
}

export function sortinoRatio(returns: number[], riskFreeRate = 0.02): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const downside = returns.filter((r) => r < 0);
  if (downside.length === 0) return Infinity;
  const downsideStd = Math.sqrt(
    downside.reduce((s, r) => s + r * r, 0) / downside.length
  );
  if (downsideStd === 0) return Infinity;
  const dailyRf = riskFreeRate / 252;
  return ((mean - dailyRf) / downsideStd) * Math.sqrt(252);
}

export function maxDrawdown(equityCurve: number[]): { maxDD: number; peakIdx: number; troughIdx: number } {
  let peak = equityCurve[0] || 0;
  let peakIdx = 0;
  let maxDD = 0;
  let maxDDPeakIdx = 0;
  let maxDDTroughIdx = 0;

  for (let i = 0; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
      peakIdx = i;
    }
    const dd = (peak - equityCurve[i]) / peak;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDPeakIdx = peakIdx;
      maxDDTroughIdx = i;
    }
  }

  return { maxDD, peakIdx: maxDDPeakIdx, troughIdx: maxDDTroughIdx };
}

export function calmarRatio(returns: number[], equityCurve: number[]): number {
  if (returns.length === 0 || equityCurve.length === 0) return 0;
  const annualReturn = (Math.pow(equityCurve[equityCurve.length - 1] / equityCurve[0], 252 / equityCurve.length) - 1);
  const { maxDD } = maxDrawdown(equityCurve);
  if (maxDD === 0) return Infinity;
  return annualReturn / maxDD;
}

// ============ PORTFOLIO ANALYTICS ============

export function correlationMatrix(assets: Returns[]): number[][] {
  const n = assets.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1;
      } else {
        const corr = pearsonCorrelation(assets[i].returns, assets[j].returns);
        matrix[i][j] = corr;
        matrix[j][i] = corr;
      }
    }
  }
  return matrix;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n === 0) return 0;
  const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

export function beta(assetReturns: number[], benchmarkReturns: number[]): number {
  const n = Math.min(assetReturns.length, benchmarkReturns.length);
  if (n === 0) return 0;
  const meanA = assetReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanB = benchmarkReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let cov = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (assetReturns[i] - meanA) * (benchmarkReturns[i] - meanB);
    varB += (benchmarkReturns[i] - meanB) ** 2;
  }
  if (varB === 0) return 0;
  return cov / varB;
}

// ============ POSITION SIZING ============

/** Kelly Criterion — optimal fraction to bet */
export function kellyCriterion(winRate: number, winLossRatio: number): number {
  // f* = (p * b - q) / b
  // p = win rate, q = loss rate (1-p), b = win/loss ratio
  const p = winRate;
  const q = 1 - p;
  const f = (p * winLossRatio - q) / winLossRatio;
  return Math.max(0, Math.min(1, f)); // Cap at 100%
}

/** Risk-adjusted position size based on account risk % */
export function positionSizeByRisk(params: {
  accountBalance: number;
  riskPercent: number;     // e.g. 1.0 = 1%
  entryPrice: number;
  stopLoss: number;
  direction: "LONG" | "SHORT";
}): { size: number; riskAmount: number } {
  const riskAmount = params.accountBalance * (params.riskPercent / 100);
  const slDistance = Math.abs(params.entryPrice - params.stopLoss);
  if (slDistance === 0) return { size: 0, riskAmount };
  const size = riskAmount / slDistance;
  return { size, riskAmount };
}

/** Portfolio allocation suggestion based on risk tolerance */
export function suggestAllocation(params: {
  riskTolerance: "conservative" | "moderate" | "aggressive";
  capital: number;
}): { asset: string; percent: number; amount: number }[] {
  const profiles = {
    conservative: [
      { asset: "Major Forex (EUR/USD, GBP/USD)", percent: 40 },
      { asset: "Gold (XAU/USD)", percent: 30 },
      { asset: "Index ETFs (SPY, QQQ)", percent: 20 },
      { asset: "Cash", percent: 10 },
    ],
    moderate: [
      { asset: "Major Forex", percent: 35 },
      { asset: "Cross Forex (EUR/GBP, AUD/USD)", percent: 20 },
      { asset: "Gold & Silver", percent: 20 },
      { asset: "Index ETFs", percent: 15 },
      { asset: "Large-cap Stocks", percent: 10 },
    ],
    aggressive: [
      { asset: "Cross & Exotic Forex", percent: 30 },
      { asset: "Cryptocurrency (BTC, ETH)", percent: 25 },
      { asset: "Individual Stocks", percent: 25 },
      { asset: "Gold & Commodities", percent: 15 },
      { asset: "Cash", percent: 5 },
    ],
  };
  const profile = profiles[params.riskTolerance];
  return profile.map((p) => ({
    ...p,
    amount: (params.capital * p.percent) / 100,
  }));
}

// ============ STRESS TESTING ============

export interface StressScenario {
  name: string;
  description: string;
  marketShock: number;     // % change applied to all positions
  volatilityMultiplier: number; // e.g. 2.0 = doubled volatility
}

export const SCENARIOS: StressScenario[] = [
  { name: "2008 Financial Crisis", description: "S&P 500 fell ~50% over 6 months", marketShock: -0.35, volatilityMultiplier: 3.0 },
  { name: "COVID-19 Crash (Mar 2020)", description: "S&P 500 fell ~34% in 23 trading days", marketShock: -0.20, volatilityMultiplier: 2.5 },
  { name: "Flash Crash (May 2010)", description: "DJIA fell 9% in minutes", marketShock: -0.09, volatilityMultiplier: 5.0 },
  { name: "EUR/CHF Unpeg (Jan 2015)", description: "EUR/CHF fell 30% in minutes", marketShock: -0.30, volatilityMultiplier: 4.0 },
  { name: "Mild Correction", description: "10% pullback", marketShock: -0.10, volatilityMultiplier: 1.5 },
  { name: "Bull Market Rally", description: "20% gain", marketShock: 0.20, volatilityMultiplier: 0.8 },
];

export function stressTest(positions: Position[], scenario: StressScenario): {
  positionResults: { symbol: string; originalValue: number; stressedValue: number; pnl: number }[];
  totalPnl: number;
  totalPnlPercent: number;
} {
  const positionResults = positions.map((p) => {
    const originalValue = p.size * p.currentPrice;
    const shockMultiplier = 1 + (p.direction === "LONG" ? scenario.marketShock : -scenario.marketShock);
    const stressedPrice = p.currentPrice * shockMultiplier;
    const stressedValue = p.size * stressedPrice;
    const pnl = p.direction === "LONG" ? stressedValue - originalValue : originalValue - stressedValue;
    return { symbol: p.symbol, originalValue, stressedValue, pnl };
  });

  const totalOriginal = positionResults.reduce((s, p) => s + p.originalValue, 0);
  const totalPnl = positionResults.reduce((s, p) => s + p.pnl, 0);

  return {
    positionResults,
    totalPnl,
    totalPnlPercent: totalOriginal > 0 ? (totalPnl / totalOriginal) * 100 : 0,
  };
}

// ============ COMPREHENSIVE RISK REPORT ============

export interface RiskReport {
  portfolioValue: number;
  var95: {
    historical: number;
    parametric: number;
    monteCarlo: { value: number; cvar: number };
  };
  var99: {
    historical: number;
    parametric: number;
    monteCarlo: { value: number; cvar: number };
  };
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  beta: number;
  stressTests: { scenario: string; pnl: number; pnlPercent: number }[];
  allocation: { asset: string; percent: number; amount: number }[];
}

export function generateRiskReport(params: {
  returns: number[];
  equityCurve: number[];
  benchmarkReturns?: number[];
  positions: Position[];
  portfolioValue: number;
  riskTolerance?: "conservative" | "moderate" | "aggressive";
}): RiskReport {
  const { returns, equityCurve, benchmarkReturns = [], positions, portfolioValue } = params;

  const var95MC = monteCarloVaR(returns, 0.95, portfolioValue);
  const var99MC = monteCarloVaR(returns, 0.99, portfolioValue);

  return {
    portfolioValue,
    var95: {
      historical: historicalVaR(returns, 0.95, portfolioValue),
      parametric: parametricVaR(returns, 0.95, portfolioValue),
      monteCarlo: { value: var95MC.var, cvar: var95MC.cvar },
    },
    var99: {
      historical: historicalVaR(returns, 0.99, portfolioValue),
      parametric: parametricVaR(returns, 0.99, portfolioValue),
      monteCarlo: { value: var99MC.var, cvar: var99MC.cvar },
    },
    sharpeRatio: sharpeRatio(returns),
    sortinoRatio: sortinoRatio(returns),
    calmarRatio: calmarRatio(returns, equityCurve),
    maxDrawdown: maxDrawdown(equityCurve).maxDD,
    beta: beta(returns, benchmarkReturns),
    stressTests: SCENARIOS.map((s) => {
      const result = stressTest(positions, s);
      return { scenario: s.name, pnl: result.totalPnl, pnlPercent: result.totalPnlPercent };
    }),
    allocation: suggestAllocation({
      riskTolerance: params.riskTolerance || "moderate",
      capital: portfolioValue,
    }),
  };
}
