// Strict shared request/response contracts and the request fingerprint.
// Safe for client and server use: no credentials or SQL imports. Normalization
// lives in ./normalize so a single shared serializer defines fingerprint bytes.

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalJson,
  normalizeInteger,
  normalizeLabel,
  normalizeTimestamp,
  normalizeUuid,
} from "./normalize.ts";

// Architecture section 2 limits.
export const LIMITS = {
  driversPerTrip: 20,
  passengersPerTrip: 50,
  seatMin: 0,
  seatMax: 8,
  maxZones: 16,
  costMin: 0,
  costMax: 10_000,
  tripNameCodePoints: 80,
  participantNameCodePoints: 80,
  destinationCodePoints: 120,
  versionMin: 0,
  // PostgreSQL `integer` is signed 32-bit; the `version`/`base_version`
  // columns use it, so the contract maximum must match the column, not an
  // unsigned 32-bit range.
  versionMax: 2 ** 31 - 1,
  // Address trips (docs/ARCHITECTURE-v2.md section 1): the per-pair extra
  // driving limit a driver accepts, in whole minutes.
  detourMinutesMin: 0,
  detourMinutesMax: 120,
} as const;

// The Zod schemas below are shape-only building blocks and are intentionally
// NOT exported. The route-facing API is the `normalize*` helpers, which are the
// single validation and canonicalization path: they apply NFC/trim/code-point
// label rules, calendar-validated timestamps, zone-enum checks, and numeric
// canonicalization that a shape schema cannot express, and they always return a
// body whose fingerprint matches what a client built from the shared contract.
// Keeping the schemas private removes the whole class of "a route parsed the
// raw schema and skipped normalization" defects by construction. `strict()`
// rejects unknown fields.

/**
 * A finite integer within an inclusive range. Rejects fractional and nonfinite
 * values, and canonicalizes -0 to 0 so schema output matches the helpers.
 */
function boundedInt(min: number, max: number) {
  return z
    .number()
    .int()
    .gte(min)
    .lte(max)
    .transform((n) => (n === 0 ? 0 : n));
}

const versionInt = boundedInt(LIMITS.versionMin, LIMITS.versionMax);
const seatInt = boundedInt(LIMITS.seatMin, LIMITS.seatMax);
const detourInt = boundedInt(LIMITS.detourMinutesMin, LIMITS.detourMinutesMax);

/** A canonical lowercase UUID. Accepts mixed case and lowercases it. */
const canonicalUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform((v) => v.toLowerCase());

// Each mutation has a zone form (deployed since W2, fingerprint-stable) and an
// address form. The two are disjoint by their keys and each is strict, so a
// mixed body fails validation. A selection token is an opaque string here: it
// is NOT trimmed, decoded or re-serialized, so its exact bytes enter the
// fingerprint; its size, signature and scope are judged inside keyed work.
const zoneCreateTripSchema = z
  .object({
    name: z.string(),
    destinationLabel: z.string(),
    departAt: z.string(),
  })
  .strict();

const addressCreateTripSchema = z
  .object({
    name: z.string(),
    departAt: z.string(),
    locationMode: z.literal("address"),
    venueSelectionToken: z.string(),
  })
  .strict();

const zoneAddDriverSchema = z
  .object({
    name: z.string(),
    zoneId: z.string(),
    seatCapacity: seatInt,
  })
  .strict();

const addressAddDriverSchema = z
  .object({
    name: z.string(),
    startSelectionToken: z.string(),
    seatCapacity: seatInt,
    maxDetourMinutes: detourInt,
  })
  .strict();

const zoneAddRequestSchema = z
  .object({
    name: z.string(),
    zoneId: z.string(),
  })
  .strict();

const addressAddRequestSchema = z
  .object({
    name: z.string(),
    pickupSelectionToken: z.string(),
  })
  .strict();

const driverDetailsSchema = z.union([
  zoneAddDriverSchema,
  addressAddDriverSchema.partial({ startSelectionToken: true }),
]);
const passengerDetailsSchema = z.union([
  zoneAddRequestSchema,
  addressAddRequestSchema.partial({ pickupSelectionToken: true }),
]);
const editDriverSchema = z.union([
  z.object({ baseVersion: versionInt, seatCapacity: seatInt }).strict(),
  z.object({ baseVersion: versionInt, active: z.literal(false) }).strict(),
  z.object({ baseVersion: versionInt, details: driverDetailsSchema }).strict(),
]);

const withdrawRequestSchema = z
  .object({ baseVersion: versionInt, active: z.literal(false) })
  .strict();
const editRequestSchema = z.union([
  withdrawRequestSchema,
  z.object({ baseVersion: versionInt, details: passengerDetailsSchema }).strict(),
]);

