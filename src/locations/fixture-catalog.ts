// Fictional place catalog and directed driving times for the offline fixture
// provider (docs/ARCHITECTURE-v2.md section 2). Shipped with the app, versioned
// by `revision`, never fetched. Rows of `seconds` are FROM, columns are TO.
// Pure data access: no filesystem, network or database use.

import catalog from "../../data/fixture-places.json" with { type: "json" };
import type { Precision } from "./snapshot.ts";

export const FIXTURE_REVISION: string = catalog.revision;
export const FIXTURE_ATTRIBUTION: string = catalog.attribution;

export interface CatalogPlace {
  id: string;
  label: string;
  street?: string;
  city: string;
  state: string;
  postcode: string;
  lat: number;
  lon: number;
  precision: Precision;
}

const places = catalog.places as CatalogPlace[];
const seconds = catalog.seconds as Record<string, Record<string, number>>;

export function fixturePlaces(): readonly CatalogPlace[] {
  return places;
}

export function fixturePlace(id: string): CatalogPlace | undefined {
  return places.find((p) => p.id === id);
}

/**
 * Directed driving seconds FROM `from` TO `to`. Throws for an unknown place or a
 * pair the catalog deliberately omits (two places at one coordinate resolve
 * locally as an identical endpoint and are never routed), so a caller that
 * asks for one has a defect rather than a missing observation.
 */
export function fixtureSeconds(from: string, to: string): number {
  const value = seconds[from]?.[to];
  if (value === undefined) throw new Error("The fixture catalog has no route for that pair.");
  return value;
}
