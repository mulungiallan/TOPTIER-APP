"use client"

import { useViewport } from "@/hooks/use-viewport"

/**
 * PreviewScreen — a full-height preview shell that auto-adjusts to any phone.
 *
 * Demonstrates the file-8 responsive pattern:
 *   .full-screen  → fits exactly the visible viewport (100svh/dvh)
 *   .safe-*       → pads around notches / home indicator
 *   useViewport() → live per-device width, height, breakpoint, orientation, dpr
 *
 * Use this as a scaffold for any full-screen preview UI. Swap the placeholder
 * content for your actual preview content.
 */
export function PreviewScreen() {
  const { width, height, breakpoint, orientation, dpr } = useViewport()

  return (
    <div className="full-screen safe-top safe-bottom safe-x w-full flex flex-col px-4 sm:px-6 lg:px-8">
      {/* Header scales with breakpoint via Tailwind, not fixed px */}
      <header className="py-3 text-lg font-semibold sm:text-xl lg:text-2xl">
        Preview
      </header>

      {/* Main content area fills remaining space, never overflows */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* your preview cards / content go here */}
        </div>
      </main>

      {/* Debug strip — remove in production. Confirms live per-device values. */}
      <footer className="py-2 text-xs opacity-60">
        {width}×{height} · {breakpoint} · {orientation} · dpr {dpr}
      </footer>
    </div>
  )
}
