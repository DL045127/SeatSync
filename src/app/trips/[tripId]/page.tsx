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
import { Attribution } from "../../locations/Attribution.tsx";
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
  inviteId: string;
  name: string;
  destinationLabel: string;
  departAt: string;
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

type Driver = Snapshot["drivers"][number];
type Passenger = Snapshot["requests"][number];

const tripStatusLabels: Record<Snapshot["status"], string> = {
  open: "Open for registration",
  assigned: "Plan saved",
  needs_rematch: "Needs a new plan",
};

const departureFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
});

function EstimateDetails({ estimate, snapshot, saved = false }: { estimate: Estimate; snapshot: Snapshot; saved?: boolean }) {
  const locations = [snapshot.venue, ...snapshot.drivers.filter(d => d.active).map(d => d.location),
    ...snapshot.requests.filter(r => r.active).map(r => r.location)];
  return <p data-testid={saved ? "saved-estimate" : "preview-estimate"}>
    {saved ? "Saved estimate. " : ""}
    {estimate.provider === "fixture" ? "Fixture estimate: fictional driving times. " : "Estimated driving times. "}
    {estimate.observedFrom ? `Observed ${estimate.observedFrom}. ` : "No provider observations. "}
    <Attribution provider={estimate.provider} sources={locations.flatMap(l => l ? [l.attribution] : [])} />
  </p>;
}

function InviteLink({ inviteId }: { inviteId: string }) {
  const path = `/join/${inviteId}`;
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  return (
    <section className="card invite-panel" aria-labelledby="invite-heading">
      <div>
        <h2 id="invite-heading">Invite people</h2>
        <p>Share this link so people can join as a driver or passenger.</p>
      </div>
      <div className="row-actions">
        <a href={path} className="invite-open">Open invite</a>
        <button type="button" className="primary" onClick={async () => {
          const url = new URL(path, window.location.origin).href;
          setShareUrl(url);
          setCopied(false);
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            // The field below also supports copying on insecure local networks.
          }
        }}>Copy invite link</button>
      </div>
      {shareUrl && (
        <label className="invite-url">
          {copied ? "Invite link copied" : "Select and copy this invite link"}
          <input value={shareUrl} readOnly onFocus={event => event.target.select()} />
        </label>
      )}
    </section>
  );
}

