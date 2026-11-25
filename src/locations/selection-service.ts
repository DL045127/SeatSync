// Search and selection verification (docs/ARCHITECTURE-v2.md section 3).
//
// Search is stateless: it performs no database write (its single read runs in a
// READ ONLY transaction) and returns signed tokens. Attachment verification
// runs INSIDE keyed mutation work, after the receipt lookup and any trip lock,
// so matching receipts replay before any signature, expiry or provider check.

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { TerminalBusinessError, TransientFailure } from "../contracts/errors.ts";
import { NormalizationError, normalizeUuid } from "../contracts/normalize.ts";
import { classifyUnkeyedFailure } from "../db/classify.ts";
import { isRetryableQueryError, isTransportError } from "../db/commit-outcome.ts";
import { assertDataset } from "../db/dataset.ts";
import { datasetLock } from "../db/local-target.ts";
import { withTransaction } from "../db/transaction.ts";
import { addressProvider, currentTarget, type AddressProvider } from "./config.ts";
import { fixtureSearch, type SearchCandidate } from "./fixture-provider.ts";
import { FIXTURE_ATTRIBUTION } from "./fixture-catalog.ts";
import {
  loadMaster,
  SelectionKeyUnavailable,
  type MasterKey,
  type TargetName,
} from "./master-key.ts";
import {
  signSelection,
  TOKEN_MAX_BYTES,
  verifySelection,
  type SelectionKeyContext,
} from "./selection-token.ts";
import {
  PURPOSES,
  USABLE_PRECISIONS,
  parseStoredSnapshot,
  toStoredSnapshot,
  type LocationSnapshot,
  type Precision,
  type Purpose,
  type ProviderName,
} from "./snapshot.ts";

export const SEARCH_LIMITS = { queryCodePoints: 100, minQueryCodePoints: 2, results: 5 } as const;

const searchSchema = z
  .object({
    query: z.string(),
    purpose: z.enum(PURPOSES),
    tripId: z.string().optional(),
  })
  .strict();

export interface SelectionDeps {
  /** Clock used to issue and to check expiry. Injectable so boundaries are testable. */
  now: () => number;
  provider: () => AddressProvider;
  target: () => TargetName;
  loadMaster: () => Promise<MasterKey>;
  warn: (message: string) => void;
}

// Test-only override of the clock, provider, target, key loader or warning sink,
// like the other `__set…` seams. Production never sets it.
let depsOverride: Partial<SelectionDeps> = {};
export function __setSelectionDeps(partial: Partial<SelectionDeps>): () => void {
  depsOverride = partial;
  return () => { depsOverride = {}; };
}

export function defaultSelectionDeps(): SelectionDeps {
  return {
    now: () => Date.now(),
    provider: () => addressProvider(),
    target: () => currentTarget(),
    loadMaster: () => {
      const provider = addressProvider();
      return loadMaster({ mode: provider === "geoapify" ? "live" : "fixture", target: currentTarget() });
    },
    warn: (message) => console.warn(message),
    ...depsOverride,
  };
}

function unavailableProvider(provider: AddressProvider): TransientFailure {
  return new TransientFailure(
    "ADDRESS_PROVIDER_UNAVAILABLE",
    provider === "off"
      ? "Address search is disabled on this server."
      : "The configured address provider is not available in this build.",
  );
}

/** Only the offline fixture provider exists in checkpoint A. */
function requireFixtureProvider(deps: SelectionDeps): ProviderName {
  const provider = deps.provider();
  if (provider !== "fixture") throw unavailableProvider(provider);
  return "fixture";
}

async function loadMasterOr503(deps: SelectionDeps): Promise<MasterKey> {
  try {
    return await deps.loadMaster();
  } catch (error) {
    if (error instanceof SelectionKeyUnavailable) {
      throw new TransientFailure("SELECTION_KEY_UNAVAILABLE", "The selection key is unavailable. Retry shortly.", error);
    }
    throw error;
  }
}

/**
 * Read the current dataset generation on a client already under the dataset
 * lock. ANY failure to read it is a retryable availability failure, never a
 * verdict on the request: inside keyed work an unclassified exception would be
 * finalized as a terminal 500 receipt that the same key replays even after the
 * fault is repaired (ISSUE-048). A transport or already-retryable database error
 * keeps its own classification; everything else (a revoked grant, a missing
 * table, an empty table) becomes SELECTION_KEY_UNAVAILABLE.
 */
