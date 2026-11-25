// Pilot rehearsal against a single loopback HTTP provider, including the same
// search tokens and durable writes that the browser uses.
import { setTimeout as delay } from "node:timers/promises";
import * as transport from "../../src/geoapify/transport.ts";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, vi } from "vitest";
import { appPool, createPool, __resetAppPoolForTests } from "../../src/db/pool.ts";
import { POST as searchRoute } from "../../src/app/api/locations/search/route.ts";
import { defaultSelectionDeps, searchLocations } from "../../src/locations/selection-service.ts";
import { publishPreview } from "../../src/trips/preview.ts";
import { addDriver, addRequest, createTrip, editDriver, getTripSnapshot } from "../../src/trips/service.ts";
import { commitPreview } from "../../src/trips/commit.ts";
import { APP, key, resetTestDatabase, useFixtureEnvironment } from "./helpers/address.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function search(query: string, tripId?: string) {
  const body = tripId ? { query, purpose: "pickup", tripId } : { query, purpose: "venue" };
  return searchRoute(new Request("http://127.0.0.1/api/locations/search", {
    method: "POST", body: JSON.stringify(body),
  }));
}

function building(housenumber: string, name?: string) {
  return { housenumber, street: "Example Road", formatted: `${housenumber} Example Road`, name,
    result_type: "building", country_code: "us", lon: -90, lat: 30 };
}

async function saveOnlyVenue(text: string, expectedStreet: string) {
  const response = await search(text);
  expect(response.status, text).toBe(200);
  const { suggestions } = await response.json();
  expect(suggestions.map((s: { detail: string }) => s.detail)).toEqual([expectedStreet]);
  expect(suggestions[0]).toMatchObject({ selectable: true, token: expect.any(String) });
  const created = await createTrip(appPool(), key(), { name: "Street selection", locationMode: "address",
    departAt: "2027-03-05T17:30:00-06:00", venueSelectionToken: suggestions[0].token });
  expect(created.httpStatus).toBe(201);
  const saved = await getTripSnapshot(appPool(), (created.body as { id: string }).id);
  expect(saved?.venue?.detail).toBe(expectedStreet);
}

test("ISSUE-084: only the complete grid pickup is signed, registered and reloaded", async () => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  const pool = createPool(APP, 2);
  vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
  vi.stubEnv("GROUPRIDE_SELECTION_SECRET", Buffer.alloc(32, 8).toString("base64url"));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  const stub = vi.spyOn(transport, "requestProviderJson").mockResolvedValue({
    status: 200, retryAfter: null, data: { results: [building("10", "Example Hall")] },
  });
  try {
    const venue = await search("Example Hall");
    expect(venue.status).toBe(200);
    const created = await createTrip(pool, key(), { name: "Grid pickup", locationMode: "address",
      departAt: "2027-03-05T17:30:00-06:00", venueSelectionToken: (await venue.json()).suggestions[0].token });
    expect(created.httpStatus).toBe(201);
    const tripId = (created.body as { id: string }).id;
    // A decoy even echoes the query in its name. Only housenumber establishes the street number.
    const results = [building("99", "N6W23001 Example Road"), building("23001"), building("N6W23010"),
      building("N6W23001"), building("6W220")];
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results } });
    for (const [query, number] of [
      ["N6W23001 Example Road", "N6W23001"], ["7-Eleven, n6w23001 Example Road, 4B", "N6W23001"],
      ["6W220 Example Road", "6W220"],
    ]) {
      const response = await search(query, tripId);
      expect(response.status, query).toBe(200);
      const { suggestions } = await response.json();
      expect(suggestions.map((s: { detail: string }) => s.detail)).toEqual([`${number} Example Road`]);
      expect(suggestions[0]).toMatchObject({ selectable: true, token: expect.any(String) });
      const passenger = await addRequest(pool, tripId, key(), { name: "Pat", pickupSelectionToken: suggestions[0].token });
      expect(passenger.httpStatus).toBe(201);
      const saved = await getTripSnapshot(pool, tripId);
      const id = (passenger.body as { id: string }).id;
      expect(saved?.requests.find(r => r.id === id)?.location?.detail).toBe(`${number} Example Road`);
    }
    const missing = await search("N6W23002 Example Road", tripId);
    expect(missing.status).toBe(200);
    expect((await missing.json()).suggestions).toEqual([]);
  } finally {
    stub.mockRestore();
    vi.unstubAllEnvs();
    await __resetAppPoolForTests();
    await pool.end();
    env.dispose();
  }
});

