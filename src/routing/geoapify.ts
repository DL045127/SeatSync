// Server-side Route Matrix v1 transport. Endpoint and credentials never come
// from the trip, browser request or stored selection.
import { setTimeout as delay } from "node:timers/promises";
import { TransientFailure } from "../contracts/errors.ts";
import { RoutingResultError, RoutingUnavailable, validateCells, type RoutingAdapter } from "./adapter.ts";
import { matrixBatches, type MatrixBatch } from "./matrix.ts";

const profile = { mode: "drive", traffic: "free_flow", type: "balanced", units: "metric", max_speed: 140 };
export const GEOAPIFY_POLICY_ID = "geoapify/routematrix-v1/drive/free_flow/balanced/metric/140/avoid-none/directed-seconds-null/1";
const endpoint = "https://api.geoapify.com/v1/routematrix";

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

function retrySeconds(header: string | null): number | undefined {
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

function quota(seconds?: number) {
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

const processLimit = new GeoapifyRateLimit();

function decode(body: unknown, batch: MatrixBatch): Array<Array<number | null>> {
  const malformed = () => new RoutingResultError("The driving-time provider returned an invalid matrix.");
  if (!body || typeof body !== "object" || !("sources_to_targets" in body)) throw malformed();
  const rows = body.sources_to_targets;
  if (!Array.isArray(rows) || rows.length !== batch.sources.length) throw malformed();
  return rows.map((row: unknown, i) => {
    if (!Array.isArray(row) || row.length !== batch.targets.length) throw malformed();
    return validateCells(row.map((cell, j) => {
      if (cell?.source_index !== i || cell?.target_index !== j) throw malformed();
      return cell.time;
    }), batch.targets.length);
  });
}

interface AdapterOptions {
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
  limit?: GeoapifyRateLimit;
}

export function geoapifyRoutingAdapter(options: AdapterOptions = {}): RoutingAdapter {
  const limit = options.limit ?? processLimit;
  return {
    provider: "geoapify",
    policyId: GEOAPIFY_POLICY_ID,
    async fetchLegs(pairs, request) {
      if (!pairs.length) return [];
      const key = (options.apiKey ?? process.env.GEOAPIFY_API_KEY)?.trim();
      if (!key) throw new RoutingUnavailable("Driving-time credentials are unavailable.");
      const url = new URL(options.endpoint ?? endpoint);
      url.searchParams.set("apiKey", key);
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      const cells = new Array<number | null>(pairs.length);
      try {
        for (const batch of matrixBatches(pairs, request.venueId)) {
          await limit.acquire(signal);
          const response = await fetch(url, {
            method: "POST", cache: "no-store", redirect: "error", signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...profile,
              sources: batch.sources.map((location) => ({ location })),
              targets: batch.targets.map((location) => ({ location })),
            }),
          });
          if (!response.ok) {
            const retry = retrySeconds(response.headers.get("retry-after"));
            if (response.status === 429) limit.backoff(retry ?? 1);
            await response.body?.cancel();
            if (response.status === 429) throw quota(retry);
            throw new RoutingUnavailable(undefined, response.status >= 500 ? retry : undefined);
          }
          const rows = decode(await response.json(), batch);
          signal.throwIfAborted();
          const at = new Date().toISOString();
          rows.forEach((row, i) => row.forEach((seconds, j) => {
            for (const index of batch.indexes[i][j]) {
              cells[index] = seconds;
              request.onObservation?.(index, seconds, at);
            }
          }));
        }
        return cells;
      } catch (error) {
        if (error instanceof TransientFailure || error instanceof RoutingResultError || error instanceof RoutingUnavailable) throw error;
        // Transport errors may carry the URL (including the key) or provider text.
        throw new RoutingUnavailable();
      }
    },
  };
}
