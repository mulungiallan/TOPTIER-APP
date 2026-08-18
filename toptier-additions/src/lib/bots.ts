/**
 * Trading Bots Service
 * Drop into: src/lib/bots.ts
 *
 * Supports:
 *  - Bot creation with strategy binding
 *  - Auto-trading based on signal generator
 *  - Strategy automation (EMA cross, RSI, custom)
 *  - Webhook triggers (incoming)
 *  - Outgoing webhooks (IFTTT/Zapier-like)
 *  - Scheduled reports
 */

import { prisma } from "./prisma";
import { signalGenerator } from "./signal-generator";
import { paperTrading } from "./paper-trading";

export interface Bot {
  id: string;
  userId: string;
  name: string;
  strategy: "ema_cross" | "rsi_reversion" | "breakout" | "signal_generator" | "custom";
  symbols: string[];
  timeframe: string;
  riskPerTrade: number;       // % of balance
  maxPositions: number;
  active: boolean;
  createdAt: string;
  lastRunAt: string | null;
  totalTrades: number;
  winningTrades: number;
  totalPnl: number;
  config: Record<string, any>;
}

export const bots = {
  async create(userId: string, config: {
    name: string;
    strategy: Bot["strategy"];
    symbols: string[];
    timeframe?: string;
    riskPerTrade?: number;
    maxPositions?: number;
    autoExecute?: boolean;
  }): Promise<Bot> {
    const bot = await prisma.tradingBot.create({
      data: {
        userId,
        name: config.name,
        strategy: config.strategy,
        symbols: config.symbols,
        timeframe: config.timeframe || "1H",
        riskPerTrade: config.riskPerTrade || 1.0,
        maxPositions: config.maxPositions || 5,
        autoExecute: config.autoExecute ?? false,
        active: true,
        config: config as any,
        createdAt: new Date(),
      },
    });

    return this.mapBot(bot);
  },

  async list(userId: string): Promise<Bot[]> {
    const bots = await prisma.tradingBot.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return bots.map(this.mapBot);
  },

  async toggle(botId: string, active: boolean): Promise<void> {
    await prisma.tradingBot.update({
      where: { id: botId },
      data: { active },
    });
  },

  async delete(botId: string): Promise<void> {
    await prisma.tradingBot.delete({ where: { id: botId } });
  },

  // ============ EXECUTION ============
  // Called by cron job every minute/hour depending on timeframe
  async runBot(botId: string): Promise<void> {
    const bot = await prisma.tradingBot.findUnique({ where: { id: botId } });
    if (!bot || !bot.active) return;

    try {
      // Generate signals for each symbol
      const signals = await signalGenerator.generateBatch(bot.symbols);

      for (const signal of signals) {
        // Check max positions
        const account = await paperTrading.getAccount(bot.userId);
        if (account.openPositions.length >= bot.maxPositions) break;

        // Calculate position size based on risk
        const riskAmount = account.balance * (bot.riskPerTrade / 100);
        const slDistance = Math.abs(signal.entryPrice - signal.stopLoss);
        const size = slDistance > 0 ? riskAmount / slDistance : 0;
        if (size === 0) continue;

        // Open position (paper trading — replace with real broker for live)
        await paperTrading.openPosition({
          userId: bot.userId,
          pair: signal.pair,
          direction: signal.direction,
          size,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
        });

        // Record bot trade
        await prisma.botTrade.create({
          data: {
            botId: bot.id,
            pair: signal.pair,
            direction: signal.direction,
            entryPrice: signal.entryPrice,
            size,
            confidence: signal.confidence,
            reason: signal.reasons.join("; "),
            createdAt: new Date(),
          },
        });

        // Trigger outgoing webhooks
        await this.triggerWebhooks(bot.userId, "trade_opened", {
          bot: bot.name,
          pair: signal.pair,
          direction: signal.direction,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
        });
      }

      await prisma.tradingBot.update({
        where: { id: botId },
        data: { lastRunAt: new Date() },
      });
    } catch (e) {
      console.error(`Bot ${botId} run failed:`, e);
    }
  },

  // ============ INCOMING WEBHOOKS ============
  // External systems (TradingView alerts, IFTTT, Zapier) can trigger bot actions
  async handleWebhook(webhookId: string, payload: any): Promise<void> {
    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId, active: true },
      include: { bot: true },
    });
    if (!webhook || !webhook.bot?.active) return;

    // Verify webhook secret
    if (webhook.secret && payload.secret !== webhook.secret) {
      throw new Error("Invalid webhook secret");
    }

    // Execute based on payload
    if (payload.action === "buy" || payload.action === "sell") {
      const account = await paperTrading.getAccount(webhook.userId);
      const riskAmount = account.balance * (webhook.bot.riskPerTrade / 100);
      const slDistance = payload.stopLoss ? Math.abs(payload.entryPrice - payload.stopLoss) : payload.entryPrice * 0.01;
      const size = riskAmount / slDistance;

      await paperTrading.openPosition({
        userId: webhook.userId,
        pair: payload.symbol,
        direction: payload.action.toUpperCase(),
        size,
        entryPrice: payload.entryPrice,
        stopLoss: payload.stopLoss,
        takeProfit: payload.takeProfit,
      });
    }
  },

  // ============ OUTGOING WEBHOOKS ============
  async triggerWebhooks(userId: string, event: string, data: any): Promise<void> {
    const webhooks = await prisma.outgoingWebhook.findMany({
      where: { userId, active: true, events: { has: event } },
    });

    await Promise.allSettled(
      webhooks.map(async (wh) => {
        try {
          const res = await fetch(wh.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(wh.secret ? { "X-Webhook-Secret": wh.secret } : {}),
            },
            body: JSON.stringify({
              event,
              timestamp: new Date().toISOString(),
              data,
            }),
          });
          if (!res.ok) {
            console.error(`Webhook ${wh.id} failed: ${res.status}`);
          }
        } catch (e) {
          console.error(`Webhook ${wh.id} error:`, e);
        }
      })
    );
  },

  // ============ SCHEDULED REPORTS ============
  async sendScheduledReport(userId: string, period: "daily" | "weekly"): Promise<void> {
    const account = await paperTrading.getAccount(userId);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const periodLabel = period === "daily" ? "Daily" : "Weekly";
    const startDate = period === "daily"
      ? new Date(Date.now() - 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const trades = await prisma.paperTrade.findMany({
      where: { userId, closedAt: { gte: startDate } },
      orderBy: { closedAt: "desc" },
    });

    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

    // Send via outgoing webhook (could be Slack, Discord, email, etc.)
    await this.triggerWebhooks(userId, "scheduled_report", {
      period: periodLabel,
      summary: {
        totalTrades: trades.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
        totalPnl,
        accountBalance: account.balance,
        equity: account.equity,
      },
    });
  },

  mapBot(b: any): Bot {
    return {
      id: b.id,
      userId: b.userId,
      name: b.name,
      strategy: b.strategy,
      symbols: b.symbols,
      timeframe: b.timeframe,
      riskPerTrade: b.riskPerTrade,
      maxPositions: b.maxPositions,
      active: b.active,
      createdAt: b.createdAt.toISOString(),
      lastRunAt: b.lastRunAt?.toISOString() || null,
      totalTrades: b.totalTrades || 0,
      winningTrades: b.winningTrades || 0,
      totalPnl: b.totalPnl || 0,
      config: b.config || {},
    };
  },
};
