import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

// Educational content — the single source of truth served to the Learn page.
const EDUCATIONAL_CONTENT = [
  {
    id: 'guide-1',
    type: 'guide',
    title: "Beginner's Guide to Trading",
    description: 'Learn the fundamentals of trading, from market types to placing your first order.',
    category: 'forex',
    difficulty: 'beginner',
    estimatedMinutes: 25,
    sections: [
      { id: 'g1-s1', title: 'What is Trading?', content: 'Trading is the act of buying and selling financial instruments such as stocks, currencies, commodities, and derivatives with the goal of making a profit. Unlike investing, which typically involves holding assets for long periods, trading focuses on shorter-term price movements. Traders use various strategies and timeframes, from minutes (scalping) to weeks (swing trading). Understanding the basics of supply and demand, market structure, and order types is essential before placing your first trade.' },
      { id: 'g1-s2', title: 'Types of Markets', content: 'Financial markets come in several forms: Stock markets (NYSE, NASDAQ), Forex (foreign exchange), Commodity markets (gold, oil, wheat), Cryptocurrency markets (Bitcoin, Ethereum), and Derivatives markets (options, futures). Each market has its own characteristics, trading hours, and volatility profiles. Forex is the largest market by volume, operating 24 hours on weekdays. Cryptocurrency markets never close. Understanding which market suits your style is an important first step.' },
      { id: 'g1-s3', title: 'How to Place Your First Order', content: 'To place a trade, you need a brokerage account. Common order types include: Market Order (buy/sell at current price), Limit Order (buy/sell at a specific price or better), Stop Order (trigger a market order when price reaches a level), and Stop-Limit Order (combines stop and limit orders). Always start with a demo account to practice without risking real money. Set your position size carefully and always use stop-loss orders to manage risk.' },
    ],
  },
  {
    id: 'guide-2',
    type: 'guide',
    title: 'Understanding Technical Indicators',
    description: 'Master RSI, MACD, Moving Averages, and other key technical indicators.',
    category: 'technical_analysis',
    difficulty: 'beginner',
    estimatedMinutes: 30,
    sections: [
      { id: 'g2-s1', title: 'Moving Averages', content: 'Moving Averages (MA) smooth out price data to identify trends. The Simple Moving Average (SMA) calculates the average price over a set period. The Exponential Moving Average (EMA) gives more weight to recent prices. Common periods are 20, 50, and 200. When the short-term MA crosses above the long-term MA, it signals a potential uptrend (Golden Cross). The opposite is a Death Cross.' },
      { id: 'g2-s2', title: 'RSI - Relative Strength Index', content: 'RSI measures the speed and magnitude of recent price changes on a scale of 0 to 100. Values above 70 indicate overbought conditions (potential sell signal), while values below 30 indicate oversold conditions (potential buy signal). RSI divergences—when price makes a new high/low but RSI doesn\'t—can signal trend reversals.' },
      { id: 'g2-s3', title: 'MACD - Moving Average Convergence Divergence', content: 'MACD consists of the MACD line (12 EMA minus 26 EMA), the Signal line (9 EMA of MACD), and a histogram. When MACD crosses above the signal line, it\'s a bullish signal. When it crosses below, it\'s bearish. The histogram shows the distance between the two lines and can indicate momentum shifts before crossovers occur.' },
    ],
  },
  {
    id: 'guide-3',
    type: 'guide',
    title: 'Chart Patterns Encyclopedia',
    description: 'Identify head & shoulders, double tops, triangles, and more patterns.',
    category: 'technical_analysis',
    difficulty: 'intermediate',
    estimatedMinutes: 35,
    sections: [
      { id: 'g3-s1', title: 'Reversal Patterns', content: 'Reversal patterns signal a potential change in trend direction. Key patterns include: Head & Shoulders (bearish reversal), Inverse Head & Shoulders (bullish reversal), Double Top (bearish), Double Bottom (bullish). These patterns are confirmed when price breaks the neckline. Measuring the distance from the head to the neckline gives a price target.' },
      { id: 'g3-s2', title: 'Continuation Patterns', content: 'Continuation patterns suggest the existing trend will resume after a pause. Common patterns: Flags (short-term consolidation in a narrow range), Pennants (small triangles), Rectangles (horizontal trading range), and Triangles (ascending, descending, symmetric). Volume typically decreases during pattern formation and increases on breakout.' },
    ],
  },
  {
    id: 'guide-4',
    type: 'guide',
    title: 'Risk Management Fundamentals',
    description: 'Learn position sizing, risk-reward ratios, and capital preservation strategies.',
    category: 'risk_management',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    sections: [
      { id: 'g4-s1', title: 'Position Sizing', content: 'Position sizing determines how much capital to risk on each trade. A common rule is the 1-2% rule: never risk more than 1-2% of your total account balance on a single trade. For example, with a $10,000 account and 1% risk, your maximum loss per trade should be $100. Calculate position size: Position Size = (Account × Risk%) / (Entry - Stop Loss).' },
      { id: 'g4-s2', title: 'Risk-Reward Ratio', content: 'The risk-reward ratio compares potential loss to potential gain. A 1:2 ratio means you risk $1 to potentially gain $2. Most professional traders look for minimum 1:2 or 1:3 ratios. Even with a 40% win rate, a 1:2 risk-reward ratio can be profitable. Always define your stop loss and take profit before entering a trade.' },
    ],
  },
  {
    id: 'guide-5',
    type: 'guide',
    title: 'How to Use Signals Effectively',
    description: 'Make the most of trading signals with proper execution and verification.',
    category: 'strategy',
    difficulty: 'beginner',
    estimatedMinutes: 15,
    sections: [
      { id: 'g5-s1', title: 'Understanding Signal Components', content: 'A trading signal typically includes: Asset (what to trade), Direction (buy/sell), Entry Price (where to enter), Stop Loss (where to exit if wrong), Take Profit (where to exit if right), and Confidence Level (how strong the signal is). Never blindly follow signals—always verify with your own analysis and risk management rules.' },
      { id: 'g5-s2', title: 'Signal Verification', content: 'Before acting on a signal: Check the current market context (trend, volatility, news), Verify the entry level makes sense on your chart, Ensure the risk-reward ratio meets your minimum, Check if any major economic events could impact the trade, and Size your position according to your risk management plan.' },
    ],
  },
  {
    id: 'guide-6',
    type: 'guide',
    title: 'Scalping vs Swing Trading',
    description: 'Compare these two popular trading styles and find which suits you.',
    category: 'strategy',
    difficulty: 'intermediate',
    estimatedMinutes: 15,
    sections: [
      { id: 'g6-s1', title: 'Scalping', content: 'Scalping involves making dozens or hundreds of small trades per day, aiming to capture small price movements (5-20 pips in forex). Scalpers use very short timeframes (1-5 minute charts), require fast execution and low spreads, need intense focus and screen time, and typically have high win rates but small individual profits. Scalping is not recommended for beginners due to the speed and psychological demands.' },
      { id: 'g6-s2', title: 'Swing Trading', content: 'Swing trading involves holding positions for days to weeks, capturing larger price moves. Swing traders use daily and 4-hour charts, need less screen time than scalpers, can have wider stop losses but larger profit targets, and typically aim for 1:2 to 1:5 risk-reward ratios. This style is generally more suitable for part-time traders and beginners.' },
    ],
  },
  {
    id: 'glossary-1',
    type: 'glossary',
    title: 'Trading Glossary',
    description: 'Essential trading terms and their definitions.',
    category: 'general',
    difficulty: 'beginner',
    estimatedMinutes: 30,
    terms: [
      { term: 'Ask Price', definition: 'The lowest price a seller is willing to accept for an asset. Also known as the offer price.', example: 'If the ask price of EUR/USD is 1.0876, you can buy at that price.', related: ['Bid Price', 'Spread'] },
      { term: 'Bid Price', definition: 'The highest price a buyer is willing to pay for an asset.', example: 'If the bid price of EUR/USD is 1.0874, you can sell at that price.', related: ['Ask Price', 'Spread'] },
      { term: 'Bollinger Bands', definition: 'A technical indicator consisting of a middle SMA band and two outer bands set at standard deviations above and below. They expand and contract with volatility.', example: 'When bands squeeze together, it often precedes a significant price move.', related: ['Volatility', 'SMA'] },
      { term: 'Candlestick', definition: 'A type of price chart that shows the open, high, low, and close prices for a specific period. The body represents the open-close range, and wicks show the high-low range.', example: 'A bullish engulfing candlestick pattern may signal a trend reversal.', related: ['OHLC', 'Support', 'Resistance'] },
      { term: 'Leverage', definition: 'The use of borrowed capital to increase the potential return of an investment. In forex, common leverage ratios range from 1:50 to 1:500.', example: 'With 1:100 leverage, $1,000 controls a $100,000 position.', related: ['Margin', 'Lot'] },
      { term: 'Lot', definition: 'A standardized unit of trading. A standard lot is 100,000 units, a mini lot is 10,000, and a micro lot is 1,000 units of the base currency.', example: 'Trading 1 standard lot of EUR/USD means controlling €100,000.', related: ['Pip', 'Leverage', 'Margin'] },
      { term: 'MACD', definition: 'Moving Average Convergence Divergence. A trend-following momentum indicator showing the relationship between two moving averages of an asset\'s price.', example: 'When MACD crosses above its signal line, it generates a bullish signal.', related: ['EMA', 'RSI'] },
      { term: 'Margin', definition: 'The amount of money required to open and maintain a leveraged position. It acts as a good-faith deposit.', example: 'If margin requirement is 1%, you need $1,000 to control a $100,000 position.', related: ['Leverage', 'Lot'] },
      { term: 'Margin Call', definition: 'A broker\'s demand for additional funds when the account equity falls below the required margin level.', example: 'If your account equity drops below 50% of required margin, you\'ll receive a margin call.', related: ['Margin', 'Leverage'] },
      { term: 'Pip', definition: 'Percentage in Point. The smallest standard price move in a forex quote, typically the fourth decimal place (0.0001). For JPY pairs, it\'s the second decimal (0.01).', example: 'If EUR/USD moves from 1.0875 to 1.0876, that\'s a 1-pip move.', related: ['Lot', 'Spread'] },
      { term: 'Resistance', definition: 'A price level where selling pressure is strong enough to prevent further upward movement. It acts as a ceiling for prices.', example: 'If EUR/USD has rejected 1.0900 multiple times, that\'s a resistance level.', related: ['Support', 'Trend Line'] },
      { term: 'RSI', definition: 'Relative Strength Index. A momentum oscillator measuring the speed and change of price movements on a scale of 0 to 100.', example: 'RSI above 70 suggests overbought conditions; below 30 suggests oversold.', related: ['MACD', 'Overbought'] },
      { term: 'Spread', definition: 'The difference between the bid and ask price of an asset. It represents the transaction cost of trading.', example: 'If bid is 1.0874 and ask is 1.0876, the spread is 2 pips.', related: ['Bid Price', 'Ask Price', 'Pip'] },
      { term: 'Stop Loss', definition: 'An order to automatically close a position when the price reaches a specified level, limiting potential losses.', example: 'If you buy at 1.0875, you might set a stop loss at 1.0845 (30 pips risk).', related: ['Take Profit', 'Risk Management'] },
      { term: 'Support', definition: 'A price level where buying pressure is strong enough to prevent further downward movement. It acts as a floor for prices.', example: 'If GBP/USD has bounced off 1.2600 multiple times, that\'s a support level.', related: ['Resistance', 'Trend Line'] },
      { term: 'Take Profit', definition: 'An order to automatically close a position when the price reaches a specified level, locking in profits.', example: 'If you buy at 1.0875, you might set take profit at 1.0920 (45 pips profit).', related: ['Stop Loss', 'Risk-Reward Ratio'] },
      { term: 'Trend Line', definition: 'A diagonal line drawn on a chart connecting a series of higher lows (uptrend) or lower highs (downtrend) to visualize the trend direction.', example: 'An uptrend line connecting higher lows can act as dynamic support.', related: ['Support', 'Resistance'] },
      { term: 'Volume', definition: 'The total number of shares, contracts, or lots traded during a given period. High volume confirms price movements.', example: 'A breakout on high volume is more likely to sustain than one on low volume.', related: ['Liquidity', 'Spread'] },
    ],
  },
  {
    id: 'quiz-1',
    type: 'quiz',
    title: "Beginner's Guide to Trading Quiz",
    description: 'Test your knowledge of trading fundamentals.',
    category: 'forex',
    difficulty: 'beginner',
    estimatedMinutes: 10,
    questions: [
      { question: 'What is the primary goal of trading?', options: ['To hold assets forever', 'To buy and sell for profit', 'To donate to markets', 'To predict the future'], correct: 1 },
      { question: 'Which market operates 24 hours on weekdays?', options: ['Stock market', 'Bond market', 'Forex market', 'Real estate'], correct: 2 },
      { question: 'What does a market order do?', options: ['Buys at a future date', 'Sells at a specific price', 'Executes at the current price', 'Cancels all trades'], correct: 2 },
      { question: 'What is the 1-2% rule in trading?', options: ['Profit target per trade', 'Maximum risk per trade', 'Tax rate on trades', 'Brokerage fee'], correct: 1 },
      { question: 'What should you do before trading with real money?', options: ['Borrow more capital', 'Practice on a demo account', 'Watch TV for tips', 'Skip learning'], correct: 1 },
    ],
  },
  {
    id: 'quiz-2',
    type: 'quiz',
    title: 'Technical Indicators Quiz',
    description: 'Test your knowledge of RSI, MACD, and moving averages.',
    category: 'technical_analysis',
    difficulty: 'intermediate',
    estimatedMinutes: 10,
    questions: [
      { question: 'What does RSI measure?', options: ['Volume', 'Momentum', 'Volatility', 'Market cap'], correct: 1 },
      { question: 'RSI above 70 indicates:', options: ['Oversold', 'Overbought', 'Neutral', 'High volume'], correct: 1 },
      { question: 'What is a Golden Cross?', options: ['50 MA crosses below 200 MA', 'Short MA crosses above long MA', 'RSI hits 70', 'Volume spike'], correct: 1 },
      { question: 'MACD consists of:', options: ['One line', 'Two lines and histogram', 'Three lines', 'A single oscillator'], correct: 1 },
    ],
  },
  {
    id: 'quiz-3',
    type: 'quiz',
    title: 'Risk Management Quiz',
    description: 'Test your knowledge of position sizing and risk-reward.',
    category: 'risk_management',
    difficulty: 'intermediate',
    estimatedMinutes: 10,
    questions: [
      { question: 'A 1:2 risk-reward ratio means:', options: ['Risk $2 to gain $1', 'Risk $1 to gain $2', 'Risk equals reward', 'Double your account'], correct: 1 },
      { question: 'Position size formula is:', options: ['Account × Leverage', '(Account × Risk%) / (Entry - SL)', 'Price × Quantity', 'Margin × Lot'], correct: 1 },
      { question: 'What is a stop-loss order?', options: ['Order to buy more', 'Order to limit losses', 'Order to take profit', 'Order to cancel'], correct: 1 },
      { question: 'What percentage of account should you risk per trade?', options: ['10-20%', '5-10%', '1-2%', '50%+'], correct: 2 },
    ],
  },
]

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // guide, glossary, video, quiz
    const category = searchParams.get('category')
    const difficulty = searchParams.get('difficulty')

    let content = EDUCATIONAL_CONTENT

    if (type) content = content.filter(c => c.type === type)
    if (category) content = content.filter(c => c.category === category)
    if (difficulty) content = content.filter(c => c.difficulty === difficulty)

    // Get user's progress if authenticated
    let progress: { contentId: string; completed: boolean; score: number | null }[] = []
    if (userId) {
      progress = await db.educationProgress.findMany({
        where: { userId },
      })
    }

    // Map progress to content
    const contentWithProgress = content.map(c => {
      const userProgress = progress.find(p => p.contentId === c.id)
      return {
        ...c,
        completed: userProgress?.completed || false,
        score: userProgress?.score || null,
      }
    })

    return successResponse({
      content: contentWithProgress,
      totalContent: contentWithProgress.length,
      completedCount: contentWithProgress.filter(c => c.completed).length,
    })
  } catch (error) {
    console.error('Education GET error:', error)
    return errorResponse('Failed to fetch educational content', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { contentId, contentType, completed, score } = body

    if (!contentId || !contentType) {
      return errorResponse('contentId and contentType are required', 400)
    }

    // Upsert progress
    const existing = await db.educationProgress.findFirst({
      where: { userId, contentId },
    })

    let progress
    if (existing) {
      progress = await db.educationProgress.update({
        where: { id: existing.id },
        data: {
          completed: completed !== undefined ? completed : existing.completed,
          score: score !== undefined ? score : existing.score,
        },
      })
    } else {
      progress = await db.educationProgress.create({
        data: {
          userId,
          contentId,
          contentType,
          completed: completed || false,
          score: score || null,
        },
      })
    }

    // Award badge for completing first content
    if (completed) {
      const completedCount = await db.educationProgress.count({
        where: { userId, completed: true },
      })

      if (completedCount === 1) {
        await db.userBadge.create({
          data: {
            userId,
            badgeType: 'education',
            badgeName: 'First Steps',
          },
        })
      } else if (completedCount === 5) {
        await db.userBadge.create({
          data: {
            userId,
            badgeType: 'education',
            badgeName: 'Quick Learner',
          },
        })
      } else if (completedCount >= EDUCATIONAL_CONTENT.length) {
        await db.userBadge.create({
          data: {
            userId,
            badgeType: 'education',
            badgeName: 'Scholar',
          },
        })
      }
    }

    return successResponse(progress, 201)
  } catch (error) {
    console.error('Education POST error:', error)
    return errorResponse('Failed to update education progress', 500)
  }
}
