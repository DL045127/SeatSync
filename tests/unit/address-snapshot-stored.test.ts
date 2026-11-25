// A stored location snapshot is read back by every dashboard load, so its issue time must be a
// real instant, not merely the right shape (ISSUE-072).
import { describe, expect, test } from "vitest";
import { parseStoredSnapshot } from "../../src/locations/snapshot.ts";
import { StoredDataError } from "../../src/contracts/errors.ts";

const valid = () => ({
  id: "00000000-0000-4000-8000-000000000001",
  provider: "fixture",
  providerRef: "ref-1",
  countryCode: "US",
  label: "Fictional Hall",
  address: { street: "1 Example St", city: "Austin", state: "TX", postcode: "78701" },
  lon: -97.74,
  lat: 30.27,
  precision: "entrance",
  attribution: "Fictional fixture data",
  issuedAt: "2026-11-24T12:00:00.000Z",
});

describe("parseStoredSnapshot issue time", () => {
  test("a real instant is accepted", () => {
    expect(parseStoredSnapshot(valid()).issuedAt).toBe("2026-11-24T12:00:00.000Z");
  });
  test("a real leap day is accepted (control for the calendar check)", () => {
    expect(parseStoredSnapshot({ ...valid(), issuedAt: "2028-02-29T00:00:00.000Z" }).issuedAt).toBe("2028-02-29T00:00:00.000Z");
    expect(() => parseStoredSnapshot({ ...valid(), issuedAt: "2027-02-29T00:00:00.000Z" })).toThrow(StoredDataError);
  });
  test.each(["2026-19-42T35:73:65.000Z", "2026-02-30T00:00:00.000Z", "2026-11-24T24:00:00.000Z", "2026-13-01T00:00:00.000Z"])(
    "%s is a server-side StoredDataError",
    (issuedAt) => {
      expect(() => parseStoredSnapshot({ ...valid(), issuedAt })).toThrow(StoredDataError);
    },
  );
});
