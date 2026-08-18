/**
 * Robust fetch hook with retry, exponential backoff, offline support
 * Drop into: src/hooks/use-robust-fetch.ts
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface UseFetchOptions<T> {
  url: string;
  initialData?: T;
  maxRetries?: number;
  baseDelay?: number;       // ms
  maxDelay?: number;        // ms
  retryOn?: number[];       // status codes to retry on
  enabled?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  refetchInterval?: number; // ms
}

interface UseFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  retry: () => void;
  refetch: () => void;
  isOffline: boolean;
  isRetrying: boolean;
  retryCount: number;
}

export function useRobustFetch<T = any>(options: UseFetchOptions<T>): UseFetchResult<T> {
  const {
    url,
    initialData = null,
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    retryOn = [408, 429, 500, 502, 503, 504],
    enabled = true,
    onSuccess,
    onError,
    refetchInterval,
  } = options;

  const [data, setData] = useState<T | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [attemptId, setAttemptId] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Track online/offline status
  useEffect(() => {
    const on = () => setIsOffline(false);
    const off = () => setIsOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setIsOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const fetchWithRetry = useCallback(async (attempt: number) => {
    if (attempt > maxRetries) {
      const err = new Error(`Max retries (${maxRetries}) exceeded`);
      setError(err);
      onError?.(err);
      setLoading(false);
      setIsRetrying(false);
      return;
    }

    if (attempt > 0) {
      setIsRetrying(true);
      setRetryCount(attempt);
      // Exponential backoff with jitter
      const delay = Math.min(maxDelay, baseDelay * 2 ** attempt) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }

    // Cancel any in-flight request
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        if (retryOn.includes(res.status) && attempt < maxRetries) {
          return fetchWithRetry(attempt + 1);
        }
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();
      setData(json);
      setError(null);
      setRetryCount(0);
      onSuccess?.(json);
    } catch (e: any) {
      if (e.name === "AbortError") return;
      if (e.message === "Failed to fetch" || e.message === "Network request failed") {
        // Network error — retry if not offline
        if (!navigator.onLine) {
          setIsOffline(true);
          setError(new Error("You're offline. Will retry when connection returns."));
        } else if (attempt < maxRetries) {
          return fetchWithRetry(attempt + 1);
        }
      }
      setError(e);
      onError?.(e);
    } finally {
      setLoading(false);
      setIsRetrying(false);
    }
  }, [url, maxRetries, baseDelay, maxDelay, retryOn, onSuccess, onError]);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    fetchWithRetry(0);
    return () => abortRef.current?.abort();
  }, [enabled, url, attemptId, fetchWithRetry]);

  // Auto-refetch on interval
  useEffect(() => {
    if (!refetchInterval) return;
    const id = setInterval(() => setAttemptId((x) => x + 1), refetchInterval);
    return () => clearInterval(id);
  }, [refetchInterval]);

  // Auto-retry when coming back online
  useEffect(() => {
    if (!isOffline && error && enabled) {
      setAttemptId((x) => x + 1);
    }
  }, [isOffline]);

  const retry = useCallback(() => setAttemptId((x) => x + 1), []);
  const refetch = useCallback(() => setAttemptId((x) => x + 1), []);

  return { data, loading, error, retry, refetch, isOffline, isRetrying, retryCount };
}
