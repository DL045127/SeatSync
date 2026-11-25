// The offline fixture catalog and search adapter. The catalog's directed times
// are data with their own invariants; the hand-derived values pinned here are
// read from data/fixture-places.json, not computed by the code under test.

import { describe, expect, test } from "vitest";
import { fixturePlace, fixturePlaces, fixtureSeconds } from "../../src/locations/fixture-catalog.ts";
import { fixtureSearch } from "../../src/locations/fixture-provider.ts";

describe("catalog data", () => {
  const places = fixturePlaces();
  const sameSite = (a: string, b: string) =>
    fixturePlace(a)!.lat === fixturePlace(b)!.lat && fixturePlace(a)!.lon === fixturePlace(b)!.lon;
  const routable = places.filter((p) => p.precision === "building" || p.precision === "entrance");

  test("every selectable place routes to every selectable place at another site", () => {
    for (const a of routable) {
      for (const b of routable) {
        if (a.id === b.id || sameSite(a.id, b.id)) continue;
        const seconds = fixtureSeconds(a.id, b.id);
        expect(Number.isInteger(seconds) && seconds >= 60).toBe(true);
      }
    }
  });

  test("two places at one coordinate have no entry: that leg is resolved locally", () => {
    expect(sameSite("fx-alpha", "fx-alpha-annex")).toBe(true);
    expect(() => fixtureSeconds("fx-alpha", "fx-alpha-annex")).toThrow();
    expect(() => fixtureSeconds("fx-alpha-annex", "fx-alpha")).toThrow();
    for (const other of ["fx-event-hall", "fx-delta", "fx-echo"]) {
      expect(fixtureSeconds("fx-alpha", other)).toBe(fixtureSeconds("fx-alpha-annex", other));
      expect(fixtureSeconds(other, "fx-alpha")).toBe(fixtureSeconds(other, "fx-alpha-annex"));
    }
  });

  test("times are directional, not symmetric", () => {
    const asymmetric = routable.flatMap((a) => routable.map((b) => [a.id, b.id] as const))
      .filter(([a, b]) => a < b && !sameSite(a, b))
      .filter(([a, b]) => fixtureSeconds(a, b) !== fixtureSeconds(b, a));
    expect(asymmetric.length).toBeGreaterThan(10);
  });

  test("hand-read values for the retained scenarios (seconds, FROM -> TO)", () => {
    // Delta -> Alpha -> Event Hall versus Delta -> Event Hall directly:
    expect(fixtureSeconds("fx-delta", "fx-alpha")).toBe(403);
    expect(fixtureSeconds("fx-alpha", "fx-event-hall")).toBe(346);
    expect(fixtureSeconds("fx-delta", "fx-event-hall")).toBe(519);
    // The reverse directions differ, so a reversed adapter is detectable.
    expect(fixtureSeconds("fx-alpha", "fx-delta")).toBe(418);
    expect(fixtureSeconds("fx-event-hall", "fx-delta")).toBe(504);
  });

  test("invented, conspicuously fictional labels", () => {
    for (const place of places) expect(place.label.startsWith("GROUPRIDE FIXTURE — ")).toBe(true);
  });
});

describe("search", () => {
  test("a query matches label, street or city, case-insensitively", () => {
    const labels = fixtureSearch({ query: "ALPHA court", limit: 5 }).map((c) => c.label);
    expect(labels).toEqual([
      "GROUPRIDE FIXTURE — Alpha Court (street only)",
      "GROUPRIDE FIXTURE — Pickup Alpha",
      "GROUPRIDE FIXTURE — Pickup Alpha Annex",
    ]);
  });

  test("city and street-only results are returned but are not usable precisions", () => {
    const results = fixtureSearch({ query: "fixtureville", limit: 20 });
    expect(results.find((r) => r.providerRef === "fx-city")?.precision).toBe("city");
    expect(results.find((r) => r.providerRef === "fx-main-street")?.precision).toBe("street");
  });

  test("at most the requested number of results, and none for no match or a blank query", () => {
    expect(fixtureSearch({ query: "fixture", limit: 5 })).toHaveLength(5);
    expect(fixtureSearch({ query: "no such place anywhere", limit: 5 })).toEqual([]);
    expect(fixtureSearch({ query: "   ", limit: 5 })).toEqual([]);
  });

  test("a venue bias ranks nearby places first and the order is deterministic", () => {
    const venue = fixturePlace("fx-event-hall")!;
    const near = fixtureSearch({ query: "pickup", bias: { lon: venue.lon, lat: venue.lat }, limit: 5 });
    const again = fixtureSearch({ query: "pickup", bias: { lon: venue.lon, lat: venue.lat }, limit: 5 });
    expect(near).toEqual(again);
    const distance = (c: { lat: number; lon: number }) => Math.hypot(c.lat - venue.lat, c.lon - venue.lon);
    for (let i = 1; i < near.length; i += 1) expect(distance(near[i])).toBeGreaterThanOrEqual(distance(near[i - 1]));
  });

  test("candidates carry explicit coordinates, country and attribution", () => {
    const [first] = fixtureSearch({ query: "event hall", limit: 1 });
    expect(first).toMatchObject({ countryCode: "US", precision: "building", providerRef: "fx-event-hall" });
    expect(first.attribution).toContain("fictional");
    expect(first.lat).toBeCloseTo(30.01, 5);
    expect(first.lon).toBeCloseTo(-97.01, 5);
  });
});
