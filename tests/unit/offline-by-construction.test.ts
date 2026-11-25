// Two L-01/L-03 properties of the offline fixture path, checked automatically:
//  1. Importing the route modules (which is what `next build` does while
//     collecting page data) creates no key file and opens no connection.
//  2. The fixture search/routing/projection code contains no network capability.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "groupride-import-"));
});
afterEach(() => {
  delete process.env.GROUPRIDE_LOCAL_DIR;
  delete process.env.GROUPRIDE_ADDRESS_PROVIDER;
  rmSync(dir, { recursive: true, force: true });
});

describe("importing the application modules has no side effects", () => {
  test("no key directory is created and no database URL is needed", async () => {
    process.env.GROUPRIDE_LOCAL_DIR = path.join(dir, "local");
    process.env.GROUPRIDE_ADDRESS_PROVIDER = "fixture";
    delete process.env.DATABASE_URL;
    await Promise.all([
      import("../../src/app/api/locations/search/route.ts"),
      import("../../src/app/api/trips/route.ts"),
      import("../../src/app/api/trips/[tripId]/drivers/route.ts"),
      import("../../src/app/api/trips/[tripId]/requests/route.ts"),
      import("../../src/app/api/trips/[tripId]/match/preview/route.ts"),
      import("../../src/app/api/trips/[tripId]/match/commit/route.ts"),
      import("../../src/locations/selection-service.ts"),
      import("../../src/locations/master-key.ts"),
    ]);
    expect(existsSync(path.join(dir, "local"))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });
});

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = path.join(root, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("the fixture path has no network capability", () => {
  const files = [
    ...sourceFiles("src/locations"),
    ...sourceFiles("src/routing").filter((file) => file !== "src/routing/geoapify.ts"),
    "src/matching/address.ts",
    "src/trips/address-evidence.ts",
    "src/trips/address-preview.ts",
    "src/trips/address-roster.ts",
  ];
  const forbidden = [
    /\bfetch\s*\(/,
    /node:(http|https|http2|net|tls|dns|dgram)\b/,
    /from\s+["'](undici|axios|node-fetch|got|ws)["']/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
  ];

  test("the scan covers the search, routing and projection modules", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain("src/locations/fixture-provider.ts");
    expect(files).toContain("src/routing/fixture.ts");
  });

  test.each(files)("%s", (file) => {
    const text = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const pattern of forbidden) expect(text, `${file} matches ${pattern}`).not.toMatch(pattern);
  });
});
