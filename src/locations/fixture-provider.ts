// Offline fixture search adapter: matches a typed query against the fictional
// catalog. No geocoder, account or network. Ordering is deterministic.

import {
  FIXTURE_ATTRIBUTION,
  fixturePlaces,
  type CatalogPlace,
} from "./fixture-catalog.ts";
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

/** Every query token must occur in the place's label, street or city. */
export function fixtureSearch(input: SearchInput): SearchCandidate[] {
  const wanted = tokens(input.query);
  if (wanted.length === 0) return [];
  const scored = fixturePlaces()
    .filter((place) => {
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
