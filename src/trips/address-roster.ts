// Convert stored trip, driver and request rows into the pure address roster,
// parsing each stored snapshot. A malformed stored snapshot is an invariant
// failure (an internal error), never a participant to silently skip.

import { parseStoredSnapshot, type LocationSnapshot, type ProviderName } from "../locations/snapshot.ts";
import type { AddressPoint, AddressRoster } from "../matching/address.ts";
import type { DriverRow, RequestRow, TripRow } from "./repository.ts";

function toPoint(snapshot: LocationSnapshot): AddressPoint {
  return { id: snapshot.id, providerRef: snapshot.providerRef, lon: snapshot.lon, lat: snapshot.lat };
}

/** The venue snapshot of an address trip. */
export function venueOf(trip: TripRow): LocationSnapshot {
  if (trip.location_mode !== "address") throw new Error("Not an address trip.");
  return parseStoredSnapshot(trip.venue_location);
}

/** The provider an address trip is pinned to by its venue. */
export function tripProvider(trip: TripRow): ProviderName {
  return venueOf(trip).provider;
}

export function toAddressRoster(
  trip: TripRow,
  drivers: readonly DriverRow[],
  requests: readonly RequestRow[],
): AddressRoster {
  return {
    venue: toPoint(venueOf(trip)),
    drivers: drivers.map((d) => {
      if (d.location_mode !== "address" || d.max_detour_minutes === null) {
        throw new Error("Address trip has a non-address driver.");
      }
      return {
        id: d.id,
        seatCapacity: d.seat_capacity,
        active: d.active,
        maxDetourMinutes: d.max_detour_minutes,
        location: toPoint(parseStoredSnapshot(d.location)),
      };
    }),
    passengers: requests.map((r) => {
      if (r.location_mode !== "address") throw new Error("Address trip has a non-address request.");
      return { id: r.id, active: r.active, location: toPoint(parseStoredSnapshot(r.location)) };
    }),
  };
}