export async function readGeneration(client: PoolClient): Promise<string> {
  let generation: string | undefined;
  try {
    const result = await client.query<{ generation: string }>("SELECT generation FROM dataset_generation");
    generation = result.rows[0]?.generation;
  } catch (error) {
    if (isTransportError(error) || isRetryableQueryError(error)) throw error;
    throw new TransientFailure("SELECTION_KEY_UNAVAILABLE", "The dataset generation is unavailable.", error);
  }
  if (!generation) {
    throw new TransientFailure("SELECTION_KEY_UNAVAILABLE", "The dataset generation is unavailable.");
  }
  return generation;
}

const REPLACED_SECRET_WARNING =
  "A new selection master secret was created while address trips exist; earlier selections are no longer valid.";

/**
 * The same optional warning for search, which has no surrounding keyed
 * transaction: ask in a SEPARATE short read-only transaction and ignore any
 * failure (a locked or slow table must never fail a search that needs no trip
 * data).
 */
async function warnIfAddressTripsExistViaPool(pool: Pool, deps: SelectionDeps): Promise<void> {
  let exists = false;
  try {
    exists = await withTransaction(pool, "read", async (client) =>
      ((await client.query("SELECT 1 FROM trips WHERE location_mode = 'address' LIMIT 1")).rowCount ?? 0) > 0);
  } catch {
    return;
  }
  if (exists) deps.warn(REPLACED_SECRET_WARNING);
}

/**
 * Warn, best effort, that a freshly created secret just invalidated earlier
 * selections. The probe runs inside keyed work, so it is wrapped in its own
 * savepoint: a failing diagnostic can never abort the surrounding transaction
 * or turn the request into a permanent failure (the ISSUE-048 hazard again).
 * A broken connection still propagates, because the rollback below then fails.
 */
async function warnIfAddressTripsExist(client: PoolClient, deps: SelectionDeps): Promise<void> {
  await client.query("SAVEPOINT selection_warn_probe");
  let exists: boolean;
  try {
    exists = ((await client.query("SELECT 1 FROM trips WHERE location_mode = 'address' LIMIT 1")).rowCount ?? 0) > 0;
    await client.query("RELEASE SAVEPOINT selection_warn_probe");
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT selection_warn_probe");
    return;
  }
  if (exists) deps.warn(REPLACED_SECRET_WARNING);
}

// ---- search ---------------------------------------------------------------

export interface Suggestion {
  label: string;
  detail: string;
  precision: Precision;
  selectable: boolean;
  /** Present only for a selectable suggestion. */
  token?: string;
}

export interface SearchResponse {
  httpStatus: 200;
  body: {
    provider: ProviderName;
    attribution: string;
    suggestions: Suggestion[];
  };
}

