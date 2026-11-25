// Address-form request contracts: strict unions, byte-preserved opaque tokens,
// disjoint zone/address forms, and unchanged zone bodies and fingerprints.

import { describe, expect, test } from "vitest";
import {
  isAddressAddDriver,
  isAddressAddRequest,
  isAddressCreateTrip,
  normalizeAddDriver,
  normalizeAddRequest,
  normalizeCreateTrip,
  requestFingerprint,
} from "../../src/contracts/index.ts";

const zones = new Set(["north", "east", "south", "west"]);
const departAt = "2027-03-05T17:30:00-06:00";

describe("create trip", () => {
  test("the zone form is exactly the deployed one", () => {
    const body = normalizeCreateTrip({ name: "  Zone Trip ", destinationLabel: "Union", departAt: "2026-03-01T09:30:00+02:00" });
    expect(body).toEqual({ name: "Zone Trip", destinationLabel: "Union", departAt: "2026-03-01T07:30:00.000Z" });
    expect(isAddressCreateTrip(body)).toBe(false);
  });

  test("the address form normalizes the name and time but never the token", () => {
    const token = "  abc.def.ghi \n";
    const body = normalizeCreateTrip({ name: " Austin ", departAt, locationMode: "address", venueSelectionToken: token });
    expect(isAddressCreateTrip(body)).toBe(true);
    expect(body).toEqual({
      name: "Austin",
      departAt: "2027-03-05T23:30:00.000Z",
      locationMode: "address",
      venueSelectionToken: token,
    });
  });

  test.each([
    ["zone fields mixed into the address form", { name: "A", departAt, locationMode: "address", venueSelectionToken: "t", destinationLabel: "X" }],
    ["address token mixed into the zone form", { name: "A", departAt, destinationLabel: "X", venueSelectionToken: "t" }],
    ["address form without a token", { name: "A", departAt, locationMode: "address" }],
    ["unknown mode", { name: "A", departAt, locationMode: "zone", venueSelectionToken: "t" }],
    ["non-string token", { name: "A", departAt, locationMode: "address", venueSelectionToken: 42 }],
    ["array body", []],
  ])("rejects %s", (_name, raw) => {
    expect(() => normalizeCreateTrip(raw)).toThrow();
  });
});

describe("register a driver", () => {
  const address = { name: "Dana", startSelectionToken: "tok", seatCapacity: 2, maxDetourMinutes: 15 };

  test("the zone form is unchanged", () => {
    const body = normalizeAddDriver({ name: "Dana", zoneId: "north", seatCapacity: 1 }, zones);
    expect(body).toEqual({ name: "Dana", zoneId: "north", seatCapacity: 1 });
    expect(isAddressAddDriver(body)).toBe(false);
  });

  test("the address form carries the exact token and an inclusive 0-120 minute limit", () => {
    expect(isAddressAddDriver(normalizeAddDriver(address, zones))).toBe(true);
    expect(normalizeAddDriver({ ...address, maxDetourMinutes: 0 }, zones)).toMatchObject({ maxDetourMinutes: 0 });
    expect(normalizeAddDriver({ ...address, maxDetourMinutes: 120 }, zones)).toMatchObject({ maxDetourMinutes: 120 });
    expect(normalizeAddDriver({ ...address, startSelectionToken: " a.b.c " }, zones))
      .toMatchObject({ startSelectionToken: " a.b.c " });
  });

  test.each([
    ["limit below range", { ...address, maxDetourMinutes: -1 }],
    ["limit above range", { ...address, maxDetourMinutes: 121 }],
    ["fractional limit", { ...address, maxDetourMinutes: 1.5 }],
    ["missing limit", { name: "D", startSelectionToken: "t", seatCapacity: 1 }],
    ["seats out of range", { ...address, seatCapacity: 9 }],
    ["zone and address together", { ...address, zoneId: "north" }],
    ["zone form with a limit", { name: "D", zoneId: "north", seatCapacity: 1, maxDetourMinutes: 5 }],
    ["neither location", { name: "D", seatCapacity: 1 }],
  ])("rejects %s", (_name, raw) => {
    expect(() => normalizeAddDriver(raw, zones)).toThrow();
  });
});

describe("register a passenger", () => {
  test("the zone form is unchanged and the address form keeps its token bytes", () => {
    const zone = normalizeAddRequest({ name: "Pat", zoneId: "east" }, zones);
    expect(zone).toEqual({ name: "Pat", zoneId: "east" });
    expect(isAddressAddRequest(zone)).toBe(false);
    const address = normalizeAddRequest({ name: "Pat", pickupSelectionToken: " x.y.z " }, zones);
    expect(isAddressAddRequest(address)).toBe(true);
    expect(address).toEqual({ name: "Pat", pickupSelectionToken: " x.y.z " });
  });

  test.each([
    ["zone and token together", { name: "P", zoneId: "east", pickupSelectionToken: "t" }],
    ["driver token on a passenger", { name: "P", startSelectionToken: "t" }],
    ["unknown zone", { name: "P", zoneId: "mars" }],
  ])("rejects %s", (_name, raw) => {
    expect(() => normalizeAddRequest(raw, zones)).toThrow();
  });
});

describe("request identity", () => {
  const route = "/api/trips/00000000-0000-4000-8000-000000000001/requests";

  test("the exact token string is part of the fingerprint", () => {
    const a = requestFingerprint("POST", route, normalizeAddRequest({ name: "Pat", pickupSelectionToken: "a.b.c" }, zones));
    const b = requestFingerprint("POST", route, normalizeAddRequest({ name: "Pat", pickupSelectionToken: "a.b.d" }, zones));
    const sameAgain = requestFingerprint("POST", route, normalizeAddRequest({ pickupSelectionToken: "a.b.c", name: "Pat" }, zones));
    expect(a).not.toBe(b);
    expect(sameAgain).toBe(a); // key order does not matter
  });

  test("a deployed zone body keeps its pinned fingerprint", () => {
    const fingerprint = requestFingerprint(
      "POST",
      "/api/trips",
      normalizeCreateTrip({ name: "Launch Day", destinationLabel: "Union", departAt: "2026-05-01T08:00:00+00:00" }),
    );
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Recorded once for the W6 release body; any change to the zone
    // normalization or canonical form would alter it.
    expect(fingerprint).toBe(PINNED_ZONE_CREATE_FINGERPRINT);
  });
});

// Computed from the committed pre-address contracts (git HEAD before checkpoint A, via `git archive`), not from the working tree.
const PINNED_ZONE_CREATE_FINGERPRINT = "2d3bb151befc67f9fd805d1fb171e9bd08f7228d819e34d33d9d7a4be05c1cb1";
