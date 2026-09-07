// ─── Competitions & Events hub ──────────────────────────────────────────────
// Keeps the Competitions page alive with a rolling, auto-generated set of
// tournaments (Competition rows) and scheduled trading events (TradingEvent
// rows). Everything is keyed by stable slugs/names so repeated runs renew the
// schedule instead of duplicating rows. Status is computed at read time from
// start/end dates, so no cron is needed to flip statuses.

import { db } from '@/lib/db'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const SYSTEM_EMAIL = 'admin@toptier.app'

// ─── time helpers ───────────────────────────────────────────────────────────

function atToday(hour: number, minutes = 0): Date {
  const d = new Date()
  d.setHours(hour, minutes, 0, 0)
  return d
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY)
}

// Next occurrence of a weekday (0 = Sunday) strictly in the future.
function nextWeekdayDow(dow: number, hour = 9): Date {
  const d = atToday(hour)
  let diff = (dow - d.getDay() + 7) % 7
  if (diff === 0) diff = 7
  return addDays(d, diff)
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

// Next occurrence of a day-of-month strictly in the future (clamped to month length).
function nextDom(day: number, hour = 12): Date {
  let d = new Date()
  d.setHours(hour, 0, 0, 0)
  d.setDate(1)
  const target = Math.min(day, daysInMonth(d))
  if (target < d.getDate()) d = addDays(d, daysInMonth(d))
  d.setDate(target)
  return d
}

async function systemCreatorId(): Promise<string | null> {
  const admin = await db.user.findUnique({ where: { email: SYSTEM_EMAIL } })
  return admin?.id ?? null
}

// ─── auto tournaments (competitions) ────────────────────────────────────────

interface TournamentDef {
  name: string
  description: string
  type: string
  entryFee: number
  prizePool: number
  maxParticipants?: number
  // schedule: how to build a fresh [start, end] window
  freshWindow: () => { start: Date; end: Date }
}

const TOURNAMENTS: TournamentDef[] = [
  {
    name: 'Weekly Win Rate Cup',
    description: 'Rank by win rate over the next 7 days. Top 3 land on the leaderboard and split a $250 prize.',
    type: 'win_rate',
    entryFee: 0,
    prizePool: 250,
    maxParticipants: 500,
    freshWindow: () => {
      const start = addDays(atToday(0), -1)
      return { start, end: addDays(start, 7) }
    },
  },
  {
    name: 'Monthly Profit Tournament',
    description: 'Biggest net profit over 30 days wins. Bragging rights, a $1,000 prize pool and a profile badge.',
    type: 'profit',
    entryFee: 5,
    prizePool: 1000,
    maxParticipants: 1000,
    freshWindow: () => {
      const start = addDays(atToday(0), 2)
      return { start, end: addDays(start, 30) }
    },
  },
  {
    name: 'Weekend Forex Sprint',
    description: '2-day sprint. Highest profit % on any FX pair takes the $150 pot.',
    type: 'profit',
    entryFee: 0,
    prizePool: 150,
    maxParticipants: 300,
    freshWindow: () => {
      const start = nextWeekdayDow(6, 8)
      return { start, end: addDays(start, 2) }
    },
  },
  {
    name: 'Crypto Signal Challenge',
    description: 'BTC, ETH & alts. Highest ROI using AI signals in 14 days wins $400.',
    type: 'win_rate',
    entryFee: 0,
    prizePool: 400,
    maxParticipants: 750,
    freshWindow: () => {
      const start = addDays(atToday(0), 5)
      return { start, end: addDays(start, 14) }
    },
  },
  {
    name: 'Accuracy Masters',
    description: '24-hour test of precision: stay closest to the AI entry, exit and stop levels.',
    type: 'accuracy',
    entryFee: 0,
    prizePool: 100,
    maxParticipants: 200,
    freshWindow: () => {
      const start = addDays(atToday(0), -9)
      return { start, end: addDays(start, 7) }
    },
  },
]

async function ensureAutoTournaments() {
  const creatorId = await systemCreatorId()
  if (!creatorId) return
  const now = new Date()
  for (const def of TOURNAMENTS) {
    const existing = await db.competition.findFirst({
      where: { name: def.name, creatorId },
      select: { id: true, endDate: true },
    })
    if (existing && existing.endDate > now) continue // still live/upcoming
    const { start, end } = def.freshWindow()
    const data = {
      name: def.name,
      description: def.description,
      type: def.type,
      entryFee: def.entryFee,
      prizePool: def.prizePool,
      maxParticipants: def.maxParticipants ?? null,
      startDate: start,
      endDate: end,
      status: start > now ? 'upcoming' : 'active',
    }
    if (existing) {
      await db.competition.update({ where: { id: existing.id }, data })
    } else {
      await db.competition.create({ data: { ...data, creatorId } })
    }
  }
}

// ─── trading events ─────────────────────────────────────────────────────────

interface EventDef {
  slug: string
  title: string
  description: string
  category: string
  host: string
  reward: string
  capacity: number
  durationMs: number
  // cadence: daily | weekly | monthly
  cadence: 'daily' | 'weekly' | 'monthly'
  // returns the next start time strictly in the future
  nextStart: () => Date
}

const EVENTS: EventDef[] = [
  {
    slug: 'weekly-forex-masterclass',
    title: 'Weekly Forex Masterclass',
    description: 'Live breakdown of the coming week: key levels, high-impact news and the setups worth trading.',
    category: 'webinar',
    host: 'Daniel K.',
    reward: 'Free for all tiers',
    capacity: 200,
    durationMs: 60 * 60 * 1000 * 1.5,
    cadence: 'weekly',
    nextStart: () => nextWeekdayDow(1, 18),
  },
  {
    slug: 'live-eurusd-session',
    title: 'Live EUR/USD Trade Session',
    description: 'Watch a full session trade from AI signal to exit, with live Q&A on every move.',
    category: 'live_session',
    host: 'Allan R.',
    reward: 'Live signals + Q&A',
    capacity: 150,
    durationMs: 2 * HOUR,
    cadence: 'daily',
    nextStart: () => {
      const d = atToday(15, 30)
      return d <= new Date() ? addDays(d, 1) : d
    },
  },
  {
    slug: 'crypto-outlook-ama',
    title: 'Crypto Market Outlook AMA',
    description: 'BTC 2026 outlook, AI-assisted entries and the tokens on Toptier\'s radar. Bring questions.',
    category: 'ama',
    host: 'Toptier Research',
    reward: '3-day free Premium',
    capacity: 300,
    durationMs: 2 * HOUR,
    cadence: 'monthly',
    nextStart: () => nextDom(14, 17),
  },
  {
    slug: 'risk-management-challenge',
    title: 'Risk Management Challenge',
    description: 'A 48-hour simulation. Survive the drawdown with the best risk-per-trade and win a cash credit.',
    category: 'challenge',
    host: 'Auto-matcher',
    reward: '$50 trading credit',
    capacity: 250,
    durationMs: 48 * HOUR,
    cadence: 'weekly',
    nextStart: () => nextWeekdayDow(4, 12),
  },
  {
    slug: 'algo-101-workshop',
    title: 'Algo Trading 101 Workshop',
    description: 'From backtest to paper trade: build your first strategy with the Strategy Builder.',
    category: 'workshop',
    host: 'Growth Team',
    reward: 'Free strategy pack',
    capacity: 180,
    durationMs: 90 * 60 * 1000,
    cadence: 'monthly',
    nextStart: () => nextDom(26, 10),
  },
  {
    slug: 'weekend-bootcamp',
    title: 'Weekend Trading Bootcamp',
    description: 'Hands-on weekend coverings setups, discipline and the Friday-NFP drill. Top sim profit wins $50.',
    category: 'live_session',
    host: 'Toptier Mentors',
    reward: '$50 to the sim winner',
    capacity: 150,
    durationMs: 6 * HOUR,
    cadence: 'weekly',
    nextStart: () => nextWeekdayDow(6, 9),
  },
]

const CADENCE_MS: Record<EventDef['cadence'], number> = {
  daily: DAY,
  weekly: 7 * DAY,
  monthly: 30 * DAY,
}

// Push startAt forward until it's strictly in the future (leaves live events alone).
function rollForward(def: EventDef, startAt: Date): Date {
  const step = CADENCE_MS[def.cadence]
  let d = startAt
  const now = new Date()
  let guard = 0
  while (d <= now && guard < 12) {
    d = new Date(d.getTime() + step)
    guard++
  }
  return d
}

async function ensureEvents() {
  for (const def of EVENTS) {
    const existing = await db.tradingEvent.findUnique({ where: { slug: def.slug } })
    const now = new Date()

    if (existing && existing.endAt > now) continue // upcoming or currently live

    let startAt = existing ? rollForward(def, existing.startAt) : def.nextStart()
    // nextStart() already returns a future date, but re-roll for safety.
    startAt = rollForward(def, startAt)
    const endAt = new Date(startAt.getTime() + def.durationMs)

    const data = {
      title: def.title,
      description: def.description,
      category: def.category,
      host: def.host,
      reward: def.reward,
      capacity: def.capacity,
      startAt,
      endAt,
    }
    if (existing) {
      await db.tradingEvent.update({ where: { slug: def.slug }, data })
    } else {
      await db.tradingEvent.create({ data: { slug: def.slug, ...data } })
    }
  }
}

export async function ensureHubContent() {
  await Promise.all([ensureAutoTournaments(), ensureEvents()])
}

// ─── events API ─────────────────────────────────────────────────────────────

export type EventStatus = 'upcoming' | 'live' | 'ended'

function computeEventStatus(e: { startAt: Date; endAt: Date }, now = new Date()): EventStatus {
  if (e.endAt < now) return 'ended'
  if (e.startAt <= now) return 'live'
  return 'upcoming'
}

export interface TradingEventView {
  id: string
  slug: string
  title: string
  description: string | null
  category: string
  host: string | null
  startAt: Date
  endAt: Date
  reward: string | null
  capacity: number | null
  registered: number
  status: EventStatus
}

export class EventService {
  static async listEvents(status?: EventStatus): Promise<TradingEventView[]> {
    const events = await db.tradingEvent.findMany({ orderBy: { startAt: 'asc' } })
    const now = new Date()
    let mapped = events
      .map((e) => ({ ...e, status: computeEventStatus(e, now) }))
      .sort((a, b) => {
        const order: Record<EventStatus, number> = { live: 0, upcoming: 1, ended: 2 }
        if (a.status !== b.status) return order[a.status] - order[b.status]
        return a.startAt.getTime() - b.startAt.getTime()
      })
    if (status) mapped = mapped.filter((e) => e.status === status)
    return mapped
  }

  static async registerForEvent(eventId: string) {
    const event = await db.tradingEvent.findUnique({ where: { id: eventId } })
    if (!event) throw new Error('Event not found')
    if (computeEventStatus(event) === 'ended') throw new Error('Event has already ended')
    const updated = await db.tradingEvent.update({
      where: { id: eventId },
      data: { registered: { increment: 1 } },
      select: { registered: true },
    })
    return updated.registered
  }
}