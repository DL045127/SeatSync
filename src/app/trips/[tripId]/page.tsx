"use client";

import { use, useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  type PendingOperation,
  canCommit,
  initialState,
  tripReducer,
} from "../reducer.ts";
import { LIMITS } from "../../../contracts/index.ts";
import { normalizeLabel } from "../../../contracts/normalize.ts";
import { LocationPicker, type Selection } from "../../locations/LocationPicker.tsx";
import { type CostUnit, formatCost, formatSeconds, formatTotal } from "../format.ts";
import {
  type OperationResponse,
  claimSlot,
  clearPendingIfOwner,
  isTerminalForKey,
  readPending,
  storageWritable,
} from "../pendingStore.ts";

/**
 * Validate a participant name with the SHARED label rules (NFC, trim,
 * code-point limit) before claiming the slot, so an over-length or blank name
 * is caught locally and never strands the tab on a receipt-free 400 (ISSUE-022).
 * Returns the normalized name, or null with the reason.
 */
function validateName(raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  try {
    return { ok: true, value: normalizeLabel(raw, LIMITS.participantNameCodePoints) };
  } catch {
    return { ok: false, reason: `Name must be 1–${LIMITS.participantNameCodePoints} characters.` };
  }
}

interface Assignment { passengerId: string; driverId: string; cost: number }
interface MatchResult {
  assignments: Assignment[];
  unassignedPassengerIds: string[];
  matchedCount: number;
  totalCost: number;
}
interface Estimate {
  provider: string;
  observedFrom: string | null;
  observedTo: string | null;
}
interface PreviewPayload {
  previewId: string;
  baseVersion: number;
  algorithmVersion: string;
  optimal: MatchResult;
  greedy: MatchResult;
  costUnit?: CostUnit;
  estimate?: Estimate;
  [key: string]: unknown;
}

interface LocationView {
  label: string;
  detail: string;
  precision: string;
  provider: string;
  attribution: string;
}

interface Snapshot {
  id: string;
  version: number;
  status: "open" | "assigned" | "needs_rematch";
  locationMode: "zone" | "address";
  costUnit: CostUnit;
  venue: LocationView | null;
  estimate: Estimate | null;
  drivers: Array<{
    id: string;
    zoneId: string | null;
    location: LocationView | null;
    maxDetourMinutes: number | null;
    name: string;
    seatCapacity: number;
    active: boolean;
  }>;
  requests: Array<{
    id: string;
    zoneId: string | null;
    location: LocationView | null;
    name: string;
    active: boolean;
  }>;
  assignments: Array<{ requestId: string; driverId: string; pickupCost: number }>;
  totals: { matched: number; totalCost: number; seatsUsed: number; seatsAvailable: number };
  [key: string]: unknown;
}

