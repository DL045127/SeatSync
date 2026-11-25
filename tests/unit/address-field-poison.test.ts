// A systematic guard for the stored-data class of defect (ISSUE-065..073): every leaf field of valid
// stored evidence and summary JSON is poisoned in turn, and each stored-data validator must refuse
// it. A field with no entry in the poison table FAILS the guard, so adding a stored field forces
// whoever adds it to decide how it can be corrupted. Unknown extra keys and deleted keys are
// exercised at every object, too.

import { describe, expect, test } from "vitest";
import {
  type AddressPoint,
  type AddressRoster,
  type Leg,
  legKey,
  resolveIdentical,
  retentionPairs,
} from "../../src/matching/address.ts";
import { buildEvidence, buildSummary, parseSummary, validateCandidate, validateEvidence } from "../../src/trips/address-evidence.ts";
import { requiredPairs } from "../../src/matching/address.ts";

const POLICY = "policy/1";
const OBSERVED = "2026-11-24T12:00:00.000Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number): AddressPoint => ({ id: uuid(100 + n), providerRef: `ref-${n}`, lon: n, lat: n * 2 });
const roster: AddressRoster = {
  venue: at(1),
  drivers: [{ id: uuid(11), seatCapacity: 1, active: true, maxDetourMinutes: 30, location: at(2) }],
  passengers: [{ id: uuid(21), active: true, location: at(4) }],
};
const legs = new Map<string, Leg>();
for (const pair of retentionPairs(roster)) {
  legs.set(legKey(pair.from.id, pair.to.id), resolveIdentical(pair) ?? {
    from: pair.from.id, to: pair.to.id, seconds: 100, source: "provider", observedAt: OBSERVED,
  });
}
const evidence = () => JSON.parse(JSON.stringify(buildEvidence(roster, POLICY, legs))) as unknown;
const summary = () =>
  JSON.parse(JSON.stringify(buildSummary("fixture", POLICY, requiredPairs(roster).map((p) => legs.get(legKey(p.from.id, p.to.id))!), { fetched: 3, reused: 0 }))) as unknown;

const BAD_TIME = ["2026-19-42T35:73:65.000Z", "2026-02-30T00:00:00.000Z", "2026-11-24T24:00:00.000Z", "not a time", 5, {}];
const BAD_UUID = ["", "not-a-uuid", uuid(1).toUpperCase(), 5, null, {}];
// Values of the wrong type or out of range for each field NAME. Every leaf field must appear here.
const POISON: Record<string, unknown[]> = {
  schema: ["address-evidence-1", "", 5, null],
  policy: ["", 5, null, "x".repeat(201)],
  id: BAD_UUID,
  from: BAD_UUID,
  to: BAD_UUID,
  providerRef: ["", 5, null, "x".repeat(121)],
  lon: [181, -181, "1", null, 1e999],
  lat: [91, -91, "1", null, 1e999],
  seats: [-1, 9, 1.5, "1", null],
  maxDetourMinutes: [-1, 121, 1.5, "30", null],
  seconds: [-1, 1_000_001, "12", {}],
  source: ["other", "", 5, null],
  observedAt: BAD_TIME,
  // summary
  costUnit: ["seconds", "", 5, null],
  provider: ["other", "", 5, null],
  routingPolicy: ["", 5, null, "x".repeat(201)],
  observedFrom: BAD_TIME,
  observedTo: BAD_TIME,
  required: [-1, 1.5, "3", null],
  fetched: [-1, 1.5, "3", null],
  reused: [-1, 1.5, "3", null],
  local: [-1, 1.5, "3", null],
};

type Path = Array<string | number>;
function walk(value: unknown, path: Path, out: Array<{ path: Path; kind: "leaf" | "object" }>): void {
  if (Array.isArray(value)) {
    if (value.length > 0) walk(value[0], [...path, 0], out); // the first element stands for the rest
  } else if (value !== null && typeof value === "object") {
    out.push({ path, kind: "object" });
    for (const [k, v] of Object.entries(value)) walk(v, [...path, k], out);
  } else {
    out.push({ path, kind: "leaf" });
  }
}
function paths(value: unknown) {
  const out: Array<{ path: Path; kind: "leaf" | "object" }> = [];
  walk(value, [], out);
  return out;
}
function setAt(root: unknown, path: Path, f: (parent: Record<string, unknown>, key: string) => void): unknown {
  let cur = root as Record<string, unknown>;
  for (const k of path.slice(0, -1)) cur = cur[k as string] as Record<string, unknown>;
  f(cur, String(path[path.length - 1]));
  return root;
}
const name = (path: Path) => [...path].reverse().find((k): k is string => typeof k === "string") ?? "";

const evidenceValidators: Array<[string, (v: unknown) => unknown]> = [
  ["validateEvidence", (v) => validateEvidence(v, roster, POLICY)],
  ["validateCandidate", (v) => validateCandidate(v, roster, POLICY)],
];

describe("every stored field is guarded", () => {
  test("the unpoisoned fixtures are valid for every validator (so rejections are caused by the poison)", () => {
    for (const [, run] of evidenceValidators) expect(() => run(evidence())).not.toThrow();
    expect(() => parseSummary(summary(), { routingPolicy: POLICY, provider: "fixture", algorithmVersion: `x+${POLICY}` })).not.toThrow();
  });

  test("no leaf field is missing from the poison table", () => {
    const missing = [...paths(evidence()), ...paths(summary())]
      .filter((p) => p.kind === "leaf")
      .map((p) => name(p.path))
      .filter((n) => !(n in POISON));
    expect(new Set(missing)).toEqual(new Set());
  });

  for (const [label, make, validators] of [
    ["evidence", evidence, evidenceValidators],
    ["summary", summary, [["parseSummary", (v: unknown) => parseSummary(v, { routingPolicy: POLICY, provider: "fixture" })]] as Array<[string, (v: unknown) => unknown]>],
  ] as const) {
    describe(`${label}`, () => {
      const all = paths(make());
      for (const { path, kind } of all) {
        const where = path.join(".") || "(root)";
        if (kind === "leaf") {
          const poisons = POISON[name(path)] ?? [];
          poisons.forEach((poison, i) => {
            test(`${where} <- poison #${i} (${JSON.stringify(poison)?.slice(0, 30)})`, () => {
              for (const [vname, run] of validators) {
                const doc = setAt(make(), path, (parent, key) => { parent[key] = poison; });
                expect(() => run(doc), vname).toThrow();
              }
            });
          });
          // Deleting a non-nullable leaf (nullable leaves may legitimately be null, never absent).
          test(`${where} deleted`, () => {
            for (const [vname, run] of validators) {
              const doc = setAt(make(), path, (parent, key) => { delete parent[key]; });
              expect(() => run(doc), vname).toThrow();
            }
          });
        } else {
          test(`${where} rejects an unknown extra key`, () => {
            for (const [vname, run] of validators) {
              const doc = make();
              const target = path.length === 0 ? (doc as Record<string, unknown>) : (path.reduce((c, k) => (c as Record<string, unknown>)[k as string], doc) as Record<string, unknown>);
              target.extra = 1;
              expect(() => run(doc), vname).toThrow();
            }
          });
        }
      }
    });
  }
});
