import { expect, test } from "vitest";
import { departureInstants } from "../../src/app/trips/departure.ts";

test.each([
  ["2026-03-01", "09:30", "UTC", ["2026-03-01T09:30:00.000Z"]],
  ["2026-01-10", "21:30", "America/Chicago", ["2026-01-11T03:30:00.000Z"]],
  ["2026-07-10", "21:30", "America/Chicago", ["2026-07-11T02:30:00.000Z"]],
  ["2026-03-08", "02:30", "America/Chicago", []],
  ["2026-11-01", "01:30", "America/Chicago", ["2026-11-01T06:30:00.000Z", "2026-11-01T07:30:00.000Z"]],
  ["2026-04-05", "01:45", "Australia/Lord_Howe", ["2026-04-04T14:45:00.000Z", "2026-04-04T15:15:00.000Z"]],
  ["2026-01-10", "00:15", "Asia/Kathmandu", ["2026-01-09T18:30:00.000Z"]],
] as const)("resolves %s at %s in %s", (date, time, zone, expected) => {
  expect(departureInstants(date, time, zone)).toEqual(expected);
});

test("rejects impossible dates without normalizing to another day", () => {
  expect(() => departureInstants("2026-02-30", "09:30", "UTC")).toThrow();
});