test.each([
  { name: "Studio 54 Theater", clarify: false }, { name: "7-Eleven", clarify: false },
  { name: "1-800-Flowers", clarify: false }, { name: "F45 Training", clarify: true },
  { name: "54", clarify: true, decoyNumber: "54" },
])("ISSUE-087: search the provider and sign the exact venue $name", async ({ name, clarify, decoyNumber }) => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
  vi.stubEnv("GROUPRIDE_SELECTION_SECRET", Buffer.alloc(32, 8).toString("base64url"));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  const stub = vi.spyOn(transport, "requestProviderJson").mockResolvedValue({
    status: 200, retryAfter: null, data: { results: [building("99", `${name} Annex`),
      { ...building("11"), formatted: name }, building(decoyNumber ?? "F45"), building("42", name)] },
  });
  try {
    let response = await search(name);
    if (clarify) {
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.message).toContain("exact name in double quotes");
      expect(body).not.toHaveProperty("suggestions");
      response = await search(`"${name}"`);
    }
    expect(response.status).toBe(200);
    expect(stub.mock.calls.map(([url]) => url.searchParams.get("text"))).toEqual(clarify ? [name, name] : [name]);
    const { suggestions } = await response.json();
    expect(suggestions).toEqual([expect.objectContaining({
      label: name, detail: "42 Example Road", selectable: true, token: expect.any(String),
    })]);
    const created = await createTrip(appPool(), key(), { name: "Venue lookup", locationMode: "address",
      departAt: "2027-03-05T17:30:00-06:00", venueSelectionToken: suggestions[0].token });
    expect(created.httpStatus).toBe(201);
    const saved = await getTripSnapshot(appPool(), (created.body as { id: string }).id);
    expect(saved?.venue).toMatchObject({ label: name, detail: "42 Example Road" });
  } finally {
    stub.mockRestore();
    vi.unstubAllEnvs();
    await __resetAppPoolForTests();
    env.dispose();
  }
});

test.each([
  { description: "locality-qualified name", query: "F45 Training, Austin, TX", extra: [] },
  { description: "street and number on different buildings", query: "F45 Training", extra: [
    { ...building("17"), street: "Training" },
  ] },
  { description: "ineligible full address", query: "F45 Training, Austin, TX", extra: [
    { ...building("F45"), street: "Training", result_type: "city" },
  ] },
])("ISSUE-088: clarify $description and save only the requested interpretation", async ({ query, extra }) => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
  vi.stubEnv("GROUPRIDE_SELECTION_SECRET", Buffer.alloc(32, 8).toString("base64url"));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  const austin = { city: "Austin", state_code: "TX" };
  const results = [building("42", "F45 Training"), { ...building("F45"), street: "Other Road" }, ...extra]
    .map(place => ({ ...place, ...austin }));
  const stub = vi.spyOn(transport, "requestProviderJson").mockResolvedValue({
    status: 200, retryAfter: null, data: { results },
  });
  try {
    const response = await search(query);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("exact name in double quotes") });
    expect(body).not.toHaveProperty("suggestions");
    await saveOnlyVenue('"F45 Training", Austin, TX', "42 Example Road, Austin, TX");
    expect(stub.mock.calls[1][0].searchParams.get("text")).toBe("F45 Training, Austin, TX");

    const exact = { ...building("F45"), ...austin, street: "Training", formatted: "F45 Training" };
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [exact, ...results] } });
    await saveOnlyVenue(query, "F45 Training, Austin, TX");

    // Remove only the venue, keep the decoys and test the literal match both ways.
    const decoys = results.slice(1);
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: decoys } });
    const unsupported = await search(query);
    expect(unsupported.status).toBe(200);
    expect((await unsupported.json()).suggestions).toEqual([]);
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [...decoys, exact] } });
    await saveOnlyVenue(query, "F45 Training, Austin, TX");
  } finally {
    stub.mockRestore();
    vi.unstubAllEnvs();
    await __resetAppPoolForTests();
    env.dispose();
  }
});

const austin = { city: "Austin", state_code: "TX" };
const eugene = { city: "Eugene", state_code: "OR" };

