// One-off seed script for TickerSymbol table (used by Ticker Tape component)
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const TICKERS = [
  // Forex
  { symbol: 'EUR/USD', name: 'Euro / US Dollar', category: 'forex', priority: 100 },
  { symbol: 'GBP/USD', name: 'British Pound / US Dollar', category: 'forex', priority: 95 },
  { symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen', category: 'forex', priority: 90 },
  { symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar', category: 'forex', priority: 80 },
  { symbol: 'USD/CAD', name: 'US Dollar / Canadian Dollar', category: 'forex', priority: 75 },
  { symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc', category: 'forex', priority: 70 },
  { symbol: 'NZD/USD', name: 'NZ Dollar / US Dollar', category: 'forex', priority: 65 },
  // Crypto
  { symbol: 'BTC/USD', name: 'Bitcoin', category: 'crypto', priority: 100 },
  { symbol: 'ETH/USD', name: 'Ethereum', category: 'crypto', priority: 95 },
  { symbol: 'SOL/USD', name: 'Solana', category: 'crypto', priority: 70 },
  { symbol: 'XRP/USD', name: 'Ripple', category: 'crypto', priority: 65 },
  // Indices
  { symbol: 'SPX500', name: 'S&P 500 Index', category: 'indices', priority: 95 },
  { symbol: 'NAS100', name: 'Nasdaq 100', category: 'indices', priority: 90 },
  { symbol: 'DOW', name: 'Dow Jones Industrial', category: 'indices', priority: 85 },
  { symbol: 'DAX', name: 'DAX 40', category: 'indices', priority: 75 },
  { symbol: 'FTSE', name: 'FTSE 100', category: 'indices', priority: 70 },
  // Commodities
  { symbol: 'GOLD', name: 'Gold', category: 'commodities', priority: 100 },
  { symbol: 'SILVER', name: 'Silver', category: 'commodities', priority: 80 },
  { symbol: 'OIL', name: 'Crude Oil WTI', category: 'commodities', priority: 85 },
  { symbol: 'BRENT', name: 'Brent Oil', category: 'commodities', priority: 75 },
  // Stocks
  { symbol: 'AAPL', name: 'Apple Inc.', category: 'stocks', priority: 90 },
  { symbol: 'TSLA', name: 'Tesla Inc.', category: 'stocks', priority: 85 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', category: 'stocks', priority: 88 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', category: 'stocks', priority: 82 },
]

async function main() {
  console.log(`Seeding ${TICKERS.length} ticker symbols...`)
  for (const t of TICKERS) {
    await prisma.tickerSymbol.upsert({
      where: { symbol: t.symbol },
      create: t,
      update: { ...t, isActive: true },
    })
  }
  const count = await prisma.tickerSymbol.count()
  console.log(`Done. ${count} ticker symbols in DB.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
