"use client";

/**
 * Backtesting Page — test strategies against historical data
 * Drop into: src/components/pages/backtest.tsx
 */

import { useState } from "react";
import { ChartSkeleton, ErrorState } from "@/components/loading-skeletons";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine,
} from "recharts";

interface BacktestTrade {
  entryDate: string;
  exitDate: string;
  direction: "BUY" | "SELL";
  pnl: number;
  pnlPercent: number;
  reason: string;
  holdingBars: number;
}

interface BacktestResult {
  trades: BacktestTrade[];
  metrics: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalReturn: number;
    totalPnl: number;
    averageWin: number;
    averageLoss: number;
    profitFactor: number;
    maxDrawdown: number;
    sharpeRatio: number;
    sortinoRatio: number;
    averageHoldingBars: number;
    longestWinStreak: number;
    longestLossStreak: number;
  };
  equityCurve: { index: number; date: string; equity: number }[];
  parameters: {
    symbol: string;
    startingCapital: number;
    timeframe: string;
  };
}

const STRATEGIES = [
  { id: "emaCross", label: "EMA Crossover (9/21/50)", description: "Trend-following" },
  { id: "rsiReversion", label: "RSI Mean Reversion", description: "Buy oversold, sell overbought" },
  { id: "breakout", label: "20-bar Breakout", description: "Buy high, sell low of range" },
  { id: "signalGenerator", label: "Multi-Indicator (AI-style)", description: "Combined scoring" },
];

const SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "XAUUSD", "BTCUSD"];

export function BacktestPage() {
  const [form, setForm] = useState({
    symbol: "EURUSD",
    strategy: "emaCross",
    startingCapital: 10000,
    positionSizePercent: 10,
    stopLossPct: 2,
    takeProfitPct: 4,
    allowShort: true,
    maxConcurrentPositions: 1,
  });
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Backtest failed");
      const json = await res.json();
      setResult(json.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">📊 Backtest Strategy</h1>
        <p className="text-muted-foreground mb-6">Test trading strategies against historical data</p>

        {/* Config form */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-6">
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Symbol</label>
              <select
                value={form.symbol}
                onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              >
                {SYMBOLS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Strategy</label>
              <select
                value={form.strategy}
                onChange={(e) => setForm({ ...form, strategy: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              >
                {STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Starting Capital ($)</label>
              <input
                type="number"
                value={form.startingCapital}
                onChange={(e) => setForm({ ...form, startingCapital: parseFloat(e.target.value) })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Position Size (%)</label>
              <input
                type="number"
                value={form.positionSizePercent}
                onChange={(e) => setForm({ ...form, positionSizePercent: parseFloat(e.target.value) })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Stop Loss (%)</label>
              <input
                type="number"
                step="0.5"
                value={form.stopLossPct}
                onChange={(e) => setForm({ ...form, stopLossPct: parseFloat(e.target.value) })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Take Profit (%)</label>
              <input
                type="number"
                step="0.5"
                value={form.takeProfitPct}
                onChange={(e) => setForm({ ...form, takeProfitPct: parseFloat(e.target.value) })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.allowShort}
                onChange={(e) => setForm({ ...form, allowShort: e.target.checked })}
              />
              Allow short selling
            </label>
            <button
              onClick={run}
              disabled={loading}
              className="ml-auto px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
            >
              {loading ? "Running..." : "Run Backtest"}
            </button>
          </div>
        </div>

        {error && <div className="mb-6"><ErrorState error={error} /></div>}

        {loading && <ChartSkeleton />}

        {/* Results */}
        {result && !loading && (
          <>
            {/* Metrics grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <MetricCard label="Total Return" value={`${result.metrics.totalReturn >= 0 ? "+" : ""}${result.metrics.totalReturn.toFixed(2)}%`} positive={result.metrics.totalReturn >= 0} />
              <MetricCard label="Win Rate" value={`${(result.metrics.winRate * 100).toFixed(1)}%`} positive={result.metrics.winRate >= 0.5} />
              <MetricCard label="Profit Factor" value={result.metrics.profitFactor === Infinity ? "∞" : result.metrics.profitFactor.toFixed(2)} positive={result.metrics.profitFactor >= 1} />
              <MetricCard label="Max Drawdown" value={`-${result.metrics.maxDrawdown.toFixed(2)}%`} positive={false} />
              <MetricCard label="Total Trades" value={result.metrics.totalTrades.toString()} />
              <MetricCard label="Sharpe Ratio" value={result.metrics.sharpeRatio.toFixed(2)} positive={result.metrics.sharpeRatio >= 1} />
              <MetricCard label="Sortino Ratio" value={result.metrics.sortinoRatio.toFixed(2)} positive={result.metrics.sortinoRatio >= 1} />
              <MetricCard label="Avg Win/Loss" value={`$${result.metrics.averageWin.toFixed(0)} / $${result.metrics.averageLoss.toFixed(0)}`} />
            </div>

            {/* Equity curve */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-6">
              <h3 className="font-semibold mb-3">Equity Curve</h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={result.equityCurve}>
                  <defs>
                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="index" tick={{ fill: "#888", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#888", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#0a0a0f", border: "1px solid #333" }}
                    labelFormatter={(i) => `Bar ${i}`}
                    formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Equity"]}
                  />
                  <Area type="monotone" dataKey="equity" stroke="#00d4ff" strokeWidth={2} fill="url(#equityGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* P&L per trade */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-6">
              <h3 className="font-semibold mb-3">P&L per Trade</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={result.trades.map((t, i) => ({ ...t, idx: i + 1 }))}>
                  <XAxis dataKey="idx" tick={{ fill: "#888", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#888", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#0a0a0f", border: "1px solid #333" }}
                    formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "P&L"]}
                  />
                  <ReferenceLine y={0} stroke="#666" />
                  <Bar dataKey="pnl">
                    {result.trades.map((t, i) => (
                      <Cell key={i} fill={t.pnl >= 0 ? "#10b981" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Trade history */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <h3 className="font-semibold mb-3">Trade History</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b border-white/10">
                      <th className="text-left p-2">#</th>
                      <th className="text-left p-2">Direction</th>
                      <th className="text-left p-2">Entry</th>
                      <th className="text-left p-2">Exit</th>
                      <th className="text-right p-2">P&L</th>
                      <th className="text-right p-2">%</th>
                      <th className="text-left p-2">Reason</th>
                      <th className="text-right p-2">Bars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className="p-2">{i + 1}</td>
                        <td className="p-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${t.direction === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                            {t.direction}
                          </span>
                        </td>
                        <td className="p-2 text-xs">{new Date(t.entryDate).toLocaleDateString()}</td>
                        <td className="p-2 text-xs">{new Date(t.exitDate).toLocaleDateString()}</td>
                        <td className={`p-2 text-right font-medium ${t.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                        </td>
                        <td className={`p-2 text-right ${t.pnlPercent >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {t.pnlPercent >= 0 ? "+" : ""}{t.pnlPercent.toFixed(2)}%
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">{t.reason}</td>
                        <td className="p-2 text-right">{t.holdingBars}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-lg font-bold ${positive === undefined ? "" : positive ? "text-emerald-400" : "text-red-400"}`}>
        {value}
      </div>
    </div>
  );
}
