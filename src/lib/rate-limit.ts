// Rate limiter simplu in-memory (sliding window).
// Pentru single-instance Railway e suficient. La scale-out → Upstash Redis.

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(
  key: string,
  options: { max: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  const { max, windowMs } = options;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
    if (buckets.size > MAX_KEYS) {
      // Curățăm cele mai vechi 100 chei (LRU rudimentar via insertion order)
      const keys = Array.from(buckets.keys()).slice(0, 100);
      for (const k of keys) buckets.delete(k);
    }
  }

  // Curăță timestamps vechi
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= max) {
    const oldest = bucket.timestamps[0];
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: windowMs - (now - oldest),
    };
  }

  bucket.timestamps.push(now);
  return {
    ok: true,
    remaining: max - bucket.timestamps.length,
    retryAfterMs: 0,
  };
}

export function clientIP(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

/** Comparare constantă în timp — previne timing attacks pe secrete. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