const commitSchema = z.object({ previewId: canonicalUuid }).strict();
const clearPlanSchema = z.object({ baseVersion: versionInt }).strict();

const guestLeaveSchema = z.object({
  role: z.enum(["driver", "passenger"]),
  token: canonicalUuid,
}).strict();

export function normalizeGuestLeave(raw: unknown) {
  const { role, token } = guestLeaveSchema.parse(raw);
  return { role, token: normalizeUuid(token) };
}

export type GuestTripStatus =
  | { state: "left" | "awaiting_plan" }
  | { state: "saved_plan"; assignedCount: number };

export function normalizeClearPlan(raw: unknown): { baseVersion: number } {
  return clearPlanSchema.parse(raw);
}

export interface NormalizedZoneCreateTrip {
  name: string;
  destinationLabel: string;
  departAt: string;
}

export interface NormalizedAddressCreateTrip {
  name: string;
  departAt: string;
  locationMode: "address";
  venueSelectionToken: string;
}

export type NormalizedCreateTrip = NormalizedZoneCreateTrip | NormalizedAddressCreateTrip;

export function isAddressCreateTrip(body: NormalizedCreateTrip): body is NormalizedAddressCreateTrip {
  return "locationMode" in body;
}

/**
 * Parse and normalize a create-trip body. Validation of structure happens with
 * Zod; label/timestamp normalization and code-point checks happen afterward so
 * the fingerprint sees canonical values. The zone form is byte-for-byte the
 * deployed one.
 */
export function normalizeCreateTrip(raw: unknown): NormalizedCreateTrip {
  if (isAddressForm(raw, "locationMode")) {
    const parsed = addressCreateTripSchema.parse(raw);
    return {
      name: normalizeLabel(parsed.name, LIMITS.tripNameCodePoints),
      departAt: normalizeTimestamp(parsed.departAt),
      locationMode: "address",
      venueSelectionToken: parsed.venueSelectionToken,
    };
  }
  const parsed = zoneCreateTripSchema.parse(raw);
  return {
    name: normalizeLabel(parsed.name, LIMITS.tripNameCodePoints),
    destinationLabel: normalizeLabel(
      parsed.destinationLabel,
      LIMITS.destinationCodePoints,
    ),
    departAt: normalizeTimestamp(parsed.departAt),
  };
}

/** True when the raw body carries an address-form key, so it must parse as that form. */
function isAddressForm(raw: unknown, ...keys: string[]): boolean {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    && keys.some((key) => key in raw);
}

export interface NormalizedZoneAddDriver {
  name: string;
  zoneId: string;
  seatCapacity: number;
}

export interface NormalizedAddressAddDriver {
  name: string;
  startSelectionToken: string;
  seatCapacity: number;
  maxDetourMinutes: number;
}

export type NormalizedAddDriver = NormalizedZoneAddDriver | NormalizedAddressAddDriver;

export function isAddressAddDriver(body: NormalizedAddDriver): body is NormalizedAddressAddDriver {
  return "startSelectionToken" in body;
}

/** Zone IDs must match the seeded enum exactly; the caller supplies it. */
export function normalizeAddDriver(
  raw: unknown,
  knownZoneIds: ReadonlySet<string>,
): NormalizedAddDriver {
  if (isAddressForm(raw, "startSelectionToken", "maxDetourMinutes")) {
    const parsed = addressAddDriverSchema.parse(raw);
    return {
      name: normalizeLabel(parsed.name, LIMITS.participantNameCodePoints),
      startSelectionToken: parsed.startSelectionToken,
      seatCapacity: normalizeInteger(parsed.seatCapacity, LIMITS.seatMin, LIMITS.seatMax),
      maxDetourMinutes: normalizeInteger(
        parsed.maxDetourMinutes,
        LIMITS.detourMinutesMin,
        LIMITS.detourMinutesMax,
      ),
    };
  }
  const parsed = zoneAddDriverSchema.parse(raw);
  return {
    name: normalizeLabel(parsed.name, LIMITS.participantNameCodePoints),
    zoneId: normalizeZoneId(parsed.zoneId, knownZoneIds),
    seatCapacity: normalizeInteger(
      parsed.seatCapacity,
      LIMITS.seatMin,
      LIMITS.seatMax,
    ),
  };
}

export interface NormalizedZoneAddRequest {
  name: string;
  zoneId: string;
}

export interface NormalizedAddressAddRequest {
  name: string;
  pickupSelectionToken: string;
}

export type NormalizedAddRequest = NormalizedZoneAddRequest | NormalizedAddressAddRequest;

