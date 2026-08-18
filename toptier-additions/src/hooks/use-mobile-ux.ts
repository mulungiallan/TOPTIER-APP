"use client";

/**
 * Mobile UX Hooks
 * Drop into: src/hooks/use-mobile-ux.ts
 *
 * - usePullToRefresh: pull down to refresh on mobile
 * - useSwipeGesture: detect left/right/up/down swipes
 * - usePinchZoom: pinch-to-zoom handler for charts
 * - useHapticFeedback: vibrate on supported devices
 * - useMediaQuery: responsive breakpoint detection
 * - useTouchOptimized: enable touch-friendly UI
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ============ MEDIA QUERY ============
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

export function useIsMobile() { return useMediaQuery("(max-width: 768px)"); }
export function useIsTablet() { return useMediaQuery("(min-width: 769px) and (max-width: 1024px)"); }
export function useIsDesktop() { return useMediaQuery("(min-width: 1025px)"); }

// ============ PULL TO REFRESH ============
export function usePullToRefresh(onRefresh: () => Promise<void>, options?: { threshold?: number }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const threshold = options?.threshold || 80;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY;
    } else {
      startY.current = null;
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === null || isRefreshing) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;
    if (diff > 0) {
      // Damping effect
      const damped = Math.min(diff * 0.5, threshold * 1.5);
      setPullDistance(damped);
    }
  }, [isRefreshing, threshold]);

  const onTouchEnd = useCallback(async () => {
    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
    startY.current = null;
  }, [pullDistance, threshold, isRefreshing, onRefresh]);

  return {
    pullDistance,
    isRefreshing,
    progress: Math.min(pullDistance / threshold, 1),
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}

// ============ SWIPE GESTURE ============
interface SwipeOptions {
  threshold?: number;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

export function useSwipeGesture(options: SwipeOptions) {
  const startX = useRef(0);
  const startY = useRef(0);
  const threshold = options.threshold || 50;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - startX.current;
    const deltaY = endY - startY.current;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (Math.max(absX, absY) < threshold) return;

    if (absX > absY) {
      if (deltaX > 0) options.onSwipeRight?.();
      else options.onSwipeLeft?.();
    } else {
      if (deltaY > 0) options.onSwipeDown?.();
      else options.onSwipeUp?.();
    }
  }, [options, threshold]);

  return { onTouchStart, onTouchEnd };
}

// ============ PINCH TO ZOOM ============
export function usePinchZoom(options?: { minScale?: number; maxScale?: number; onScaleChange?: (scale: number) => void }) {
  const [scale, setScale] = useState(1);
  const initialDistance = useRef<number | null>(null);
  const minScale = options?.minScale || 0.5;
  const maxScale = options?.maxScale || 5;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialDistance.current = Math.sqrt(dx * dx + dy * dy);
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2 || initialDistance.current === null) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const newScale = Math.min(maxScale, Math.max(minScale, scale * (distance / initialDistance.current)));
    setScale(newScale);
    options?.onScaleChange?.(newScale);
  }, [scale, minScale, maxScale, options]);

  const onTouchEnd = useCallback(() => {
    initialDistance.current = null;
  }, []);

  return {
    scale,
    setScale,
    reset: () => setScale(1),
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}

// ============ HAPTIC FEEDBACK ============
export function useHapticFeedback() {
  return useCallback((pattern: number | number[] = 10) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  }, []);
}

// ============ KEYBOARD NAVIGATION (for accessibility) ============
export function useKeyboardNav(handlers: Record<string, () => void>) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const handler = handlers[e.key];
      if (handler) {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}

// ============ FOCUS MANAGEMENT (for accessibility) ============
export function useFocusTrap(active: boolean) {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;
    const container = containerRef.current;
    const focusable = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [active]);

  return containerRef;
}

// ============ ANNOUNCEMENTS (for screen readers) ============
export function useAnnouncer() {
  const announce = useCallback((message: string, type: "polite" | "assertive" = "polite") => {
    if (typeof document === "undefined") return;
    const announcer = document.createElement("div");
    announcer.setAttribute("role", "status");
    announcer.setAttribute("aria-live", type);
    announcer.setAttribute("aria-atomic", "true");
    announcer.style.position = "absolute";
    announcer.style.width = "1px";
    announcer.style.height = "1px";
    announcer.style.padding = "0";
    announcer.style.margin = "-1px";
    announcer.style.overflow = "hidden";
    announcer.style.clip = "rect(0,0,0,0)";
    announcer.style.whiteSpace = "nowrap";
    announcer.style.border = "0";
    announcer.textContent = message;
    document.body.appendChild(announcer);
    setTimeout(() => document.body.removeChild(announcer), 1000);
  }, []);

  return announce;
}
