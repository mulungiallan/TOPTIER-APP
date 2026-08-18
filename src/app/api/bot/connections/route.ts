import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/bot-crypto'
import { isReferralUnlocked, REFERRAL_LOCK_MESSAGE } from '@/lib/referral-gate'

const DEFAULT_SETTINGS = {
  FOREX_BASE_LOT_PER_100: 0.08,
  CRYPTO_BASE_LOT_PER_100: 0.04,
  HIGH_VOL_BASE_LOT_PER_100: 0.02,
  BASE_LOT_EQUITY_REFERENCE: 100,
  MAX_OPEN_POSITIONS: 3,
  // account-size tier rules (enforced by the engine on top of sizing)
  ACCOUNT_TIER_SMALL_MAX_EQUITY: 50,
  ACCOUNT_TIER_SMALL_MAX_ENTRIES: 3,
  ACCOUNT_TIER_SMALL_MAX_LOT: 0.02,
  ACCOUNT_TIER_MID_MAX_EQUITY: 100,
  ACCOUNT_TIER_MID_MAX_ENTRIES: 2,
  ACCOUNT_TIER_MID_MAX_LOT: 0.02,
  ACCOUNT_TIER_MID_ENABLE_METALS: true,
  ACCOUNT_TIER_MID_SCALP_PROFILE: true,
  REWARD_RISK_RATIO: 2,
  MAX_DAILY_LOSS_PCT: 3,
  MIN_VOTES_TO_TRADE: 2,
  // 4 take profits: partial closes at 25/50/75% of target, broker TP at 100%
  USE_TP_LADDER: true,
  TAKE_PROFIT_LEVELS: [[0.25, 25], [0.5, 25], [0.75, 25], [1.0, 25]],
  // legacy risk% knobs retained for compatibility (no longer used for sizing)
  MIN_RISK_PCT_PER_TRADE: 0.5,
  MAX_RISK_PCT_PER_TRADE: 1.5,
  PORTFOLIO_MAX_RISK_PCT: 5,
}

// GET /api/bot/connections — list the current user's linked accounts
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const connections = await db.botConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, userId: true, platform: true, label: true, brokerName: true,
        login: true, server: true, terminalPath: true, riskPerTradePct: true,
        providerSharePct: true, createdAt: true, updatedAt: true,
        instances: { orderBy: { updatedAt: 'desc' } },
        _count: { select: { trades: true } },
      },
    })
    return successResponse({ connections })
  } catch (error) {
    console.error('Bot connections GET error:', error)
    return errorResponse('Failed to load connections', 500)
  }
}

// POST /api/bot/connections — link an MT5/MT4 account. Password is encrypted
// (AES-256-GCM) at rest and never returned to the client.
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    if (!(await isReferralUnlocked(userId))) {
      return errorResponse(REFERRAL_LOCK_MESSAGE, 403)
    }

    const body = await request.json()
    const { platform, label, brokerName, login, password, server, terminalPath, riskPerTradePct, providerSharePct, settings } = body

    if (!platform || !['mt5', 'mt4'].includes(platform)) {
      return errorResponse('platform must be mt5 or mt4', 400)
    }
    if (!login || !password || !server) {
      return errorResponse('login, password and server are required', 400)
    }
    if (!label) {
      return errorResponse('label is required', 400)
    }

    const connection = await db.botConnection.create({
      data: {
        userId,
        platform,
        label: String(label),
        brokerName: brokerName ? String(brokerName) : null,
        login: String(login),
        passwordEnc: encryptSecret(String(password)),
        server: String(server),
        terminalPath: terminalPath ? String(terminalPath) : null,
        riskPerTradePct: riskPerTradePct != null ? Number(riskPerTradePct) : 1.0,
        providerSharePct: providerSharePct != null ? Number(providerSharePct) : 50,
        settings: JSON.stringify({ ...DEFAULT_SETTINGS, ...(settings || {}) }),
      },
    })
    return successResponse({ connection }, 201)
  } catch (error) {
    console.error('Bot connections POST error:', error)
    return errorResponse('Failed to link account', 500)
  }
}
