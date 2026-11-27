// Immutable routing evidence stored with an address preview, and its public
// summary (docs/ARCHITECTURE-v2.md sections 4 and 5). The evidence is private:
// display reads never select it. It is validated on publication, when it is
// offered for reuse, and at commit, where a corrupt row must fail safely and
// leave the prior plan intact.
//
// Schema `address-evidence-2` stores the RETAINED legs: every directed leg the
// solve required, plus the earlier observations still worth keeping for active
// participants (notably a zero-seat driver who may regain capacity). Only the
// required legs ever enter the projection.

import { z } from "zod";
import { StoredDataError } from "../contracts/errors.ts";
import { ALGORITHM_VERSION } from "../matching/index.ts";
import {
  AddressEvidenceError,
  type AddressPoint,
  type AddressRoster,
  type Leg,
  identicalCoordinates,
  legKey,
  requiredPairs,
  retentionPairs,
} from "../matching/address.ts";

export const EVIDENCE_SCHEMA = "address-evidence-2";

/** Preview identifier for address trips: solver, evidence schema and routing policy. */
export function addressAlgorithmId(policyId: string): string {
  return `${ALGORITHM_VERSION}+${EVIDENCE_SCHEMA}+${policyId}`;
}

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
/** A real instant in canonical form: the shape alone would admit month 19 or 24:00 (ISSUE-072). */
export const isoMillis = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((v) => {
    const t = Date.parse(v);
    return Number.isFinite(t) && new Date(t).toISOString() === v;
  }, "Not a real calendar instant.");

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
    // EVERY active participant, including a driver offering zero seats.
    drivers: z
      .array(
        z
          .object({
            id: uuid,
            location: point,
            seats: z.number().int().gte(0).lte(8),
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

export interface SummaryContext {
  /** The routing policy the summary must carry (the stored row's, or the trip's current one for a hit). */
  routingPolicy?: string;
  /** The provider the trip is pinned to. */
  provider?: "fixture" | "geoapify";
  /** The preview or trip algorithm identifier, which must end in `+<routingPolicy>`. */
  algorithmVersion?: string;
}

/**
 * Validate a stored summary for a display read. It uses only the summary
 * column, never the private leg evidence, yet still proves the summary cannot
 * contradict itself or the row it belongs to: the counts partition the required
 * legs, the observation range exists exactly when provider legs were needed and
 * is ordered, and the policy and provider are the applicable ones. Anything else
 * is a server-side StoredDataError, never a ZodError (which the HTTP layer would
 * report as a 400 about the request).
 */
export function parseSummary(value: unknown, context: SummaryContext = {}): EstimateSummary {
  const parsed = summarySchema.safeParse(value);
  if (!parsed.success) throw new StoredDataError("A stored estimate summary is malformed.", parsed.error);
  const summary = parsed.data;
  const bad = (reason: string): never => {
    throw new StoredDataError(`A stored estimate summary ${reason}.`);
  };
  const { required, fetched, reused, local } = summary.legs;
  if (fetched + reused + local !== required) bad("has counts that do not add up to its required legs");
  const providerLegs = fetched + reused;
  const hasRange = summary.observedFrom !== null || summary.observedTo !== null;
  if (providerLegs === 0 ? hasRange : summary.observedFrom === null || summary.observedTo === null) {
    bad("has an observation range that disagrees with its provider legs");
  }
  if (summary.observedFrom !== null && summary.observedTo !== null && summary.observedFrom > summary.observedTo) {
    bad("has an observation range that runs backwards");
  }
  if (context.routingPolicy !== undefined && summary.routingPolicy !== context.routingPolicy) bad("names another routing policy");
  if (context.provider !== undefined && summary.provider !== context.provider) bad("names another provider");
  if (context.algorithmVersion !== undefined && !context.algorithmVersion.endsWith(`+${summary.routingPolicy}`)) {
    bad("does not match the algorithm identifier of its preview");
  }
  return summary;
}

function pointOf(p: AddressPoint) {
  return { id: p.id, providerRef: p.providerRef, lon: p.lon, lat: p.lat };
}

function samePoint(a: AddressPoint, b: AddressPoint): boolean {
  return a.id === b.id && a.providerRef === b.providerRef && a.lon === b.lon && a.lat === b.lat;
}

const byId = <T extends { id: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Assemble the evidence: all active participants and the retained legs, in key order. */
export function buildEvidence(
  roster: AddressRoster,
  policy: string,
  legs: ReadonlyMap<string, Leg>,
): AddressEvidence {
  const allowed = new Set(retentionPairs(roster).map((p) => legKey(p.from.id, p.to.id)));
  for (const key of legs.keys()) {
    if (!allowed.has(key)) throw new AddressEvidenceError("A leg outside the retention set cannot be stored.");
  }
  for (const pair of requiredPairs(roster)) {
    if (!legs.has(legKey(pair.from.id, pair.to.id))) {
      throw new AddressEvidenceError("A required directed leg has no observation.");
    }
  }
  const evidence: AddressEvidence = {
    schema: EVIDENCE_SCHEMA,
    policy,
    venue: pointOf(roster.venue),
    drivers: roster.drivers
      .filter((d) => d.active)
      .map((d) => ({
        id: d.id,
        location: pointOf(d.location),
        seats: d.seatCapacity,
        maxDetourMinutes: d.maxDetourMinutes,
      })),
    passengers: roster.passengers.filter((p) => p.active).map((p) => ({ id: p.id, location: pointOf(p.location) })),
    legs: [...legs.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, leg]) => ({
        from: leg.from,
        to: leg.to,
        seconds: leg.seconds,
        source: leg.source,
        observedAt: leg.observedAt,
      })),
  };
  return evidenceSchema.parse(evidence);
}

/**
 * The public summary describes ONLY the legs this solve needed: how many were
 * resolved locally as identical endpoints, carried over from an earlier preview
 * (provider observations only) or fetched now. Dormant retained legs and local
 * zeros are excluded from the provider observation range.
 */
export function buildSummary(
  provider: "fixture" | "geoapify",
  policy: string,
  requiredLegs: readonly Leg[],
  counts: { fetched: number; reused: number },
): EstimateSummary {
  const local = requiredLegs.filter((l) => l.source === "identical_endpoint").length;
  if (counts.fetched + counts.reused + local !== requiredLegs.length) {
    throw new AddressEvidenceError("Leg counts do not partition the required legs.");
  }
  const observed = requiredLegs
    .map((l) => l.observedAt)
    .filter((t): t is string => t !== null)
    .sort();
  return summarySchema.parse({
    costUnit: "detour_seconds",
    provider,
    routingPolicy: policy,
    observedFrom: observed[0] ?? null,
    observedTo: observed[observed.length - 1] ?? null,
    legs: { required: requiredLegs.length, fetched: counts.fetched, reused: counts.reused, local },
  });
}

/**
 * Commit-time proof that a preview's public summary describes ITS OWN evidence
 * (ISSUE-071): the required legs recomputed from the evidence must reproduce the
 * summary's totals, local count and observation range. The fetched/reused split
 * is a provenance fact the evidence cannot show, so only its sum is checked.
 */
export function assertSummaryMatchesEvidence(
  summary: EstimateSummary,
  legs: ReadonlyMap<string, Leg>,
  roster: AddressRoster,
  provider: "fixture" | "geoapify",
  policy: string,
): void {
  const required = requiredPairs(roster).map((pair) => {
    const leg = legs.get(legKey(pair.from.id, pair.to.id));
    if (!leg) throw new AddressEvidenceError("Stored evidence is missing a required leg.");
    return leg;
  });
  const expected = buildSummary(provider, policy, required, {
    fetched: summary.legs.fetched,
    reused: summary.legs.reused,
  });
  if (JSON.stringify(expected) !== JSON.stringify(summary)) {
    throw new AddressEvidenceError("The preview summary disagrees with its evidence.");
  }
}

/** Check one stored leg for internal well-formedness against its endpoints' coordinates. */
function checkLeg(
  stored: AddressEvidence["legs"][number],
  from: AddressPoint,
  to: AddressPoint,
): void {
  const identical = identicalCoordinates(from, to);
  if (identical !== (stored.source === "identical_endpoint")) {
    throw new AddressEvidenceError("Stored evidence misclassifies an identical endpoint.");
  }
  if (stored.source === "identical_endpoint"
    ? stored.seconds !== 0 || stored.observedAt !== null
    : stored.observedAt === null) {
    throw new AddressEvidenceError("Stored evidence has a malformed observation.");
  }
}

function parseEvidence(raw: unknown, expectedPolicy: string): AddressEvidence {
  const parsed = evidenceSchema.safeParse(raw);
  if (!parsed.success) throw new AddressEvidenceError("Stored routing evidence is malformed.");
  if (parsed.data.policy !== expectedPolicy) throw new AddressEvidenceError("Stored routing evidence has another policy.");
  return parsed.data;
}

/**
 * Decode stored evidence and prove it matches the CURRENT roster: policy, venue,
 * the exact participant mapping and thresholds, every stored leg is one this
 * roster may retain and is well formed, and every REQUIRED leg is present.
 * Anything else is corrupt server evidence (an invariant failure), never a plan
 * to trust. Returns every stored leg; only the required ones enter projection.
 */
export function validateEvidence(
  raw: unknown,
  roster: AddressRoster,
  expectedPolicy: string,
): Map<string, Leg> {
  const evidence = parseEvidence(raw, expectedPolicy);
  if (!samePoint(evidence.venue, roster.venue)) throw new AddressEvidenceError("Stored evidence has another venue.");

  const drivers = byId(roster.drivers.filter((d) => d.active));
  const storedDrivers = byId(evidence.drivers);
  if (storedDrivers.length !== drivers.length
    || storedDrivers.some((d, i) => {
      const c = drivers[i];
      return d.id !== c.id || d.seats !== c.seatCapacity || d.maxDetourMinutes !== c.maxDetourMinutes
        || !samePoint(d.location, c.location);
    })) {
    throw new AddressEvidenceError("Stored evidence does not match the current drivers.");
  }
  const passengers = byId(roster.passengers.filter((p) => p.active));
  const storedPassengers = byId(evidence.passengers);
  if (storedPassengers.length !== passengers.length
    || storedPassengers.some((p, i) => p.id !== passengers[i].id || !samePoint(p.location, passengers[i].location))) {
    throw new AddressEvidenceError("Stored evidence does not match the current passengers.");
  }

  const allowed = new Map(retentionPairs(roster).map((pair) => [legKey(pair.from.id, pair.to.id), pair]));
  const legs = new Map<string, Leg>();
  for (const stored of evidence.legs) {
    const key = legKey(stored.from, stored.to);
    const pair = allowed.get(key);
    if (!pair) throw new AddressEvidenceError("Stored evidence has a leg this roster does not retain.");
    if (legs.has(key)) throw new AddressEvidenceError("Stored evidence repeats a directed leg.");
    checkLeg(stored, pair.from, pair.to);
    legs.set(key, stored);
  }
  for (const pair of requiredPairs(roster)) {
    if (!legs.has(legKey(pair.from.id, pair.to.id))) {
      throw new AddressEvidenceError("Stored evidence is missing a required leg.");
    }
  }
  return legs;
}

/**
 * Validate an EARLIER preview's evidence offered for reuse by a later roster.
 * The earlier roster differs, so the participant mapping is not compared; the
 * candidate must instead be internally consistent (every leg joins two of its
 * own recorded endpoints in a legal role, with well-formed observations) and
 * must agree with the current trip or its verified address history about every location identity it names:
 * a location ID fixes its coordinates for the life of the trip, so any
 * disagreement, or a location this trip never had, means a wrong trip or
 * corruption. Returns the candidate's legs by key, or throws
 * AddressEvidenceError, in which case the caller discards the whole candidate.
 */
export function validateCandidate(
  raw: unknown,
  roster: AddressRoster,
  expectedPolicy: string,
  history?: {
    baseVersion: number;
    since: ReadonlyMap<string, number>;
    /** All replacements after baseVersion, in ascending version order. */
    replacements: readonly { participant_kind: "driver" | "passenger"; participant_id: string; location: AddressPoint }[];
  },
): Map<string, Leg> {
  const evidence = parseEvidence(raw, expectedPolicy);
  const drivers = new Map(roster.drivers.map(d => [d.id, d.location]));
  const passengers = new Map(roster.passengers.map(p => [p.id, p.location]));
  const replaced = new Map<string, AddressPoint>();
  for (const row of history?.replacements ?? []) {
    const key = `${row.participant_kind}:${row.participant_id}`;
    if (!replaced.has(key)) replaced.set(key, row.location);
  }

  const agrees = (kind: "driver" | "passenger", id: string, candidate: AddressPoint) => {
    const current = (kind === "driver" ? drivers : passengers).get(id);
    const key = `${kind}:${id}`;
    const atVersion = replaced.get(key) ?? current;
    if (history && (history.since.get(key) ?? Infinity) > history.baseVersion) {
      throw new AddressEvidenceError("Cannot verify this participant at the stored preview version.");
    }
    if (!atVersion || !samePoint(atVersion, candidate)) {
      throw new AddressEvidenceError("Stored evidence disagrees with the participant's location at that version.");
    }
  };
  // A roster lists each participant once (ISSUE-073).
  if (new Set(evidence.drivers.map(d => d.id)).size !== evidence.drivers.length
    || new Set(evidence.passengers.map(p => p.id)).size !== evidence.passengers.length) {
    throw new AddressEvidenceError("Stored evidence lists a participant twice.");
  }
  if (!samePoint(evidence.venue, roster.venue)) throw new AddressEvidenceError("Stored evidence has another venue.");
  for (const d of evidence.drivers) agrees("driver", d.id, d.location);
  for (const p of evidence.passengers) agrees("passenger", p.id, p.location);

  const start = new Map(evidence.drivers.map((d) => [d.location.id, d.location] as const));
  const pickup = new Map(evidence.passengers.map((p) => [p.location.id, p.location] as const));
  // Distinct participants may share a location, but one location is never two roles.
  for (const id of start.keys()) {
    if (pickup.has(id) || id === evidence.venue.id) throw new AddressEvidenceError("Stored evidence gives one location two roles.");
  }
  for (const id of pickup.keys()) {
    if (id === evidence.venue.id) throw new AddressEvidenceError("Stored evidence gives one location two roles.");
  }
  const legs = new Map<string, Leg>();
  for (const stored of evidence.legs) {
    const from = start.get(stored.from) ?? pickup.get(stored.from);
    const to = pickup.get(stored.to) ?? (stored.to === evidence.venue.id ? evidence.venue : undefined);
    const legalRole =
      (start.has(stored.from) && (pickup.has(stored.to) || stored.to === evidence.venue.id))
      || (pickup.has(stored.from) && stored.to === evidence.venue.id);
    if (!from || !to || !legalRole || stored.from === stored.to) {
      throw new AddressEvidenceError("Stored evidence has a leg that does not join its own endpoints.");
    }
    const key = legKey(stored.from, stored.to);
    if (legs.has(key)) throw new AddressEvidenceError("Stored evidence repeats a directed leg.");
    checkLeg(stored, from, to);
    legs.set(key, stored);
  }

  // The candidate must be COMPLETE for the roster it records: every leg that roster REQUIRED
  // (drivers with seats against its passengers, and each to the venue) must be present. A row
  // missing one was never a valid preview, so none of its observations may be copied, even if
  // the later roster would no longer need the missing leg (ISSUE-065).
  const supply = evidence.drivers.filter((d) => d.seats > 0);
  if (supply.length > 0 && evidence.passengers.length > 0) {
    const needed: Array<[string, string]> = [];
    for (const d of supply) {
      needed.push([d.location.id, evidence.venue.id]);
      for (const p of evidence.passengers) needed.push([d.location.id, p.location.id]);
    }
    for (const p of evidence.passengers) needed.push([p.location.id, evidence.venue.id]);
    for (const [from, to] of needed) {
      if (!legs.has(legKey(from, to))) throw new AddressEvidenceError("Stored evidence is missing a leg its own roster required.");
    }
  }
  return legs;
}
