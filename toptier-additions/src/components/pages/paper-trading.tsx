"use client";

/**
 * Paper Trading Page — practice trading with virtual money
 * Drop into: src/components/pages/paper-trading.tsx
 */

import { useState } from "react";
import { useRobustFetch } from "@/hooks/use-robust-fetch";
import { StatCardSkeleton, ErrorState, OfflineBanner } from "@/components/loading-skeletons";

interface OpenPosition {
  id: string;
  pair: string;
  direction: "BUY" | "SELL";
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  margin: number;
  openedAt: string;
}

interface PaperAccount {
  balance: number;
  equity: number;
  marginUsed: number;
  freeMargin: number;
  openPositions: OpenPosition[];
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
}

const DEFAULT_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD"];

export function PaperTradingPage() {
  const [showOpenForm, setShowOpenForm] = useState(false);
  const [form, setForm] = useState({
    pair: "EURUSD",
    direction: "BUY" as "BUY" | "SELL",
    size: 1,
    entryPrice: 1.0850,
    stopLoss: 1.0800,
    takeProfit: 1.0950,
  });
  const [actionLoading, setActionLoading] = useState(false);

  const { data, loading, error, retry, refetch, isRetrying } = useRobustFetch<{ data: PaperAccount }>({
    url: "/api/paper-trade",
    refetchInterval: 30000,
  });

  const account = data?.data;

  const openPosition = async () => {
    setActionLoading(true);
    try {
      await fetch("/api/paper-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", ...form }),
      });
      setShowOpenForm(false);
      refetch();
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  const closePosition = async (id: string) => {
    setActionLoading(true);
    try {
      await fetch("/api/paper-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", positionId: id }),
      });
      refetch();
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  const resetAccount = async () => {
    if (!confirm("Reset account to $100,000 and delete all history?")) return;
    setActionLoading(true);
    try {
      await fetch("/api/paper-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      refetch();
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
          </div>
        </div>
      </div>
    );
  }

  if (error && !account) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
        <ErrorState error={error.message} onRetry={retry} isRetrying={isRetrying} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 md:p-6">
      <OfflineBanner isOffline={false} />
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">💼 Paper Trading</h1>
            <p className="text-muted-foreground">Practice trading with $100,000 virtual money</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowOpenForm(!showOpenForm)}
              className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600"
            >
              + New Position
            </button>
            <button
              onClick={resetAccount}
              disabled={actionLoading}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm hover:bg-white/10"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-xs text-muted-foreground mb-1">Balance</div>
            <div className="text-xl font-bold">${account?.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-xs text-muted-foreground mb-1">Equity</div>
            <div className="text-xl font-bold text-blue-400">${account?.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-xs text-muted-foreground mb-1">Total P&L</div>
            <div className={`text-xl font-bold ${(account?.totalPnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {(account?.totalPnl || 0) >= 0 ? "+" : ""}${(account?.totalPnl || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-xs text-muted-foreground mb-1">Win Rate</div>
            <div className="text-xl font-bold">{((account?.winRate || 0) * 100).toFixed(1)}%</div>
          </div>
        </div>

        {/* Open form */}
        {showOpenForm && (
          <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h3 className="font-semibold mb-3">Open New Position</h3>
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Pair</label>
                <select
                  value={form.pair}
                  onChange={(e) => setForm({ ...form, pair: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
                >
                  {DEFAULT_PAIRS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Direction</label>
                <div className="flex gap-2 mt-1">
                  {(["BUY", "SELL"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setForm({ ...form, direction: d })}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium ${
                        form.direction === d
                          ? d === "BUY" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
                          : "bg-white/5"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Size (lots)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.size}
                  onChange={(e) => setForm({ ...form, size: parseFloat(e.target.value) })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Entry Price</label>
                <input
                  type="number"
                  step="0.0001"
                  value={form.entryPrice}
                  onChange={(e) => setForm({ ...form, entryPrice: parseFloat(e.target.value) })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Stop Loss</label>
                <input
                  type="number"
                  step="0.0001"
                  value={form.stopLoss}
                  onChange={(e) => setForm({ ...form, stopLoss: parseFloat(e.target.value) })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Take Profit</label>
                <input
                  type="number"
                  step="0.0001"
                  value={form.takeProfit}
                  onChange={(e) => setForm({ ...form, takeProfit: parseFloat(e.target.value) })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={openPosition}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
              >
                {actionLoading ? "Opening..." : "Open Position"}
              </button>
              <button
                onClick={() => setShowOpenForm(false)}
                className="px-4 py-2 rounded-lg bg-white/5 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Open positions */}
        <h2 className="text-lg font-semibold mb-3">Open Positions ({account?.openPositions.length || 0})</h2>
        {account?.openPositions.length === 0 ? (
          <div className="text-center py-12 rounded-xl border border-white/10 bg-white/[0.02]">
            <div className="text-4xl mb-3">📊</div>
            <p className="text-muted-foreground">No open positions. Click "New Position" to start.</p>
          </div>
        ) : (
          <div className="space-y-2 mb-6">
            {account?.openPositions.map((p) => (
              <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-sm px-2 py-1 rounded font-bold ${p.direction === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                      {p.direction}
                    </span>
                    <div>
                      <div className="font-semibold">{p.pair}</div>
                      <div className="text-xs text-muted-foreground">{p.size} lots @ {p.entryPrice}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(2)}
                    </div>
                    <div className={`text-xs ${p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {p.pnlPercent >= 0 ? "+" : ""}{p.pnlPercent.toFixed(2)}%
                    </div>
                  </div>
                  <button
                    onClick={() => closePosition(p.id)}
                    disabled={actionLoading}
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-medium hover:bg-white/10"
                  >
                    Close
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
