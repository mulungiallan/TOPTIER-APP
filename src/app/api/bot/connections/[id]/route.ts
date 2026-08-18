import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/bot-crypto'
import { botService } from '@/lib/services/bot-service'

function ownedConnectionOrNull(userId: string, connection: any) {
  return connection && connection.userId === userId ? connection : null
}

// PATCH /api/bot/connections/[id] — update label/broker/server/settings/password
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)
    const { id } = await params

    const existing = await db.botConnection.findUnique({ where: { id } })
    if (!ownedConnectionOrNull(userId, existing)) return errorResponse('Not found', 404)

    const body = await request.json()
    const data: any = {}
    if (body.label !== undefined) data.label = String(body.label)
    if (body.brokerName !== undefined) data.brokerName = body.brokerName ? String(body.brokerName) : null
    if (body.server !== undefined) data.server = String(body.server)
    if (body.terminalPath !== undefined) data.terminalPath = body.terminalPath ? String(body.terminalPath) : null
    if (body.password) data.passwordEnc = encryptSecret(String(body.password))
    if (body.riskPerTradePct !== undefined) data.riskPerTradePct = Number(body.riskPerTradePct)
    if (body.providerSharePct !== undefined) data.providerSharePct = Number(body.providerSharePct)
    if (body.settings !== undefined) data.settings = typeof body.settings === 'string' ? body.settings : JSON.stringify(body.settings)
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive)

    const connection = await db.botConnection.update({ where: { id }, data })
    return successResponse({ connection })
  } catch (error) {
    console.error('Bot connections PATCH error:', error)
    return errorResponse('Failed to update connection', 500)
  }
}

// DELETE /api/bot/connections/[id] — stop instances (best-effort), remove
// their remote workspaces, then delete the connection and its trades.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)
    const { id } = await params

    const existing = await db.botConnection.findUnique({ where: { id } })
    if (!ownedConnectionOrNull(userId, existing)) return errorResponse('Not found', 404)

    const instances = await db.botInstance.findMany({ where: { connectionId: id } })
    for (const inst of instances) {
      try {
        await botService.delete(inst.id)
      } catch (e: any) {
        console.warn(`[Bot] Failed to delete instance ${inst.id}:`, e?.message)
      }
    }

    await db.botConnection.delete({ where: { id } })
    return successResponse({ deleted: true })
  } catch (error) {
    console.error('Bot connections DELETE error:', error)
    return errorResponse('Failed to delete connection', 500)
  }
}
