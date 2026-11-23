"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PendingOperation } from "./trips/reducer.ts";
import { normalizeCreateTrip } from "../contracts/index.ts";
import {
  type OperationResponse,
  claimSlot,
  clearPendingIfOwner,
  isTerminalForKey,
  readPending,
  storageWritable,
} from "./trips/pendingStore.ts";

// Trip creation page. One tab-wide pending operation is persisted before the
// request is sent, so a lost response is recoverable by retrying the ORIGINAL
// key (ISSUE-021); with storage unavailable, creation is blocked before any
// request is sent.
export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [departAt, setDepartAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Storage availability is decided once in the lazy initializer (SSR-safe:
  // storageWritable() returns true when there is no window, and the client
  // re-evaluates on hydration).
  const [storageBlocked, setStorageBlocked] = useState(() => !storageWritable());
  const [pending, setPending] = useState<PendingOperation | null>(null);
  // A pending op that belongs to a TRIP (not this create page) occupies the
  // tab's single slot; creation must not overwrite it (ISSUE-021).
  const [slotOwnedByTrip, setSlotOwnedByTrip] = useState<string | null>(null);

  // On mount: inspect the shared slot. A create op is restored for retry here;
  // a trip op means another operation owns the slot and must be resolved first.
  useEffect(() => {
    if (storageBlocked) return;
    const op = readPending();
    if (!op) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (op.canonicalRoute === "/api/trips") setPending(op);
    else if (op.tripId) setSlotOwnedByTrip(op.tripId);
  }, [storageBlocked]);

  async function send(op: PendingOperation): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(op.canonicalRoute, {
        method: op.method,
        headers: { "content-type": "application/json", "idempotency-key": op.key },
        body: JSON.stringify(op.normalizedBody),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as OperationResponse & { id?: string; error?: { message: string } };
      // ISSUE-022: resolve ONLY on a receipt-backed terminal outcome for this
      // key. A bare 500, a 503, an unknown outcome, a key-reuse 409, or a
      // mismatched-key 200 all retain the operation for same-key retry.
      if (isTerminalForKey(op.key, body)) {
        // Release only a slot this key still owns (a delayed receipt must not
        // clear a newer operation's slot — ISSUE-021).
        clearPendingIfOwner(op.key);
        setPending(null);
        if (res.ok && body.id) {
          router.push(`/trips/${body.id}`);
          return;
        }
        setError(body.error?.message ?? `Creation rejected (${res.status}).`);
        return;
      }
      setPending(op);
      setError("Outcome unknown. Retry the same creation.");
    } catch {
      // Network error: retain the exact pending op (same key) for retry.
      setPending(op);
      setError("Network error. Retry the same creation.");
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (storageBlocked) {
      setError("Session storage is unavailable; creation is blocked.");
      return;
    }
    // ISSUE-021: never overwrite the tab's single slot while it is occupied.
    const existing = readPending();
    if (existing) {
      if (existing.canonicalRoute === "/api/trips") {
        setPending(existing);
        setError("An unresolved creation already exists in this tab. Retry it first.");
      } else {
        setSlotOwnedByTrip(existing.tripId);
        setError("Another operation is unresolved in this tab. Resolve it before creating a trip.");
      }
      return;
    }
    // ISSUE-022: run the SHARED create-trip normalizer before claiming the slot
    // so an impossible date (2026-02-30), an over-length label, or any other
    // contract violation is caught here — the same rules the server applies —
    // and never reaches storage or the network. The stored body is canonical.
    let normalizedBody: { name: string; destinationLabel: string; departAt: string };
    try {
      normalizedBody = normalizeCreateTrip({ name, destinationLabel, departAt });
    } catch {
      setError("Enter a valid name, destination, and ISO 8601 departure (with offset).");
      return;
    }
    const op: PendingOperation = {
      key: crypto.randomUUID(),
      method: "POST",
      canonicalRoute: "/api/trips",
      normalizedBody,
      tripId: null,
    };
    // Claim the tab's single slot atomically (re-checks occupancy + writes).
    const claim = claimSlot(op);
    if (!claim.ok) {
      if (claim.reason === "blocked") {
        setStorageBlocked(true);
        setError("Could not persist the operation; creation blocked.");
      } else if (claim.owner.canonicalRoute === "/api/trips") {
        setPending(claim.owner);
        setError("An unresolved creation already exists in this tab. Retry it first.");
      } else {
        setSlotOwnedByTrip(claim.owner.tripId);
        setError("Another operation is unresolved in this tab. Resolve it before creating a trip.");
      }
      return;
    }
    setPending(op);
    await send(op);
  }

  return (
    <main>
      <h1>GroupRide</h1>
      <p>Create a carpool trip for an organization event.</p>
      {storageBlocked ? <p role="alert">Session storage unavailable: creation is blocked.</p> : null}

      {pending ? (
        <section>
          <p role="status">An unresolved creation exists in this tab. Retry it with its original key.</p>
          <button onClick={() => void send(pending)} disabled={busy}>Retry creation</button>
        </section>
      ) : null}

      {slotOwnedByTrip ? (
        <section>
          <p role="status">
            Another operation is unresolved in this tab. Resolve it before creating a new trip.
          </p>
          <a href={`/trips/${slotOwnedByTrip}`}>Go to the pending trip</a>
        </section>
      ) : null}

      <form onSubmit={create}>
        <label>
          Trip name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </label>
        <label>
          Destination
          <input
            value={destinationLabel}
            onChange={(e) => setDestinationLabel(e.target.value)}
            required
            maxLength={120}
          />
        </label>
        <label>
          Departure (ISO 8601 with offset, e.g. 2026-03-01T09:30:00+00:00)
          <input value={departAt} onChange={(e) => setDepartAt(e.target.value)} required />
        </label>
        <button type="submit" disabled={busy || storageBlocked || !!pending || !!slotOwnedByTrip}>
          {busy ? "Creating…" : "Create trip"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
