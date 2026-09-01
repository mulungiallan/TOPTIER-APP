import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { ClientProviders } from "./client-providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f2a4a" },
  ],
};

export const metadata: Metadata = {
  title: "TOPTIER — Powered by BAGMUL",
  description: "AI-powered trading signals, screenshot analysis, and market intelligence. Trade smarter with TOPTIER, powered by BAGMUL.",
  keywords: ["trading", "signals", "analyzer", "forex", "crypto", "stocks", "AI", "screenshot", "BAGMUL"],
  authors: [{ name: "BAGMUL" }],
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
    title: "TOPTIER",
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  openGraph: {
    type: "website",
    title: "TOPTIER — AI Trading Signals",
    description: "AI-powered trading signals, screenshot analysis, and market intelligence. Trade smarter with TOPTIER.",
    siteName: "TOPTIER",
  },
  twitter: {
    card: "summary",
    title: "TOPTIER — AI Trading Signals",
    description: "AI-powered trading signals, screenshot analysis, and market intelligence.",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The CSP nonce is set by the middleware (x-csp-nonce). Binding it here is
  // optional — the header is still forwarded so the CSP works regardless — but
  // it lets Next.js tag its inline scripts with the nonce for a stricter CSP.
  let cspNonce = "";
  try {
    const hdrs = await headers();
    cspNonce = hdrs.get("x-csp-nonce") || "";
  } catch {
    // fall through — nonce unavailable during static generation
  }

  return (
    <html lang="en" suppressHydrationWarning nonce={cspNonce}>
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* iOS launch screens (apple-touch-startup-image) for the main device sizes */}
        <link rel="apple-touch-startup-image" href="/icons/splash-ios-2048x2732.png" media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" />
        <link rel="apple-touch-startup-image" href="/icons/splash-ios-1668x2388.png" media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)" />
        <link rel="apple-touch-startup-image" href="/icons/splash-ios-1536x2048.png" media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)" />
        <link rel="apple-touch-startup-image" href="/icons/splash-ios-1242x2688.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/icons/splash-ios-1125x2436.png" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/icons/splash-ios-828x1792.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" />
      </head>
      <body
        className={`antialiased bg-background text-foreground ${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <ClientProviders>{children}</ClientProviders>
          <Toaster richColors position="top-right" />
          <ServiceWorkerRegistrar />
        </ThemeProvider>
      </body>
    </html>
  );
}
