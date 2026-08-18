/**
 * TOPTIER Hybrid Chart Analyzer — 90/10 split logic
 *
 * For paid plan users:
 *   - 90% (configurable per-package via `splitRatio`) of analyses go through
 *     the premium API path (LLaVA-1.5-7B / LLaVA-1.6 / Gemini Flash).
 *   - 10% go through the free API path (Hugging Face free tier only, no fallbacks).
 *
 * For free users:
 *   - 100% of analyses use the free Hugging Face path.
 *
 * The split is randomized per-analysis. The result is recorded with the
 * `planUsed` and `method` fields so admins can audit the distribution.
 *
 * FREE PATH  — Hugging Face free tier only (HF → HF backup → heuristic).
 * PREMIUM PATH — full fallback chain (HF → HF backup → Gemini Flash → heuristic).
 * This keeps operator cost at $0 for free users while giving paid users the
 * best-available result.
 */

import { db } from '@/lib/db'
import { chartAnalyzer, type ChartAnalysisResult } from '@/lib/chart-analyzer'

export interface HybridAnalysisResult extends ChartAnalysisResult {
  planUsed: 'free' | 'premium'
  packageSplitRatio: number
  analysesUsed: number
  analysesLimit: number
  analysesRemaining: number // -1 = unlimited
}

export class HybridChartAnalyzer {
  /**
   * Analyze a chart with plan-aware routing.
   * Mutates the user's analysesUsed counter and writes an Analysis row.
   */
  async analyzeChart(
    imageBuffer: Buffer,
    userId: string
  ): Promise<HybridAnalysisResult> {
    // ─── Load user + active order + package ───────────────────────────────
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        plan: true,
        analysesLimit: true,
        analysesUsed: true,
        analysesResetAt: true,
      },
    })

    if (!user) {
      throw new Error('User not found')
    }

    // Reset monthly counter if a month has elapsed
    let { analysesLimit, analysesUsed, analysesResetAt } = user
    const now = new Date()
    if (
      !analysesResetAt ||
      analysesResetAt.getMonth() !== now.getMonth() ||
      analysesResetAt.getFullYear() !== now.getFullYear()
    ) {
      analysesUsed = 0
      analysesResetAt = now
      await db.user.update({
        where: { id: userId },
        data: { analysesUsed: 0, analysesResetAt: now },
      })
    }

    // Enforce quota (0 = unlimited)
    if (analysesLimit > 0 && analysesUsed >= analysesLimit) {
      throw new Error(
        `Analysis limit reached (${analysesUsed}/${analysesLimit}). Upgrade your plan for more analyses.`
      )
    }

    // Resolve the user's package (if any) to read splitRatio
    const packageName = user.plan
    let splitRatio = 0 // free users = 0% premium
    if (packageName && packageName !== 'free') {
      // Plan name is stored lowercased with underscores, e.g. "premium_annual"
      // SQLite doesn't support mode: 'insensitive', so we fetch all packages
      // and compare lowercased in JS.
      const allPackages = await db.package.findMany({
        where: { isActive: true },
        select: { name: true, splitRatio: true },
      })
      const normalizedPlan = packageName.replace(/_/g, ' ').toLowerCase()
      const matched =
        allPackages.find((p) => p.name.toLowerCase() === normalizedPlan) ||
        allPackages.find((p) => p.name.toLowerCase().includes(normalizedPlan))
      splitRatio = matched?.splitRatio ?? 90
    }

    // ─── Route: free vs premium ───────────────────────────────────────────
    const isPremiumUser = splitRatio > 0
    const usePremiumPath = isPremiumUser && Math.random() * 100 < splitRatio
    const planUsed: 'free' | 'premium' = usePremiumPath ? 'premium' : 'free'

    // Run analysis — premium path uses full fallback chain; free path is restricted
    const result = usePremiumPath
      ? await chartAnalyzer.analyzeChart(imageBuffer, 'standard')
      : await this.freePathAnalysis(imageBuffer)

    // ─── Record usage ─────────────────────────────────────────────────────
    const updated = await db.user.update({
      where: { id: userId },
      data: { analysesUsed: { increment: 1 } },
      select: { analysesUsed: true },
    })

    const analysesRemaining =
      analysesLimit === 0 ? -1 : Math.max(0, analysesLimit - updated.analysesUsed)

    await db.analysis.create({
      data: {
        userId,
        analysis: JSON.stringify(result),
        planUsed,
        cost: result.cost,
        method: result.method,
        pattern: result.pattern,
        signal: result.signal,
        confidence: result.confidence,
        imageUrl: null,
      },
    })

    return {
      ...result,
      planUsed,
      packageSplitRatio: splitRatio,
      analysesUsed: updated.analysesUsed,
      analysesLimit,
      analysesRemaining,
    }
  }

  /**
   * Free path: Hugging Face only, no paid fallbacks (Gemini is skipped).
   * If HF fails, returns the heuristic result (still $0 cost).
   */
  private async freePathAnalysis(imageBuffer: Buffer): Promise<ChartAnalysisResult> {
    return chartAnalyzer.analyzeChart(imageBuffer, 'free')
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const hybridChartAnalyzer = new HybridChartAnalyzer()
