// Selection master secret (docs/ARCHITECTURE-v2.md section 3). In fixture mode
// the server creates it lazily on first runtime use, never at module import
// (`next build` evaluates route modules). Publication never overwrites a
// concurrent winner and never exposes a partial key: write a uniquely named
// temporary file, fsync it, then link() it to the final name, and unlink the
// temporary name on success, EEXIST and any error.
//
// Server-only: this module uses the filesystem.

import { randomBytes } from "node:crypto";
import { link, lstat, mkdir, open, readFile, unlink, chmod } from "node:fs/promises";
import path from "node:path";

export const MASTER_MIN_BYTES = 32;
export const FIXTURE_KEY_FILE = "fixture-signing.key";
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/** A storage or format failure of the master secret that is detectable and retryable. */
export class SelectionKeyUnavailable extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SelectionKeyUnavailable";
  }
}

export type TargetName = "demo" | "test";

type Env = Readonly<Record<string, string | undefined>>;

export interface MasterKeyOptions {
  mode: "fixture" | "live";
  target: TargetName;
  /** Root of the ignored local directory. Defaults to `<cwd>/.groupride-local`. */
  rootDir?: string;
  env?: Env;
}

export interface MasterKey {
  master: Buffer;
  /** True when this call created the fixture secret. */
  created: boolean;
}

export function defaultRootDir(env: Env = process.env): string {
  return env.GROUPRIDE_LOCAL_DIR ?? path.resolve(process.cwd(), ".groupride-local");
}

/** Decode and validate stored secret text; throws SelectionKeyUnavailable. */
export function parseMasterText(text: string): Buffer {
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!SEGMENT_RE.test(trimmed)) {
    throw new SelectionKeyUnavailable("The selection master secret is not canonical base64url text.");
  }
  const bytes = Buffer.from(trimmed, "base64url");
  if (bytes.toString("base64url") !== trimmed) {
    throw new SelectionKeyUnavailable("The selection master secret is not canonical base64url text.");
  }
  if (bytes.length < MASTER_MIN_BYTES) {
    throw new SelectionKeyUnavailable("The selection master secret is too short.");
  }
  return bytes;
}

// Test-only seam: replace link() to inject a publication failure other than
// EEXIST. Production never sets it.
let linkImpl: typeof link = link;
export function __setLinkForTests(impl: typeof link | undefined): void {
  linkImpl = impl ?? link;
}

// Only successful loads are cached, so a repaired file is read on the next
// attempt. A cached secret is not re-read: editing or deleting the file affects
// the next server process, not the running one.
const cache = new Map<string, Buffer>();

export function __clearMasterCacheForTests(): void {
  cache.clear();
}

export async function loadMaster(options: MasterKeyOptions): Promise<MasterKey> {
  const env = options.env ?? process.env;
  const cacheKey = `${options.mode}:${options.target}:${options.rootDir ?? defaultRootDir(env)}`;
  const cached = cache.get(cacheKey);
  if (cached) return { master: cached, created: false };

  const loaded = options.mode === "live" ? loadLive(env) : await loadFixture(options, env);
  cache.set(cacheKey, loaded.master);
  return loaded;
}

function loadLive(env: Env): MasterKey {
  const text = env.GROUPRIDE_SELECTION_SECRET;
  if (!text) throw new SelectionKeyUnavailable("GROUPRIDE_SELECTION_SECRET is not configured.");
  return { master: parseMasterText(text), created: false };
}

async function loadFixture(options: MasterKeyOptions, env: Env): Promise<MasterKey> {
  const root = options.rootDir ?? defaultRootDir(env);
  const dir = path.join(root, options.target);
  const file = path.join(dir, FIXTURE_KEY_FILE);

  try {
    await ensureDirectory(root, dir);
    const existing = await readKeyFile(file);
    if (existing) return { master: existing, created: false };
    return await createKeyFile(dir, file);
  } catch (error) {
    if (error instanceof SelectionKeyUnavailable) throw error;
    throw new SelectionKeyUnavailable("The selection master secret storage is unavailable.", error);
  }
}

async function ensureDirectory(root: string, dir: string): Promise<void> {
  // mkdir with a mode is subject to the umask, which can only remove bits.
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new SelectionKeyUnavailable("The selection key directory is not a directory.");
  }
  // A directory this process just created may still be wider than 0700 under an
  // unusual umask; an existing wider directory is refused rather than trusted.
  if ((info.mode & 0o077) !== 0) {
    await chmod(dir, 0o700);
    if (((await lstat(dir)).mode & 0o077) !== 0) {
      throw new SelectionKeyUnavailable("The selection key directory is not owner-only.");
    }
  }
}

/** Read and validate the key file. Returns undefined only when it does not exist. */
async function readKeyFile(file: string): Promise<Buffer | undefined> {
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new SelectionKeyUnavailable("The selection master secret path is not a regular file.");
  }
  if ((info.mode & 0o077) !== 0) {
    throw new SelectionKeyUnavailable("The selection master secret file is not owner-only.");
  }
  return parseMasterText(await readFile(file, "utf8"));
}

async function createKeyFile(dir: string, file: string): Promise<MasterKey> {
  const temp = path.join(dir, `.${FIXTURE_KEY_FILE}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  const text = `${randomBytes(MASTER_MIN_BYTES).toString("base64url")}\n`;
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      // link() fails with EEXIST rather than overwriting a concurrent winner,
      // and the final name only ever appears fully written.
      await linkImpl(temp, file);
      return { master: parseMasterText(text), created: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const winner = await readKeyFile(file);
      if (!winner) throw new SelectionKeyUnavailable("The selection master secret disappeared during creation.");
      return { master: winner, created: false };
    }
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
