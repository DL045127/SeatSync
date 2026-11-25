import { setTimeout as delay } from "node:timers/promises";
import { TransientFailure } from "../contracts/errors.ts";

// Normalize the legacy wire layouts to IMF-fixdate before checking the
// calendar date and weekday. Never give JavaScript a two-digit year to parse.
function canonicalHttpDate(header: string, now: number): string | undefined {
  const rfc850 = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(header);
  if (rfc850) {
    const [, weekday, day, month, shortYear, time] = rfc850;
    const limit = new Date(now);
    limit.setUTCFullYear(limit.getUTCFullYear() + 50);
    const limitYear = limit.getUTCFullYear();
    const year = limitYear - (limitYear - Number(shortYear)) % 100;
    const inYear = (y: number) => `${weekday.slice(0, 3)}, ${day} ${month} ${y} ${time} GMT`;
    const candidate = inYear(year);
    // RFC 9110 §5.6.7 uses the full instant, including the time of day.
    return Date.parse(candidate) > limit.getTime() ? inYear(year - 100) : candidate;
  }
  const asctime = /^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) ( \d|\d{2}) (\d{2}:\d{2}:\d{2}) (\d{4})$/.exec(header);
  if (asctime) {
    const [, weekday, month, day, time, year] = asctime;
    return `${weekday}, ${day.replace(" ", "0")} ${month} ${year} ${time} GMT`;
  }
  if (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)) return header;
}

export function retrySeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  if (/^\d+$/.test(header)) {
    const seconds = Number(header);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  const now = Date.now();
  const canonical = canonicalHttpDate(header, now);
  if (!canonical) return undefined;
  const date = new Date(canonical);
  if (!Number.isFinite(date.getTime()) || date.toUTCString() !== canonical) return undefined;
  return Math.max(0, Math.ceil((date.getTime() - now) / 1000));
}

export function quota(seconds?: number) {
  return new TransientFailure("ROUTING_QUOTA", "The driving-time provider is rate limited.", undefined, seconds);
}

/** One rolling five-request window per server process, including simultaneous trips. */
export class GeoapifyRateLimit {
  private starts: number[] = [];
  private blockedUntil = 0;

  backoff(seconds: number) {
    this.blockedUntil = Math.max(this.blockedUntil, performance.now() + seconds * 1000);
  }

  async acquire(signal: AbortSignal) {
    for (;;) {
      signal.throwIfAborted();
      const now = performance.now();
      if (now < this.blockedUntil) throw quota(Math.ceil((this.blockedUntil - now) / 1000));
      this.starts = this.starts.filter((start) => now - start < 1000);
      if (this.starts.length < 5) {
        this.starts.push(now);
        return;
      }
      await delay(Math.ceil(1000 + this.starts[0] - now), undefined, { signal });
    }
  }
}

// Next may bundle the search and preview routes separately in the same server.
const server = globalThis as typeof globalThis & { groupRideGeoapifyLimit?: GeoapifyRateLimit };
export const processLimit = server.groupRideGeoapifyLimit ??= new GeoapifyRateLimit();
