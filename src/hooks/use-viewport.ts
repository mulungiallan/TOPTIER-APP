"use client"

import { useEffect, useState, useCallback } from "react"

type Breakpoint = "xs" | "sm" | "md" | "lg" | "xl" | "2xl"

interface ViewportState {
  width: number
  height: number
  breakpoint: Breakpoint
  isTouch: boolean
  orientation: "portrait" | "landscape"
  dpr: number // device pixel ratio — useful for canvas/image rendering
}

// Keep in sync with the Tailwind breakpoints
const BREAKPOINTS: [Breakpoint, number][] = [
  ["2xl", 1536],
  ["xl", 1280],
  ["lg", 1024],
  ["md", 768],
  ["sm", 640],
  ["xs", 0],
]

function getBreakpoint(width: number): Breakpoint {
  for (const [name, min] of BREAKPOINTS) {
    if (width >= min) return name
  }
  return "xs"
}

function readViewport(): ViewportState {
  if (typeof window === "undefined") {
    // SSR-safe default; real values populate after mount
    return {
      width: 375,
      height: 812,
      breakpoint: "xs",
      isTouch: false,
      orientation: "portrait",
      dpr: 1,
    }
  }
  const width = window.visualViewport?.width ?? window.innerWidth
  const height = window.visualViewport?.height ?? window.innerHeight
  return {
    width,
    height,
    breakpoint: getBreakpoint(width),
    isTouch: "ontouchstart" in window || navigator.maxTouchPoints > 0,
    orientation: width >= height ? "landscape" : "portrait",
    dpr: window.devicePixelRatio || 1,
  }
}

/**
 * useViewport — live, resize-aware viewport info for any device.
 *
 * Use this when Tailwind's CSS-only responsive classes aren't enough,
 * e.g. sizing a <canvas>, deciding how many carousel items to render,
 * or measuring available space for a custom-drawn UI.
 *
 * For pure styling (padding, font size, grid columns), prefer Tailwind's
 * responsive classes (sm:, md:, lg:) over this hook — CSS is cheaper
 * and avoids layout flicker.
 */
export function useViewport(): ViewportState {
  const [state, setState] = useState<ViewportState>(readViewport)

  const handleResize = useCallback(() => {
    setState(readViewport())
  }, [])

  useEffect(() => {
    handleResize() // sync real values on mount (fixes SSR mismatch)

    window.addEventListener("resize", handleResize)
    window.addEventListener("orientationchange", handleResize)
    // visualViewport fires on mobile keyboard open/close & pinch zoom
    window.visualViewport?.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("orientationchange", handleResize)
      window.visualViewport?.removeEventListener("resize", handleResize)
    }
  }, [handleResize])

  return state
}
