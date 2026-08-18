/**
 * Paper Trading Service — virtual trading account
 * Drop into: src/lib/paper-trading.ts
 *
 * Lets users practice trading without real money.
 * Tracks: cash balance, open positions, closed trades, P&L.
 * Uses Prisma models PaperTrade and PaperPosition (see prisma additions).
 */

import { prisma } from "./prisma";

export interface OpenPosition {
  id: string;
  userId: string;
  pair: string;
  direction: "BUY" | "SELL";
  size: number;        // lot size
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  pnl: number;
  pnlPercent: number;
  margin: number;
  openedAt: string;
}

export interface ClosedTrade {
  id: string;
  userId: string;
  pair: string;
  direction: "BUY" | "SELL";
  size: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  reason: "manual" | "stop_loss" | "take_profit";
  openedAt: string;
  closedAt: string;
}

export interface PaperAccount {
  userId: string;
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

const STARTING_BALANCE = parseFloat(process.env.PAPER_TRADE_STARTING_BALANCE || "100000");
const LEVERAGE = 30; // 30:1 max leverage for retail forex
const MAX_POSITIONS = parseInt(process.env.PAPER_TRADE_MAX_POSITIONS || "10", 10);

export const paperTrading = {
  async getAccount(userId: string): Promise<PaperAccount> {
    // Get or create account
    let account = await prisma.paperAccount.findUnique({ where: { userId } });
    if (!account) {
      account = await prisma.paperAccount.create({
        data: { userId, balance: STARTING_BALANCE },
      });
    }

    const positions = await prisma.paperPosition.findMany({ where: { userId, status: "OPEN" } });
    const closedTrades = await prisma.paperTrade.findMany({
      where: { userId },
      orderBy: { closedAt: "desc" },
      take: 100,
    });

    const openPositions: OpenPosition[] = positions.map((p) => ({
      id: p.id,
      userId: p.userId,
      pair: p.pair,
      direction: p.direction as "BUY" | "SELL",
      size: p.size,
      entryPrice: p.entryPrice,
      currentPrice: p.currentPrice,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      pnl: p.pnl,
      pnlPercent: p.pnlPercent,
      margin: p.margin,
      openedAt: p.openedAt.toISOString(),
    }));

    const marginUsed = openPositions.reduce((sum, p) => sum + p.margin, 0);
    const unrealizedPnl = openPositions.reduce((sum, p) => sum + p.pnl, 0);
    const totalPnl = account.balance - STARTING_BALANCE + unrealizedPnl;
    const winningTrades = closedTrades.filter((t) => t.pnl > 0).length;

    return {
      userId,
      balance: account.balance,
      equity: account.balance + unrealizedPnl,
      marginUsed,
      freeMargin: account.balance + unrealizedPnl - marginUsed,
      openPositions,
      totalPnl,
      winRate: closedTrades.length > 0 ? winningTrades / closedTrades.length : 0,
      totalTrades: closedTrades.length,
      winningTrades,
    };
  },

  async openPosition(params: {
    userId: string;
    pair: string;
    direction: "BUY" | "SELL";
    size: number;
    entryPrice: number;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<OpenPosition> {
    const account = await this.getAccount(params.userId);
    if (account.openPositions.length >= MAX_POSITIONS) {
      throw new Error(`Maximum ${MAX_POSITIONS} positions reached`);
    }

    const margin = (params.size * params.entryPrice) / LEVERAGE;
    if (margin > account.freeMargin) {
      throw new Error("Insufficient free margin");
    }

    const position = await prisma.paperPosition.create({
      data: {
        userId: params.userId,
        pair: params.pair,
        direction: params.direction,
        size: params.size,
        entryPrice: params.entryPrice,
        currentPrice: params.entryPrice,
        stopLoss: params.stopLoss,
        takeProfit: params.takeProfit,
        pnl: 0,
        pnlPercent: 0,
        margin,
        status: "OPEN",
        openedAt: new Date(),
      },
    });

    return {
      id: position.id,
      userId: position.userId,
      pair: position.pair,
      direction: position.direction as "BUY" | "SELL",
      size: position.size,
      entryPrice: position.entryPrice,
      currentPrice: position.currentPrice,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      pnl: 0,
      pnlPercent: 0,
      margin: position.margin,
      openedAt: position.openedAt.toISOString(),
    };
  },

  async closePosition(positionId: string, exitPrice?: number): Promise<ClosedTrade> {
    const position = await prisma.paperPosition.findUnique({ where: { id: positionId } });
    if (!position) throw new Error("Position not found");
    if (position.status !== "OPEN") throw new Error("Position already closed");

    const exit = exitPrice || position.currentPrice;
    const pnl = position.direction === "BUY"
      ? (exit - position.entryPrice) * position.size
      : (position.entryPrice - exit) * position.size;
    const pnlPercent = (pnl / (position.size * position.entryPrice)) * 100;

    const closed = await prisma.paperTrade.create({
      data: {
        userId: position.userId,
        pair: position.pair,
        direction: position.direction,
        size: position.size,
        entryPrice: position.entryPrice,
        exitPrice: exit,
        pnl,
        pnlPercent,
        reason: "manual",
        openedAt: position.openedAt,
        closedAt: new Date(),
      },
    });

    await prisma.paperPosition.update({
      where: { id: positionId },
      data: { status: "CLOSED", pnl, pnlPercent },
    });

    // Update account balance
    const account = await prisma.paperAccount.findUnique({ where: { userId: position.userId } });
    if (account) {
      await prisma.paperAccount.update({
        where: { userId: position.userId },
        data: { balance: account.balance + pnl },
      });
    }

    return {
      id: closed.id,
      userId: closed.userId,
      pair: closed.pair,
      direction: closed.direction as "BUY" | "SELL",
      size: closed.size,
      entryPrice: closed.entryPrice,
      exitPrice: closed.exitPrice,
      pnl: closed.pnl,
      pnlPercent: closed.pnlPercent,
      reason: closed.reason as "manual",
      openedAt: closed.openedAt.toISOString(),
      closedAt: closed.closedAt.toISOString(),
    };
  },

  // Update current prices for all open positions — call periodically
  async updatePrices(userId: string, prices: Record<string, number>): Promise<void> {
    const positions = await prisma.paperPosition.findMany({
      where: { userId, status: "OPEN" },
    });

    for (const p of positions) {
      const newPrice = prices[p.pair];
      if (!newPrice) continue;

      const pnl = p.direction === "BUY"
        ? (newPrice - p.entryPrice) * p.size
        : (p.entryPrice - newPrice) * p.size;
      const pnlPercent = (pnl / (p.size * p.entryPrice)) * 100;

      // Auto-close on SL/TP hit
      let shouldClose = false;
      let closeReason: "stop_loss" | "take_profit" | null = null;
      if (p.stopLoss) {
        if (p.direction === "BUY" && newPrice <= p.stopLoss) {
          shouldClose = true; closeReason = "stop_loss";
        } else if (p.direction === "SELL" && newPrice >= p.stopLoss) {
          shouldClose = true; closeReason = "stop_loss";
        }
      }
      if (p.takeProfit) {
        if (p.direction === "BUY" && newPrice >= p.takeProfit) {
          shouldClose = true; closeReason = "take_profit";
        } else if (p.direction === "SELL" && newPrice <= p.takeProfit) {
          shouldClose = true; closeReason = "take_profit";
        }
      }

      if (shouldClose && closeReason) {
        await this.closePosition(p.id, newPrice);
        // Update reason
        await prisma.paperTrade.updateMany({
          where: { userId, pair: p.pair, closedAt: { gte: new Date(Date.now() - 5000) } },
          data: { reason: closeReason },
        });
      } else {
        await prisma.paperPosition.update({
          where: { id: p.id },
          data: { currentPrice: newPrice, pnl, pnlPercent },
        });
      }
    }
  },

  async resetAccount(userId: string): Promise<void> {
    await prisma.paperPosition.deleteMany({ where: { userId } });
    await prisma.paperTrade.deleteMany({ where: { userId } });
    await prisma.paperAccount.upsert({
      where: { userId },
      update: { balance: STARTING_BALANCE },
      create: { userId, balance: STARTING_BALANCE },
    });
  },
};
