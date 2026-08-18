// src/lib/services/bot-instance-manager.ts
// Glue between the Prisma BotConnection/BotInstance rows and the Python bot
// service: builds instance specs (decrypting the broker password), starts and
// stops instances, and keeps the DB status in sync with the subprocess state.

import { db } from '@/lib/db'
import { decryptSecret } from '@/lib/bot-crypto'
import {
  botService,
  BotServiceOfflineError,
  type CreateInstanceSpec,
  type ServiceInstanceStatus,
} from '@/lib/services/bot-service'

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
  async start(connectionId: string): Promise<{ instance: any; serviceStatus: ServiceInstanceStatus }> {
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
      await db.botInstance.update({ where: { id: instance.id }, data: { status: 'error' } })
      throw err
    }

    await db.botInstance.update({
      where: { id: instance.id },
      data: {
        status: mapStatus(serviceStatus),
        pid: serviceStatus.pid,
        startCount: { increment: 1 },
        lastHeartbeatAt: new Date(),
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

  async stop(instanceId: string): Promise<{ instance: any }> {
    await db.botInstance.update({ where: { id: instanceId }, data: { status: 'stopping' } })
    try {
      const res = await botService.stop(instanceId)
      await db.botInstance.update({
        where: { id: instanceId },
        data: { status: mapStatus(res.instance), pid: null, lastHeartbeatAt: new Date() },
      })
    } catch (err) {
      await db.botInstance.update({ where: { id: instanceId }, data: { status: 'stopped', pid: null } })
      throw err
    }
    const instance = await db.botInstance.findUnique({ where: { id: instanceId } })
    return { instance }
  },
}
