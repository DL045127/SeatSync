"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LIMITS, normalizeAddDriver, normalizeAddRequest, type GuestTripStatus } from "../../../contracts/index.ts";
import { LocationPicker, type Selection } from "../../locations/LocationPicker.tsx";
import { claimSlot, clearPendingIfOwner, isTerminalForKey, readPending } from "../../trips/pendingStore.ts";
import type { PendingOperation } from "../../trips/reducer.ts";

const zones = new Set(["north", "east", "south", "west"]);

type Registration = { role: "driver" | "passenger"; token: string };

function registrationFromUrl(): Registration | null {
  const match = /^#leave=(driver|passenger)\.([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(window.location.hash);
  if (!match) return null;
  return { role: match[1].toLowerCase() === "driver" ? "driver" : "passenger", token: match[2].toLowerCase() };
}

function registrationUrl(registration: Registration): string {
  const url = new URL(window.location.href);
  url.hash = `leave=${registration.role}.${registration.token}`;
  return url.href;
}

type RegistrationStatus = GuestTripStatus | "invalid" | "error";

function sameRegistration(a: Registration | null, b: Registration | null): boolean {
  return a?.role === b?.role && a?.token === b?.token;
}

function matchesPage(op: PendingOperation, route: string, registration: Registration | null): boolean {
  if (op.method !== "POST") return false;
  if (op.canonicalRoute !== route + "/leave") {
    return !registration && (op.canonicalRoute === route + "/drivers" || op.canonicalRoute === route + "/requests");
  }
  const body = op.normalizedBody as Partial<Registration> | null;
  return !!registration && body?.role === registration.role && body.token === registration.token;
}

function statusMessage(status: GuestTripStatus, role: Registration["role"]): string {
  if (status.state === "awaiting_plan") return "Awaiting a saved plan from the organizer.";
  if (status.state !== "saved_plan") return "";
  if (role === "passenger") {
    return status.assignedCount ? "You have a saved ride assignment." : "There is a saved plan, and you are unassigned.";
  }
  return status.assignedCount === 1 ? "The saved plan assigns you 1 passenger."
    : `The saved plan assigns you ${status.assignedCount} passengers.`;
}

