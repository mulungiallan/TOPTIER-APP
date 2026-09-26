// Boot-time seed: makes sure the E-Books store has the starter titles.
// Idempotent — existing books (by slug) are left untouched so admin edits are
// never clobbered on a redeploy. Mirrors src/lib/ebooks/seed (inline content).
//
// NOTE: this must require the SAME client the app uses (src/generated/prisma,
// set by `output` in prisma/schema.prisma) — NOT '@prisma/client'. The
// default @prisma/client entry is not regenerated when a custom output is
// configured, so it is stale: it had no `eBook` delegate at all, and the boot
// chain died on `Cannot read properties of undefined (reading 'findUnique')`.
// Because the Railway start command is `&&`-chained, that exit code 1 stopped
// the chain before the server ever started.
const { PrismaClient } = require('../src/generated/prisma')

const EBOOKS = [
  {
    slug: 'supply-demand-playbook',
    title: 'The Supply & Demand Trading Playbook',
    author: 'TOPTIER Academy',
    coverColor: 'indigo',
    emoji: '📉',
    category: 'strategy',
    level: 'beginner',
    price: 1.5,
    description:
      'Learn how to identify institutional supply and demand zones, trade the first retest, and read order-flow like a professional.',
    content: [
      '# The Supply & Demand Trading Playbook',
      '',
      '_TOPTIER Academy · Licensed digital edition_',
      '',
      'Welcome to the playbook. By the end of this book you will be able to mark high-probability supply and demand zones, wait for the first retest, and manage risk like a pro.',
      '',
      '## Why Supply & Demand Works',
      '',
      'Markets move in auctions between aggressive buyers and sellers. When price leaves a range quickly, it leaves behind an imbalance. Those imbalance zones act like magnets: price tends to return to them before continuing.',
      '',
      '- **Fresh zones** have the highest probability. The older a zone is, the weaker it gets.',
      '- **Time frames matter** – mark zones on the 4H/1D first, then zoom in.',
      '- **Context wins** – a zone aligned with the trend is far more reliable than one against it.',
      '',
      '## Marking a Zone',
      '',
      'A demand zone is the last down candle or cluster of candles before a strong rally. Mark the base of the move, not the wick.',
      '',
      '1. Find the impulsive leg away from a range.',
      '2. Identify the last rotational candles before the leg.',
      '3. Draw the zone across the base of those candles.',
      '4. Fill the zone and watch for a retest.',
      '',
      '## The First Retest',
      '',
      'When price returns into a zone we watch three things:',
      '',
      '1. **Reaction** – a reject wick or a strong close back inside the zone.',
      '2. **Structure** – price is retesting, not breaking the opposite side.',
      '3. **Momentum** – the last candles into the zone are slowing down.',
      '',
      'Entries on the first retest give the best risk-to-reward. Second and third retests fill less often and carry more risk.',
      '',
      '## Risk Management',
      '',
      '- Risk no more than 1–2% per trade.',
      '- Stop below the zone (demand) or above the zone (supply); never in the middle of it.',
      '- Target the nearest opposing zone or key level, then trail the remainder.',
      '- If a zone breaks with real momentum, exit and look for the next level.',
      '',
      '## Putting It Together',
      '',
      '1. Trend direction first (2H/4H).',
      '2. Mark fresh zones on the 1H.',
      '3. Wait for the first retest + confirmation.',
      '4. Size by risk, not by conviction.',
      '5. Journal every trade — review weekly.',
      '',
      'Practice marking zones on your charts for a week before trading real money. The edge comes from consistency, not from any single trade.',
      '',
      '_End of playbook · © TOPTIER Academy. Sharing or redistribution is prohibited._',
    ].join('\n'),
  },
  {
    slug: 'smart-money-concepts',
    title: 'Smart Money Concepts: Decoding Institutional Footprints',
    author: 'TOPTIER Academy',
    coverColor: 'cyan',
    emoji: '🧠',
    category: 'strategy',
    level: 'intermediate',
    price: 1.5,
    description:
      'Order blocks, liquidity grabs, breaker blocks and fair value gaps explained in plain English with concrete trade examples.',
    content: [
      '# Smart Money Concepts: Decoding Institutional Footprints',
      '',
      '_TOPTIER Academy · Licensed digital edition_',
      '',
      'This book translates institutional terminology into actionable checklist you can apply on any market.',
      '',
      '## Order Blocks',
      '',
      'An order block is the last opposing candle before an impulsive move. It represents the location where institutions accumulated positions.',
      '',
      '- Mark the last opposing candle before the move, including its wick.',
      '- Fresh order blocks behave like magnets on retest.',
      '- Combine blocks with higher-timeframe direction for the highest win rates.',
      '',
      '## Liquidity Grabs & the Stop Hunt',
      '',
      'Price hunts resting stops on the far side of obvious highs and lows before reversing. These are the traps retail traders fall into.',
      '',
      '1. Identify the obvious swing high or low.',
      '2. Watch for price to pierce it then close back inside.',
      '3. That rejection is frequently the real entry area.',
      '',
      '## Fair Value Gaps (FVG)',
      '',
      'A fair value gap is the price void left between three consecutive candles when a move is so fast the middle candle barely overlaps its neighbors.',
      '',
      '- Gaps left unmitigated are targets and support/resistance.',
      '- A retest of an unfilled gap on the same time frame is a high-probability entry.',
      '- Higher-timeframe gaps are far more meaningful than lower-timeframe ones.',
      '',
      '## Breaker Blocks',
      '',
      'When a bullish order block or support structure breaks and price closes below it, that area often becomes resistance. The role of the level flips, and the broken block is now called a breaker.',
      '',
      '## The Confluence Checklist',
      '',
      'Before every entry, require at least three of these:',
      '',
      '1. HTF trend alignment',
      '2. Fresh order block or FVG',
      '3. Liquidity sweep at a key level',
      '4. Clear risk level within 1.5%',
      '5. R:R of at least 1:2',
      '',
      'Without three or more, stand aside. Selective trading is how institutions stay profitable.',
      '',
      '_End of book · © TOPTIER Academy. Sharing or redistribution is prohibited._',
    ].join('\n'),
  },
  {
    slug: 'trading-psychology',
    title: 'The Psychology of Consistent Trading',
    author: 'TOPTIER Academy',
    coverColor: 'emerald',
    emoji: '🧘',
    category: 'psychology',
    level: 'beginner',
    price: 1.5,
    description:
      'Master the mental game: fear, greed, tilt and discipline — with a practical daily routine that builds a repeatable trading process.',
    content: [
      '# The Psychology of Consistent Trading',
      '',
      '_TOPTIER Academy · Licensed digital edition_',
      '',
      'Most losing streaks are not strategy problems — they are process problems. This book is about the habits that keep winners consistent.',
      '',
      '## Why You Trade Better on Paper Than Live',
      '',
      'On paper there is no equity on the line, so emotion is absent. Live, the brain reacts to loss as a threat: the same circuit that fires when you touch a hot stove.',
      '',
      '- You are not built to enjoy losing money. Expect emotional discomfort.',
      '- The goal is not to eliminate emotion — it is to pre-decide your actions so emotion has no vote.',
      '',
      '## The Three Humans in Every Trader',
      '',
      '1. **The Gambler** — wants excitement, oversizes, chases.',
      '2. **The Analyst** — wants to be right, holds losers, refuses to cut.',
      '3. **The Process Trader** — executes the plan, takes the small loss, and waits for the next opportunity.',
      '',
      'Every bad trade you have taken is one of the first two talking. Build systems that only let the third person handle money.',
      '',
      '## Pre-Programming Your Decisions',
      '',
      'Before the market opens, write down:',
      '',
      '1. The exact setups I am allowed to take today.',
      '2. The maximum loss I am willing to accept (a hard stop-out for the day).',
      '3. What I will do when I lose that limit (close the platform).',
      '',
      '## Tilt Recovery Routine',
      '',
      'When you feel yourself chasing:',
      '',
      '- Step away for at least 30 minutes.',
      '- Audit the last three trades on paper, without blame.',
      '- Reduce size to half for the next three trades.',
      '- Re-read your trading plan.',
      '',
      '## A Daily Routine That Compounds',
      '',
      '1. Morning: update your plan for the current session.',
      '2. During: execute only pre-approved setups.',
      '3. After: journal entries, exits, and emotional states.',
      '4. Weekly: review the journal and remove one bad habit.',
      '',
      'Consistency is not about being right often. It is about reacting the same way every time. That single habit is worth more than any indicator.',
      '',
      '_End of book · © TOPTIER Academy. Sharing or redistribution is prohibited._',
    ].join('\n'),
  },
]

async function main() {
  const prisma = new PrismaClient()
  try {
    let created = 0
    let skipped = 0
    for (const book of EBOOKS) {
      const existing = await prisma.eBook.findUnique({ where: { slug: book.slug } })
      if (existing) {
        skipped += 1
        continue
      }
      await prisma.eBook.create({ data: book })
      created += 1
    }
    console.log(`[ensure-ebooks] ${created} created, ${skipped} already present.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('[ensure-ebooks] failed:', err)
  process.exit(1)
})