test.each([
  { text: "2500 I-35 Frontage Road, Austin, TX", number: "2500", street: "I-35 Frontage Road", locality: austin },
  { text: "12 US-183 Highway, Austin, TX", number: "12", street: "US-183 Highway", locality: austin },
  { text: "24 N TX-35 Frontage Road, Austin, TX", number: "24", street: "North TX 35 Frontage Road", locality: austin },
  { text: "24 North TX-35 Frontage Road, Austin, TX", number: "24", street: "N TX-35 Frontage Road", locality: austin },
  { text: "24 N OR-99 Frontage Road, Eugene, OR", number: "24", street: "North OR 99 Frontage Road", locality: eugene },
  { text: "24 North OR-99 Frontage Road, Eugene, OR", number: "24", street: "N OR-99 Frontage Road", locality: eugene },
  { text: "24 OR-99 Frontage Road, Eugene, OR", number: "24", street: "OR 99 Frontage Road", locality: eugene },
  { text: "24 N OR 99 Frontage Road, Eugene, OR", number: "24", street: "North OR-99 Frontage Road", locality: eugene },
  { text: "2500 I 35 Frontage Road, Austin, TX", number: "2500", street: "I-35 Frontage Road", locality: austin },
  { text: "24 W Example St", number: "24", street: "West Example Street" },
  { text: "12 Example Road, Portland, OR 97201-1234", number: "12", street: "Example Road",
    locality: { city: "Portland", state_code: "OR", postcode: "97201-1234" } },
])("ISSUE-084/088: dispatch and save the single street $text with and without an echoed name", async ({ text, number, street, locality }) => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
  vi.stubEnv("GROUPRIDE_SELECTION_SECRET", Buffer.alloc(32, 8).toString("base64url"));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  const stub = vi.spyOn(transport, "requestProviderJson");
  try {
    const exact = { ...building(number), street, ...locality, formatted: number + " " + street };
    const decoys = [{ ...exact, street: "Other Road" }, { ...exact, housenumber: "99" },
      { ...exact, street: "South TX-35 Frontage Road" }, { ...exact, street: "South OR-99 Frontage Road" }];
    for (const name of [undefined, text.split(",")[0]]) {
      stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [...decoys, { ...exact, name }] } });
      const area = text.split(", ").slice(1);
      await saveOnlyVenue(text, [exact.formatted, ...area].join(", "));
    }
    expect(stub.mock.calls.map(([url]) => url.searchParams.get("text"))).toEqual([text, text]);
  } finally {
    stub.mockRestore();
    vi.unstubAllEnvs();
    await __resetAppPoolForTests();
    env.dispose();
  }
});

test.each([
  { query: "12 Example Road, Miami, FL 33101, USA", suppliedState: { state_code: "FL" } },
  { query: "12 Example Road, Miami, FL 33101, United States", suppliedState: { state_code: "FL" } },
  { query: "12 Example Road, Miami, FL, United States", suppliedState: { state_code: "FL" } },
  { query: "12 Example Road Miami FL USA", suppliedState: { state_code: "FL" } },
  { query: "12 Example Road, Miami, FL", suppliedState: { state_code: "FL" } },
  { query: "12 Example Road, Miami, FL 33101", suppliedState: { state: "Florida" } },
  { query: "12 Example Road, Miami, Florida 33101", suppliedState: { state_code: "FL" } },
])("ISSUE-089/090: verify every qualifier before signing $query", async ({ query, suppliedState }) => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
  vi.stubEnv("GROUPRIDE_SELECTION_SECRET", Buffer.alloc(32, 8).toString("base64url"));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  const exact = { ...building("12"), city: "Miami", ...suppliedState, postcode: "33101" };
  const decoys = [
    { ...building("12"), city: "Miami", state_code: "OK", postcode: "74354" },
    { ...exact, state: "Florida", state_code: "OK" },
    { ...exact, city: "Other City" },
    { ...building("12"), city: "Miami", postcode: "33101" },
  ];
  const stub = vi.spyOn(transport, "requestProviderJson");
  try {
    for (const results of [[decoys[0]], decoys]) {
      stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results } });
      const missing = await search(query);
      expect(missing.status, query).toBe(200);
      expect((await missing.json()).suggestions, query).toEqual([]);
    }
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [...decoys, exact] } });
    await saveOnlyVenue(query, `12 Example Road, Miami, ${suppliedState.state_code ?? suppliedState.state} 33101`);
  } finally {
    stub.mockRestore();
    vi.unstubAllEnvs();
    await __resetAppPoolForTests();
    env.dispose();
  }
});