function detailOf(candidate: SearchCandidate): string {
  const { street, city, state, postcode } = candidate.address;
  const place = [city, [state, postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, place].filter(Boolean).join(", ");
}

function normalizeSearch(raw: unknown): { query: string; purpose: Purpose; tripId: string | null } {
  const parsed = searchSchema.parse(raw);
  const query = parsed.query.normalize("NFC").trim();
  const length = Array.from(query).length;
  if (length < SEARCH_LIMITS.minQueryCodePoints || length > SEARCH_LIMITS.queryCodePoints
    || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new NormalizationError(
      `Enter ${SEARCH_LIMITS.minQueryCodePoints}–${SEARCH_LIMITS.queryCodePoints} characters to search.`,
    );
  }
  if (parsed.purpose === "venue") {
    if (parsed.tripId !== undefined) throw new NormalizationError("A venue search names no trip.");
    return { query, purpose: parsed.purpose, tripId: null };
  }
  if (parsed.tripId === undefined) throw new NormalizationError("Start and pickup searches name a trip.");
  return { query, purpose: parsed.purpose, tripId: normalizeUuid(parsed.tripId) };
}

export async function searchLocations(
  pool: Pool,
  rawBody: unknown,
  deps: SelectionDeps = defaultSelectionDeps(),
): Promise<SearchResponse> {
  const request = normalizeSearch(rawBody);
  const provider = requireFixtureProvider(deps);

  // One short READ ONLY snapshot captures the generation and the trip scope. It touches only
  // what the request needs: a venue search reads no trip data at all, so a busy or locked
  // trips table cannot break it (ISSUE-061). A transient database condition here is a
  // retryable 503, never a generic 500 (ISSUE-059).
  let scope: { generation: string; bias: { lon: number; lat: number } | undefined };
  try {
    scope = await withTransaction(pool, "read", async (client) => {
      await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
      await assertDataset(client);
      const generation = await readGeneration(client);
      if (request.tripId === null) return { generation, bias: undefined };
      const trip = (await client.query<{ location_mode: string; venue_location: unknown }>(
        "SELECT location_mode, venue_location FROM trips WHERE id = $1", [request.tripId],
      )).rows[0];
      if (!trip) throw new TerminalBusinessError(404, "NOT_FOUND", "Trip not found.");
      if (trip.location_mode !== "address") {
        throw new TerminalBusinessError(422, "LOCATION_MODE_MISMATCH", "This trip uses zones, not addresses.");
      }
      const venue = parseStoredSnapshot(trip.venue_location);
      if (venue.provider !== provider) throw unavailableProvider(deps.provider());
      return { generation, bias: { lon: venue.lon, lat: venue.lat } };
    });
  } catch (error) {
    throw classifyUnkeyedFailure(error);
  }

  const { master, created } = await loadMasterOr503(deps);
  // Whether address trips exist matters ONLY to the replacement warning, so it is asked only
  // when a secret was actually created, and a failure of that optional question is ignored.
  if (created) await warnIfAddressTripsExistViaPool(pool, deps);
  const context: SelectionKeyContext = { master, generation: scope.generation };

  const nowMs = deps.now();
  const candidates = fixtureSearch({ query: request.query, bias: scope.bias, limit: SEARCH_LIMITS.results });
  const suggestions: Suggestion[] = candidates.map((candidate) => {
    const base = { label: candidate.label, detail: detailOf(candidate), precision: candidate.precision };
    if (!(USABLE_PRECISIONS as readonly string[]).includes(candidate.precision)) {
      // City, ZIP and street-only results need a more specific selection.
      return { ...base, selectable: false };
    }
    try {
      const token = signSelection({
        context,
        purpose: request.purpose,
        tripId: request.tripId,
        provider,
        id: randomUUID(),
        nowMs,
        snapshot: {
          providerRef: candidate.providerRef,
          countryCode: candidate.countryCode,
          label: candidate.label,
          address: candidate.address,
          lon: candidate.lon,
          lat: candidate.lat,
          precision: candidate.precision as (typeof USABLE_PRECISIONS)[number],
          attribution: candidate.attribution,
        },
      });
      return { ...base, selectable: true, token };
    } catch {
      // A faulty encoder or an oversized token is caught before it is offered.
      return { ...base, selectable: false };
    }
  });

  return {
    httpStatus: 200,
    body: { provider, attribution: FIXTURE_ATTRIBUTION, suggestions },
  };
}

// ---- attachment verification ----------------------------------------------

export interface AttachExpectation {
  purpose: Purpose;
  tripId: string | null;
  /** A roster write must match the trip's pinned provider. */
  provider?: ProviderName;
}

/** The generic terminal rejection for any selection the server could evaluate and refuse. */
export function selectionInvalid(): TerminalBusinessError {
  return new TerminalBusinessError(
    422,
    "LOCATION_SELECTION_INVALID",
    "That address selection is no longer valid. Search again and select it.",
  );
}

/**
 * Verify a presented token for a new-key attachment and return the stored
 * snapshot to copy. Call only inside keyed work, with the dataset lock held.
 *
 * Key or generation unavailability is a retryable 503 with no receipt. Every
 * rejection of client-supplied token bytes is the one generic terminal 422.
 */
export async function verifyAttachment(
  client: PoolClient,
  token: unknown,
  expect: AttachExpectation,
  deps: SelectionDeps = defaultSelectionDeps(),
): Promise<LocationSnapshot> {
  const provider = requireFixtureProvider(deps);
  if (expect.provider !== undefined && expect.provider !== provider) throw unavailableProvider(deps.provider());
  const generation = await readGeneration(client);
  const { master, created } = await loadMasterOr503(deps);
  // Verification can be the first operation after a lost secret (ISSUE-058).
  if (created) await warnIfAddressTripsExist(client, deps);
  const result = verifySelection(token, { master, generation }, deps.now(), {
    purpose: expect.purpose,
    tripId: expect.tripId,
    provider,
  });
  if (!result.ok) throw selectionInvalid();
  const { payload } = result;
  return toStoredSnapshot(payload.snapshot, {
    id: payload.id,
    provider: payload.provider,
    issuedAtMs: payload.iat,
  });
}

export { TOKEN_MAX_BYTES };
