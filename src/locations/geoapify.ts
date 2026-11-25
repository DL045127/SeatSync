// Geoapify Address Autocomplete v1, JSON format. Only allowlisted fields
// enter selection tokens. Provider URLs, errors and payloads stay server-side.
import { createHash } from "node:crypto";
import { z } from "zod";
import { TransientFailure } from "../contracts/errors.ts";
import { NormalizationError } from "../contracts/normalize.ts";
import { requestProviderJson } from "../geoapify/transport.ts";
import { processLimit, retrySeconds } from "../geoapify/quota.ts";
import type { SearchCandidate, SearchInput } from "./fixture-provider.ts";
import { classifyLocationQuery, normalizeLocationText, streetKey, withoutTrailingUnit, type LocationQuery } from "./house-number.ts";
import { hasConsistentUsState, matchesPrimaryLine, matchesUsLocality } from "./us-locality.ts";
import { SNAPSHOT_LIMITS } from "./snapshot.ts";

const resultSchema = z.object({
  country_code: z.string(), result_type: z.string(), formatted: z.string().min(1),
  lon: z.number().gte(-180).lte(180), lat: z.number().gte(-90).lte(90),
  name: z.string().optional(), address_line1: z.string().optional(), place_id: z.string().optional(),
  housenumber: z.string().optional(), street: z.string().optional(), city: z.string().optional(),
  state_code: z.string().optional(), state: z.string().optional(), postcode: z.string().optional(),
  datasource: z.object({ attribution: z.string().optional(), sourcename: z.string().optional() }).optional(),
});

type ProviderPlace = z.infer<typeof resultSchema>;

function isBuilding(r: ProviderPlace): boolean {
  return r.result_type === "building" || (r.result_type === "amenity" && !!r.housenumber && !!r.street);
}

function candidate(r: ProviderPlace, query: LocationQuery): SearchCandidate | undefined {
  const precision = isBuilding(r) ? "building" : r.result_type === "street" ? "street" : "city";
  if (query.kind === "address") {
    if (precision !== "building" || query.houseNumber !== normalizeLocationText(r.housenumber ?? "")) return;
    if (query.street) {
      const expected = streetKey(r.street ?? "");
      if (!expected || !matchesPrimaryLine(query.street, query.locality, r,
        street => streetKey(withoutTrailingUnit(street)) === expected)) return;
    }
  }
  if (query.kind !== "address" && query.locality && !matchesUsLocality(query.locality, r)) return;
  if (query.kind === "named" && query.name !== normalizeLocationText(r.name ?? "")) return;
  const ref = r.place_id || JSON.stringify([r.lon, r.lat, r.formatted]);
  return {
    label: r.name || r.address_line1 || r.formatted,
    providerRef: r.place_id && ref.length <= SNAPSHOT_LIMITS.providerRefCodePoints ? ref
      : createHash("sha256").update(ref).digest("hex"),
    countryCode: "US", precision, lat: r.lat, lon: r.lon,
    address: {
      street: [r.housenumber, r.street].filter(Boolean).join(" ") || undefined,
      city: r.city, state: r.state_code || r.state, postcode: r.postcode,
    },
    attribution: r.datasource?.attribution || r.datasource?.sourcename || "Geoapify",
  };
}

export async function geoapifySearch(input: SearchInput, signal: AbortSignal): Promise<SearchCandidate[]> {
  const query = classifyLocationQuery(input.query);
  const key = process.env.GEOAPIFY_API_KEY?.trim();
  if (!key) throw new TransientFailure("ADDRESS_PROVIDER_UNAVAILABLE", "Address search credentials are unavailable.");
  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
  url.search = new URLSearchParams({
    text: query.kind === "named" ? query.quotedText ?? input.query : input.query,
    filter: "countrycode:us", limit: String(input.limit),
    format: "json", lang: "en", apiKey: key,
  }).toString();
  if (input.bias) url.searchParams.set("bias", `proximity:${input.bias.lon},${input.bias.lat}`);
  try {
    await processLimit.acquire(signal);
    signal.throwIfAborted();
    const response = await requestProviderJson(url, signal);
    if (response.status < 200 || response.status >= 300) {
      const retry = retrySeconds(response.retryAfter);
      if (response.status === 429) processLimit.backoff(retry ?? 1);
      throw new TransientFailure("ADDRESS_PROVIDER_UNAVAILABLE",
        response.status === 429 ? "Address search is rate limited. Retry shortly." : "Address search is unavailable.",
        undefined, response.status === 429 || response.status >= 500 ? retry : undefined);
    }
    const { results } = z.object({ results: z.array(z.unknown()) }).parse(response.data);
    const places = results.slice(0, input.limit).flatMap(row => {
      const parsed = resultSchema.safeParse(row);
      if (!parsed.success || parsed.data.country_code.toUpperCase() !== "US") return [];
      return hasConsistentUsState(parsed.data) ? [parsed.data] : [];
    });
    const candidates = places.flatMap(place => candidate(place, query) ?? []);
    if (query.kind === "address" && (!query.street || !candidates.length)) {
      const line = query.street ? query.houseNumber + " " + query.street : query.houseNumber;
      const named = places.some(p => p.name && isBuilding(p) && matchesPrimaryLine(line, query.locality, p,
        primary => primary === normalizeLocationText(p.name ?? "")));
      if (named) {
        throw new NormalizationError(
          "This also matches a venue name. For that venue, enter its exact name in double quotes, followed by any city and state. For a street address, check the building number and street.",
        );
      }
    }
    return candidates;
  } catch (error) {
    if (error instanceof NormalizationError) throw error;
    if (error instanceof TransientFailure) {
      if (error.code === "ROUTING_QUOTA") throw new TransientFailure("ADDRESS_PROVIDER_UNAVAILABLE",
        "Address search is rate limited. Retry shortly.", undefined, error.retryAfterSeconds);
      throw error;
    }
    throw new TransientFailure("ADDRESS_PROVIDER_UNAVAILABLE", "Address search is unavailable. Retry shortly.");
  }
}