test("ISSUE-089/090: inline, quoted and free-text localities constrain the signed building", async () => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
  vi.stubEnv("GROUPRIDE_SELECTION_SECRET", Buffer.alloc(32, 8).toString("base64url"));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  const exact = { ...building("24", "Studio 54 Theater"), street: "North OR 99 Frontage Road",
    city: "Central Point", state: "Oregon", postcode: "97502-1234" };
  const other = { ...exact, state: "Oklahoma", postcode: "74354" };
  const detail = "24 North OR 99 Frontage Road, Central Point, Oregon 97502-1234";
  const stub = vi.spyOn(transport, "requestProviderJson");
  try {
    for (const query of [
      "24 N OR-99 Frontage Rd Central Point OR 97502 USA",
      "24 N OR-99 Frontage Rd, Central Point, OR, 97502 United States",
      "Studio 54 Theater, Central Point, OR, United States",
      '"Studio 54 Theater", Central Point, OR 97502 USA',
      "Theater, Central Point, OR 97502, U.S.A.",
    ]) {
      stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [other] } });
      const missing = await search(query);
      expect(missing.status, query).toBe(200);
      expect((await missing.json()).suggestions, query).toEqual([]);
      stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [other, exact] } });
      await saveOnlyVenue(query, detail);
    }
  } finally {
    stub.mockRestore();
    vi.unstubAllEnvs();
    await __resetAppPoolForTests();
    env.dispose();
  }
});

test.each([
  {
    query: "12 Example Road, Ste. Genevieve, MO",
    exact: { city: "Ste. Genevieve", state_code: "MO" },
    decoy: { city: "Springfield", state_code: "MO" },
    detail: "12 Example Road, Ste. Genevieve, MO",
    controls: ["12 Example Road Ste. Genevieve, MO", "12 Example Road, Ste. 4B, Ste. Genevieve, MO"],
  },
  {
    query: "12 Example Road, Miami, 33101, USA",
    exact: { city: "Miami", state: "Florida", state_code: "FL", postcode: "33101" },
    decoy: { city: "Miami", state: "Florida", state_code: "OK", postcode: "33101" },
    detail: "12 Example Road, Miami, FL 33101",
    controls: ["12 Example Road", "Example Hall", '"Example Hall", Miami, FL', "12 Example Road, Miami, FL 33101"],
  },
  {
    query: "12 Example Road, Washington, 20001, USA",
    exact: { city: "Washington", state_code: "DC", postcode: "20001" },
    decoy: { city: "Other City", state_code: "WA", postcode: "98001" },
    detail: "12 Example Road, Washington, DC 20001",
    controls: ["12 Example Road Washington 20001", "12 Example Road, Washington, DC 20001"],
  },
])("ISSUE-089–091: only a consistent building can be saved for $query", async ({ query, exact, decoy, detail, controls }) => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
  vi.stubEnv("GROUPRIDE_SELECTION_SECRET", Buffer.alloc(32, 8).toString("base64url"));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  const rejected = { ...building("12", "Example Hall"), ...decoy };
  const accepted = { ...building("12", "Example Hall"), ...exact };
  const stub = vi.spyOn(transport, "requestProviderJson");
  try {
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [rejected] } });
    const absent = await search(query);
    expect(absent.status).toBe(200);
    expect((await absent.json()).suggestions).toEqual([]);
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [rejected, accepted] } });
    for (const text of [query, ...controls]) await saveOnlyVenue(text, detail);
  } finally {
    stub.mockRestore();
    vi.unstubAllEnvs();
    await __resetAppPoolForTests();
    env.dispose();
  }
});

test("ISSUE-089: FL plus a ZIP belongs to the selected Miami building", async () => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
  vi.stubEnv("GROUPRIDE_SELECTION_SECRET", Buffer.alloc(32, 8).toString("base64url"));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  const exact = { ...building("12"), city: "Miami", state_code: "FL", state: "Florida", postcode: "33101" };
  const oklahoma = { ...exact, state_code: "OK", state: "Oklahoma", postcode: "74354" };
  const wrongZip = { ...exact, postcode: "33102" };
  const otherState = { ...oklahoma, postcode: "33101" };
  const detail = "12 Example Road, Miami, FL 33101";
  const stub = vi.spyOn(transport, "requestProviderJson");
  try {
    for (const query of ["12 Example Road Miami FL 33101", "12 Example Road Miami, FL 33101", detail,
      "12 Example Road Miami Florida 33101", "12 Example Road Fl 4, Miami, FL 33101"]) {
      for (const results of [[oklahoma], [wrongZip], [otherState, building("12"), { ...exact, city: "Other City" }]]) {
        stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results } });
        const response = await search(query);
        expect(response.status, query).toBe(200);
        expect((await response.json()).suggestions, query).toEqual([]);
      }
      stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [wrongZip, oklahoma, exact] } });
      await saveOnlyVenue(query, detail);
    }
    const zip4 = { ...exact, postcode: "33101-1234" };
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [zip4, { ...zip4, postcode: "33101-9999" }] } });
    await saveOnlyVenue("12 Example Road Miami FL 33101-1234", detail + "-1234");
  } finally {
    stub.mockRestore();
    vi.unstubAllEnvs();
    await __resetAppPoolForTests();
    env.dispose();
  }
});

