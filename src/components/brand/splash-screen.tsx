// src/components/brand/splash-screen.tsx
// The branded launch screen shown while the app boots.
//
// Rendered from the root layout so it is part of the server-sent HTML: the
// logo paints on the very first frame, before React hydrates and before the
// route/page bundle arrives. That is what makes tapping the home-screen icon
// feel like a native app instead of a blank white flash.
//
// Styling is inline (not in globals.css) on purpose — the splash must not
// depend on the stylesheet bundle, which may land after first paint. Keyframe
// animation is the one exception, so it is injected as a scoped <style>.

'use client'

import { useEffect, useState } from 'react'

export function SplashScreen() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    // Fade out only once the app is interactive, so the splash never vanishes
    // into an unstyled/empty page. A short floor keeps the logo on screen long
    // enough to register as branding on a fast connection.
    const MIN_MS = 550
    const started = Date.now()
    let done = false

    const hide = () => {
      if (done) return
      const wait = Math.max(0, MIN_MS - (Date.now() - started))
      setTimeout(() => {
        done = true
        setVisible(false)
      }, wait)
    }

    // requestIdleCallback isn't in Safari; fall back to a plain timeout.
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    }).requestIdleCallback

    if (typeof idle === 'function') {
      idle(hide, { timeout: 1200 })
    } else {
      setTimeout(hide, 120)
    }

    return () => {
      done = true
    }
  }, [])

  if (!visible) return null

  return (
    <div
      // Fixed + above everything: covers the app until it is ready.
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22,
        background: '#0a0e14',
        color: '#e5e7eb',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <style>{`
        @keyframes ttSplashPulse { 0%,100% { opacity: .35; transform: scale(.82);} 50% { opacity: 1; transform: scale(1);} }
        @keyframes ttSplashGlow { 0%,100% { opacity: .28; } 50% { opacity: .6; } }
        @keyframes ttSplashRise { from { opacity: 0; transform: translateY(8px);} to { opacity: 1; transform: translateY(0);} }
        @keyframes ttSplashBar { 0% { width: 8%; } 60% { width: 78%; } 100% { width: 100%; } }
        .tt-splash-ring { animation: ttSplashPulse 1.9s cubic-bezier(.4,0,.2,1) infinite; }
        .tt-splash-glow { animation: ttSplashGlow 2.4s ease-in-out infinite; }
        .tt-splash-word { animation: ttSplashRise .5s ease-out both; }
        .tt-splash-bar { animation: ttSplashBar 1.5s cubic-bezier(.4,0,.2,1) infinite; }
        @media (prefers-reduced-motion: reduce) {
          .tt-splash-ring, .tt-splash-glow, .tt-splash-word, .tt-splash-bar { animation: none; }
        }
      `}</style>

      {/* radial brand glow so the screen feels designed rather than empty */}
      <div
        className="tt-splash-glow"
        style={{
          position: 'absolute',
          top: '-18%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 520,
          height: 420,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(16,185,129,0.20) 0%, rgba(16,185,129,0) 68%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
        {/* the mark: a "T" cut from a rising tier bar */}
        <svg width="104" height="104" viewBox="0 0 104 104" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="ttSplashGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
          </defs>
          <g className="tt-splash-ring">
            <circle cx="52" cy="52" r="46" stroke="url(#ttSplashGrad)" strokeWidth="2.5" opacity="0.28" />
            <circle
              cx="52"
              cy="52"
              r="46"
              stroke="url(#ttSplashGrad)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="72 217"
            />
          </g>
          {/* tier bars */}
          <rect x="33" y="60" width="9" height="14" rx="3" fill="url(#ttSplashGrad)" opacity="0.55" />
          <rect x="47" y="52" width="9" height="22" rx="3" fill="url(#ttSplashGrad)" opacity="0.78" />
          <rect x="61" y="42" width="9" height="32" rx="3" fill="url(#ttSplashGrad)" />
          {/* T */}
          <path
            d="M38 22h28a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H57v20a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V32h-6a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3Z"
            fill="#e5e7eb"
          />
        </svg>
      </div>

      <div className="tt-splash-word" style={{ position: 'relative', textAlign: 'center' }}>
        <div
          style={{
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: '-0.025em',
            lineHeight: 1,
          }}
        >
          <span style={{ color: '#10b981' }}>TOP</span>
          <span style={{ color: '#e5e7eb' }}>TIER</span>
        </div>
        <div
          style={{
            marginTop: 9,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: '0.19em',
            textTransform: 'uppercase',
            color: 'rgba(148,163,184,0.9)',
          }}
        >
          AI Trading Platform
        </div>
      </div>

      {/* determinate-looking loading bar */}
      <div
        style={{
          position: 'relative',
          width: 132,
          height: 3,
          borderRadius: 999,
          background: 'rgba(148,163,184,0.18)',
          overflow: 'hidden',
        }}
      >
        <div
          className="tt-splash-bar"
          style={{
            height: '100%',
            borderRadius: 999,
            background: 'linear-gradient(90deg, #34d399, #10b981)',
          }}
        />
      </div>
    </div>
  )
}

export default SplashScreen
