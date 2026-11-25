// Master secret lifecycle (docs/ARCHITECTURE-v2.md section 3, L-01): lazy
// creation, no-overwrite publication under real concurrency (in-process and
// across processes), owner-only permissions, temp-file cleanup on success,
// EEXIST and error, retryable detectable failures, success-only caching.

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  FIXTURE_KEY_FILE,
  SelectionKeyUnavailable,
  __clearMasterCacheForTests,
  __setLinkForTests,
  loadMaster,
  parseMasterText,
} from "../../src/locations/master-key.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "groupride-key-"));
  __clearMasterCacheForTests();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const keyFile = () => path.join(root, "test", FIXTURE_KEY_FILE);
const options = () => ({ mode: "fixture" as const, target: "test" as const, rootDir: root });
const leftovers = () => readdirSync(path.join(root, "test")).filter((name) => name !== FIXTURE_KEY_FILE);

describe("lazy creation", () => {
  test("nothing is created until first use, then an owner-only key appears", async () => {
    expect(existsSync(root) && readdirSync(root).length).toBeFalsy();
    const { master, created } = await loadMaster(options());
    expect(created).toBe(true);
    expect(master).toHaveLength(32);
    expect(statSync(keyFile()).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(keyFile())).mode & 0o777).toBe(0o700);
    expect(leftovers()).toEqual([]); // the temporary name is unlinked after a successful link
  });

  test("a later start reuses the key and does not rewrite it", async () => {
    const first = await loadMaster(options());
    __clearMasterCacheForTests(); // a new process
    const second = await loadMaster(options());
    expect(second.created).toBe(false);
    expect(second.master.equals(first.master)).toBe(true);
  });

  test("demo and test targets keep separate keys", async () => {
    const a = await loadMaster({ ...options(), target: "demo" });
    const b = await loadMaster({ ...options(), target: "test" });
    expect(a.master.equals(b.master)).toBe(false);
  });
});

describe("a publication failure other than EEXIST", () => {
  afterEach(() => __setLinkForTests(undefined));

  test("is retryable, leaves NO temporary file and no partial key, and a retry then succeeds", async () => {
    __setLinkForTests(async () => {
      throw Object.assign(new Error("injected I/O failure"), { code: "EIO" });
    });
    await expect(loadMaster(options())).rejects.toBeInstanceOf(SelectionKeyUnavailable);
    expect(readdirSync(path.join(root, "test"))).toEqual([]); // the temporary name was unlinked on ERROR
    __setLinkForTests(undefined);
    const retry = await loadMaster(options());
    expect(retry.created).toBe(true); // nothing was published by the failed attempt
    expect(leftovers()).toEqual([]);
  });
});

describe("concurrent initialization", () => {
  test("in-process racers all read one winner and leave no temporary files", async () => {
    const results = await Promise.all(Array.from({ length: 16 }, () => loadMaster(options())));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    for (const r of results) expect(r.master.equals(results[0].master)).toBe(true);
    expect(leftovers()).toEqual([]);
    expect(readFileSync(keyFile(), "utf8")).toBe(`${results[0].master.toString("base64url")}\n`);
  });

  test("separate processes racing from an empty directory agree on exactly one creator", async () => {
    const helper = path.resolve("tests/unit/helpers/init-master-key.ts");
    const run = () =>
      new Promise<{ created: boolean; key: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", helper, root], { stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk) => (out += chunk));
        child.stderr.on("data", (chunk) => (err += chunk));
        child.on("close", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))));
      });
    const results = await Promise.all(Array.from({ length: 8 }, run));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.key)).size).toBe(1);
    expect(leftovers()).toEqual([]);
    expect(statSync(keyFile()).mode & 0o777).toBe(0o600);
  }, 30_000);
});

describe("detectable failures are retryable and never cached", () => {
  async function seed(text: string, mode = 0o600): Promise<void> {
    await mkdir(path.dirname(keyFile()), { recursive: true, mode: 0o700 });
    writeFileSync(keyFile(), text, { mode });
    chmodSync(keyFile(), mode);
  }

  test.each([
    ["too short", `${Buffer.alloc(16, 1).toString("base64url")}\n`],
    ["not base64url", "not a key!\n"],
    ["padded", `${Buffer.alloc(32, 1).toString("base64")}\n`],
    ["empty", ""],
  ])("a malformed file (%s) is unavailable and is not overwritten", async (_name, text) => {
    await seed(text);
    await expect(loadMaster(options())).rejects.toBeInstanceOf(SelectionKeyUnavailable);
    expect(readFileSync(keyFile(), "utf8")).toBe(text);
  });

  test("a group- or world-readable file is refused", async () => {
    await seed(`${Buffer.alloc(32, 7).toString("base64url")}\n`, 0o644);
    await expect(loadMaster(options())).rejects.toBeInstanceOf(SelectionKeyUnavailable);
  });

  test("a directory in place of the file is unavailable", async () => {
    await mkdir(keyFile(), { recursive: true });
    await expect(loadMaster(options())).rejects.toBeInstanceOf(SelectionKeyUnavailable);
  });

  test("repair then retry succeeds (failures are not cached); a warm process ignores later edits", async () => {
    await seed("garbage\n");
    await expect(loadMaster(options())).rejects.toBeInstanceOf(SelectionKeyUnavailable);
    const good = `${Buffer.alloc(32, 9).toString("base64url")}\n`;
    writeFileSync(keyFile(), good);
    const repaired = await loadMaster(options());
    expect(repaired.master.equals(Buffer.alloc(32, 9))).toBe(true);
    // Deleting or editing the file now affects the NEXT process, not this one.
    rmSync(keyFile());
    expect((await loadMaster(options())).master.equals(Buffer.alloc(32, 9))).toBe(true);
  });

  test("a deleted file in a new process creates a new, different secret", async () => {
    const first = await loadMaster(options());
    rmSync(keyFile());
    __clearMasterCacheForTests();
    const second = await loadMaster(options());
    expect(second.created).toBe(true);
    expect(second.master.equals(first.master)).toBe(false);
  });

  test("live mode reads the configured secret and never creates a file", async () => {
    await expect(loadMaster({ ...options(), mode: "live", env: {} })).rejects.toBeInstanceOf(SelectionKeyUnavailable);
    const secret = Buffer.alloc(32, 3).toString("base64url");
    const { master, created } = await loadMaster({ ...options(), mode: "live", env: { GROUPRIDE_SELECTION_SECRET: secret } });
    expect(created).toBe(false);
    expect(master.equals(Buffer.alloc(32, 3))).toBe(true);
    expect(existsSync(path.join(root, "test"))).toBe(false);
  });
});

describe("secret text format", () => {
  test("accepts canonical unpadded base64url of at least 32 bytes", () => {
    expect(parseMasterText(`${Buffer.alloc(32, 5).toString("base64url")}\n`)).toHaveLength(32);
    expect(parseMasterText(Buffer.alloc(48, 5).toString("base64url"))).toHaveLength(48);
  });
});
