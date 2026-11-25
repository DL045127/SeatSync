// Immutable routing evidence stored with an address preview, and its public
// summary (docs/ARCHITECTURE-v2.md sections 4 and 5). The evidence is private:
// display reads never select it. It is validated on publication and at commit,
// where a corrupt row must fail safely and leave the prior plan intact.

import { z } from "zod";
import { ALGORITHM_VERSION } from "../matching/index.ts";
import {
  AddressEvidenceError,
  type AddressPoint,
  type AddressRoster,
  type Leg,
  demandAndSupply,
  identicalCoordinates,
  legKey,
  requiredPairs,
} from "../matching/address.ts";

export const EVIDENCE_SCHEMA = "address-evidence-1";

/** Preview identifier for address trips: solver, evidence schema and routing policy. */
export function addressAlgorithmId(policyId: string): string {
  return `${ALGORITHM_VERSION}+${EVIDENCE_SCHEMA}+${policyId}`;
}

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const isoMillis = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

const point = z
  .object({
    id: uuid,
    providerRef: z.string().min(1).max(120),
    lon: z.number().finite().gte(-180).lte(180),
    lat: z.number().finite().gte(-90).lte(90),
  })
  .strict();

const evidenceSchema = z
  .object({
    schema: z.literal(EVIDENCE_SCHEMA),
    policy: z.string().min(1).max(200),
    venue: point,
    drivers: z
      .array(
        z
          .object({
            id: uuid,
            location: point,
            seats: z.number().int().gte(1).lte(8),
            maxDetourMinutes: z.number().int().gte(0).lte(120),
          })
          .strict(),
      )
      .max(20),
    passengers: z.array(z.object({ id: uuid, location: point }).strict()).max(50),
    legs: z
      .array(
        z
          .object({
            from: uuid,
            to: uuid,
            seconds: z.number().finite().gte(0).lte(1_000_000).nullable(),
            source: z.enum(["provider", "identical_endpoint"]),
            observedAt: isoMillis.nullable(),
          })
          .strict(),
      )
      .max(1_100),
  })
  .strict();
export type AddressEvidence = z.infer<typeof evidenceSchema>;

const summarySchema = z
  .object({
    costUnit: z.literal("detour_seconds"),
    provider: z.enum(["fixture", "geoapify"]),
    routingPolicy: z.string().min(1).max(200),
    observedFrom: isoMillis.nullable(),
    observedTo: isoMillis.nullable(),
    legs: z
      .object({
        required: z.number().int().gte(0),
        fetched: z.number().int().gte(0),
        reused: z.number().int().gte(0),
        local: z.number().int().gte(0),
      })
      .strict(),
  })
  .strict();
export type EstimateSummary = z.infer<typeof summarySchema>;

/** Validate a stored summary for a display read (no evidence column involved). */
export function parseSummary(value: unknown): EstimateSummary {
  return summarySchema.parse(value);
}

function pointOf(p: AddressPoint) {
  return { id: p.id, providerRef: p.providerRef, lon: p.lon, lat: p.lat };
}

/** Assemble the evidence for the participants and legs a solve used. */
export function buildEvidence(
  roster: AddressRoster,
  policy: string,
  legs: ReadonlyMap<string, Leg>,
): AddressEvidence {
  const { drivers, passengers } = demandAndSupply(roster);
  const used = requiredPairs(roster).map((pair) => {
    const leg = legs.get(legKey(pair.from.id, pair.to.id));
    if (!leg) throw new AddressEvidenceError("A required directed leg has no observation.");
    return { from: leg.from, to: leg.to, seconds: leg.seconds, source: leg.source, observedAt: leg.observedAt };
  });
  const evidence: AddressEvidence = {
    schema: EVIDENCE_SCHEMA,
    policy,
    venue: pointOf(roster.venue),
    drivers: drivers.map((d) => ({
      id: d.id,
      location: pointOf(d.location),
      seats: d.seatCapacity,
      maxDetourMinutes: d.maxDetourMinutes,
    })),
    passengers: passengers.map((p) => ({ id: p.id, location: pointOf(p.location) })),
    legs: used,
  };
  return evidenceSchema.parse(evidence);
}

