import { db } from '@/lib/db'

/**
 * Screenshot analyses are kept for a short window so users can reopen their
 * latest result, then deleted automatically to avoid storing chart images and
 * AI output indefinitely.
 */
export const ANALYSIS_TTL_MS = 60 * 60 * 1000 // 1 hour

export async function purgeExpiredAnalyses(): Promise<number> {
  const cutoff = new Date(Date.now() - ANALYSIS_TTL_MS)
  const { count } = await db.screenshotAnalysis.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  return count
}