// Eval-only preview telemetry (W5/P-01). When enabled, publishPreview records
// one record per request: whether the stored preview was reused (cacheHit) or
// freshly computed, and the pure matcher duration in milliseconds when it
// computed. A monitorEventLoopDelay histogram tracks loop latency across the
// run. Nothing here runs unless explicitly enabled; production preview serving
// is unaffected and the public response contract is unchanged.
//
// This exists because the architecture's P-01 requires recording matcher
// duration, cache hits, and event-loop delay — server-internal facts a
// black-box HTTP client cannot see. The eval route drains these records.

import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

export interface PreviewTelemetryRecord {
  cacheHit: boolean;
  matcherMs: number | null; // null on a cache hit (no computation ran)
}

let enabled = false;
let records: PreviewTelemetryRecord[] = [];
let loopDelay: IntervalHistogram | undefined;

/** Enabled once at server start for the eval build; no-op otherwise. */
export function enablePreviewTelemetry(): void {
  if (enabled) return;
  enabled = true;
  loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
}

export function isPreviewTelemetryEnabled(): boolean {
  return enabled;
}

export function recordPreview(record: PreviewTelemetryRecord): void {
  if (enabled) records.push(record);
}

/**
 * Start a fresh measurement window: discard any records collected so far
 * (warmup/idle) and reset the event-loop-delay histogram so its percentiles
 * reflect only the window that follows. The P-01 harness calls this right
 * before the measured under-load phase.
 */
export function resetPreviewTelemetry(): void {
  records = [];
  loopDelay?.reset();
}

/** Drain the collected records and the current event-loop-delay percentiles. */
export function drainPreviewTelemetry(): {
  records: PreviewTelemetryRecord[];
  eventLoopDelayMs: { p50: number; p95: number; max: number } | null;
} {
  const drained = records;
  records = [];
  const h = loopDelay;
  const toMs = (ns: number) => Number((ns / 1e6).toFixed(3));
  const eventLoopDelayMs = h
    ? { p50: toMs(h.percentile(50)), p95: toMs(h.percentile(95)), max: toMs(h.max) }
    : null;
  return { records: drained, eventLoopDelayMs };
}
