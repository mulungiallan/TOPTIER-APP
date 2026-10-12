import type { Metadata } from "next";

// Central SEO config. One source of truth for the canonical origin, brand copy,
// structured data and Next.js metadata — mirrors the "lib/seo.ts" layout the SEO
// kit recommends. The canonical domain is the custom production domain; every
// deployment env overrides it through NEXT_PUBLIC_APP_URL.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || "https://app.toptier.app"
);

export const site = {
  name: "TOPTIER",
  legalName: "BAGMUL",
  tagline: "AI Trading Signals & Screenshot Analysis",
  title: "TOPTIER — AI Trading Signals & Screenshot Analysis",
  shortTitle: "TOPTIER — AI Trading Signals",
  description:
    "AI-powered trading signals, screenshot analysis, and market intelligence. Trade smarter with TOPTIER, powered by BAGMUL.",
  keywords: [
    "trading",
    "signals",
    "analyzer",
    "forex",
    "crypto",
    "stocks",
    "AI",
    "screenshot",
    "trading bot",
    "BAGMUL",
  ],
  // Real, customer-facing features — used for WebApplication.featureList and
  // (in prose form) the on-page FAQ. Keep in sync with what the product ships.
  features: [
    "AI trading signals scored by confidence",
    "Screenshot pattern analysis",
    "Transparent trader leaderboards",
    "Auto-trading MetaTrader 5/4 bot",
    "Copy trading",
    "Risk management and position sizing",
  ],
  faq: [
    {
      q: "What is TOPTIER?",
      a: "TOPTIER is an AI-powered trading platform. Every signal is scored by confidence, chart screenshots are analyzed by AI, and every trader is ranked on live proof — win rate, profit factor and drawdown. No deleted losers, no fake results.",
    },
    {
      q: "Is TOPTIER free?",
      a: "Yes. Everyone starts on a free tier with a daily signal limit. Upgrade only when you need more — signals, the trading bot and removing ads are sold a-la-carte, and you can cancel anytime.",
    },
    {
      q: "How does the trading bot work?",
      a: "Link your own MetaTrader 5 or 4 account with your login, password and server. The AI bot trades it 24/7 under strict risk caps. You keep 100% of your account — TOPTIER earns a share only on winning trades.",
    },
    {
      q: "What is copy trading?",
      a: "Follow proven traders and mirror their trades automatically, or become a MASTER and let others copy you while you earn profit share on every winning trade. Performance is transparent — no hidden or deleted losers.",
    },
    {
      q: "How do I get started?",
      a: "Sign up for free, then use the signals and screenshot analyzer immediately. To go hands-free, open Trading Bot in the app, link your MT5/MT4 account and press Start.",
    },
  ],
  url: SITE_URL,
  ogImage: "/opengraph-image",
  twitterImage: "/twitter-image",
  supportEmail: "support@toptier.app",
  locale: "en_US",
} as const;

export function absoluteUrl(path = "/"): string {
  return new URL(path, `${SITE_URL}/`).toString();
}

// Next.js metadata for the root layout. `buildMetadata` lets a future route
// override or extend any field while keeping the shared defaults.
export function buildMetadata(overrides: Metadata = {}): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    applicationName: site.name,
    title: {
      default: site.title,
      template: "%s — TOPTIER",
    },
    description: site.description,
    keywords: [...site.keywords],
    authors: [{ name: site.legalName }],
    creator: site.legalName,
    publisher: site.legalName,
    category: "finance",
    alternates: {
      canonical: "/",
      languages: {
        "en": `${SITE_URL}/`,
        "x-default": `${SITE_URL}/`,
      },
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    verification: {
      google: "google8acd419857671d47.html",
    },
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
        { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      ],
      apple: [
        { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      ],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: site.name,
    },
    formatDetection: {
      telephone: false,
      email: false,
      address: false,
    },
    openGraph: {
      type: "website",
      title: site.shortTitle,
      description: site.description,
      siteName: site.name,
      url: `${SITE_URL}/`,
      images: [
        {
          url: site.ogImage,
          width: 1200,
          height: 630,
          alt: site.title,
        },
      ],
      locale: site.locale,
    },
    twitter: {
      card: "summary_large_image",
      title: site.shortTitle,
      description: site.description,
      images: [site.twitterImage],
    },
    ...overrides,
  };
}

// ─── Structured data (JSON-LD) ──────────────────────────────────────────────
// Only real, verifiable facts are marked up; no invented ratings or socials.
const organization = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: site.name,
  url: `${SITE_URL}/`,
  logo: absoluteUrl("/icons/icon-512x512.png"),
  description: site.description,
  email: site.supportEmail,
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: site.supportEmail,
    availableLanguage: ["English"],
  },
};

const website = {
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: site.name,
  url: `${SITE_URL}/`,
  publisher: { "@id": `${SITE_URL}/#organization` },
};

const webApplication = {
  "@type": "WebApplication",
  "@id": `${SITE_URL}/#app`,
  name: site.name,
  url: `${SITE_URL}/`,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web, Android, iOS",
  browserRequirements: "Requires JavaScript",
  description: site.description,
  featureList: [...site.features],
  publisher: { "@id": `${SITE_URL}/#organization` },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
  },
};

export const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: site.faq.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export const structuredDataGraph = {
  "@context": "https://schema.org",
  "@graph": [organization, website, webApplication],
};

export type StructuredData = typeof structuredDataGraph;