export function isAddressAddRequest(body: NormalizedAddRequest): body is NormalizedAddressAddRequest {
  return "pickupSelectionToken" in body;
}

export function normalizeAddRequest(
  raw: unknown,
  knownZoneIds: ReadonlySet<string>,
): NormalizedAddRequest {
  if (isAddressForm(raw, "pickupSelectionToken")) {
    const parsed = addressAddRequestSchema.parse(raw);
    return {
      name: normalizeLabel(parsed.name, LIMITS.participantNameCodePoints),
      pickupSelectionToken: parsed.pickupSelectionToken,
    };
  }
  const parsed = zoneAddRequestSchema.parse(raw);
  return {
    name: normalizeLabel(parsed.name, LIMITS.participantNameCodePoints),
    zoneId: normalizeZoneId(parsed.zoneId, knownZoneIds),
  };
}

export type NormalizedEditDriver =
  | { baseVersion: number; seatCapacity: number }
  | { baseVersion: number; active: false }
  | { baseVersion: number; details: z.infer<typeof driverDetailsSchema> };

/**
 * Parse and normalize a driver edit/cancel body. `baseVersion` is validated as
 * a nonnegative integer within the PostgreSQL version range, and a capacity
 * edit is validated as a 0..8 integer. A fractional or out-of-range value is
 * rejected rather than silently accepted.
 */
export function normalizeEditDriver(raw: unknown, knownZoneIds: ReadonlySet<string> = new Set()): NormalizedEditDriver {
  const parsed = editDriverSchema.parse(raw);
  const baseVersion = normalizeInteger(
    parsed.baseVersion,
    LIMITS.versionMin,
    LIMITS.versionMax,
  );
  if ("seatCapacity" in parsed) {
    return {
      baseVersion,
      seatCapacity: normalizeInteger(
        parsed.seatCapacity,
        LIMITS.seatMin,
        LIMITS.seatMax,
      ),
    };
  }
  if ("details" in parsed) {
    return { baseVersion, details: normalizeParticipantDetails(parsed.details, knownZoneIds) };
  }
  return { baseVersion, active: false };
}

function normalizeParticipantDetails<T extends { name: string; zoneId?: string }>(
  details: T, knownZoneIds: ReadonlySet<string>,
): T {
  const name = normalizeLabel(details.name, LIMITS.participantNameCodePoints);
  return {
    ...details,
    name,
    ...(details.zoneId !== undefined
      ? { zoneId: normalizeZoneId(details.zoneId, knownZoneIds) }
      : {}),
  };
}

export function normalizeEditRequest(raw: unknown, knownZoneIds: ReadonlySet<string>) {
  const parsed = editRequestSchema.parse(raw);
  return "details" in parsed
    ? { baseVersion: parsed.baseVersion, details: normalizeParticipantDetails(parsed.details, knownZoneIds) }
    : normalizeWithdrawRequest(parsed);
}

export interface NormalizedWithdrawRequest {
  baseVersion: number;
  active: false;
}

export function normalizeWithdrawRequest(raw: unknown): NormalizedWithdrawRequest {
  const parsed = withdrawRequestSchema.parse(raw);
  return {
    baseVersion: normalizeInteger(
      parsed.baseVersion,
      LIMITS.versionMin,
      LIMITS.versionMax,
    ),
    active: false,
  };
}

export interface NormalizedCommit {
  previewId: string;
}

/**
 * Parse and normalize a commit body. The preview ID must be a well-formed UUID
 * and is lowercased before it ever reaches the fingerprint, so two spellings of
 * the same UUID produce one fingerprint and an identical retry is not rejected
 * as a key conflict. Malformed IDs like "junk" are rejected here.
 */
export function normalizeCommit(raw: unknown): NormalizedCommit {
  const parsed = commitSchema.parse(raw);
  return { previewId: normalizeUuid(parsed.previewId) };
}

function normalizeZoneId(
  value: string,
  knownZoneIds: ReadonlySet<string>,
): string {
  if (!knownZoneIds.has(value)) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "Unknown zone.",
        path: ["zoneId"],
      },
    ]);
  }
  return value;
}

export type CanonicalMethod = "POST" | "PATCH" | "GET";

/**
 * `request-v1` fingerprint = SHA-256 of UTF-8 JSON for
 * ["request-v1", uppercaseMethod, canonicalRoute, normalizedBody].
 * The canonical route must already have normalized path IDs, no query string,
 * and no trailing slash.
 */
export function requestFingerprint(
  method: CanonicalMethod,
  canonicalRoute: string,
  normalizedBody: unknown,
): string {
  const payload = canonicalJson([
    "request-v1",
    method.toUpperCase(),
    canonicalRoute,
    normalizedBody,
  ]);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export { normalizeUuid };
