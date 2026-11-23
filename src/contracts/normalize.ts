// Shared normalization used by both client and server request contracts.
// This module has no database, network, or framework dependencies.
// Changing its semantics is a deliberate compatibility change, not a silent
// reinterpretation of already-stored receipts; the fixed vectors in
// tests/contracts/ pin the behavior.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class NormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormalizationError";
  }
}

/** Lowercase a well-formed UUID; reject anything else. */
export function normalizeUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new NormalizationError("Expected a UUID.");
  }
  return value.toLowerCase();
}

/**
 * Normalize a label with Unicode NFC, trim surrounding whitespace, then
 * validate the code-point length. `maxCodePoints` is counted after trimming.
 */
export function normalizeLabel(value: unknown, maxCodePoints: number): string {
  if (typeof value !== "string") {
    throw new NormalizationError("Expected a string label.");
  }
  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0) {
    throw new NormalizationError("Label must be nonempty after trimming.");
  }
  const codePoints = [...normalized].length;
  if (codePoints > maxCodePoints) {
    throw new NormalizationError(
      `Label exceeds ${maxCodePoints} code points.`,
    );
  }
  return normalized;
}

/**
 * Validate a timestamp as a real calendar date with an explicit offset and at
 * most millisecond precision, then normalize to UTC ISO milliseconds.
 */
// Strict ISO 8601 date-time with an explicit offset and at most millisecond
// precision. The whole string must match; `Date` parsing alone is too lax (it
// accepts English month names and silently rolls over 2026-02-29 to March 1).
// Seconds are optional ("at most millisecond precision" does not require an
// explicit seconds field); the fractional part needs seconds to be present.
const ISO_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function normalizeTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    throw new NormalizationError("Expected an ISO timestamp string.");
  }
  const match = ISO_TIMESTAMP_RE.exec(value);
  if (!match) {
    throw new NormalizationError(
      "Timestamp must be ISO 8601 with an explicit offset and at most millisecond precision.",
    );
  }
  const [, y, mo, d, h, mi, s, , offset] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);

  // Validate the calendar components before any conversion, so an invalid date
  // (2026-02-29, 2026-04-31, 2026-13-01) is rejected rather than rolled over.
  if (month < 1 || month > 12) {
    throw new NormalizationError("Timestamp month is out of range.");
  }
  let maxDay = DAYS_IN_MONTH[month - 1];
  if (month === 2 && isLeapYear(year)) maxDay = 29;
  if (day < 1 || day > maxDay) {
    throw new NormalizationError("Timestamp day is out of range for the month.");
  }
  // Allow 23:59:59; leap seconds (:60) are not supported by the Date model.
  if (hour > 23 || minute > 59 || second > 59) {
    throw new NormalizationError("Timestamp time-of-day is out of range.");
  }
  if (offset !== "Z") {
    const offHour = Number(offset.slice(1, 3));
    const offMinute = Number(offset.slice(4, 6));
    if (offHour > 23 || offMinute > 59) {
      throw new NormalizationError("Timestamp offset is out of range.");
    }
  }

  const epoch = new Date(value).getTime();
  if (!Number.isFinite(epoch)) {
    throw new NormalizationError("Timestamp is not a valid calendar date.");
  }
  // The canonical output must itself be a supported four-digit-year ISO string
  // so that re-normalizing an accepted value (the browser sends the normalized
  // body, which the server validates again) is idempotent. An offset can push
  // the UTC instant into an extended year (e.g. 9999-12-31T…-01:00 ->
  // +010000-…), which `toISOString` renders with a six-digit year that the
  // input pattern rejects. Reject such inputs on the first pass instead.
  const canonical = new Date(epoch).toISOString();
  if (!ISO_TIMESTAMP_RE.test(canonical)) {
    throw new NormalizationError(
      "Timestamp converts to an unsupported UTC year outside 0000-9999.",
    );
  }
  return canonical;
}

/**
 * Normalize a bounded integer. Rejects nonfinite and fractional values, and
 * maps numeric -0 to 0. Bounds are inclusive.
 */
export function normalizeInteger(
  value: unknown,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new NormalizationError("Expected a finite number.");
  }
  if (!Number.isInteger(value)) {
    throw new NormalizationError("Expected an integer.");
  }
  const normalized = value === 0 ? 0 : value; // collapses -0 to 0
  if (normalized < min || normalized > max) {
    throw new NormalizationError(`Integer out of range [${min}, ${max}].`);
  }
  return normalized;
}

/**
 * Canonical JSON serialization for fingerprints: recursively sort object keys
 * lexicographically, preserve array order, and serialize using JSON string and
 * number rules. Rejects values JSON cannot represent (undefined, functions,
 * nonfinite numbers). -0 is serialized as 0.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "string") return JSON.stringify(value);
  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") {
    if (!Number.isFinite(value as number)) {
      throw new NormalizationError("Cannot serialize a nonfinite number.");
    }
    return JSON.stringify((value as number) === 0 ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(",")}]`;
  }
  if (type === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`)
      .join(",")}}`;
  }
  throw new NormalizationError(`Cannot serialize value of type ${type}.`);
}
