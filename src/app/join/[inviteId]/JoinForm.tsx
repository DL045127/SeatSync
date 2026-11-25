"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LIMITS, normalizeAddDriver, normalizeAddRequest } from "../../../contracts/index.ts";
import { LocationPicker, type Selection } from "../../locations/LocationPicker.tsx";
import { claimSlot, clearPendingIfOwner, isTerminalForKey, readPending } from "../../trips/pendingStore.ts";
import type { PendingOperation } from "../../trips/reducer.ts";

const zones = new Set(["north", "east", "south", "west"]);

export function JoinForm({ inviteId, mode }: { inviteId: string; mode: "zone" | "address" }) {
  const [role, setRole] = useState<"drivers" | "requests">("requests");
  const [address, setAddress] = useState<Selection | null>(null);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<"drivers" | "requests" | null>(null);
  const [error, setError] = useState("");
  const route = `/api/invites/${inviteId}`;
  const driver = role === "drivers";

  useEffect(() => {
    const op = readPending();
    if (op?.method === "POST" && (op.canonicalRoute === route + "/drivers" || op.canonicalRoute === route + "/requests")) {
      // Restore the exact submission after reload, as on the organizer page.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPending(op);
    }
  }, [route]);

  async function send(op: PendingOperation) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(op.canonicalRoute, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": op.key },
        body: JSON.stringify(op.normalizedBody),
        cache: "no-store",
      });
      const body = await response.json();
      if (!isTerminalForKey(op.key, body)) {
        setError("We couldn’t confirm your registration. Retry to check the same submission.");
        return;
      }
      clearPendingIfOwner(op.key);
      setPending(null);
      if (response.ok) {
        setJoined(op.canonicalRoute.endsWith("/drivers") ? "drivers" : "requests");
      } else {
        setError(body.error?.message ?? "Registration could not be saved.");
        if (body.error?.code === "LOCATION_SELECTION_INVALID") setAddress(null);
      }
    } catch {
      setError("We couldn’t confirm your registration. Retry to check the same submission.");
    } finally {
      setBusy(false);
    }
  }

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pending || joined) return;
    const form = new FormData(event.currentTarget);
    const name = form.get("name");
    const seatCapacity = Number(form.get("seats"));
    const maxDetourMinutes = Number(form.get("detour"));
    const zoneId = form.get("zone");
    if (mode === "address" && !address) return;
    let normalizedBody: unknown;
    try {
      if (driver) {
        normalizedBody = normalizeAddDriver(mode === "zone"
          ? { name, zoneId, seatCapacity }
          : { name, startSelectionToken: address?.token, seatCapacity, maxDetourMinutes }, zones);
      } else {
        normalizedBody = normalizeAddRequest(mode === "zone"
          ? { name, zoneId }
          : { name, pickupSelectionToken: address?.token }, zones);
      }
    } catch {
      setError("Check your name and the registration fields.");
      return;
    }
    const op = { key: crypto.randomUUID(), method: "POST" as const,
      canonicalRoute: route + "/" + role, normalizedBody, tripId: null };
    const claim = claimSlot(op);
    if (!claim.ok) {
      setError(claim.reason === "blocked" ? "This browser couldn’t store a retry. Allow session storage and try again."
        : "This tab already has an unfinished submission. Resolve it first.");
      return;
    }
    setPending(op);
    void send(op);
  }

  if (joined) return (
    <section className="card notice">
      <h2>You’re registered</h2>
      <p role="status">You joined as a {joined === "drivers" ? "driver" : "passenger"}. The organizer can now include you in the carpool plan.</p>
    </section>
  );

  return (
    <form className="card create-form" onSubmit={register}>
      <h2>Join this trip</h2>
      {pending ? (
        <>
          <p role="status">A registration is awaiting confirmation.</p>
          <button type="button" className="primary" disabled={busy} onClick={() => void send(pending)}>Retry registration</button>
        </>
      ) : (
        <>
          <label>Join as
            <select value={role} onChange={event => {
              setRole(event.target.value === "drivers" ? "drivers" : "requests");
              setAddress(null);
              setError("");
            }}>
              <option value="requests">Passenger</option>
              <option value="drivers">Driver</option>
            </select>
          </label>
          <label>Name<input name="name" autoComplete="name" required maxLength={LIMITS.participantNameCodePoints} /></label>
          {mode === "zone" ? (
            <label>Pickup zone
              <select name="zone" required defaultValue="">
                <option value="" disabled>Choose a zone</option>
                {[...zones].map(zone => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </label>
          ) : (
            <LocationPicker key={role} inviteId={inviteId} purpose={driver ? "driver_start" : "pickup"}
              label={driver ? "Starting address" : "Pickup address"} onSelect={setAddress} />
          )}
          {driver && (
            <label>Seats available
              <input name="seats" type="number" min={1} max={LIMITS.seatMax} defaultValue={1} required />
            </label>
          )}
          {driver && mode === "address" && (
            <label>Detour limit (minutes)
              <input name="detour" type="number" min={LIMITS.detourMinutesMin} max={LIMITS.detourMinutesMax}
                defaultValue={15} required />
            </label>
          )}
          <button type="submit" disabled={busy || (mode === "address" && !address)}>Join as {driver ? "driver" : "passenger"}</button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
