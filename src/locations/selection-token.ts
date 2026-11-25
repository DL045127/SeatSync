// Signed selection tokens (docs/ARCHITECTURE-v2.md section 3, "Stateless
// selection" and "Admission and verification order"). Pure: the caller supplies
// the master secret, the database's current dataset generation and the clock.
//
// Wire form: `header.payload.tag`, three canonical unpadded base64url segments.
// The tag is HMAC-SHA-256 over the ASCII bytes of the literal `header.payload`
// text under a key derived (HKDF-SHA-256) from the master secret and the
// current generation. Verification therefore never interprets the header or
// payload until the MAC has passed, and a token from another generation or
// another secret simply fails the MAC.

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  PURPOSES,
  PROVIDERS,
  type Purpose,
  type ProviderName,
  type SnapshotBody,
  snapshotBodySchema,
} from "./snapshot.ts";

export const TOKEN_MAX_BYTES = 4 * 1024;
export const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const FORMAT_VERSION = 1;
const HKDF_INFO = "GroupRide/selection/v1";
const KID_LABEL = "GroupRide/selection/kid/v1";
const TAG_BYTES = 32;

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const headerSchema = z
  .object({ v: z.literal(FORMAT_VERSION), kid: z.string().min(1), gen: z.string().regex(UUID_RE) })
  .strict();

const payloadSchema = z
  .object({
    id: z.string().regex(UUID_RE),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().nonnegative(),
    purpose: z.enum(PURPOSES),
    tripId: z.string().regex(UUID_RE).nullable(),
    provider: z.enum(PROVIDERS),
    snapshot: snapshotBodySchema,
  })
  .strict();

export interface SelectionPayload {
  id: string;
  iat: number;
  exp: number;
  purpose: Purpose;
  tripId: string | null;
  provider: ProviderName;
  snapshot: SnapshotBody;
}

export interface SelectionKeyContext {
  /** Master secret bytes. */
  master: Buffer;
  /** The database's current dataset generation UUID. */
  generation: string;
}

// ---- encoding -------------------------------------------------------------

