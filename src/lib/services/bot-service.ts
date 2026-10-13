// src/lib/services/bot-service.ts
// HTTP client for the TOPTIER Python bot service (mini-services/bot/server.py).
//
// Historically the service ran on the same machine as the app (default
// 127.0.0.1:8765). With self-hosted agents the app now routes each request to
// the machine that actually runs the user's instances: callers pass a
// BotHostTarget (the paired user host) and every call falls back to the legacy
// owner host from BOT_SERVICE_URL when none is given. All requests require the
// per-host `x-bot-service-key` secret. When the service is unreachable we raise
// BotServiceOfflineError so callers can show a friendly message instead of a
// raw fetch failure.

import { env } from '@/lib/env'

export class BotServiceOfflineError extends Error {
  constructor(message = 'The trading bot service is not running') {
    super(message)
    this.name = 'BotServiceOfflineError'
  }
}

// A resolved execution host: where to send the request (url) and the shared
// secret that host expects (key). `hostId` is the BotHost row for self-hosted
// agents, or undefined for the legacy owner host.
export interface BotHostTarget {
  hostId?: string
  url: string
  key: string
}

export interface ServiceInstanceStatus {
  instanceId: string
  status: 'running' | 'stopped'
  pid: number | null
  startedAt: number | null
  platform: string | null
  login: string | null
}

export interface TerminalPoolStatus {
  enabled: boolean
  dir: string
  total: number
  assigned: number
  free: number
}

export interface CreateInstanceSpec {
  instanceId: string
  platform: string
  login: string
  password: string
  server: string
  terminalPath?: string | null
  webhookUrl: string
  // No serviceKey: the bot service already holds the shared key and passes it
  // to each instance through the process environment. Sending a second copy in
  // the request body only widened the places the secret could leak.
  settings: Record<string, unknown>
  // 'standard' runs the multi-strategy engine. 'funded' runs the isolated
  // FundingPips guard, which sizes from a fixed percentage of the profile's
  // account size and enforces the firm's loss limits. The bot service picks a
  // separate execution path per mode; the two never share position sizing.
  mode?: 'standard' | 'funded'
  // Only read when mode === 'funded'. Flat keys (fundedModel, fundedSize, ...)
  // rather than one nested object so the bot service can whitelist each field.
  fundedModel?: string | null
  fundedPhase?: string | null
  fundedSize?: number | null
  fundedSplit?: number | null
  fundedPeakEquity?: number | null
  fundedSymbols?: string[] | null
  fundedAvoidNews?: boolean | null
  fundedDryRun?: boolean | null
  fundedGuard?: Record<string, unknown> | null
  fundedStrategy?: Record<string, unknown> | null
  fundedNews?: Record<string, unknown> | null
}

function serviceUrl(): string {
  return env.botServiceUrl
}

function serviceKey(): string {
  return env.botServiceKey
}

async function request<T>(path: string, init?: RequestInit, target?: BotHostTarget | null): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  const baseUrl = (target?.url || serviceUrl()).replace(/\/+$/, '')
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-bot-service-key': target?.key || serviceKey(),
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
  async health(target?: BotHostTarget | null): Promise<{ status: string; terminalPool?: TerminalPoolStatus }> {
    return request('/api/health', undefined, target)
  },

  /** Create the instance spec and start the subprocess (POST does both). */
  async createInstance(spec: CreateInstanceSpec, target?: BotHostTarget | null): Promise<{ instance: ServiceInstanceStatus }> {
    return request('/api/instances', {
      method: 'POST',
      body: JSON.stringify(spec),
    }, target)
  },

  async start(instanceId: string, target?: BotHostTarget | null): Promise<{ instance: ServiceInstanceStatus }> {
    return request(`/api/instances/${encodeURIComponent(instanceId)}/start`, { method: 'POST' }, target)
  },

  async stop(instanceId: string, target?: BotHostTarget | null): Promise<{ instance: ServiceInstanceStatus }> {
    return request(`/api/instances/${encodeURIComponent(instanceId)}/stop`, { method: 'POST' }, target)
  },

  async delete(instanceId: string, target?: BotHostTarget | null): Promise<{ deleted: boolean }> {
    return request(`/api/instances/${encodeURIComponent(instanceId)}`, { method: 'DELETE' }, target)
  },

  async status(instanceId: string, target?: BotHostTarget | null): Promise<{ instance: ServiceInstanceStatus }> {
    return request(`/api/instances/${encodeURIComponent(instanceId)}`, undefined, target)
  },

  async logs(instanceId: string, tail = 300, target?: BotHostTarget | null): Promise<{ lines: string[] }> {
    return request(`/api/instances/${encodeURIComponent(instanceId)}/logs?tail=${tail}`, undefined, target)
  },
}
