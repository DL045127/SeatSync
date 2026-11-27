// Server-side Route Matrix v1 transport. Endpoint and credentials never come
// from the trip, browser request or stored selection.
import { requestProviderJson } from "../geoapify/transport.ts";
import { processLimit, quota, retrySeconds, type GeoapifyRateLimit } from "../geoapify/quota.ts";
export { GeoapifyRateLimit } from "../geoapify/quota.ts";
import { TransientFailure } from "../contracts/errors.ts";
import { RoutingResultError, RoutingUnavailable, validateCells, type ObservedCell, type RoutingAdapter } from "./adapter.ts";
import { matrixBatches, type MatrixBatch } from "./matrix.ts";

const profile = { mode: "drive", traffic: "free_flow", type: "balanced", units: "metric", max_speed: 140 };
export const GEOAPIFY_POLICY_ID = "geoapify/routematrix-v1/drive/free_flow/balanced/metric/140/avoid-none/directed-seconds-null/1";
const endpoint = "https://api.geoapify.com/v1/routematrix";

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

const loopbackAdapters = new WeakSet<RoutingAdapter>();

export function isLoopbackRoutingAdapter(adapter: RoutingAdapter): boolean {
  return loopbackAdapters.has(adapter);
}

export function geoapifyRoutingAdapter(options: AdapterOptions = {}): RoutingAdapter {
  const limit = options.limit ?? processLimit;
  const adapter: RoutingAdapter = {
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
          const response = await requestProviderJson(url, signal, JSON.stringify({
            ...profile,
            sources: batch.sources.map((location) => ({ location })),
            targets: batch.targets.map((location) => ({ location })),
          }));
          if (response.status < 200 || response.status >= 300) {
            const retry = retrySeconds(response.retryAfter);
            if (response.status === 429) limit.backoff(retry ?? 1);
            if (response.status === 429) throw quota(retry);
            throw new RoutingUnavailable(undefined, response.status >= 500 ? retry : undefined);
          }
          const rows = decode(response.data, batch);
          const observed: ObservedCell[] = [];
          const at = new Date().toISOString();
          rows.forEach((row, i) => row.forEach((seconds, j) => {
            for (const index of batch.indexes[i][j]) {
              cells[index] = seconds;
              observed.push({ index, seconds });
            }
          }));
          request.onBatch?.(observed, at);
          signal.throwIfAborted();
        }
        return cells;
      } catch (error) {
        if (error instanceof TransientFailure || error instanceof RoutingResultError || error instanceof RoutingUnavailable) throw error;
        // Transport errors may carry the URL (including the key) or provider text.
        throw new RoutingUnavailable();
      }
    },
  };
  if (options.endpoint && ["127.0.0.1", "[::1]"].includes(new URL(options.endpoint).hostname)) {
    loopbackAdapters.add(adapter);
  }
  return adapter;
}