test("ISSUE-089: a city or ZIP attached to the street must come from the selected building", async () => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
  vi.stubEnv("GROUPRIDE_SELECTION_SECRET", Buffer.alloc(32, 8).toString("base64url"));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  const exact = { ...building("12"), city: "Austin", state_code: "TX", state: "Texas", postcode: "78701" };
  const detail = "12 Example Road, Austin, TX 78701";
  const stub = vi.spyOn(transport, "requestProviderJson");
  try {
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [exact] } });
    await saveOnlyVenue(detail, detail);

    const decoys = [{ ...exact, street: "Other Road" }, { ...exact, housenumber: "99" },
      { ...exact, postcode: "78702" }, { ...exact, city: "Dallas" }];
    for (const query of ["12 Example Road Austin, TX 78701", "12 Example Road Austin TX 78701",
      "12 Example Rd Austin Texas 78701", "12 Example Road 78701"]) {
      const others = query === "12 Example Road 78701" ? decoys.slice(0, 3) : decoys;
      stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [...others, exact] } });
      await saveOnlyVenue(query, detail);
      stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [...others, building("12")] } });
      const missing = await search(query);
      expect(missing.status).toBe(200);
      expect((await missing.json()).suggestions, query).toEqual([]);
    }
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [exact] } });
    for (const query of ["12 Example Road Austin, OK 78701", "12 Example Road Unverified Austin TX 78701"]) {
      const response = await search(query);
      expect(response.status).toBe(200);
      expect((await response.json()).suggestions, query).toEqual([]);
    }
    const oregon = { ...exact, city: "Central Point", state_code: "OR", state: "Oregon", postcode: "97502-1234" };
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [oregon] } });
    for (const zip of ["97502-1234", "97502"]) {
      await saveOnlyVenue("12 Example Rd Apt 4B Central Point OR " + zip, "12 Example Road, Central Point, OR 97502-1234");
    }
    const venue = { ...exact, housenumber: "42", name: "F45 Training" };
    const split = [{ ...exact, housenumber: "F45", street: "Other Road" }, { ...exact, housenumber: "17", street: "Training" }];
    const name = "F45 Training Austin TX 78701";
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: split } });
    const absent = await search(name);
    expect(absent.status).toBe(200);
    expect((await absent.json()).suggestions).toEqual([]);
    stub.mockResolvedValue({ status: 200, retryAfter: null, data: { results: [...split, venue] } });
    const clarification = await search(name);
    expect(clarification.status).toBe(400);
    expect((await clarification.json()).error.message).toContain("exact name in double quotes");
  } finally {
    stub.mockRestore();
    vi.unstubAllEnvs();
    await __resetAppPoolForTests();
    env.dispose();
  }
});