export function JoinForm({ inviteId, mode }: { inviteId: string; mode: "zone" | "address" }) {
  const [role, setRole] = useState<"drivers" | "requests">("requests");
  const [address, setAddress] = useState<Selection | null>(null);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<Registration | null>(null);
  const [justJoined, setJustJoined] = useState(false);
  const [completedWithoutLink, setCompletedWithoutLink] = useState<Registration["role"] | null>(null);
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [error, setError] = useState("");
  const route = `/api/invites/${inviteId}`;
  const driver = role === "drivers";

  const visiblePending = pending && matchesPage(pending, route, joined) ? pending : null;

  useEffect(() => {
    function readLink() {
      const registration = registrationFromUrl();
      setJoined(registration);
      setJustJoined(false);
      setCompletedWithoutLink(null);
      setStatus(null);
      setError("");
      const op = readPending();
      setPending(op && matchesPage(op, route, registration) ? op : null);
    }
    readLink();
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, [route]);

  useEffect(() => {
    if (!joined) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    void (async () => {
      try {
        const response = await fetch(route + "/status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(joined),
          cache: "no-store",
          signal,
        });
        const current = response.ok ? await response.json() as GuestTripStatus
          : response.status === 404 ? "invalid" : "error";
        if (!controller.signal.aborted && sameRegistration(joined, registrationFromUrl())) setStatus(current);
      } catch {
        if (!controller.signal.aborted && sameRegistration(joined, registrationFromUrl())) setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [joined, route, statusAttempt, visiblePending]);

  async function send(op: PendingOperation) {
    if (!matchesPage(op, route, registrationFromUrl())) return;
    const path = window.location.pathname;
    const isCurrent = () => window.location.pathname === path && matchesPage(op, route, registrationFromUrl());
    setBusy(true);
    setError("");
    const leaving = op.canonicalRoute === route + "/leave";
    const uncertain = leaving ? "We couldn’t confirm that you left. Retry to check the same request."
      : "We couldn’t confirm your registration. Retry to check the same submission.";
    try {
      const response = await fetch(op.canonicalRoute, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": op.key },
        body: JSON.stringify(op.normalizedBody),
        cache: "no-store",
      });
      const body = await response.json();
      if (!isTerminalForKey(op.key, body)) {
        if (isCurrent()) setError(uncertain);
        return;
      }
      if (!isCurrent()) {
        // The shared invite still needs to deliver the registration receipt.
        if (!leaving && response.ok) return;
        clearPendingIfOwner(op.key);
        setPending(current => current?.key === op.key ? null : current);
        return;
      }
      if (response.ok) {
        if (leaving) {
          setJustJoined(false);
          setStatus({ state: "left" });
        } else {
          const registeredRole = op.canonicalRoute.endsWith("/drivers") ? "driver" : "passenger";
          if (typeof body.leaveToken === "string") {
            const registration: Registration = { role: registeredRole, token: body.leaveToken };
            window.history.replaceState(null, "", registrationUrl(registration));
            setJoined(registration);
            setStatus(null);
            setJustJoined(true);
          } else {
            setCompletedWithoutLink(registeredRole);
          }
        }
      } else {
        setError(body.error?.message ?? (leaving ? "Could not leave the trip." : "Registration could not be saved."));
        if (body.error?.code === "LOCATION_SELECTION_INVALID") setAddress(null);
      }
      clearPendingIfOwner(op.key);
      setPending(null);
    } catch {
      if (isCurrent()) setError(uncertain);
    } finally {
      setBusy(false);
    }
  }

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || visiblePending || joined || completedWithoutLink) return;
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
    submit(route + "/" + role, normalizedBody);
  }

  function submit(canonicalRoute: string, normalizedBody: unknown) {
    const op: PendingOperation = { key: crypto.randomUUID(), method: "POST", canonicalRoute, normalizedBody, tripId: null };
    if (!matchesPage(op, route, registrationFromUrl())) return;
    const claim = claimSlot(op);
    if (!claim.ok) {
      setError(claim.reason === "blocked" ? "This browser couldn’t store a retry. Allow session storage and try again."
        : "This tab has an unfinished request. Return to the link where you started it to retry.");
      return;
    }
    setPending(op);
    void send(op);
  }

  if (visiblePending) {
    const leaving = visiblePending.canonicalRoute === route + "/leave";
    return (
      <section className="card notice">
        <p role="status">{leaving ? "A leave request is awaiting confirmation." : "A registration is awaiting confirmation."}</p>
        {joined && status && typeof status === "object" && (
          <p>{status.state === "left" ? "This registration is already inactive." : statusMessage(status, joined.role)}</p>
        )}
        <button type="button" className="primary" disabled={busy} onClick={() => void send(visiblePending)}>
          {leaving ? "Retry leaving" : "Retry registration"}
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  }

  if (joined && typeof status === "object" && status?.state === "left") {
    return <section className="card notice"><h2>You left the trip</h2></section>;
  }

  if (joined && status === "invalid") {
    return <section className="card notice"><h2>This private registration link is invalid</h2></section>;
  }

  if (joined) return (
    <section className="card notice">
      <h2>{justJoined ? "You’re registered" : "Manage your registration"}</h2>
      {justJoined && <p>You joined as a {joined.role}. The organizer can now include you in the carpool plan.</p>}
      {status === null && <p role="status">Checking your registration…</p>}
      {status === "error" && (
        <div>
          <p role="alert">Couldn’t check your registration.</p>
          <button type="button" onClick={() => {
            setStatus(null);
            setStatusAttempt(attempt => attempt + 1);
          }}>Try again</button>
        </div>
      )}
      {status && typeof status === "object" && <p role="status">{statusMessage(status, joined.role)}</p>}
      <p>Save this private link if you might need to leave later.</p>
      <label>Private registration link
        <input readOnly value={registrationUrl(joined)} onFocus={event => event.target.select()} />
      </label>
      <button type="button" disabled={busy || !status || typeof status !== "object"} onClick={() => {
        if (window.confirm("Leave this trip and remove yourself from its active roster?")) submit(route + "/leave", joined);
      }}>Leave trip</button>
      {error && <p role="alert">{error}</p>}
    </section>
  );

  if (completedWithoutLink) return (
    <section className="card notice">
      <h2>You’re registered</h2>
      <p>You joined as a {completedWithoutLink}. Ask the organizer if you need to leave the trip.</p>
    </section>
  );

  return (
    <form className="card create-form" onSubmit={register}>
      <h2>Join this trip</h2>
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
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
