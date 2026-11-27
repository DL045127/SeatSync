"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyRotation, visibleRecoveryCode, type RecoveryDisplay, type RecoveryRotationNotice } from "./recoveryDisplay.ts";
import { rotationNoticeKey, WorkspaceCommandError, workspaceChannel, workspaceCommand } from "./workspaceClient.ts";
import { DepartureFields } from "./trips/DepartureFields.tsx";
import type { PendingOperation } from "./trips/reducer.ts";
import { normalizeCreateTrip, type NormalizedCreateTrip } from "../contracts/index.ts";
import { LocationPicker, type Selection } from "./locations/LocationPicker.tsx";
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
  // Zone trips are the default and unchanged. An address trip carries a venue
  // chosen from search; its signed selection token is the only venue input.
  const [mode, setMode] = useState<"zone" | "address">("zone");
  const [venue, setVenue] = useState<Selection | null>(null);
  const [pickerReset, setPickerReset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [draftWorkspaceId, setDraftWorkspaceId] = useState<string | null>(null);
  const [workspaceAttempt, setWorkspaceAttempt] = useState(0);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryDisplay>(() => ({ code: null, pending: new Map(), versions: new Map() }));
  const recoveryCode = visibleRecoveryCode(recovery, workspaceId);
  const remoteRotationTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
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

  const observeWorkspace = useCallback((id: string) => {
    setWorkspaceId(id);
    setDraftWorkspaceId(current => current ?? id);
    setRecovery(current => current.code?.workspaceId === id ? current : { ...current, code: null });
  }, []);

  useEffect(() => {
    const channel = workspaceChannel();
    const timers = remoteRotationTimers.current;
    function onNotice({ data }: Pick<MessageEvent, "data">) {
      if (typeof data?.workspaceId !== "string") return;
      if (data.type === "workspace") observeWorkspace(data.workspaceId);
      if (typeof data.requestId !== "string") return;
      const { requestId, workspaceId } = data;
      if (data.type === "rotation-started") {
        if (timers.has(requestId)) return;
        const event: RecoveryRotationNotice = { type: "rotation-started", workspaceId, requestId };
        setRecovery(current => applyRotation(current, event));
        // A closed tab cannot announce a finish. Use a conservative unknown
        // result if it outlives the sender's 10-second request deadline.
        timers.set(requestId, setTimeout(() => {
          timers.delete(requestId);
          setRecovery(current => applyRotation(current, { ...event, type: "rotation-finished", version: null }));
        }, 12_000));
      } else if (data.type === "rotation-finished" &&
          (data.version === null || (Number.isSafeInteger(data.version) && data.version > 0))) {
        clearTimeout(timers.get(requestId));
        timers.delete(requestId);
        setRecovery(current => applyRotation(current, data));
      }
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== rotationNoticeKey || !event.newValue) return;
      let data: unknown;
      try { data = JSON.parse(event.newValue); } catch { return; }
      onNotice({ data });
    }
    channel?.addEventListener("message", onNotice);
    window.addEventListener("storage", onStorage);
    return () => {
      channel?.removeEventListener("message", onNotice);
      window.removeEventListener("storage", onStorage);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [observeWorkspace]);

  useEffect(() => {
    let active = true;
    void workspaceCommand({ action: "bootstrap" }).then(
      result => { if (active) observeWorkspace(result.workspaceId); },
      () => { if (active) setWorkspaceError("Could not open the workspace."); },
    );
    return () => { active = false; };
  }, [observeWorkspace, workspaceAttempt]);

  async function manageWorkspace(command: Parameters<typeof workspaceCommand>[0]) {
    setWorkspaceBusy(true);
    setWorkspaceNotice(null);
    setRecovery(current => ({ ...current, code: null }));
    setWorkspaceError(null);
    try {
      const result = await workspaceCommand(command, (event, code) => {
        setRecovery(current => applyRotation(current, event, code));
      });
      if (command.action === "recover") observeWorkspace(result.workspaceId);
      if (command.action === "recover") setWorkspaceNotice("Workspace recovered.");
      if (command.action === "revoke") setWorkspaceNotice("Other browsers signed out.");
    } catch (error) {
      if (error instanceof WorkspaceCommandError &&
          (error.code === "WORKSPACE_CHANGED" || error.code === "WORKSPACE_REQUIRED")) {
        try {
          observeWorkspace((await workspaceCommand({ action: "bootstrap" })).workspaceId);
        } catch {
          setWorkspaceId(null);
          setWorkspaceError("Could not refresh the workspace. Open it again before continuing.");
          return;
        }
        setWorkspaceError("The workspace changed. Review it and choose the action again.");
      } else {
        setWorkspaceError(error instanceof Error ? error.message : "Workspace request failed.");
      }
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function send(op: PendingOperation): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const post = () => fetch(op.canonicalRoute, {
        method: op.method,
        headers: {
          "content-type": "application/json",
          "idempotency-key": op.key,
          // An older pending record can replay, but needs confirmation before
          // first application because it has no recorded workspace.
          "x-groupride-workspace": op.expectedWorkspaceId ?? "",
        },
        body: JSON.stringify(op.normalizedBody),
        cache: "no-store",
      });
      const parse = async (response: Response) => (await response.json().catch(() => ({}))) as OperationResponse & {
        id?: string;
        error?: { code?: string; message?: string };
      };
      let res = await post();
      let body = await parse(res);
      if (res.status === 409 && body.error?.code === "WORKSPACE_REQUIRED") {
        observeWorkspace((await workspaceCommand({ action: "bootstrap" })).workspaceId);
        res = await post();
        body = await parse(res);
      }
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
        // A rejected selection (expired, or from before a reset) must be searched again.
        if (body.error?.code === "LOCATION_SELECTION_INVALID") {
          setVenue(null);
          setPickerReset((n) => n + 1);
        }
        return;
      }
      if (res.status === 409 && body.error?.code === "WORKSPACE_CHANGED") {
        observeWorkspace((await workspaceCommand({ action: "bootstrap" })).workspaceId);
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

  const workspaceChanged = !!workspaceId && (pending ? pending.expectedWorkspaceId : draftWorkspaceId) !== workspaceId;

  function confirmWorkspace() {
    if (!workspaceId || !workspaceChanged || busy || workspaceBusy) return;
    if (pending) {
      const confirmed = { ...pending, expectedWorkspaceId: workspaceId };
      if (!claimSlot(confirmed).ok) {
        setError("Could not save the workspace choice for this pending creation.");
        return;
      }
      setPending(confirmed);
    }
    setDraftWorkspaceId(workspaceId);
    setError(null);
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!workspaceId || workspaceChanged || workspaceBusy) return;
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
    const departAt = new FormData(e.currentTarget).get("departAt");
    if (typeof departAt !== "string" || !departAt) return;

    // ISSUE-022: run the SHARED create-trip normalizer before claiming the slot
    // so an impossible date (2026-02-30), an over-length label, or any other
    // contract violation is caught here — the same rules the server applies —
    // and never reaches storage or the network. The stored body is canonical.
    let normalizedBody: NormalizedCreateTrip;
    try {
      if (mode === "address") {
        if (!venue) {
          setError("Search for the venue and select one of the suggestions.");
          return;
        }
        normalizedBody = normalizeCreateTrip({
          name,
          departAt,
          locationMode: "address",
          venueSelectionToken: venue.token,
        });
      } else {
        normalizedBody = normalizeCreateTrip({ name, destinationLabel, departAt });
      }
    } catch {
      setError(
        mode === "address"
          ? "Check the trip name and departure."
          : "Check the trip name, destination, and departure.",
      );
      return;
    }
    const op: PendingOperation = {
      key: crypto.randomUUID(),
      method: "POST",
      canonicalRoute: "/api/trips",
      normalizedBody,
      tripId: null,
      expectedWorkspaceId: workspaceId,
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
    <main className="page create-page" id="main-content" tabIndex={-1}>
      <div className="create-content">
        <header className="page-heading">
          <h1>Create a trip</h1>
          <p>Set the destination and departure time. You’ll add drivers and passengers once the trip is created.</p>
        </header>
        {storageBlocked ? <p role="alert">Session storage unavailable: creation is blocked.</p> : null}

        {workspaceChanged && (
          <section className="notice">
            <p role="status">The workspace changed. Your trip details are still here.</p>
            <button type="button" onClick={confirmWorkspace} disabled={busy || workspaceBusy}>Use current workspace</button>
          </section>
        )}

        {pending ? (
          <section className="notice">
            <p role="status">An unresolved creation exists in this tab. Retry it with its original key.</p>
            <button onClick={() => void send(pending)} disabled={busy}>Retry creation</button>
          </section>
        ) : null}

        {slotOwnedByTrip ? (
          <section className="notice">
            <p role="status">
              Another operation is unresolved in this tab. Resolve it before creating a new trip.
            </p>
            <a href={`/trips/${slotOwnedByTrip}`}>Go to the pending trip</a>
          </section>
        ) : null}

        <form className="card create-form" onSubmit={create}>
          <h2>Trip details</h2>
          <label>
            Trip name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Saturday volunteer day" required maxLength={80} />
          </label>
          <label>
            Trip type
            <select
              value={mode}
              aria-describedby="trip-type-hint"
              onChange={(e) => {
                setMode(e.target.value === "address" ? "address" : "zone");
                // Leaving or entering address mode discards the venue: the field is
                // rebuilt blank, so the parent must not keep a token for it (ISSUE-056).
                setVenue(null);
                setPickerReset((n) => n + 1);
              }}
              disabled={busy}
            >
              <option value="zone">Zones</option>
              <option value="address">Addresses</option>
            </select>
          </label>
          <p id="trip-type-hint" className="field-hint">
            {mode === "zone" ? "Use shared pickup zones for drivers and passengers." : "Search for a venue and use street addresses for pickups."}
          </p>
          {mode === "zone" ? (
            <label>
              Destination
              <input
                value={destinationLabel}
                onChange={(e) => setDestinationLabel(e.target.value)}
                placeholder="e.g. Riverside Park"
                required
                maxLength={120}
              />
            </label>
          ) : (
            <LocationPicker
              label="Venue"
              purpose="venue"
              disabled={busy}
              onSelect={setVenue}
              resetSignal={pickerReset}
            />
          )}
          <DepartureFields />
          {error ? <p role="alert">{error}</p> : null}
          <button
            type="submit"
            disabled={!workspaceId || workspaceChanged || workspaceBusy || busy || storageBlocked || !!pending || !!slotOwnedByTrip || (mode === "address" && !venue)}
          >
            {busy ? "Creating…" : "Create trip"} <span aria-hidden="true">→</span>
          </button>
        </form>
        <details className="card">
          <summary>Organizer workspace</summary>
          <form onSubmit={event => {
            event.preventDefault();
            const code = String(new FormData(event.currentTarget).get("recoveryCode") ?? "").trim();
            event.currentTarget.reset();
            void manageWorkspace({ action: "recover", code });
          }}>
            <label>Recovery code<input name="recoveryCode" type="password" autoComplete="off" required /></label>
            <button disabled={workspaceBusy || busy || !!pending}>Recover workspace</button>
          </form>
          <button type="button" disabled={!workspaceId || workspaceBusy || busy || !!pending}
            onClick={() => {
              if (workspaceId) void manageWorkspace({ action: "rotate", expectedWorkspaceId: workspaceId });
            }}>Rotate recovery code</button>
          <button type="button" disabled={!workspaceId || workspaceBusy || busy || !!pending}
            onClick={() => {
              if (workspaceId) void manageWorkspace({ action: "revoke", expectedWorkspaceId: workspaceId });
            }}>Sign out other browsers</button>
          {recoveryCode && <label>New recovery code<input readOnly value={recoveryCode} /></label>}
          {workspaceNotice && <p role="status">{workspaceNotice}</p>}
        </details>
        {workspaceError && (
          <section className="notice">
            <p role="alert">{workspaceError}</p>
            {!workspaceId && <button type="button" onClick={() => {
              setWorkspaceError(null);
              setWorkspaceAttempt(n => n + 1);
            }}>Retry opening workspace</button>}
          </section>
        )}
      </div>
      <div className="trip-hero" aria-hidden="true" />
    </main>
  );
}
