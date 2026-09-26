// ─── App expenses & profit-and-loss ─────────────────────────────────────────
// Income ledger = PlatformEarning rows (premium payments, copy fees, bot
// profit share, referral revenue, ads revenue — all write there, including
// manual `log_ad_revenue` / `record_earning`). Expenses are AppExpense rows
// entered by admins. Net profit = sum(income) - sum(expenses).

import { db } from '@/lib/db'
import { getEarningsBySource } from '@/lib/payouts'

export const EXPENSE_CATEGORIES = [
  'hosting',
  'marketing',
  'salary',
  'tools',
  'api',
  'ads',
  'cloud',
  'misc',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export interface MonthBucket {
  month: string
  income: number
  expense: number
  net: number
}

export interface FinanceSummary {
  totalIncome: number
  totalExpenses: number
  netProfit: number
  earningCount: number
  expenseCount: number
  // Income sources (mirrors PlatformEarning.source values)
  incomeBySource: Array<{ source: string; total: number; available: number; paid: number }>
  // Expenses grouped by category
  byCategory: Array<{ category: string; total: number; count: number }>
  // Last 12 months of P&L, plus everything before that in the first bucket
  byMonth: MonthBucket[]
  monthToDate: { income: number; expense: number; net: number }
  updatedAt: string
}

const round = (n: number) => Math.round(n * 100) / 100

/** Sum an array of amounts coming back from aggregation. */
function sumOf(items: Array<{ amount: number }>): number {
  return round(items.reduce((acc, i) => acc + i.amount, 0))
}

/**
 * Full P&L summary for the admin Finances tab. Income comes from the
 * PlatformEarning ledger (never double-counted — premium payments are accrued
 * into it from completed transactions), expenses from AppExpense.
 */
export async function getFinanceSummary(): Promise<FinanceSummary> {
  const now = new Date()
  const recentStart = new Date(now.getFullYear(), now.getMonth() - 11, 1)

  // Income: accrue anything not yet recorded, then sum the whole ledger.
  const incomeBySource = await getEarningsBySource()

  const [incomeAll, expenseAll] = await Promise.all([
    db.platformEarning.findMany({ select: { amount: true, createdAt: true } }),
    db.appExpense.findMany({ select: { amount: true, spentAt: true, category: true } }),
  ])

  const totalIncome = round(sumOf(incomeAll))
  const totalExpenses = round(sumOf(expenseAll))

  // Monthly buckets for the trailing 12 months; older entries roll into the
  // first bucket so nothing is silently dropped from the total.
  const byMonthMap = new Map<string, { income: number; expense: number }>()
  const bucketKey = (d: Date) => d.toISOString().slice(0, 7)
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    byMonthMap.set(bucketKey(d), { income: 0, expense: 0 })
  }
  for (const e of incomeAll) {
    const k = bucketKey(e.createdAt)
    const b = byMonthMap.get(k)
    if (b) b.income += e.amount
    else {
      const first = byMonthMap.values().next().value
      if (first) first.income += e.amount
    }
  }
  for (const e of expenseAll) {
    const k = bucketKey(e.spentAt)
    const b = byMonthMap.get(k)
    if (b) b.expense += e.amount
    else {
      const first = byMonthMap.values().next().value
      if (first) first.expense += e.amount
    }
  }

  const byMonth: MonthBucket[] = [...byMonthMap.entries()].map(([month, v]) => ({
    month,
    income: round(v.income),
    expense: round(v.expense),
    net: round(v.income - v.expense),
  }))

  // Month to date
  const mtd = byMonthMap.get(bucketKey(now))
  const monthToDate = {
    income: round(mtd?.income || 0),
    expense: round(mtd?.expense || 0),
    net: round((mtd?.income || 0) - (mtd?.expense || 0)),
  }

  // Expenses by category
  const byCatMap = new Map<string, { total: number; count: number }>()
  for (const e of expenseAll) {
    const c = byCatMap.get(e.category) || { total: 0, count: 0 }
    c.total += e.amount
    c.count += 1
    byCatMap.set(e.category, c)
  }
  const byCategory = [...byCatMap.entries()]
    .map(([category, v]) => ({ category, total: round(v.total), count: v.count }))
    .sort((a, b) => b.total - a.total)

  return {
    totalIncome,
    totalExpenses,
    netProfit: round(totalIncome - totalExpenses),
    earningCount: incomeAll.length,
    expenseCount: expenseAll.length,
    incomeBySource,
    byCategory,
    byMonth,
    monthToDate,
    updatedAt: now.toISOString(),
  }
}

/** Recent expense rows for the Finances table (newest first). */
export async function listExpenses(limit = 200): Promise<Array<{
  id: string
  category: string
  description: string
  amount: number
  currency: string
  spentAt: Date
  reference: string | null
  note: string | null
  createdById: string | null
  createdAt: Date
}>> {
  return db.appExpense.findMany({ orderBy: { spentAt: 'desc' }, take: limit })
}