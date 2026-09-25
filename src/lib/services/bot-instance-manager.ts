// src/lib/services/bot-instance-manager.ts
// Glue between the Prisma BotConnection/BotInstance rows and the Python bot
// service: builds instance specs (decrypting the broker password), starts and
// stops instances, and keeps the DB status in sync with the subprocess state.

import { db } from '@/lib/db'
import { decryptSecret } from '@/lib/bot-crypto'
import { hasBotAccess } from '@/lib/entitlements'
import {
  botService,
  BotServiceOfflineError,
  type CreateInstanceSpec,
  type ServiceInstanceStatus,
} from '@/lib/services/bot-service'

// Cooldown on auto-restarts: if an instance dies (wrong credentials, broker
// disconnect, engine crash) reconcile won't hot-spin it. It retries on later
// page loads / webhook pings instead.
export const RESTART_COOLDOWN_MS = 2 * 60 * 1000

function appWebhookUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) throw new Error('NEXT_PUBLIC_APP_URL is not configured — cannot build webhook URL for bot service')
  return `${url}/api/bot/webhook`
}

function parseSettings(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

export async function buildSpec(
  connection: { passwordEnc: string },
  instance: { id: string },
  platform: string,
  login: string,
  server: string,
  terminalPath: string | null,
  settings: string
): Promise<CreateInstanceSpec> {
  // GUI-attach mode: if no broker login is set, the password stays empty and
  // the engine attaches to the terminal already signed in on the hosting box.
  if (!String(login || '').trim() && !connection.passwordEnc) {
    return {
      instanceId: instance.id,
      platform,
      login: '',
      password: '',
      server,
      terminalPath,
      webhookUrl: appWebhookUrl(),
      serviceKey: process.env.BOT_SERVICE_KEY || '',
      settings: parseSettings(settings),
    }
  }
  const password = decryptSecret(connection.passwordEnc)
  if (!password) {
    throw new Error('Stored broker password could not be decrypted (check BOT_CREDENTIALS_SECRET).')
  }
  return {
    instanceId: instance.id,
    platform,
    login,
    password,
    server,
    terminalPath,
    webhookUrl: appWebhookUrl(),
    serviceKey: process.env.BOT_SERVICE_KEY || '',
    settings: parseSettings(settings),
  }
}

function mapStatus(serviceStatus: ServiceInstanceStatus): string {
  return serviceStatus.status === 'running' ? 'running' : 'stopped'
}

export type ReconcileSummary = {
  healed: number
  stoppedExpired: number
  skipped: number
  errors: number
}

async function isCopyMasterConnection(connectionId: string): Promise<boolean> {
  const copyMaster = await db.copyTrader.findFirst({ where: { masterConnectionId: connectionId } })
  return !!copyMaster
}

export const BotInstanceManager = {
  /** Get the connection's instance row, creating it lazily. */
  async ensureInstance(connectionId: string): Promise<{ id: string }> {
    const existing = await db.botInstance.findFirst({ where: { connectionId } })
    if (existing) return existing
    const conn = await db.botConnection.findUnique({ where: { id: connectionId } })
    if (!conn) throw new Error('Connection not found')
    return db.botInstance.create({
      data: {
        connectionId,
        userId: conn.userId,
        status: 'stopped',
      },
    })
  },

  /** Start (or restart) the bot for a connection. */
  async start(connectionId: string, opts: { autoStarted?: boolean } = {}): Promise<{ instance: any; serviceStatus: ServiceInstanceStatus }> {
    const connection = await db.botConnection.findUnique({ where: { id: connectionId } })
    if (!connection) throw new Error('Connection not found')

    // One account, one use: an account that is designated as a copy-trading
    // MASTER cannot also run the bot. The user must unlink the master first.
    const copyMaster = await db.copyTrader.findFirst({ where: { masterConnectionId: connectionId } })
    if (copyMaster) {
      throw new Error(
        'This account is your copy-trading MASTER. One account is used for one thing at a time — unlink it on the Copy Trading page (Manage tab) before running the bot here.'
      )
    }

    const instance = await this.ensureInstance(connectionId)
    const spec = await buildSpec(connection, instance, connection.platform, connection.login, connection.server, connection.terminalPath, connection.settings)

    await db.botInstance.update({
      where: { id: instance.id },
      data: { status: 'starting', lastError: null, lastHeartbeatAt: new Date() },
    })

    let serviceStatus: ServiceInstanceStatus
    try {
      const res = await botService.createInstance(spec)
      serviceStatus = res.instance
    } catch (err) {
      await db.botInstance.update({
        where: { id: instance.id },
        data: { status: 'error', shouldRun: false, stoppedReason: 'error', lastError: err instanceof Error ? err.message : 'Failed to start bot' },
      })
      throw err
    }

    await db.botInstance.update({
      where: { id: instance.id },
      data: {
        status: mapStatus(serviceStatus),
        pid: serviceStatus.pid,
        startCount: { increment: 1 },
        lastHeartbeatAt: new Date(),
        lastRestartAttemptAt: new Date(),
        lastError: null,
        shouldRun: true,
        stoppedReason: null,
        autoStarted: opts.autoStarted === true,
      },
    })
    return { instance, serviceStatus }
  },

  /** Refresh live status from the bot service and persist it. */
  async refreshStatus(instanceId: string): Promise<{ instance: any; online: boolean }> {
    let serviceStatus: ServiceInstanceStatus | null = null
    try {
      const res = await botService.status(instanceId)
      serviceStatus = res.instance
    } catch (err) {
      if (err instanceof BotServiceOfflineError) {
        return { instance: null, online: false }
      }
      throw err
    }

    const instance = await db.botInstance.update({
      where: { id: instanceId },
      data: {
        status: mapStatus(serviceStatus),
        pid: serviceStatus.pid,
        lastHeartbeatAt: new Date(),
      },
    })
    return { instance, online: true }
  },

  async stop(instanceId: string, reason: 'manual' | 'subscription_expired' | 'error' = 'manual'): Promise<{ instance: any }> {
    const current = await db.botInstance.findUnique({ where: { id: instanceId } })
    if (current && current.status === 'stopped') {
      const instance = await db.botInstance.update({
        where: { id: instanceId },
        data: { shouldRun: false, stoppedReason: reason },
      })
      return { instance }
    }
    await db.botInstance.update({
      where: { id: instanceId },
      data: { status: 'stopping', lastHeartbeatAt: new Date() },
    })
    try {
      const res = await botService.stop(instanceId)
      await db.botInstance.update({
        where: { id: instanceId },
        data: {
          status: mapStatus(res.instance),
          pid: null,
          lastHeartbeatAt: new Date(),
          shouldRun: false,
          stoppedReason: reason,
        },
      })
    } catch (err) {
      await db.botInstance.update({
        where: { id: instanceId },
        data: { status: 'stopped', pid: null, shouldRun: false, stoppedReason: reason },
      })
      throw err
    }
    const instance = await db.botInstance.findUnique({ where: { id: instanceId } })
    return { instance }
  },

  /**
   * Keep-running reconciliation. For instances flagged `shouldRun` whose owner
   * still has an active subscription, ensure the bot service is actually
   * running them — restarting any that went down (crash, service restart).
   * Instances whose subscription expired are stopped and marked so they don't
   * restart until the user explicitly starts them again.
   */
  async reconcileForUser(userId: string): Promise<ReconcileSummary> {
    return reconcile({ onlyUserId: userId })
  },

  async reconcileAll(): Promise<ReconcileSummary> {
    return reconcile({})
  },
}

async function reconcile({ onlyUserId }: { onlyUserId?: string } = {}): Promise<ReconcileSummary> {
  const instances = await db.botInstance.findMany({
    where: onlyUserId ? { userId: onlyUserId } : {},
    include: { connection: true },
  })

  const summary: ReconcileSummary = { healed: 0, stoppedExpired: 0, skipped: 0, errors: 0 }
  const botCache = new Map<string, boolean>()

  const hasBot = async (userId: string): Promise<boolean> => {
    const cached = botCache.get(userId)
    if (cached !== undefined) return cached
    const value = await hasBotAccess(userId)
    botCache.set(userId, value)
    return value
  }

  for (const inst of instances) {
    if (await isCopyMasterConnection(inst.connectionId)) {
      summary.skipped++
      continue
    }

    const premium = await hasBot(inst.userId)

    // ── Subscription ended: the bot must stop, and never auto-restart ──
    if (!premium) {
      if (['starting', 'running', 'stopping'].includes(inst.status)) {
        try {
          await BotInstanceManager.stop(inst.id, 'subscription_expired')
          summary.stoppedExpired++
        } catch {
          summary.errors++
        }
      } else if (inst.shouldRun) {
        await db.botInstance.update({
          where: { id: inst.id },
          data: { shouldRun: false, stoppedReason: 'subscription_expired' },
        })
      }
      continue
    }

    // Manually stopped (or already expired) — reconcile never force-restarts.
    if (!inst.shouldRun) {
      summary.skipped++
      continue
    }

    // Not stopping anything that is mid-action right now.
    if (inst.status === 'stopping') {
      summary.skipped++
      continue
    }

    let serviceStatus: ServiceInstanceStatus
    try {
      const res = await botService.status(inst.id)
      serviceStatus = res.instance
    } catch (err) {
      if (err instanceof BotServiceOfflineError) {
        summary.skipped++ // service unreachable — nothing we can do this pass
        continue
      }
      summary.errors++
      continue
    }

    if (serviceStatus.status === 'running') {
      if (inst.status !== 'running') {
        await db.botInstance.update({
          where: { id: inst.id },
          data: { status: 'running', pid: serviceStatus.pid, lastHeartbeatAt: new Date() },
        })
      }
      continue
    }

    // Service reports stopped while the subscription is live and the bot is
    // meant to keep running → restart it (respecting the cooldown).
    if (inst.status !== 'stopped' && inst.status !== 'error') {
      summary.skipped++
      continue
    }
    if (inst.lastRestartAttemptAt && Date.now() - new Date(inst.lastRestartAttemptAt).getTime() < RESTART_COOLDOWN_MS) {
      summary.skipped++
      continue
    }

    try {
      await BotInstanceManager.start(inst.connectionId)
      summary.healed++
    } catch (err) {
      if (err instanceof BotServiceOfflineError) {
        summary.skipped++
        continue
      }
      await db.botInstance.update({
        where: { id: inst.id },
        data: {
          status: 'error',
          lastRestartAttemptAt: new Date(),
          lastError: err instanceof Error ? err.message : 'Restart failed',
        },
      })
      summary.errors++
    }
  }

  return summary
}