test.each([
  {
    description: "complete house number",
    numbers: ["12", "12 1/2", "99", "12A", "12-14"],
    searches: [
      ["12 Example Street", "12"], ["12 1/2 Example Street", "12 1/2"],
      ["Example Hall, 12 Example Street", "12"], ["Example Hall, 12 1/2 Example Street", "12 1/2"],
      ["12a Example Street", "12A"], ["12-14 Example Street", "12-14"],
      ["12½ Example Street", "12 1/2"], ["12 1/2", "12 1/2"],
      ["5 Example Hall, 12 Example Street, 78705", "12"],
      ["5 Example Hall, 12-14 Example Street, Portland, OR 97201", "12-14"],
    ],
  },
  {
    description: "hyphenated suffix and apartment",
    numbers: ["99", "4B", "12B", "12", "12-B"],
    searches: [
      ["12-B Example Street", "12-B"], ["12-b Example Street, 4B", "12-B"],
      ["12 Example Street, 4B", "12"], ["12 Example Street, Apt 4B", "12"],
      ["12 Example Street Apt 4B, Austin, TX", "12"], ["12-B Example Street #4B", "12-B"],
      ["12 Example Street Fl 4", "12"], ["12 Example Street, FL 4", "12"],
      ["12 Example Street Floor 33101", "12"], ["12 Example Street, Fl #33101", "12"],
      ["Example Hall, 12 Example Street, 4B, Austin, TX 78705", "12"],
      ["4B Example Street", "4B"], ["12B Example Street", "12B"],
      ["12-B Example Street, Apt 4B, Winston-Salem, NC 27101-1234", "12-B"],
    ],
  },
])("ISSUE-084: sign and reload only the $description match", async ({ numbers, searches }) => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  const pool = createPool(APP, 2);
  vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
  vi.stubEnv("GROUPRIDE_SELECTION_SECRET", Buffer.alloc(32, 8).toString("base64url"));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  const locations: Record<string, { city: string; state_code: string; postcode: string }> = {
    "12": { city: "Austin", state_code: "TX", postcode: "78705" },
    "12-14": { city: "Portland", state_code: "OR", postcode: "97201" },
    "12-B": { city: "Winston-Salem", state_code: "NC", postcode: "27101-1234" },
  };
  const stub = vi.spyOn(transport, "requestProviderJson").mockResolvedValue({
    status: 200, retryAfter: null, data: { results: numbers.map(housenumber => ({
      formatted: `${housenumber} Example Street`, housenumber, street: "Example Street", ...locations[housenumber],
      result_type: "building", country_code: "us", lon: -90, lat: 30,
    })) },
  });
  try {
    for (const [query, expected] of searches) {
      const { body } = await searchLocations(pool, { purpose: "venue", query });
      expect(body.suggestions.map(s => s.label)).toEqual([`${expected} Example Street`]);
      const created = await createTrip(pool, key(), {
        name: "Number check", departAt: "2027-03-05T17:30:00-06:00", locationMode: "address",
        venueSelectionToken: body.suggestions[0].token,
      });
      expect(created.httpStatus).toBe(201);
      const saved = await getTripSnapshot(pool, (created.body as { id: string }).id);
      const location = locations[expected];
      const suffix = location ? `, ${location.city}, ${location.state_code} ${location.postcode}` : "";
      expect(saved?.venue?.detail).toBe(`${expected} Example Street${suffix}`);
    }
    const missing = await searchLocations(pool, { purpose: "venue", query: "13-B Example Street, 4B" });
    expect(missing.body.suggestions).toEqual([]);
  } finally {
    stub.mockRestore();
    vi.unstubAllEnvs();
    await pool.end();
    env.dispose();
  }
});

test("ISSUE-084: ambiguous numbers ask for clarification before dispatch or signing", async () => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
  vi.stubEnv("GROUPRIDE_SELECTION_SECRET", Buffer.alloc(32, 8).toString("base64url"));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  const stub = vi.spyOn(transport, "requestProviderJson").mockResolvedValue({
    status: 200, retryAfter: null, data: { results: [] },
  });
  try {
    for (const query of ["12 Example Road, Austin, TX, or 99 Other Road, Dallas, TX",
      "24 N TX-35 Frontage Road, Austin, TX, or 99 Other Road, Dallas, TX",
      "24 N OR-99 Frontage Road, Eugene, OR, or 99 Other Road, Salem, OR",
      "24 North OR-99 Frontage Road or 99 Other Road",
      "12 Example Road, Austin, TX - 99 Other Road, Dallas, TX",
      "2500 I-35 Frontage Road, Austin, TX, or 12 US-183 Highway, Austin, TX",
      "12 US-183 Highway, Portland, OR 97201, or 2500 I-35 Frontage Road, Austin, TX",
      "99 Other Road, Dallas, TX 75201 — N6W23001 Example Road, Austin, TX",
      "12 Example Road, Austin, TX/99 Other Road, Dallas, TX",
      "12 Example Road, Austin, TX-99 Other Road, Dallas, TX",
      "12 Example Road, Austin, TX 78701/99 Other Road, Dallas, TX",
      "12 Example Road, Apt 4B, Austin, TX or 99 Other Road, Dallas, TX",
      "5 Example Hall, Austin, TX, 99 Other Road, Dallas, TX",
      '"Event Hall", Austin, TX - 99 Other Road, Dallas, TX',
      "12 Example Road - 99 Other Road", "N6W23001 Example Road — 99 Other Road",
      "12 Example Road - N6W23001 Other Road", "N6 W23001 Example Road", "12 Example Street, 99 Other Road", "12--B Example Street",
      "12 or 99 Example Street", "12 to 99 Example Street", "12 4B Example Street",
      "Example Hall, 4B", "12, 4B"]) {
      const response = await search(query);
      expect(response.status, query).toBe(400);
      const body = await response.json();
      expect(body.error).toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("Enter one building number") });
      expect(body).not.toHaveProperty("suggestions");
    }
    expect(stub).not.toHaveBeenCalled();
  } finally {
    stub.mockRestore();
    vi.unstubAllEnvs();
    await __resetAppPoolForTests();
    env.dispose();
  }
});

