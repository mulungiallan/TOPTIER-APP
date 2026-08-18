/**
 * Centralized cache layer — works with in-memory (dev) or Redis (prod).
 * Drop into: src/lib/cache.ts
 */

type CacheDriver = "memory" | "redis";

interface CacheOptions {
  ttl?: number; // seconds
  driver?: CacheDriver;
}

class MemoryCache {
  private store = new Map<string, { value: unknown; expires: number }>();

  async get<T>(key: string): Promise<T | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expires) {
      this.store.delete(key);
      return null;
    }
    return item.value as T;
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    this.store.set(key, { value, expires: Date.now() + ttl * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async flush(): Promise<void> {
    this.store.clear();
  }

  // Periodic cleanup
  cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (now > v.expires) this.store.delete(k);
    }
  }
}

// Redis wrapper — lazy-loaded so dev environments without redis don't break
class RedisCache {
  private client: any = null;

  private async getClient() {
    if (!this.client) {
      const { createClient } = await import("redis");
      this.client = createClient({ url: process.env.REDIS_URL });
      this.client.on("error", (err: Error) => console.error("Redis error:", err));
      await this.client.connect();
    }
    return this.client;
  }

  async get<T>(key: string): Promise<T | null> {
    const client = await this.getClient();
    const raw = await client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    const client = await this.getClient();
    await client.set(key, JSON.stringify(value), { EX: ttl });
  }

  async del(key: string): Promise<void> {
    const client = await this.getClient();
    await client.del(key);
  }

  async flush(): Promise<void> {
    const client = await this.getClient();
    await client.flushDb();
  }
}

const driver: CacheDriver = (process.env.CACHE_DRIVER as CacheDriver) || "memory";
const memoryCache = new MemoryCache();
let redisCache: RedisCache | null = null;

function getRedis() {
  if (!redisCache) redisCache = new RedisCache();
  return redisCache;
}

// Auto-cleanup memory cache every 5 minutes
if (driver === "memory") {
  setInterval(() => memoryCache.cleanup(), 5 * 60 * 1000).unref();
}

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      return driver === "redis" ? await getRedis().get<T>(key) : await memoryCache.get<T>(key);
    } catch (e) {
      console.error("Cache get failed:", e);
      return null;
    }
  },

  async set<T>(key: string, value: T, opts: CacheOptions = {}): Promise<void> {
    const ttl = opts.ttl ?? 300;
    try {
      if (driver === "redis") await getRedis().set(key, value, ttl);
      else await memoryCache.set(key, value, ttl);
    } catch (e) {
      console.error("Cache set failed:", e);
    }
  },

  async del(key: string): Promise<void> {
    try {
      if (driver === "redis") await getRedis().del(key);
      else await memoryCache.del(key);
    } catch (e) {
      console.error("Cache del failed:", e);
    }
  },

  async flush(): Promise<void> {
    try {
      if (driver === "redis") await getRedis().flush();
      else await memoryCache.flush();
    } catch (e) {
      console.error("Cache flush failed:", e);
    }
  },

  // Helper: get-or-set pattern
  async remember<T>(key: string, ttl: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached) return cached;
    const fresh = await factory();
    await this.set(key, fresh, { ttl });
    return fresh;
  },
};

// Cache key builder
export const cacheKeys = {
  news: (category?: string) => `news:${category || "all"}`,
  calendar: (startDate: string, endDate: string) => `calendar:${startDate}:${endDate}`,
  signals: (status?: string) => `signals:${status || "all"}`,
  marketPrice: (symbol: string) => `price:${symbol}`,
  signalGenerated: (symbol: string) => `signal-gen:${symbol}`,
};