export default function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = use(params);
  // The storage probe runs once in the lazy initializer. On the server there is
  // no sessionStorage, so storageWritable() returns true optimistically; the
  // client value from this initializer is authoritative for actual blocking.
  const [storageBlocked, setStorageBlocked] = useState(() => !storageWritable());
  const [state, dispatch] = useReducer(tripReducer, tripId, initialState);
  const [message, setMessage] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);
  const snapshot = state.snapshot as Snapshot | null;
  // The reducer holds the full accepted preview payload, so the rendered detail
  // and the committable reference are the same object (ISSUE-023). When the
  // reducer clears/rejects a preview, there is nothing to render.
  const previewDetail = state.preview as PreviewPayload | null;

  // Keep a ref in sync with the read generation AFTER render (not during), so a
  // fetch completion can tag itself with the generation it was started under.
  const readGenRef = useRef(state.readGeneration);
  useEffect(() => {
    readGenRef.current = state.readGeneration;
  }, [state.readGeneration]);

  const refresh = useCallback(async () => {
    dispatch({ type: "get/start" });
    const generation = readGenRef.current + 1; // matches the bump in get/start
    readGenRef.current = generation;
    try {
      const res = await fetch(`/api/trips/${tripId}`, { cache: "no-store" });
      if (!res.ok) {
        setReadError(true);
        return;
      }
      const body = (await res.json()) as Snapshot;
      setReadError(false);
      dispatch({ type: "get/received", generation, snapshot: body });
    } catch {
      // ISSUE-023: a failed read must be visible and offer retry, not loop on
      // the loading message.
      setReadError(true);
    }
  }, [tripId]);

  // On mount/reload: restore any pending op (tab-wide) that targets THIS trip,
  // then load the current snapshot.
  useEffect(() => {
    const op = readPending();
    if (op && op.tripId === tripId) dispatch({ type: "pending/restore", operation: op });
    // Initial data load on mount: fetching is the intended effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [tripId, refresh]);

  // ISSUE-023: when the version floor rises past the shown snapshot (e.g. a
  // newer preview/conflict raised it), fetch a current snapshot to replace the
  // now-hidden one, so the page never strands on stale/empty data.
  useEffect(() => {
    if (
      !state.pendingOperation &&
      (state.snapshot === null || state.snapshot.version < state.highestObservedVersion)
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void refresh();
    }
  }, [state.highestObservedVersion, state.snapshot, state.pendingOperation, refresh]);

  async function sendMutation(
    op: Omit<PendingOperation, "key" | "tripId"> & { key?: string },
  ): Promise<void> {
    if (storageBlocked) {
      setMessage("Session storage is unavailable; mutations are blocked. Reads and previews still work.");
      return;
    }
    const key = op.key ?? crypto.randomUUID();
    const pending: PendingOperation = {
      key,
      method: op.method,
      canonicalRoute: op.canonicalRoute,
      normalizedBody: op.normalizedBody,
      tripId,
    };
    // ISSUE-021: claim the tab-wide slot before sending. Refuse if another
    // operation (a pending creation or another trip's mutation) owns it.
    const claim = claimSlot(pending);
    if (!claim.ok) {
      if (claim.reason === "blocked") {
        setStorageBlocked(true);
        setMessage("Could not persist the pending operation; mutation blocked.");
      } else {
        setMessage(
          claim.owner.canonicalRoute === "/api/trips"
            ? "An unresolved trip creation exists in this tab. Resolve it first."
            : "Another operation is unresolved in this tab. Resolve it before starting another.",
        );
      }
      return;
    }
    dispatch({ type: "mutation/start", operation: pending });

    try {
      const res = await fetch(pending.canonicalRoute, {
        method: pending.method,
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(pending.normalizedBody),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as OperationResponse & {
        mutationVersion?: number;
        error?: { code?: string; currentVersion?: number };
      };
      // ISSUE-022: one receipt check for all outcomes. Resolve ONLY on a
      // receipt-backed terminal outcome for THIS key; clear storage only when
      // this key still owns the slot. A 503, unknown, metadata-free error
      // (incl. a bare 500 or a key-reuse 409), a mismatched-key 200, or a
      // network error retains the exact operation for same-key retry.
      if (isTerminalForKey(key, body)) {
        clearPendingIfOwner(key); // release only a slot this key still owns
        if (res.ok) {
          dispatch({ type: "mutation/applied", key, mutationVersion: body.mutationVersion ?? 0 });
        } else if (res.status === 409) {
          dispatch({ type: "mutation/conflict", key, currentVersion: body.error?.currentVersion ?? state.highestObservedVersion });
          setMessage("The trip changed. Review the refreshed state and resubmit.");
        } else {
          dispatch({ type: "mutation/notApplied", key, currentVersion: body.error?.currentVersion });
          setMessage(body.error?.code ? `Rejected: ${body.error.code}` : "Operation rejected.");
        }
        await refresh();
      } else {
        // Not finalized: keep the exact operation (same key).
        dispatch({ type: "mutation/unknown", key });
        setMessage("Outcome unknown. Retry the same operation.");
      }
    } catch {
      // Network error: retain the exact pending operation (same key).
      dispatch({ type: "mutation/unknown", key });
      setMessage("Network error. Retry the same operation.");
    }
  }

  function retryPending(): void {
    const op = state.pendingOperation;
    if (op) void sendMutation({ key: op.key, method: op.method, canonicalRoute: op.canonicalRoute, normalizedBody: op.normalizedBody });
  }

  async function preview(): Promise<void> {
    const previewGeneration = state.previewGeneration;
    try {
      const res = await fetch(`/api/trips/${tripId}/match/preview`, { method: "POST", cache: "no-store" });
      if (!res.ok) {
        // ISSUE-023: a stale/version preview error carries a newer version.
        // Apply it to the floor IMMEDIATELY (clearing a now-stale preview and
        // disabling Commit) BEFORE awaiting the refresh, so a failed refresh
        // cannot leave an older plan committable.
        const errBody = (await res.json().catch(() => ({}))) as { error?: { currentVersion?: number } };
        if (typeof errBody.error?.currentVersion === "number") {
          dispatch({ type: "version/observed", version: errBody.error.currentVersion });
        }
        setMessage("Preview rejected; refreshing current state.");
        await refresh();
        return;
      }
      const body = (await res.json()) as PreviewPayload;
      // The full payload is stored IN the reducer, so the rendered detail and
      // the committable reference are always the same accepted object. A
      // delayed/discarded preview that the reducer rejects therefore cannot
      // replace the visible plan (ISSUE-023).
      dispatch({ type: "preview/received", generation: previewGeneration, preview: body });
    } catch {
      setMessage("Preview failed. Retry.");
    }
  }

  function commit(): void {
    if (!canCommit(state) || !state.preview) return;
    void sendMutation({
      method: "POST",
      canonicalRoute: `/api/trips/${tripId}/match/commit`,
      normalizedBody: { previewId: state.preview.previewId },
    });
  }

  function registerDriver(name: string, zoneId: string, seatCapacity: number): void {
    void sendMutation({
      method: "POST",
      canonicalRoute: `/api/trips/${tripId}/drivers`,
      normalizedBody: { name, zoneId, seatCapacity },
    });
  }

  function registerPassenger(name: string, zoneId: string): void {
    void sendMutation({
      method: "POST",
      canonicalRoute: `/api/trips/${tripId}/requests`,
      normalizedBody: { name, zoneId },
    });
  }

  function registerAddressDriver(name: string, token: string, seatCapacity: number, maxDetourMinutes: number): void {
    void sendMutation({
      method: "POST",
      canonicalRoute: `/api/trips/${tripId}/drivers`,
      normalizedBody: { name, startSelectionToken: token, seatCapacity, maxDetourMinutes },
    });
  }

  function registerAddressPassenger(name: string, token: string): void {
    void sendMutation({
      method: "POST",
      canonicalRoute: `/api/trips/${tripId}/requests`,
      normalizedBody: { name, pickupSelectionToken: token },
    });
  }

  const pending = state.pendingOperation;
  const commitEnabled = canCommit(state);
  const nameOf = (members: Array<{ id: string; name: string }>, id: string) =>
    members.find((m) => m.id === id)?.name ?? id;

  return (
    <main>
      <h1>Trip</h1>
      {storageBlocked ? <p role="alert">Session storage unavailable: mutations are blocked.</p> : null}
      {readError ? (
        <section>
          <p role="alert">Could not load the current trip.</p>
          <button onClick={() => void refresh()}>Retry load</button>
        </section>
      ) : null}
      {message ? <p role="status">{message}</p> : null}

      {pending ? (
        <section>
          <p role="status">Pending operation ({pending.method} {pending.canonicalRoute}). Resolve before continuing.</p>
          <button onClick={retryPending}>Retry</button>
        </section>
      ) : null}

      {snapshot ? (
        <>
          <p data-testid="trip-status">
            Status: {snapshot.status} · Version: {snapshot.version} · Matched: {snapshot.totals.matched} ·{" "}
            {formatTotal(snapshot.costUnit, snapshot.totals.totalCost)} · Seats available:{" "}
            {snapshot.totals.seatsAvailable}
          </p>
          {snapshot.venue ? (
            <p data-testid="trip-venue">
              Venue: {snapshot.venue.label} — {snapshot.venue.detail}.{" "}
              {snapshot.venue.provider === "fixture"
                ? "Fixture data: fictional places and driving times."
                : null}{" "}
              {snapshot.venue.attribution}
            </p>
          ) : null}

          <section>
            <h2>Register</h2>
            {snapshot.locationMode === "address" ? (
              <>
                <AddressDriverForm tripId={tripId} disabled={!!pending} onSubmit={registerAddressDriver} />
                <AddressPassengerForm tripId={tripId} disabled={!!pending} onSubmit={registerAddressPassenger} />
              </>
            ) : (
              <>
                <RegisterDriverForm disabled={!!pending} onSubmit={registerDriver} />
                <RegisterPassengerForm disabled={!!pending} onSubmit={registerPassenger} />
              </>
            )}
          </section>

          <section>
            <h2>Drivers</h2>
            <ul>
              {snapshot.drivers.map((d) => (
                <li key={d.id}>
                  {d.name} ({d.location ? d.location.label : d.zoneId}) seats {d.seatCapacity}
                  {d.maxDetourMinutes !== null ? ` · limit ${d.maxDetourMinutes} min` : ""}{" "}
                  {d.active ? "" : "— canceled"}
                  {d.active ? (
                    <>
                      <button
                        disabled={!!pending}
                        onClick={() => sendMutation({ method: "PATCH", canonicalRoute: `/api/trips/${tripId}/drivers/${d.id}`, normalizedBody: { baseVersion: snapshot.version, seatCapacity: Math.max(0, d.seatCapacity - 1) } })}
                      >Reduce capacity</button>
                      <button
                        disabled={!!pending}
                        onClick={() => sendMutation({ method: "PATCH", canonicalRoute: `/api/trips/${tripId}/drivers/${d.id}`, normalizedBody: { baseVersion: snapshot.version, active: false } })}
                      >Cancel</button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Passengers</h2>
            <ul>
              {snapshot.requests.map((r) => (
                <li key={r.id}>
                  {r.name} ({r.location ? r.location.label : r.zoneId}) {r.active ? "" : "— withdrawn"}
                  {r.active ? (
                    <button
                      disabled={!!pending}
                      onClick={() => sendMutation({ method: "PATCH", canonicalRoute: `/api/trips/${tripId}/requests/${r.id}`, normalizedBody: { baseVersion: snapshot.version, active: false } })}
                    >Withdraw</button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Matching</h2>
            <button disabled={!!pending} onClick={() => void preview()}>Preview</button>
            <button disabled={!commitEnabled} onClick={commit}>
              Save plan (commit)
            </button>
            {previewDetail ? (
              <div data-testid="preview-ready">
                <p role="status">Preview for version {previewDetail.baseVersion} (optimal plan).</p>
                <p>
                  Optimal: {previewDetail.optimal.matchedCount} matched,{" "}
                  {previewDetail.costUnit === "detour_seconds"
                    ? `sum of estimated individual pickup detours ${formatSeconds(previewDetail.optimal.totalCost)}`
                    : `cost ${previewDetail.optimal.totalCost}`}
                  . Greedy: {previewDetail.greedy.matchedCount} matched,{" "}
                  {previewDetail.costUnit === "detour_seconds"
                    ? formatSeconds(previewDetail.greedy.totalCost)
                    : `cost ${previewDetail.greedy.totalCost}`}
                  .
                </p>
                {previewDetail.estimate ? (
                  <p data-testid="preview-estimate">
                    {previewDetail.estimate.provider === "fixture"
                      ? "Fixture estimate: fictional driving times. "
                      : "Estimated driving times. "}
                    {previewDetail.estimate.observedFrom
                      ? `Observed ${previewDetail.estimate.observedFrom}.`
                      : "No provider observations."}
                  </p>
                ) : null}
                <ul data-testid="preview-assignments">
                  {previewDetail.optimal.assignments.map((a) => (
                    <li key={a.passengerId}>
                      {nameOf(snapshot.requests, a.passengerId)} →{" "}
                      {nameOf(snapshot.drivers, a.driverId)} ({formatCost(previewDetail.costUnit ?? "zone_cost", a.cost)})
                    </li>
                  ))}
                </ul>
                {previewDetail.optimal.unassignedPassengerIds.length > 0 ? (
                  <p data-testid="preview-unassigned">
                    Unassigned:{" "}
                    {previewDetail.optimal.unassignedPassengerIds
                      .map((id) => nameOf(snapshot.requests, id))
                      .join(", ")}
                  </p>
                ) : (
                  <p data-testid="preview-unassigned">Unassigned: none</p>
                )}
              </div>
            ) : (
              <p data-testid="preview-none">No current preview. Preview to review a plan, then save.</p>
            )}
          </section>

          {snapshot.status === "assigned" ? (
            <section>
              <h2>Saved plan</h2>
              <ul data-testid="saved-assignments">
                {snapshot.assignments.map((a) => (
                  <li key={a.requestId}>
                    {nameOf(snapshot.requests, a.requestId)} →{" "}
                    {nameOf(snapshot.drivers, a.driverId)} ({formatCost(snapshot.costUnit, a.pickupCost)})
                  </li>
                ))}
              </ul>
              <p data-testid="saved-unassigned">
                Unassigned:{" "}
                {snapshot.requests
                  .filter((r) => r.active && !snapshot.assignments.some((a) => a.requestId === r.id))
                  .map((r) => r.name)
                  .join(", ") || "none"}
              </p>
            </section>
          ) : null}
        </>
      ) : (
        <p>Loading current trip…</p>
      )}
    </main>
  );
}

function RegisterDriverForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (name: string, zoneId: string, seatCapacity: number) => void;
}) {
  const [name, setName] = useState("");
  const [zoneId, setZoneId] = useState("north");
  const [seatCapacity, setSeatCapacity] = useState(1);
  const [fieldError, setFieldError] = useState<string | null>(null);
  return (
    <form
      data-testid="driver-form"
      onSubmit={(e) => {
        e.preventDefault();
        // ISSUE-022: validate with the shared label rules before claiming the
        // slot; a blank or over-length name is rejected here and never sent.
        const check = validateName(name);
        if (!check.ok) {
          setFieldError(check.reason);
          return;
        }
        setFieldError(null);
        onSubmit(check.value, zoneId, seatCapacity);
        setName("");
      }}
    >
      <input aria-label="driver name" value={name} onChange={(e) => setName(e.target.value)} />
      <select aria-label="driver zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
        <option value="north">north</option>
        <option value="east">east</option>
        <option value="south">south</option>
        <option value="west">west</option>
      </select>
      <input
        aria-label="driver seats"
        type="number"
        min={0}
        max={8}
        value={seatCapacity}
        onChange={(e) => setSeatCapacity(Number(e.target.value))}
      />
      <button type="submit" disabled={disabled}>Add driver</button>
      {fieldError ? <span role="alert">{fieldError}</span> : null}
    </form>
  );
}

function RegisterPassengerForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (name: string, zoneId: string) => void;
}) {
  const [name, setName] = useState("");
  const [zoneId, setZoneId] = useState("north");
  const [fieldError, setFieldError] = useState<string | null>(null);
  return (
    <form
      data-testid="passenger-form"
      onSubmit={(e) => {
        e.preventDefault();
        const check = validateName(name);
        if (!check.ok) {
          setFieldError(check.reason);
          return;
        }
        setFieldError(null);
        onSubmit(check.value, zoneId);
        setName("");
      }}
    >
      <input aria-label="passenger name" value={name} onChange={(e) => setName(e.target.value)} />
      <select aria-label="passenger zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
        <option value="north">north</option>
        <option value="east">east</option>
        <option value="south">south</option>
        <option value="west">west</option>
      </select>
      <button type="submit" disabled={disabled}>Add passenger</button>
      {fieldError ? <span role="alert">{fieldError}</span> : null}
    </form>
  );
}

function AddressDriverForm({
  tripId,
  disabled,
  onSubmit,
}: {
  tripId: string;
  disabled: boolean;
  onSubmit: (name: string, token: string, seatCapacity: number, maxDetourMinutes: number) => void;
}) {
  const [name, setName] = useState("");
  const [start, setStart] = useState<Selection | null>(null);
  const [seatCapacity, setSeatCapacity] = useState(1);
  // Proposed default: 15 minutes, editable at registration, 0-120 inclusive.
  const [maxDetour, setMaxDetour] = useState(15);
  const [resetSignal, setResetSignal] = useState(0);
  const [fieldError, setFieldError] = useState<string | null>(null);
  return (
    <form
      data-testid="driver-form"
      onSubmit={(e) => {
        e.preventDefault();
        const check = validateName(name);
        if (!check.ok) {
          setFieldError(check.reason);
          return;
        }
        if (!start) {
          setFieldError("Search for the starting address and select one of the suggestions.");
          return;
        }
        if (!Number.isInteger(maxDetour) || maxDetour < 0 || maxDetour > 120) {
          setFieldError("The detour limit is a whole number of minutes from 0 to 120.");
          return;
        }
        setFieldError(null);
        onSubmit(check.value, start.token, seatCapacity, maxDetour);
        setName("");
        setStart(null);
        setResetSignal((n) => n + 1);
      }}
    >
      <input aria-label="driver name" value={name} onChange={(e) => setName(e.target.value)} />
      <LocationPicker
        label="Driver start address"
        purpose="driver_start"
        tripId={tripId}
        disabled={disabled}
        onSelect={setStart}
        resetSignal={resetSignal}
      />
      <input
        aria-label="driver seats"
        type="number"
        min={0}
        max={8}
        value={seatCapacity}
        onChange={(e) => setSeatCapacity(Number(e.target.value))}
      />
      <input
        aria-label="driver detour limit (minutes)"
        type="number"
        min={0}
        max={120}
        value={maxDetour}
        onChange={(e) => setMaxDetour(Number(e.target.value))}
      />
      <button type="submit" disabled={disabled || !start}>Add driver</button>
      {fieldError ? <span role="alert">{fieldError}</span> : null}
    </form>
  );
}

function AddressPassengerForm({
  tripId,
  disabled,
  onSubmit,
}: {
  tripId: string;
  disabled: boolean;
  onSubmit: (name: string, token: string) => void;
}) {
  const [name, setName] = useState("");
  const [pickup, setPickup] = useState<Selection | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [fieldError, setFieldError] = useState<string | null>(null);
  return (
    <form
      data-testid="passenger-form"
      onSubmit={(e) => {
        e.preventDefault();
        const check = validateName(name);
        if (!check.ok) {
          setFieldError(check.reason);
          return;
        }
        if (!pickup) {
          setFieldError("Search for the pickup address and select one of the suggestions.");
          return;
        }
        setFieldError(null);
        onSubmit(check.value, pickup.token);
        setName("");
        setPickup(null);
        setResetSignal((n) => n + 1);
      }}
    >
      <input aria-label="passenger name" value={name} onChange={(e) => setName(e.target.value)} />
      <LocationPicker
        label="Passenger pickup address"
        purpose="pickup"
        tripId={tripId}
        disabled={disabled}
        onSelect={setPickup}
        resetSignal={resetSignal}
      />
      <button type="submit" disabled={disabled || !pickup}>Add passenger</button>
      {fieldError ? <span role="alert">{fieldError}</span> : null}
    </form>
  );
}