test("ISSUE-085: pool wait and partial provider body share the original five seconds", async () => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  const pool = createPool(APP, 1);
  const held = await pool.connect();
  const started = deferred<void>();
  const closed = deferred<void>();
  const server = createServer((_req, res) => {
    res.writeHead(200).write('{"results":');
    started.resolve();
    res.once("close", closed.resolve);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const request = transport.requestProviderJson;
  const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  const redirect = vi.spyOn(transport, "requestProviderJson").mockImplementation((_url, signal) => request(url, signal));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  let released = false;
  try {
    const deps = { ...defaultSelectionDeps(), provider: () => "geoapify" as const };
    const start = performance.now();
    const pending = searchLocations(pool, { purpose: "venue", query: "Demo Hall" }, deps);
    const failure = expect(pending).rejects.toMatchObject({ code: "ADDRESS_PROVIDER_UNAVAILABLE" });
    expect(pool.waitingCount).toBe(1);
    await delay(1400);
    held.release();
    released = true;
    await started.promise;
    await failure;
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(4800);
    expect(elapsed).toBeLessThan(5700); // restarting at dispatch would take at least 6400 ms
    await closed.promise;
    expect(redirect).toHaveBeenCalledTimes(1);
    expect((await pool.query("SELECT 1")).rowCount).toBe(1);
  } finally {
    if (!released) held.release();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    redirect.mockRestore();
    vi.unstubAllEnvs();
    await pool.end();
    env.dispose();
  }
});

test("ISSUE-085: a canceled pool wait and an expired signing-key wait never dispatch later", async () => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  const pool = createPool(APP, 1);
  const stub = vi.spyOn(transport, "requestProviderJson").mockRejectedValue(new Error("Unexpected dispatch"));
  try {
    const deps = { ...defaultSelectionDeps(), provider: () => "geoapify" as const };
    const raw = { query: "Demo Hall", purpose: "venue" };
    const held = await pool.connect();
    try {
      const caller = new AbortController();
      const pending = searchLocations(pool, raw, deps, caller.signal);
      expect(pool.waitingCount).toBe(1);
      caller.abort();
      await expect(pending).rejects.toMatchObject({ code: "ADDRESS_PROVIDER_UNAVAILABLE" });
    } finally { held.release(); }
    const loading = deferred<void>();
    const secret = deferred<Awaited<ReturnType<typeof deps.loadMaster>>>();
    const pending = searchLocations(pool, raw, { ...deps, loadMaster: () => { loading.resolve(); return secret.promise; } });
    await loading.promise;
    await expect(pending).rejects.toMatchObject({ code: "ADDRESS_PROVIDER_UNAVAILABLE" });
    secret.resolve({ master: Buffer.alloc(32), created: false });
    await pool.query("SELECT 1");
    expect(stub).not.toHaveBeenCalled();
  } finally {
    stub.mockRestore();
    await pool.end();
    env.dispose();
  }
});

