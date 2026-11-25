// Offline fixture search adapter: matches a typed query against the fictional
// catalog. No geocoder, account or network. Ordering is deterministic.

import {
  FIXTURE_ATTRIBUTION,
  fixturePlaces,
  type CatalogPlace,
} from "./fixture-catalog.ts";
import { classifyLocationQuery, normalizeLocationText, streetKey, withoutTrailingUnit } from "./house-number.ts";
import { matchesPrimaryLine, matchesUsLocality } from "./us-locality.ts";
import type { Precision } from "./snapshot.ts";

export interface SearchCandidate {
  providerRef: string;
  countryCode: "US";
  label: string;
  address: { street?: string; city?: string; state?: string; postcode?: string };
  lon: number;
  lat: number;
  precision: Precision;
  attribution: string;
}

export interface SearchInput {
  query: string;
  /** Venue coordinates used to rank nearby results first. */
  bias?: { lon: number; lat: number };
  limit: number;
}

function tokens(text: string): string[] {
  return text.normalize("NFC").toLowerCase().split(/\s+/).filter(Boolean);
}

function candidate(place: CatalogPlace): SearchCandidate {
  const address: SearchCandidate["address"] = {};
  if (place.street) address.street = place.street;
  address.city = place.city;
  address.state = place.state;
  address.postcode = place.postcode;
  return {
    providerRef: place.id,
    countryCode: "US",
    label: place.label,
    address,
    lon: place.lon,
    lat: place.lat,
    precision: place.precision,
    attribution: FIXTURE_ATTRIBUTION,
  };
}

/** Free text searches the catalog. Qualified selections require the structured address. */
export function fixtureSearch(input: SearchInput): SearchCandidate[] {
  const query = classifyLocationQuery(input.query);
  const wanted = tokens(input.query.split(",")[0]);
  if (wanted.length === 0) return [];
  const scored = fixturePlaces()
    .filter((place) => {
      if (query.kind === "address") {
        const address = classifyLocationQuery(place.street ?? "");
        if (address.kind !== "address" || address.houseNumber !== query.houseNumber) return false;
        if (!query.street) return true;
        const expected = streetKey(address.street ?? "");
        return !!expected && matchesPrimaryLine(query.street, query.locality, place,
          street => streetKey(withoutTrailingUnit(street)) === expected);
      }
      if (query.locality && !matchesUsLocality(query.locality, place)) return false;
      if (query.kind === "named") {
        const label = normalizeLocationText(place.label);
        return label === query.name || label.replace(/^groupride fixture — /, "") === query.name;
      }
      const haystack = `${place.label} ${place.street ?? ""} ${place.city}`.toLowerCase();
      return wanted.every((token) => haystack.includes(token));
    })
    .map((place) => {
      const distance = input.bias
        ? Math.hypot(place.lat - input.bias.lat, place.lon - input.bias.lon)
        : 0;
      return { place, distance };
    });
  scored.sort((a, b) => a.distance - b.distance || a.place.label.localeCompare(b.place.label)
    || a.place.id.localeCompare(b.place.id));
  return scored.slice(0, input.limit).map(({ place }) => candidate(place));
}