function encodeSegment(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/**
 * Decode a canonical, unpadded base64url segment, or return undefined. Node's
 * decoder also accepts regular base64 and ignores non-canonical trailing bits,
 * so the character set is checked first and the decoded bytes are re-encoded
 * and compared with the received text.
 */
function decodeSegment(segment: string): Buffer | undefined {
  if (!SEGMENT_RE.test(segment)) return undefined;
  const bytes = Buffer.from(segment, "base64url");
  return encodeSegment(bytes) === segment ? bytes : undefined;
}

// ---- keys -----------------------------------------------------------------

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

/** Key identifier: 16 bytes of HMAC(master, label), unpadded base64url. */
export function keyIdentifier(master: Buffer): string {
  return encodeSegment(createHmac("sha256", master).update(KID_LABEL, "utf8").digest().subarray(0, 16));
}

export function deriveSelectionKey(context: SelectionKeyContext): Buffer {
  if (!UUID_RE.test(context.generation)) throw new Error("Invalid dataset generation.");
  return Buffer.from(
    hkdfSync("sha256", context.master, uuidBytes(context.generation), HKDF_INFO, 32),
  );
}

function mac(key: Buffer, signingInput: string): Buffer {
  return createHmac("sha256", key).update(signingInput, "ascii").digest();
}

// ---- signing --------------------------------------------------------------

export interface SignInput {
  context: SelectionKeyContext;
  purpose: Purpose;
  tripId: string | null;
  provider: ProviderName;
  id: string;
  snapshot: SnapshotBody;
  nowMs: number;
}

/**
 * Sign one suggestion. The envelope is validated before it is offered: a
 * payload the verifier would reject (a faulty encoder, an oversized token)
 * throws here instead of reaching the organizer. Returns the token string.
 */
export function signSelection(input: SignInput): string {
  const header = { v: FORMAT_VERSION, kid: keyIdentifier(input.context.master), gen: input.context.generation };
  const payload: SelectionPayload = {
    id: input.id,
    iat: input.nowMs,
    exp: input.nowMs + TOKEN_LIFETIME_MS,
    purpose: input.purpose,
    tripId: input.tripId,
    provider: input.provider,
    snapshot: input.snapshot,
  };
  headerSchema.parse(header);
  payloadSchema.parse(payload);
  return assembleToken(input.context, header, payload);
}

/**
 * Assemble and sign arbitrary header/payload JSON values. Exported for tests
 * that need a validly signed but malformed envelope (the verifier must reject
 * those with the same generic outcome and no parser exception); production
 * code uses signSelection.
 */
export function assembleToken(context: SelectionKeyContext, header: unknown, payload: unknown): string {
  return signSegments(
    context,
    encodeSegment(Buffer.from(JSON.stringify(header), "utf8")),
    encodeSegment(Buffer.from(JSON.stringify(payload), "utf8")),
  );
}

/**
 * Sign two already-encoded segments. Exported only so tests can produce a
 * validly signed envelope whose contents are not JSON at all.
 */
export function signSegments(context: SelectionKeyContext, headerSegment: string, payloadSegment: string): string {
  const tag = encodeSegment(mac(deriveSelectionKey(context), `${headerSegment}.${payloadSegment}`));
  const token = `${headerSegment}.${payloadSegment}.${tag}`;
  if (Buffer.byteLength(token, "ascii") > TOKEN_MAX_BYTES) {
    throw new Error("Selection token exceeds its size limit.");
  }
  return token;
}

// ---- verification ---------------------------------------------------------

export type SelectionFailure =
  | "type"
  | "oversize"
  | "framing"
  | "tag"
  | "mac"
  | "decode"
  | "version"
  | "key"
  | "generation"
  | "schema"
  | "expired"
  | "not_yet_valid"
  | "lifetime"
  | "purpose"
  | "scope"
  | "provider";

export interface VerifyExpectation {
  purpose: Purpose;
  /** Null for a venue token; the trip ID for a start or pickup token. */
  tripId: string | null;
  /** The trip's pinned provider, when the caller knows it (every roster write). */
  provider?: ProviderName;
}

export type VerifyResult =
  | { ok: true; payload: SelectionPayload }
  | { ok: false; reason: SelectionFailure };

/**
 * Advisory counters. After a failed MAC a bounded, best-effort look at the
 * unauthenticated header can label the failure. These hints cannot establish
 * why the MAC failed, never select a key and never alter a response or
 * receipt. Caller-supplied values are never logged or used as labels.
 */
export const selectionCounters = {
  mac_failure_claimed_key_mismatch: 0,
  mac_failure_claimed_generation_mismatch: 0,
  mac_failure_other: 0,
};

export function resetSelectionCounters(): void {
  selectionCounters.mac_failure_claimed_key_mismatch = 0;
  selectionCounters.mac_failure_claimed_generation_mismatch = 0;
  selectionCounters.mac_failure_other = 0;
}

function countMacFailure(headerSegment: string, context: SelectionKeyContext): void {
  try {
    if (headerSegment.length > 512) throw new Error("header too long");
    const bytes = decodeSegment(headerSegment);
    const hint = bytes ? (JSON.parse(bytes.toString("utf8")) as { kid?: unknown; gen?: unknown }) : undefined;
    if (hint && typeof hint === "object") {
      if (typeof hint.kid === "string" && hint.kid !== keyIdentifier(context.master)) {
        selectionCounters.mac_failure_claimed_key_mismatch += 1;
        return;
      }
      if (typeof hint.gen === "string" && hint.gen !== context.generation) {
        selectionCounters.mac_failure_claimed_generation_mismatch += 1;
        return;
      }
    }
  } catch {
    // An unreadable header is just another invalid token.
  }
  selectionCounters.mac_failure_other += 1;
}

/**
 * Verify a presented token. Every failure of client-supplied bytes is a
 * returned reason, never a thrown parser exception: the keyed mutation helper
 * would finalize any unexpected exception as a terminal 500 receipt.
 */
export function verifySelection(
  token: unknown,
  context: SelectionKeyContext,
  nowMs: number,
  expect: VerifyExpectation,
): VerifyResult {
  const fail = (reason: SelectionFailure): VerifyResult => ({ ok: false, reason });
  if (typeof token !== "string") return fail("type");
  if (Buffer.byteLength(token, "utf8") > TOKEN_MAX_BYTES) return fail("oversize");

  // Framing and encoding need no interpretation of the contents.
  const parts = token.split(".");
  if (parts.length !== 3) return fail("framing");
  const [h, p, t] = parts;
  if (!h || !p || !t) return fail("framing");
  if (decodeSegment(h) === undefined || decodeSegment(p) === undefined) return fail("framing");
  const tag = decodeSegment(t);
  // timingSafeEqual requires equal lengths, so check the tag length first.
  if (tag === undefined || tag.length !== TAG_BYTES) return fail("tag");

  // The server chooses the algorithm, key and generation, never the token.
  const expected = mac(deriveSelectionKey(context), `${h}.${p}`);
  if (!timingSafeEqual(tag, expected)) {
    countMacFailure(h, context);
    return fail("mac");
  }

  // Only now interpret the authenticated bytes.
  let header: z.infer<typeof headerSchema>;
  let payload: SelectionPayload;
  try {
    const rawHeader: unknown = JSON.parse(decodeSegment(h)!.toString("utf8"));
    const parsedHeader = headerSchema.safeParse(rawHeader);
    if (!parsedHeader.success) {
      // An unsupported version is reported separately from other bad headers.
      const v = (rawHeader as { v?: unknown } | null)?.v;
      return fail(typeof v === "number" && v !== FORMAT_VERSION ? "version" : "schema");
    }
    header = parsedHeader.data;
    const rawPayload: unknown = JSON.parse(decodeSegment(p)!.toString("utf8"));
    const parsedPayload = payloadSchema.safeParse(rawPayload);
    if (!parsedPayload.success) return fail("schema");
    payload = parsedPayload.data;
  } catch {
    return fail("decode");
  }

  if (header.kid !== keyIdentifier(context.master)) return fail("key");
  if (header.gen !== context.generation) return fail("generation");

  // Valid from issue until expiry (exclusive), for at most 30 minutes.
  if (payload.exp - payload.iat > TOKEN_LIFETIME_MS || payload.exp <= payload.iat) return fail("lifetime");
  if (nowMs < payload.iat) return fail("not_yet_valid");
  if (nowMs >= payload.exp) return fail("expired");

  if (payload.purpose !== expect.purpose) return fail("purpose");
  if (payload.tripId !== expect.tripId) return fail("scope");
  if (expect.provider !== undefined && payload.provider !== expect.provider) return fail("provider");
  return { ok: true, payload };
}