export function buildSummary(
  provider: "fixture" | "geoapify",
  policy: string,
  evidence: AddressEvidence,
  counts: { fetched: number; reused: number },
): EstimateSummary {
  const observed = evidence.legs
    .map((l) => l.observedAt)
    .filter((t): t is string => t !== null)
    .sort();
  return summarySchema.parse({
    costUnit: "detour_seconds",
    provider,
    routingPolicy: policy,
    observedFrom: observed[0] ?? null,
    observedTo: observed[observed.length - 1] ?? null,
    legs: {
      required: evidence.legs.length,
      fetched: counts.fetched,
      reused: counts.reused,
      local: evidence.legs.filter((l) => l.source === "identical_endpoint").length,
    },
  });
}

function samePoint(a: AddressPoint, b: AddressPoint): boolean {
  return a.id === b.id && a.providerRef === b.providerRef && a.lon === b.lon && a.lat === b.lat;
}

/**
 * Decode stored evidence and prove it matches the CURRENT roster: policy,
 * venue, the exact participant mapping and thresholds, and exactly the
 * required directed legs, each well formed. Anything else is corrupt server
 * evidence (an invariant failure), never a plan to trust.
 */
export function validateEvidence(
  raw: unknown,
  roster: AddressRoster,
  expectedPolicy: string,
): Map<string, Leg> {
  const parsed = evidenceSchema.safeParse(raw);
  if (!parsed.success) throw new AddressEvidenceError("Stored routing evidence is malformed.");
  const evidence = parsed.data;
  if (evidence.policy !== expectedPolicy) throw new AddressEvidenceError("Stored routing evidence has another policy.");
  if (!samePoint(evidence.venue, roster.venue)) throw new AddressEvidenceError("Stored evidence has another venue.");

  const { drivers, passengers } = demandAndSupply(roster);
  const sorted = <T extends { id: string }>(items: readonly T[]) => [...items].sort((a, b) => (a.id < b.id ? -1 : 1));
  const storedDrivers = sorted(evidence.drivers);
  const currentDrivers = sorted(drivers);
  if (storedDrivers.length !== currentDrivers.length
    || storedDrivers.some((d, i) => {
      const c = currentDrivers[i];
      return d.id !== c.id || d.seats !== c.seatCapacity || d.maxDetourMinutes !== c.maxDetourMinutes
        || !samePoint(d.location, c.location);
    })) {
    throw new AddressEvidenceError("Stored evidence does not match the current drivers.");
  }
  const storedPassengers = sorted(evidence.passengers);
  const currentPassengers = sorted(passengers);
  if (storedPassengers.length !== currentPassengers.length
    || storedPassengers.some((p, i) => p.id !== currentPassengers[i].id
      || !samePoint(p.location, currentPassengers[i].location))) {
    throw new AddressEvidenceError("Stored evidence does not match the current passengers.");
  }

  const required = new Map(requiredPairs(roster).map((pair) => [legKey(pair.from.id, pair.to.id), pair]));
  const legs = new Map<string, Leg>();
  for (const stored of evidence.legs) {
    const key = legKey(stored.from, stored.to);
    const pair = required.get(key);
    if (!pair) throw new AddressEvidenceError("Stored evidence has a leg this solve does not need.");
    if (legs.has(key)) throw new AddressEvidenceError("Stored evidence repeats a directed leg.");
    const identical = identicalCoordinates(pair.from, pair.to);
    if (identical !== (stored.source === "identical_endpoint")) {
      throw new AddressEvidenceError("Stored evidence misclassifies an identical endpoint.");
    }
    if (stored.source === "identical_endpoint"
      ? stored.seconds !== 0 || stored.observedAt !== null
      : stored.observedAt === null) {
      throw new AddressEvidenceError("Stored evidence has a malformed observation.");
    }
    legs.set(key, stored);
  }
  if (legs.size !== required.size) throw new AddressEvidenceError("Stored evidence is missing a required leg.");
  return legs;
}
