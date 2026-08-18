/**
 * Screenshot AI Analyzer — OpenAI Vision API integration
 * Drop into: src/lib/screenshot-analyzer.ts
 *
 * Analyzes trading chart screenshots to extract:
 *  - Pair/symbol
 *  - Timeframe
 *  - Trend direction
 *  - Key levels (support/resistance)
 *  - Detected patterns
 *  - Suggested entry/SL/TP
 *
 * Requires OPENAI_API_KEY — throws if missing instead of returning fake data.
 */

export interface ScreenshotAnalysis {
  id: string;
  symbol: string | null;
  timeframe: string | null;
  trend: "bullish" | "bearish" | "neutral";
  confidence: number;
  support: number[];
  resistance: number[];
  patterns: string[];
  indicators: { name: string; value: string; signal: "bullish" | "bearish" | "neutral" }[];
  suggestedEntry: number | null;
  suggestedStopLoss: number | null;
  suggestedTakeProfit: number | null;
  summary: string;
  warnings: string[];
  analyzedAt: string;
}

const SYSTEM_PROMPT = `You are an expert trading chart analyst. Analyze the provided chart screenshot and return a JSON object with the following structure. Be precise and only include fields you can confidently identify.

{
  "symbol": "string or null — ticker/pair if visible (e.g. EURUSD, BTCUSD, AAPL)",
  "timeframe": "string or null — chart timeframe if visible (1m, 5m, 15m, 1H, 4H, 1D, 1W)",
  "trend": "bullish | bearish | neutral — overall trend direction",
  "confidence": "number 0-1 — your confidence in the analysis",
  "support": "number[] — visible support price levels",
  "resistance": "number[] — visible resistance price levels",
  "patterns": "string[] — detected chart patterns (e.g. head and shoulders, double top, ascending triangle)",
  "indicators": [{"name": "RSI", "value": "55", "signal": "bullish|bearish|neutral"}],
  "suggestedEntry": "number or null",
  "suggestedStopLoss": "number or null",
  "suggestedTakeProfit": "number or null",
  "summary": "string — 2-3 sentence analysis summary",
  "warnings": "string[] — any risk warnings (e.g. low volume, news event, low liquidity)"
}

Return ONLY valid JSON, no markdown or commentary.`;

export const screenshotAnalyzer = {
  async analyze(imageBase64: string, mimeType = "image/png"): Promise<ScreenshotAnalysis> {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        "AI Vision API key not configured. Screenshot analysis requires OPENAI_API_KEY. " +
        "Set it in your environment to enable real chart analysis."
      );
    }

    try {
      const model = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Analyze this trading chart screenshot and return the JSON analysis." },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${imageBase64}`,
                    detail: "high",
                  },
                },
              ],
            },
          ],
          max_tokens: 1200,
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI API ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response from OpenAI");

      const parsed = JSON.parse(content);

      return {
        id: `analysis-${Date.now()}`,
        symbol: parsed.symbol || null,
        timeframe: parsed.timeframe || null,
        trend: parsed.trend || "neutral",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        support: Array.isArray(parsed.support) ? parsed.support : [],
        resistance: Array.isArray(parsed.resistance) ? parsed.resistance : [],
        patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
        indicators: Array.isArray(parsed.indicators) ? parsed.indicators : [],
        suggestedEntry: parsed.suggestedEntry ?? null,
        suggestedStopLoss: parsed.suggestedStopLoss ?? null,
        suggestedTakeProfit: parsed.suggestedTakeProfit ?? null,
        summary: parsed.summary || "Analysis complete.",
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        analyzedAt: new Date().toISOString(),
      };
    } catch (e) {
      console.error("Screenshot analysis failed:", e);
      throw new Error(
        `Screenshot analysis failed: ${e instanceof Error ? e.message : "Unknown error"}. ` +
        "Check your OPENAI_API_KEY and try again."
      );
    }
  },
};