test("D pilot rehearsal: signed US search, venue bias, matrix, disconnected rematch, save and replay", async () => {
  await resetTestDatabase();
  const env = useFixtureEnvironment();
  const pool = createPool(APP, 3);
  const queries: URLSearchParams[] = [];
  const streets = { venue: "Event Square", driver_start: "Depot Way", pickup: "Park Lane" };
  let matrices = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/v1/geocode/autocomplete") {
      queries.push(url.searchParams);
      const text = url.searchParams.get("text")!;
      if (text === "Quota test") { res.writeHead(429, { "retry-after": "7" }).end(); return; }
      const building = {
        name: text, formatted: text, country_code: "us", result_type: "building", housenumber: "10",
        place_id: "a".repeat(150), street: Object.values(streets).find(street => text === `10 ${street}`),
        city: "Fixture City", state_code: "TX",
        lon: -97 + queries.length / 100, lat: 30, datasource: { attribution: "Example civic survey" },
      };
      res.end(JSON.stringify({ results: [
        { ...building, housenumber: "19" }, { ...building, country_code: "ca" },
        { ...building, result_type: "city" }, { ...building, lon: 181 }, building,
      ] }));
    } else if (url.pathname === "/v1/routematrix") {
      matrices++;
      let data = "";
      for await (const chunk of req) data += chunk;
      const { sources, targets } = JSON.parse(data) as {sources: unknown[]; targets: unknown[]};
      res.end(JSON.stringify({ sources_to_targets: sources.map((_, i) => targets.map((_, j) => ({
        source_index: i, target_index: j, time: 100,
      }))) }));
    } else res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const request = transport.requestProviderJson;
  vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
  vi.stubEnv("GROUPRIDE_SELECTION_SECRET", Buffer.alloc(32, 7).toString("base64url"));
  vi.stubEnv("GEOAPIFY_API_KEY", "fictional");
  const redirect = vi.spyOn(transport, "requestProviderJson").mockImplementation((url, signal, body) => {
    expect(url.origin).toBe("https://api.geoapify.com");
    return request(new URL(`http://127.0.0.1:${port}${url.pathname}${url.search}`), signal, body);
  });
  try {
    async function select(purpose: "venue" | "driver_start" | "pickup", tripId?: string) {
      const query = "10 " + streets[purpose];
      const { body } = await searchLocations(pool, { purpose, query, tripId });
      expect(body).toMatchObject({ provider: "geoapify", attribution: "Example civic survey" });
      expect(body.suggestions).toHaveLength(1);
      expect(body.suggestions[0]).toMatchObject({ label: query, precision: "building", selectable: true });
      return body.suggestions[0].token!;
    }
    const created = await createTrip(pool, key(), { name: "Pilot rehearsal", locationMode: "address",
      departAt: "2027-03-05T17:30:00-06:00", venueSelectionToken: await select("venue") });
    expect(created.httpStatus).toBe(201);
    const trip = (created.body as { id: string }).id;
    const driver = await addDriver(pool, trip, key(), { name: "D", seatCapacity: 2, maxDetourMinutes: 15,
      startSelectionToken: await select("driver_start", trip) });
    expect(driver.httpStatus).toBe(201);
    expect((await addRequest(pool, trip, key(), { name: "P", pickupSelectionToken: await select("pickup", trip) })).httpStatus).toBe(201);
    expect(queries.map(q => q.get("bias"))).toEqual([null, "proximity:-96.99,30", "proximity:-96.99,30"]);
    for (const q of queries) {
      expect(q.get("filter")).toBe("countrycode:us");
      expect(q.get("limit")).toBe("5");
      expect(q.has("tripId")).toBe(false);
    }
    const first = (await publishPreview(pool, trip)).body;
    expect(first.optimal).toMatchObject({ matchedCount: 1, totalCost: 100 });
    expect(matrices).toBe(2);
    vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "off");
    expect((await editDriver(pool, trip, (driver.body as { id: string }).id, key(),
      { baseVersion: first.baseVersion, seatCapacity: 1 })).httpStatus).toBe(200);
    const next = (await publishPreview(pool, trip)).body;
    expect(next.estimate?.legs).toMatchObject({ fetched: 0, reused: 3 });
    const requestKey = key();
    const save = () => commitPreview(pool, trip, requestKey, { previewId: next.previewId });
    const committed = await save();
    expect(committed.httpStatus).toBe(200);
    expect((await save()).body).toEqual(committed.body);
    expect(await getTripSnapshot(pool, trip)).toMatchObject({ committedPreviewId: next.previewId,
      totals: { matched: 1, totalCost: 100 }, venue: { attribution: "Example civic survey" } });
    expect([queries.length, matrices]).toEqual([3, 2]);

    vi.stubEnv("GROUPRIDE_ADDRESS_PROVIDER", "geoapify");
    await expect(searchLocations(pool, { purpose: "venue", query: "Quota test" })).rejects.toMatchObject({
      code: "ADDRESS_PROVIDER_UNAVAILABLE", retryAfterSeconds: 7,
    });
    const { geoapifyRoutingAdapter } = await import("../../src/routing/geoapify.ts");
    const a = { id: "a", providerRef: "a", lon: 0, lat: 1 }, b = { id: "b", providerRef: "b", lon: 2, lat: 3 };
    await expect(geoapifyRoutingAdapter().fetchLegs([{ from: a, to: b }], { venueId: "b" })).rejects.toMatchObject({ code: "ROUTING_QUOTA" });
    expect(matrices).toBe(2);
  } finally {
    redirect.mockRestore();
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    env.dispose();
  }
});
