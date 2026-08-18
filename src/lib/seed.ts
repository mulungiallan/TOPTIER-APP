import { db } from '@/lib/db'

let seeded = false

export async function seedDemoData() {
  // Never fabricate demo data in production — the app must show only real data.
  if (process.env.NODE_ENV === 'production') return
  if (seeded) return

  try {
    // Check if data already exists
    const signalCount = await db.signal.count()
    if (signalCount > 0) {
      seeded = true
      return
    }

    const now = new Date()
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

    // Seed demo signals (userId is null = public/global signals)
    await db.signal.createMany({
      data: [
        {
          type: 'BUY',
          asset: 'EUR/USD',
          entryPrice: 1.0850,
          stopLoss: 1.0810,
          takeProfit1: 1.0890,
          takeProfit2: 1.0920,
          takeProfit3: 1.0960,
          riskRewardRatio: 1.0,
          confidence: 82,
          strategy: 'swing',
          timeframe: '4H',
          reason: 'Bullish divergence on RSI with support at 1.0840. Price bouncing off 200 EMA.',
          status: 'active',
          expiryDate: nextWeek,
          marketType: 'forex',
          tradingSession: 'european',
        },
        {
          type: 'SELL',
          asset: 'GBP/JPY',
          entryPrice: 191.50,
          stopLoss: 192.10,
          takeProfit1: 190.80,
          takeProfit2: 190.00,
          takeProfit3: 189.20,
          riskRewardRatio: 1.17,
          confidence: 75,
          strategy: 'swing',
          timeframe: '1D',
          reason: 'Bearish engulfing at key resistance. Overbought on stochastic.',
          status: 'active',
          expiryDate: nextWeek,
          marketType: 'forex',
          tradingSession: 'asian',
        },
        {
          type: 'BUY',
          asset: 'BTC/USD',
          entryPrice: 67400,
          stopLoss: 66800,
          takeProfit1: 68500,
          takeProfit2: 69500,
          riskRewardRatio: 1.83,
          confidence: 70,
          strategy: 'swing',
          timeframe: '4H',
          reason: 'Breakout from ascending triangle pattern. Volume confirming.',
          status: 'active',
          expiryDate: tomorrow,
          marketType: 'crypto',
          tradingSession: 'us',
        },
        {
          type: 'SELL',
          asset: 'USD/JPY',
          entryPrice: 154.20,
          stopLoss: 154.70,
          takeProfit1: 153.60,
          riskRewardRatio: 1.2,
          confidence: 68,
          strategy: 'scalp',
          timeframe: '15M',
          reason: 'Rejection at supply zone. Bearish candlestick pattern.',
          status: 'hit_tp',
          resultPrice: 153.60,
          resultType: 'tp1',
          expiryDate: yesterday,
          resolvedAt: yesterday,
          marketType: 'forex',
          tradingSession: 'asian',
        },
        {
          type: 'BUY',
          asset: 'XAU/USD',
          entryPrice: 2340,
          stopLoss: 2320,
          takeProfit1: 2370,
          takeProfit2: 2400,
          riskRewardRatio: 1.5,
          confidence: 85,
          strategy: 'swing',
          timeframe: '1D',
          reason: 'Safe-haven demand increasing. Cup and handle formation.',
          status: 'hit_tp',
          resultPrice: 2370,
          resultType: 'tp1',
          expiryDate: twoDaysAgo,
          resolvedAt: twoDaysAgo,
          marketType: 'commodities',
          tradingSession: 'us',
        },
        {
          type: 'SELL',
          asset: 'ETH/USD',
          entryPrice: 3520,
          stopLoss: 3560,
          takeProfit1: 3460,
          riskRewardRatio: 1.5,
          confidence: 60,
          strategy: 'scalp',
          timeframe: '5M',
          reason: 'Double top formation. RSI overbought.',
          status: 'hit_sl',
          resultPrice: 3560,
          resultType: 'sl',
          expiryDate: threeDaysAgo,
          resolvedAt: threeDaysAgo,
          marketType: 'crypto',
          tradingSession: 'european',
        },
        {
          type: 'BUY',
          asset: 'AAPL',
          entryPrice: 195.50,
          stopLoss: 193.00,
          takeProfit1: 199.00,
          takeProfit2: 202.00,
          riskRewardRatio: 1.4,
          confidence: 72,
          strategy: 'swing',
          timeframe: '1D',
          reason: 'Post-earnings recovery. Strong support at 193.',
          status: 'active',
          expiryDate: nextWeek,
          marketType: 'stocks',
          tradingSession: 'us',
        },
        {
          type: 'NEUTRAL',
          asset: 'SPX500',
          entryPrice: 5450,
          stopLoss: 5400,
          takeProfit1: 5500,
          riskRewardRatio: 1.0,
          confidence: 55,
          strategy: 'swing',
          timeframe: '4H',
          reason: 'Consolidation near all-time high. Wait for breakout direction.',
          status: 'active',
          expiryDate: tomorrow,
          marketType: 'indices',
          tradingSession: 'us',
        },
      ],
    })

    // Seed economic events
    await db.economicEvent.createMany({
      data: [
        {
          eventName: 'FOMC Interest Rate Decision',
          eventDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
          currency: 'USD',
          impactLevel: 'high',
          previousValue: '5.50%',
          forecastValue: '5.50%',
          eventType: 'central_bank',
          description: 'Federal Open Market Committee announces its interest rate decision.',
        },
        {
          eventName: 'Non-Farm Payrolls',
          eventDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
          currency: 'USD',
          impactLevel: 'high',
          previousValue: '272K',
          forecastValue: '190K',
          eventType: 'employment',
          description: 'Change in the number of employed people, excluding the farming industry.',
        },
        {
          eventName: 'ECB Press Conference',
          eventDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          currency: 'EUR',
          impactLevel: 'high',
          previousValue: '-',
          forecastValue: '-',
          eventType: 'central_bank',
          description: 'European Central Bank President speaks about monetary policy.',
        },
        {
          eventName: 'UK CPI (YoY)',
          eventDate: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000),
          currency: 'GBP',
          impactLevel: 'high',
          previousValue: '2.0%',
          forecastValue: '2.1%',
          eventType: 'inflation',
          description: 'Consumer Price Index year-over-year change.',
        },
        {
          eventName: 'Japan GDP (QoQ)',
          eventDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
          currency: 'JPY',
          impactLevel: 'medium',
          previousValue: '-0.5%',
          forecastValue: '0.3%',
          eventType: 'gdp',
          description: 'Gross Domestic Product quarter-over-quarter change.',
        },
        {
          eventName: 'Australia Employment Change',
          eventDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          currency: 'AUD',
          impactLevel: 'medium',
          previousValue: '38.5K',
          forecastValue: '25.0K',
          eventType: 'employment',
          description: 'Change in the number of employed people in Australia.',
        },
        {
          eventName: 'German ZEW Economic Sentiment',
          eventDate: new Date(now.getTime() + 6 * 60 * 60 * 1000),
          currency: 'EUR',
          impactLevel: 'medium',
          previousValue: '47.5',
          forecastValue: '50.0',
          eventType: 'sentiment',
          description: 'ZEW Economic Sentiment index based on survey of institutional investors.',
        },
        {
          eventName: 'US Retail Sales (MoM)',
          eventDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
          currency: 'USD',
          impactLevel: 'medium',
          previousValue: '0.1%',
          forecastValue: '0.3%',
          eventType: 'consumption',
          description: 'Change in total value of sales at the retail level.',
        },
      ],
    })

    // Seed news articles
    await db.newsArticle.createMany({
      data: [
        {
          title: 'Fed Signals Potential Rate Cuts Later This Year',
          summary: 'Federal Reserve officials indicated that interest rate cuts could begin as early as September, depending on inflation data.',
          source: 'Reuters',
          sentiment: 'bullish',
          taggedAssets: 'EUR/USD,GBP/USD,XAU/USD',
          category: 'central_banks',
          publishedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        },
        {
          title: 'Bitcoin Surges Past $68K on ETF Inflows',
          summary: 'Bitcoin reached new monthly highs as spot ETF inflows exceeded $1 billion in a single week.',
          source: 'Bloomberg',
          sentiment: 'bullish',
          taggedAssets: 'BTC/USD,ETH/USD',
          category: 'crypto',
          publishedAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
        },
        {
          title: 'European Economy Shows Signs of Slowdown',
          summary: 'PMI data from the Eurozone came in below expectations, raising concerns about economic growth.',
          source: 'Financial Times',
          sentiment: 'bearish',
          taggedAssets: 'EUR/USD,EUR/GBP,DAX',
          category: 'economy',
          publishedAt: new Date(now.getTime() - 6 * 60 * 60 * 1000),
        },
        {
          title: 'Gold Hits New All-Time High on Geopolitical Tensions',
          summary: 'Gold prices surpassed $2,400 as investors seek safe-haven assets amid escalating tensions in the Middle East.',
          source: 'CNBC',
          sentiment: 'bullish',
          taggedAssets: 'XAU/USD',
          category: 'commodities',
          publishedAt: new Date(now.getTime() - 8 * 60 * 60 * 1000),
        },
        {
          title: 'Japanese Yen Weakens Despite BOJ Intervention Warnings',
          summary: 'USD/JPY continued its upward trajectory despite verbal intervention from Japanese officials.',
          source: 'Nikkei Asia',
          sentiment: 'bearish',
          taggedAssets: 'USD/JPY,GBP/JPY',
          category: 'forex',
          publishedAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
        },
        {
          title: 'S&P 500 Sets New Record Close',
          summary: 'The benchmark index closed at a record high driven by strong earnings from tech companies.',
          source: 'Wall Street Journal',
          sentiment: 'bullish',
          taggedAssets: 'SPX500,NAS100,AAPL',
          category: 'stocks',
          publishedAt: new Date(now.getTime() - 18 * 60 * 60 * 1000),
        },
        {
          title: 'Oil Prices Drop on OPEC+ Production Increase',
          summary: 'Crude oil fell 3% after OPEC+ announced plans to gradually increase production starting next quarter.',
          source: 'Energy Voice',
          sentiment: 'bearish',
          taggedAssets: 'OIL,USOIL',
          category: 'commodities',
          publishedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        },
        {
          title: 'UK Inflation Holds Steady, Rate Cut Expectations Grow',
          summary: 'British inflation remained at 2.0%, supporting expectations of a Bank of England rate cut in August.',
          source: 'BBC Business',
          sentiment: 'neutral',
          taggedAssets: 'GBP/USD,GBP/JPY',
          category: 'inflation',
          publishedAt: new Date(now.getTime() - 30 * 60 * 60 * 1000),
        },
      ],
    })

    seeded = true
    console.log('Demo data seeded successfully')
  } catch (error) {
    // Don't crash the API if seeding fails - just log and continue
    console.error('Seed demo data error (non-fatal):', error)
    seeded = true // Prevent retrying on every request
  }
}