function PlanCards({ assignments, drivers, passengers, unit, saved = false }: {
  assignments: Assignment[];
  drivers: Driver[];
  passengers: Passenger[];
  unit: CostUnit;
  saved?: boolean;
}) {
  const byDriver = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    const group = byDriver.get(assignment.driverId);
    if (group) group.push(assignment);
    else byDriver.set(assignment.driverId, [assignment]);
  }
  const names = new Map(passengers.map(passenger => [passenger.id, passenger.name]));
  return (
    <div className="plan-grid" data-testid={saved ? "saved-assignments" : "preview-assignments"}>
      {drivers.length === 0 && <p className="empty-state">No active drivers.</p>}
      {drivers.map(driver => {
        const riders = byDriver.get(driver.id) ?? [];
        return (
          <article key={driver.id} className="driver-plan" aria-label={driver.name}>
            <header>
              <h3>{driver.name}</h3>
              <p>{riders.length} of {driver.seatCapacity} seats filled</p>
            </header>
            {riders.length ? (
              <ul>
                {riders.map(({ passengerId, cost }) => (
                  <li key={passengerId}>
                    <span>{names.get(passengerId) ?? passengerId}</span>
                    <span className="pickup-cost">{formatCost(unit, cost)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="empty-state">No passengers assigned.</p>}
          </article>
        );
      })}
    </div>
  );
}

export default function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = use(params);
  return <TripDashboard key={tripId} tripId={tripId} />;
}

function TripDashboard({ tripId }: { tripId: string }) {
  // The storage probe runs once in the lazy initializer. On the server there is
  // no sessionStorage, so storageWritable() returns true optimistically; the
  // client value from this initializer is authoritative for actual blocking.
  const [storageBlocked, setStorageBlocked] = useState(() => !storageWritable());
  const [state, dispatch] = useReducer(tripReducer, tripId, initialState);
  const [message, setMessage] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);
  const [editing, setEditing] = useState<{ id: string; baseVersion: number } | null>(null);
  const snapshot = state.snapshot as Snapshot | null;
  // The reducer holds the full accepted preview payload, so the rendered detail
  // and the committable reference are the same object (ISSUE-023). When the
  // reducer clears/rejects a preview, there is nothing to render.
  const previewDetail = state.preview as PreviewPayload | null;

  // Allocate once per read, alongside the reducer's get/start. A render or
  // effect replay can still see an older reducer value while starts are queued.
  const readGenRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++readGenRef.current;
    dispatch({ type: "get/start" });
    try {
      const res = await fetch(`/api/trips/${tripId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Trip read failed.");
      const body = (await res.json()) as Snapshot;
      if (generation === readGenRef.current) setReadError(false);
      dispatch({ type: "get/received", generation, snapshot: body });
    } catch {
      // ISSUE-023: a failed read must be visible and offer retry, not loop on
      // the loading message.
      if (generation === readGenRef.current) setReadError(true);
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
      state.highestObservedVersion > 0 &&
      !state.pendingOperation &&
      state.snapshot === null
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void refresh();
    }
  }, [state.highestObservedVersion, state.snapshot, state.pendingOperation, refresh]);

  async function sendMutation(
    op: Omit<PendingOperation, "key" | "tripId"> & { key?: string },
  ): Promise<boolean> {
    if (storageBlocked) {
      setMessage("Session storage is unavailable; mutations are blocked. Reads and previews still work.");
      return false;
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
      return false;
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
        return res.ok;
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
    return false;
  }

  function retryPending(): void {
    const op = state.pendingOperation;
    if (op) void sendMutation({ key: op.key, method: op.method, canonicalRoute: op.canonicalRoute, normalizedBody: op.normalizedBody });
  }

  const inFlight = useRef<{ generation: number; controller: AbortController } | null>(null);
  useEffect(() => () => inFlight.current?.controller.abort(), []);
  useEffect(() => {
    const active = inFlight.current;
    if (active && active.generation !== state.previewGeneration) {
      active.controller.abort();
      inFlight.current = null;
    }
  }, [state.previewGeneration]);

  async function preview(): Promise<void> {
    if (inFlight.current || state.pendingOperation) return;
    const generation = state.previewGeneration + 1;
    const controller = new AbortController();
    inFlight.current = { generation, controller };
    dispatch({ type: "preview/start" });
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]);
    try {
      const res = await fetch(`/api/trips/${tripId}/match/preview`, { method: "POST", cache: "no-store", signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const version = body?.error?.currentVersion;
        dispatch({ type: "preview/failed", generation, currentVersion: Number.isSafeInteger(version) ? version : undefined });
        return;
      }
      const body = (await res.json()) as PreviewPayload;
      dispatch({ type: "preview/received", generation, preview: body });
    } catch {
      dispatch({ type: "preview/failed", generation });
    } finally {
      if (inFlight.current?.controller === controller) inFlight.current = null;
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

  function clearSavedPlan(): void {
    if (snapshot?.status !== "assigned" || state.pendingOperation) return;
    if (!window.confirm("Clear the saved assignments? Drivers and passengers will stay registered.")) return;
    void sendMutation({
      method: "POST",
      canonicalRoute: `/api/trips/${tripId}/match/clear`,
      normalizedBody: { baseVersion: snapshot.version },
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
  const activeDrivers = snapshot?.drivers.filter(driver => driver.active) ?? [];
  const activePassengers = snapshot?.requests.filter(passenger => passenger.active) ?? [];
  const commitEnabled = canCommit(state);
  const nameOf = (members: Array<{ id: string; name: string }>, id: string) =>
    members.find((m) => m.id === id)?.name ?? id;

  function rosterRow(participant: Driver | Passenger) {
    if (!snapshot) return null;
    const driver = "seatCapacity" in participant;
    const label = driver ? "driver" : "passenger";
    const disabled = !!pending || storageBlocked;
    const isEditing = editing?.id === participant.id && editing.baseVersion === snapshot.version;
    const route = `/api/trips/${tripId}/${driver ? "drivers" : "requests"}/${participant.id}`;
    const location = participant.location?.label ?? participant.zoneId;
    return (
      <li key={participant.id}>
        <div className="roster-row">
          <p className="roster-details">
            <strong>{participant.name}</strong>{" "}
            <span>
              ({location})
              {driver && ` seats ${participant.seatCapacity}`}
              {driver && participant.maxDetourMinutes !== null && ` · limit ${participant.maxDetourMinutes} min`}
            </span>
          </p>
          <div className="row-actions">
            {!isEditing && (
              <button type="button" disabled={disabled} aria-label={`Edit ${label} ${participant.name}`} onClick={() => {
                setMessage(null);
                setEditing({ id: participant.id, baseVersion: snapshot.version });
              }}>
                Edit {label}
              </button>
            )}
            <button type="button" disabled={!!pending} onClick={() => void sendMutation({
              method: "PATCH",
              canonicalRoute: route,
              normalizedBody: { baseVersion: snapshot.version, active: false },
            })}>
              {driver ? "Cancel" : "Withdraw"}
            </button>
          </div>
        </div>
        {isEditing && (
          <ParticipantEditForm
            participant={participant}
            tripId={tripId}
            disabled={disabled}
            onCancel={() => setEditing(null)}
            onSave={async details => {
              const saved = await sendMutation({
                method: "PATCH",
                canonicalRoute: route,
                normalizedBody: { baseVersion: editing.baseVersion, details },
              });
              if (saved) setEditing(current => current === editing ? null : current);
            }}
          />
        )}
      </li>
    );
  }

  return (
    <main className="page dashboard" id="main-content" tabIndex={-1}>
      <header className="page-heading">
        <h1>{snapshot?.name ?? "Trip"}</h1>
        {snapshot ? (
          <p className="trip-context">
            {snapshot.locationMode === "zone" && <span>{snapshot.destinationLabel}</span>}
            <span>Departs <time dateTime={snapshot.departAt}>{departureFormat.format(new Date(snapshot.departAt))} UTC</time></span>
          </p>
        ) : null}
      </header>
      {storageBlocked ? <p role="alert">Session storage unavailable: mutations are blocked.</p> : null}
      {readError ? (
        <section className="notice">
          <p role="alert">Could not load the current trip.</p>
          <button onClick={() => void refresh()}>Retry load</button>
        </section>
      ) : null}
      {message ? <p role="status">{message}</p> : null}

      {pending ? (
        <section className="notice">
          <p role="status">Pending operation. Retry the last change before continuing.</p>
          <button onClick={retryPending}>Retry</button>
        </section>
      ) : null}

      {snapshot ? (
        <>
          <div className="trip-summary" data-testid="trip-status" data-version={snapshot.version}>
            <span className="trip-state" data-state={snapshot.status}>{tripStatusLabels[snapshot.status]}</span>
            <span>Matched: {snapshot.totals.matched}</span>
            <span>Seats available: {snapshot.totals.seatsAvailable}</span>
            <span>{formatTotal(snapshot.costUnit, snapshot.totals.totalCost)}</span>
          </div>
          {snapshot.venue ? (
            <p data-testid="trip-venue">
              Venue: {snapshot.venue.label} — {snapshot.venue.detail}.{" "}
              {snapshot.venue.provider === "fixture"
                ? "Fixture data: fictional places and driving times."
                : null}{" "}
              <Attribution provider={snapshot.venue.provider} sources={[snapshot.venue.attribution]} />
            </p>
          ) : null}

          <InviteLink inviteId={snapshot.inviteId} />

          <section className="card registration">
            <h2>Register participants</h2>
            <div className="registration-grid">
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
            </div>
          </section>

          <div className="roster-grid">
            <section className="card roster roster-drivers" aria-labelledby="roster-drivers">
              <h2 id="roster-drivers">Drivers</h2>
              {activeDrivers.length === 0 ? <p className="empty-state">No active drivers.</p> : null}
              <ul>{activeDrivers.map(rosterRow)}</ul>
            </section>

            <section className="card roster roster-passengers" aria-labelledby="roster-passengers">
              <h2 id="roster-passengers">Passengers</h2>
              {activePassengers.length === 0 ? <p className="empty-state">No active passengers.</p> : null}
              <ul>{activePassengers.map(rosterRow)}</ul>
            </section>

          </div>

          <section className="card matching">
            <h2>Matching</h2>
            <div className="row-actions">
              <button type="button" disabled={!!pending || state.previewStatus === "pending"} onClick={() => void preview()}>
                {state.previewStatus === "retry" ? "Retry preview" : "Preview"}
              </button>
              <button type="button" className="primary" disabled={!commitEnabled} onClick={commit}>
                Save plan
              </button>
              {previewDetail && (
                <button type="button" onClick={() => dispatch({ type: "preview/discard" })}>Discard preview</button>
              )}
            </div>
            {previewDetail ? (
              <div data-testid="preview-ready" data-version={previewDetail.baseVersion}>
                <p role="status">Preview ready to review.</p>
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
                  <EstimateDetails estimate={previewDetail.estimate} snapshot={snapshot} />
                ) : null}
                <PlanCards assignments={previewDetail.optimal.assignments} drivers={activeDrivers}
                  passengers={activePassengers} unit={previewDetail.costUnit ?? snapshot.costUnit} />
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
              <p role="status" data-testid="preview-none">
                {state.previewStatus === "pending"
                  ? snapshot.locationMode === "address" ? "Estimating pickup times…" : "Computing assignments…"
                  : state.previewStatus === "retry" ? "Preview unavailable. Retry to review a plan." : "No current preview. Preview to review a plan, then save."}
              </p>
            )}
          </section>

          {snapshot.status === "assigned" ? (
            <section className="card saved-plan">
              <div className="plan-heading">
                <h2>Saved plan</h2>
                <button type="button" disabled={!!pending || storageBlocked} onClick={clearSavedPlan}>Clear plan</button>
              </div>
              {snapshot.estimate && <EstimateDetails estimate={snapshot.estimate} snapshot={snapshot} saved />}
              <PlanCards assignments={snapshot.assignments.map(({ requestId, driverId, pickupCost }) =>
                ({ passengerId: requestId, driverId, cost: pickupCost }))}
                drivers={activeDrivers} passengers={activePassengers} unit={snapshot.costUnit} saved />
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
        <p role="status" className="empty-state">{readError ? "Trip unavailable." : "Loading current trip…"}</p>
      )}
    </main>
  );
}

function ZoneOptions() {
  return ["north", "east", "south", "west"].map(zone => (
    <option key={zone} value={zone}>{zone}</option>
  ));
}

function ParticipantEditForm({
  participant, tripId, disabled, onCancel, onSave,
}: {
  participant: Driver | Passenger;
  tripId: string;
  disabled: boolean;
  onCancel: () => void;
  onSave: (details: Record<string, string | number>) => Promise<void>;
}) {
  const [changeAddress, setChangeAddress] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const driver = "seatCapacity" in participant;
  const label = driver ? "driver" : "passenger";
  const address = participant.location;
  return (
    <form className="participant-edit" aria-label={`Edit ${label} details`} onSubmit={event => {
      event.preventDefault();
      if (disabled || (changeAddress && !selection)) return;
      const fields = new FormData(event.currentTarget);
      const checked = validateName(String(fields.get("name") ?? ""));
      if (!checked.ok) {
        setError(checked.reason);
        return;
      }
      const details: Record<string, string | number> = { name: checked.value };
      if (driver) {
        details.seatCapacity = Number(fields.get("seats"));
        if (address) details.maxDetourMinutes = Number(fields.get("detour"));
      }
      if (!address) details.zoneId = String(fields.get("zone"));
      if (changeAddress && selection) {
        details[driver ? "startSelectionToken" : "pickupSelectionToken"] = selection.token;
      }
      setError(null);
      void onSave(details);
    }}>
      <label>Name<input name="name" defaultValue={participant.name} required disabled={disabled} /></label>
      {address ? (
        <>
          <p>Current address: {address.detail}</p>
          <label className="checkbox-label">
            <input type="checkbox" checked={changeAddress} disabled={disabled} onChange={event => {
              setChangeAddress(event.target.checked);
              setSelection(null);
            }} />
            Change address
          </label>
          {changeAddress && (
            <LocationPicker label={driver ? "New driver start address" : "New passenger pickup address"}
              purpose={driver ? "driver_start" : "pickup"} tripId={tripId} disabled={disabled} onSelect={setSelection} />
          )}
        </>
      ) : (
        <label>Pickup zone
          <select name="zone" defaultValue={participant.zoneId ?? ""} disabled={disabled} required><ZoneOptions /></select>
        </label>
      )}
      {driver && (
        <label>Seats available
          <input name="seats" type="number" min={LIMITS.seatMin} max={LIMITS.seatMax}
            defaultValue={participant.seatCapacity} disabled={disabled} required />
        </label>
      )}
      {driver && address && (
        <label>Detour limit (minutes)
          <input name="detour" type="number" min={LIMITS.detourMinutesMin} max={LIMITS.detourMinutesMax}
            defaultValue={participant.maxDetourMinutes ?? undefined} disabled={disabled} required />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="row-actions">
        <button type="submit" disabled={disabled || (changeAddress && !selection)}>Save changes</button>
        <button type="button" disabled={disabled} onClick={onCancel}>Cancel edit</button>
      </div>
    </form>
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
      <h3>Driver</h3>
      <label>Name<input aria-label="driver name" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Pickup zone<select aria-label="driver zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
        <ZoneOptions />
      </select></label>
      <label>Seats available<input
        aria-label="driver seats"
        type="number"
        min={0}
        max={8}
        value={seatCapacity}
        onChange={(e) => setSeatCapacity(Number(e.target.value))}
      /></label>
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
      <h3>Passenger</h3>
      <label>Name<input aria-label="passenger name" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Pickup zone<select aria-label="passenger zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
        <ZoneOptions />
      </select></label>
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
      <h3>Driver</h3>
      <label>Name<input aria-label="driver name" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <LocationPicker
        label="Driver start address"
        purpose="driver_start"
        tripId={tripId}
        disabled={disabled}
        onSelect={setStart}
        resetSignal={resetSignal}
      />
      <label>Seats available<input
        aria-label="driver seats"
        type="number"
        min={0}
        max={8}
        value={seatCapacity}
        onChange={(e) => setSeatCapacity(Number(e.target.value))}
      /></label>
      <label>Detour limit (minutes)<input
        aria-label="driver detour limit (minutes)"
        type="number"
        min={0}
        max={120}
        value={maxDetour}
        onChange={(e) => setMaxDetour(Number(e.target.value))}
      /></label>
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
      <h3>Passenger</h3>
      <label>Name<input aria-label="passenger name" value={name} onChange={(e) => setName(e.target.value)} /></label>
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
