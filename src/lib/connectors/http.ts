import type { Db } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/repo/sync";

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: string) {
    super(message);
  }
}

const lastCall = new Map<string, number[]>();

/** Limitatore a finestra scorrevole: max `perMinute` richieste al minuto per fonte. */
async function throttle(bucket: string, perMinute: number) {
  for (;;) {
    const now = Date.now();
    const calls = (lastCall.get(bucket) ?? []).filter((t) => now - t < 60_000);
    if (calls.length < perMinute) {
      calls.push(now);
      lastCall.set(bucket, calls);
      return;
    }
    const wait = 60_000 - (now - calls[0]) + 50;
    await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
  }
}

export interface FetchOpts {
  bucket: string;
  perMinute: number;
  ttlSeconds: number;
  headers?: Record<string, string>;
  force?: boolean; // ignora la cache
  timeoutMs?: number;
  retries?: number;
  cacheKey?: string; // chiave senza segreti
}

export const USER_AGENT = "FantacalcioIntelligence/1.0 (+progetto open source personale)";

/**
 * GET con cache su database, limitazione delle richieste e retry con backoff
 * (solo per errori temporanei: rete, 429, 5xx).
 */
export async function cachedGet(db: Db, url: string, opts: FetchOpts): Promise<{ body: string; fromCache: boolean; fetchedAt: string }> {
  const key = opts.cacheKey ?? `${opts.bucket}:${url}`;
  if (!opts.force) {
    const hit = cacheGet(db, key);
    if (hit) return { body: hit.body, fromCache: true, fetchedAt: hit.fetched_at };
  }
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await throttle(opts.bucket, opts.perMinute);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json, application/xml, text/xml, */*", ...(opts.headers ?? {}) },
        signal: ctrl.signal,
        cache: "no-store",
      }).finally(() => clearTimeout(timer));
      const body = await res.text();
      if (res.status === 429 || res.status >= 500) {
        throw new HttpError(res.status, `HTTP ${res.status}`, body.slice(0, 300));
      }
      if (!res.ok) {
        // errore definitivo (es. 401/403/404): niente retry
        const err = new HttpError(res.status, `HTTP ${res.status}: ${body.slice(0, 200)}`, body.slice(0, 500));
        (err as HttpError & { final?: boolean }).final = true;
        throw err;
      }
      cacheSet(db, key, url.replace(/(api_token|key|token)=[^&]+/gi, "$1=***"), res.status, body, opts.ttlSeconds);
      return { body, fromCache: false, fetchedAt: new Date().toISOString() };
    } catch (err) {
      lastErr = err;
      if ((err as { final?: boolean }).final) break;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
  }
  // fallback: dato in cache anche se scaduto, dichiarandolo
  const stale = cacheGet(db, key, true);
  if (stale) {
    const e = lastErr instanceof Error ? lastErr.message : String(lastErr);
    return { body: stale.body, fromCache: true, fetchedAt: `${stale.fetched_at}|stale|${e}` };
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function isStale(fetchedAt: string) {
  return fetchedAt.includes("|stale|");
}
