import { describe, it, expect, beforeEach, vi } from 'vitest'

// The registered-user count is the only figure here that must not be public, so
// the assertions are about the SHAPE OF THE RESPONSE for each caller rather than
// about the numbers.
const h = vi.hoisted(() => ({
  userCount: vi.fn().mockResolvedValue(1234),
  groupBy: vi.fn().mockResolvedValue([{ country: 'KE' }, { country: 'NG' }, { country: '' }]),
  signalCount: vi.fn().mockResolvedValue(42),
  postCount: vi.fn().mockResolvedValue(7),
  admin: null as null | { id: string; email: string; name: string | null; role: string },
}))

vi.mock('@/lib/db', () => ({
  db: {
    user: { count: h.userCount, groupBy: h.groupBy },
    signal: { count: h.signalCount },
    post: { count: h.postCount },
  },
}))

vi.mock('@/lib/admin-guard', () => ({
  requireAdmin: async () => ({ error: null, user: h.admin }),
}))

vi.mock('@/lib/auth', () => ({
  successResponse: (data: unknown) => Response.json({ success: true, data }),
  errorResponse: (message: string, status: number) =>
    Response.json({ success: false, error: message }, { status }),
}))

import { GET } from '@/app/api/platform/stats/route'

const call = async () => {
  const res = await GET({} as never)
  return { res, body: (await res.json()) as { data: Record<string, unknown> } }
}

describe('GET /api/platform/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.admin = null
    h.userCount.mockResolvedValue(1234)
    h.groupBy.mockResolvedValue([{ country: 'KE' }, { country: 'NG' }, { country: '' }])
    h.signalCount.mockResolvedValue(42)
    h.postCount.mockResolvedValue(7)
  })

  it('omits the user count entirely for anonymous callers', async () => {
    const { res, body } = await call()
    expect(res.status).toBe(200)
    // Absent, not 0 and not null: either would still describe a withheld figure.
    expect('traders' in body.data).toBe(false)
  })

  it('omits the user count for an authenticated non-admin', async () => {
    // requireAdmin() returns an error Response for non-admins; this route must
    // treat that as "no number" rather than failing or leaking.
    h.admin = null
    const { body } = await call()
    expect('traders' in body.data).toBe(false)
  })

  it('does not even query the user count for non-admins', async () => {
    await call()
    // Counting users for a caller who may not see the result is a wasted query
    // and a needless disclosure surface.
    expect(h.userCount).not.toHaveBeenCalled()
  })

  it('still serves the public marketing figures', async () => {
    const { body } = await call()
    expect(body.data.totalSignals).toBe(42)
    expect(body.data.totalPosts).toBe(7)
    expect(body.data.countries).toBe(2) // the blank country is excluded
  })

  it('includes the user count for an admin', async () => {
    h.admin = { id: '1', email: 'admin@toptier.app', name: 'Admin', role: 'super_admin' }
    const { body } = await call()
    expect(body.data.traders).toBe(1234)
    expect(h.userCount).toHaveBeenCalledTimes(1)
  })
})
