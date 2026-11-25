// Location snapshots and selection purposes (docs/ARCHITECTURE-v2.md sections 3
// and 4). A snapshot is an allowlisted, immutable copy of a confirmed place; a
// trip, driver or ride request stores one, so a saved plan keeps the exact
// entrance that was confirmed. No credentials, SQL or filesystem access here.

import { z } from "zod";
import { StoredDataError } from "../contracts/errors.ts";

export const PURPOSES = ["venue", "driver_start", "pickup"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const PROVIDERS = ["fixture", "geoapify"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

/** Precisions a person may select. City, ZIP and street-only results may not. */
export const USABLE_PRECISIONS = ["entrance", "building"] as const;
export type UsablePrecision = (typeof USABLE_PRECISIONS)[number];
export type Precision = UsablePrecision | "street" | "city";

export const SNAPSHOT_LIMITS = {
  labelCodePoints: 120,
  addressPartCodePoints: 80,
  providerRefCodePoints: 120,
  attributionCodePoints: 160,
} as const;

const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .refine((v) => Array.from(v).length <= max, "Text is too long.")
    // Control characters have no place in a stored address.
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "Control characters are not allowed.");

const canonicalUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

const coordinate = (min: number, max: number) =>
  z.number().finite().gte(min).lte(max);

/** The part of a snapshot a token carries; the location ID and issue time sit in the payload. */
export const snapshotBodySchema = z
  .object({
    providerRef: boundedText(SNAPSHOT_LIMITS.providerRefCodePoints),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    label: boundedText(SNAPSHOT_LIMITS.labelCodePoints),
    address: z
      .object({
        street: boundedText(SNAPSHOT_LIMITS.addressPartCodePoints).optional(),
        city: boundedText(SNAPSHOT_LIMITS.addressPartCodePoints).optional(),
        state: boundedText(SNAPSHOT_LIMITS.addressPartCodePoints).optional(),
        postcode: boundedText(SNAPSHOT_LIMITS.addressPartCodePoints).optional(),
      })
      .strict(),
    // Longitude/latitude order is explicit by field name at every boundary.
    lon: coordinate(-180, 180),
    lat: coordinate(-90, 90),
    precision: z.enum(USABLE_PRECISIONS),
    attribution: boundedText(SNAPSHOT_LIMITS.attributionCodePoints),
  })
  .strict();
export type SnapshotBody = z.infer<typeof snapshotBodySchema>;

/** The stored snapshot: the token body plus its immutable ID, provider and issue time. */
export const locationSnapshotSchema = snapshotBodySchema
  .extend({
    id: canonicalUuid,
    provider: z.enum(PROVIDERS),
    issuedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      .refine((v) => {
        const t = Date.parse(v);
        return Number.isFinite(t) && new Date(t).toISOString() === v;
      }, "Not a real calendar instant."),
  })
  .strict();
export type LocationSnapshot = z.infer<typeof locationSnapshotSchema>;

/**
 * Copy exactly the allowlisted fields of a verified body into a stored
 * snapshot. A parsed object could carry nothing else (the schemas are strict),
 * but building the result field by field keeps that property independent of the
 * schema's own behavior.
 */
export function toStoredSnapshot(
  body: SnapshotBody,
  attach: { id: string; provider: ProviderName; issuedAtMs: number },
): LocationSnapshot {
  const address: SnapshotBody["address"] = {};
  if (body.address.street !== undefined) address.street = body.address.street;
  if (body.address.city !== undefined) address.city = body.address.city;
  if (body.address.state !== undefined) address.state = body.address.state;
  if (body.address.postcode !== undefined) address.postcode = body.address.postcode;
  return locationSnapshotSchema.parse({
    id: attach.id,
    provider: attach.provider,
    providerRef: body.providerRef,
    countryCode: body.countryCode,
    label: body.label,
    address,
    lon: body.lon,
    lat: body.lat,
    precision: body.precision,
    attribution: body.attribution,
    issuedAt: new Date(attach.issuedAtMs).toISOString(),
  });
}

/**
 * Parse a snapshot read back from the database. Malformed stored data is a
 * server-side failure (StoredDataError), not a ZodError: the HTTP layer reports
 * a ZodError as a 400 about the request, which a corrupt row is not.
 */
export function parseStoredSnapshot(value: unknown): LocationSnapshot {
  const parsed = locationSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new StoredDataError("A stored location snapshot is malformed.", parsed.error);
  return parsed.data;
}
