// src/lib/services/bot-service.ts
// HTTP client for the TOPTIER Python bot service (mini-services/bot/server.py).
//
// The service runs on the same machine as the app (default 127.0.0.1:8765)
// and controls one isolated bot subprocess per linked MetaTrader account.
// All requests require the shared `x-bot-service-key` secret. When the
// service is unreachable we raise BotServiceOfflineError so callers can show
// a friendly message instead of a raw fetch failure.

import { env } from '@/lib/env'

export class BotServiceOfflineError extends Error {
  constructor(message = 'The trading bot service is not running') {
    super(message)
    this.name = 'BotServiceOfflineError'
  }
}

export interface ServiceInstanceStatus {
  instanceId: string
  status: 'running' | 'stopped'
  pid: number | null
  startedAt: number | null
  platform: string | null
  login: string | null
}

export interface CreateInstanceSpec {
  instanceId: string
  platform: string
  login: string
  password: string
  server: string
  terminalPath?: string | null
  webhookUrl: string
  serviceKey: string
  settings: Record<string, unknown>
}

function serviceUrl(): string {
  return env.botServiceUrl
}

function serviceKey(): string {
  return env.botServiceKey
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(`${serviceUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-bot-service-key': serviceKey(),
        ...(init?.headers || {}),
      },
    })
    if (res.status === 401) throw new Error('Bot service rejected the service key')
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
      throw new Error(detail.detail || `Bot service error: ${res.status}`)
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new BotServiceOfflineError()
    }
    if (err instanceof TypeError) {
      // fetch network failure (ECONNREFUSED etc.)
      throw new BotServiceOfflineError()
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

export const botService = {
  async health(): Promise<{ status: string }> {
    return request('/api/health')
  },

  /** Create the instance spec and start the subprocess (POST does both). */
  async createInstance(spec: CreateInstanceSpec): Promise<{ instance: ServiceInstanceStatus }> {
    return request('/api/instances', {
      method: 'POST',
      body: JSON.stringify(spec),
    })
  },

  async start(instanceId: string): Promise<{ instance: ServiceInstanceStatus }> {
    return request(`/api/instances/${encodeURIComponent(instanceId)}/start`, { method: 'POST' })
  },

  async stop(instanceId: string): Promise<{ instance: ServiceInstanceStatus }> {
    return request(`/api/instances/${encodeURIComponent(instanceId)}/stop`, { method: 'POST' })
  },

  async delete(instanceId: string): Promise<{ deleted: boolean }> {
    return request(`/api/instances/${encodeURIComponent(instanceId)}`, { method: 'DELETE' })
  },

  async status(instanceId: string): Promise<{ instance: ServiceInstanceStatus }> {
    return request(`/api/instances/${encodeURIComponent(instanceId)}`)
  },

  async logs(instanceId: string, tail = 300): Promise<{ lines: string[] }> {
    return request(`/api/instances/${encodeURIComponent(instanceId)}/logs?tail=${tail}`)
  },
}
