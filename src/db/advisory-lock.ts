import { createHash } from "node:crypto";

/**
 * Derive the transaction-scoped advisory lock ID for a mutation request key.
 * Architecture section 6: interpret the first eight bytes of
 * SHA-256("mutation-lock-v1:<lowercase UUID>") as a signed 64-bit big-endian
 * integer, bound as a decimal bigint string for `pg_advisory_xact_lock(bigint)`.
 *
 * A hash collision only serializes two unrelated keys; it never merges their
 * identities, because the receipt table stores and compares the full UUID and
 * fingerprint. This single-bigint namespace is distinct from the two-int
 * dataset lock.
 */
export function mutationLockId(requestKey: string): string {
  const digest = createHash("sha256")
    .update(`mutation-lock-v1:${requestKey.toLowerCase()}`, "utf8")
    .digest();
  // Signed 64-bit big-endian from the first eight bytes.
  return digest.readBigInt64BE(0).toString();
}
