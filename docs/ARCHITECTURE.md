# GroupRide architecture and implementation roadmap

**Status:** Proposed design; the app, scripts, and tests are not implemented. This is the single implementation reference. Record actual results in [EVIDENCE.md](EVIDENCE.md); [PROJECT_SPEC.md](../PROJECT_SPEC.md) defines course requirements.

## Product, scope, and workflow

GroupRide helps organizations coordinate carpools to a shared event, reducing manual coordination. The planned claims are:

1. **Matching:** Maximize assigned passengers, then minimize total estimated pickup cost among equally complete feasible assignments.
2. **Consistency:** Preserve capacity, uniqueness, and cancellation invariants during overlapping updates; reject stale matching commits.

These are project choices. The course requires at least one consequential claim and two documented decisions, not two separate technical subsystems.

**Core workflow:** Create `Saturday Retreat` with one destination and departure time → register drivers with names, zones, and available passenger seats → register passengers with names and zones → preview matching → commit → reload the saved roster. Each passenger requests one seat; capacity excludes the driver. Display per-driver assignments, unassigned riders, seats used, matched count, and cost. After cancellation, remove invalid assignments and let the organizer rematch manually. A stale commit shows a conflict and requests a fresh preview.

**Core implementation:** Minimal trip-creation, roster, preview, and committed-roster views (which may share a page), persistence, cancellation, greedy comparison, fixtures/reset, and a scripted conflict demonstration. Demo roles are simulated.

**Optional:** Invitations, passenger confirmations, zone visualization or cost editing, polling, CSV export, and a demo panel. Cost editing would need explicit version/invalidation rules.

**Limitations:** Fictional participants, synthetic zones, and fixed nonnegative integer pickup costs; missing pairs are incompatible. Independent pickup costs do not model actual driving time/distance or multi-stop routes. Payments, GPS/navigation, messaging, driver vetting, mobile apps, and production authentication/authorization are out of scope. This is a class demo, not a production transportation service.

## Technology and components

| Component | Planned technology / responsibility |
|---|---|
| Web application | Next.js, React, TypeScript; forms, dashboard, and API routes |
| Database | PostgreSQL; persistence, transactions, and trip-row coordination |
| Database access | `pg`, or an ORM exposing explicit transactions; finalize during setup |
| Tests | Vitest for matching and database integration; optional Playwright for browser automation |
| Local environment | Docker Compose for PostgreSQL; synthetic fixtures, no required external API |

Pin runtime/dependency versions when scaffolding. Put verified install, build, start, reset, and test commands in the [README](../README.md).

- `src/matching/`: pure optimizer, greedy baseline, flow graph, validator; no HTTP/database dependencies.
- `src/trips/`: repositories, coordinated mutations, preview, commit.
- `src/app/`: UI/API; `src/db/`: schema, connections, migrations.
- `tests/`: matching, concurrency, end-to-end checks, retained fixtures/seeds.
- `scripts/`: demo seed/reset and controlled conflict harness.

## Data model and invariants

| Entity | Conceptual fields |
|---|---|
| `trips` | `id`, `name`, `destination_label`, `depart_at`, `status`, `version`, `created_at` |
| `drivers` | `id`, `trip_id`, `name`, `zone_id`, `seat_capacity`, `active` |
| `ride_requests` | `id`, `trip_id`, `name`, `zone_id`, `active`, `request_key` |
| `assignments` | `trip_id`, `request_id`, `driver_id`, `committed_version` |
| `zone_costs` | `driver_zone_id`, `passenger_zone_id`, `cost` |

- Capacity is an integer `>= 0`; assignments never exceed driver capacity.
- A passenger has at most one assignment per trip: `UNIQUE(trip_id, request_id)`.
- Assigned drivers/requests are active, compatible, and belong to the same trip.
- Every effective roster/assignment mutation locks the trip and increments its version in the same transaction. Assignment replacement/invalidation is atomic.
- Retrying registration with the same `request_key` creates one effective registration; clients reuse the key on retries.

Use keys, foreign keys, and checks where applicable, plus coordinated transaction logic for capacity and active status. Uniqueness alone does not establish all invariants.

Statuses: `open` before an authoritative allocation; `assigned` after commit; `needs_rematch` when inputs to an existing plan change. Still-valid assignments may remain visible in `needs_rematch`, but are no longer asserted globally optimal. Matching can run from any status. Registrations after assignment also increment version and require rematching.

## API

| Method | Route | Behavior |
|---|---|---|
| `POST` | `/api/trips` | Create a trip |
| `GET` | `/api/trips/:id` | Read trip, roster, assignments, version |
| `POST` | `/api/trips/:id/drivers` | Register driver |
| `POST` | `/api/trips/:id/requests` | Register passenger idempotently |
| `PATCH` | `/api/trips/:id/drivers/:driverId` | Change capacity/availability or cancel |
| `DELETE` | `/api/trips/:id/requests/:requestId` | Withdraw passenger and invalidate assignment |
| `POST` | `/api/trips/:id/match/preview` | Snapshot inputs, then compute matching |
| `POST` | `/api/trips/:id/match/commit` | Check version and atomically save |

Validate IDs, trip membership, capacities, zones, and bodies. Stale commits return structured `409` with current version and no partial changes.

## Matching engine

The pure `optimizeMatches(input)` accepts drivers (`id`, `zoneId`, `seatCapacity`, `active`), passengers (`id`, `zoneId`, `active`), and pairwise costs. Use a typed map or unambiguous key helper for `(driverId, passengerId)`. Return assignments (`passengerId`, `driverId`, `cost`), `unassignedPassengerIds`, `matchedCount`, and `totalCost`.

For binary `x[i,j]`, each passenger satisfies `sum_j x[i,j] <= 1`, each driver satisfies `sum_i x[i,j] <= capacity[j]`, and incompatible/inactive pairs cannot be selected. Maximize `sum x` first, then minimize `sum cost * x` among maximum-cardinality solutions.

**Greedy:** Process passengers in a fixed order, choosing the cheapest compatible driver with space; break driver ties by ID.

**Proposed optimizer:** Min-cost max-flow on source → passengers → drivers → sink. Source-to-passenger edges have capacity 1/cost 0; compatible passenger-to-driver edges have capacity 1/pickup cost; driver-to-sink edges have seat capacity/cost 0. Augment along minimum-cost residual paths until none remains. Include reverse edges, capacity updates, reconstruction, and invariant validation.

**Decision D-1:** Evaluate global matching versus greedy using the hand-check below, an independent exhaustive oracle, and seeded quality/runtime comparisons. Record the actual choice and evidence during implementation.

## Concurrency protocol

Every relevant mutation endpoint coordinates through the same trip row inside a transaction (`SELECT ... FOR UPDATE` or equivalent conditional update). A version check outside the write transaction is insufficient. Seeded costs stay fixed during normal operation; reset establishes a new demo state.

**Preview:** Briefly lock the trip, read its version and matching inputs, then commit the read transaction. Compute outside the lock; return assignments, metrics, and `baseVersion`. A preview does not reserve seats.

**Commit:** Start a transaction, lock the trip, compare its version with `baseVersion`. On mismatch, roll back and return `409`. Otherwise validate against authoritative inputs (or recompute server-side), atomically replace assignments, increment version, set `assigned`, and commit. Never trust an unchecked client assignment list.

**Cancellation/updates:** Lock the trip, change inputs, remove invalid assignments, increment version, update status, and commit together. Capacity reductions must not leave overcapacity assignments; finalize the exact invalidation policy before implementing the endpoint.

Two commits using one version permit at most one success. Registration/cancellation after preview makes it stale. Duplicate registration retries create one record. Failure during assignment replacement rolls back the whole transaction. Different trips coordinate independently.

**Decision D-2:** Compare holding the lock throughout computation with the proposed short snapshot transaction and versioned commit. Evaluate forced conflicts, blocking, and retries; retain or revise based on observations.

Before implementing commit, settle how it identifies the server-generated preview: feasibility checks alone do not establish that a client-supplied plan is the optimizer's result.

## Validation and demonstration

These are planned checks, not observed results. Retain fixtures, commands, expected-result derivations, outputs, and code/commit links in [EVIDENCE.md](EVIDENCE.md).

### Independent fixture

| Driver | Passenger A cost | Passenger B cost | Seats |
|---|---:|---:|---:|
| Driver 1 | 1 | 2 | 1 |
| Driver 2 | 2 | 100 | 1 |

The only complete assignments are A→1/B→2 costing **101**, and A→2/B→1 costing **4**. Both serve two passengers. Enumeration independently establishes the optimum and exposes an implementation that reports the passenger-A-first greedy result as optimal.

### Acceptance checks

| ID | Scenario and expected observable result |
|---|---|
| M-01 | Above fixture: 2 matched, total cost 4 |
| M-02 | One driver, 2 seats, 5 compatible passengers: exactly 2 matched |
| M-03 | No drivers / zero capacities: 0 matched, cost 0 |
| M-04 | Incompatible pairs: none selected |
| M-05 | Equal-cost alternatives: correct matched count/cost; no required tied assignment |
| M-06 | Tiny seeded instances: cardinality/cost agree with independently written exhaustive oracle |
| M-07 | Corrupt assignments: reject duplicate passengers and overcapacity drivers |
| C-01 | Two commits from one version: one succeeds; stale contender gets `409` |
| C-02 | Driver cancels after preview: old commit rejected; no assignment to canceled driver |
| C-03 | Passenger registers after preview: old commit rejected |
| C-04 | Concurrent retries with one request key: one effective registration |
| C-05 | Inject failure between assignment delete/insert: original assignments survive rollback |
| C-06 | Independent trips: both updates succeed |
| C-07 | Reduce capacity: no overcapacity assignments; follow documented invalidation policy |
| WF-1 | Create → register → preview → commit → reload: valid saved roster and consistent displayed totals |
| WF-2 | Cancel → rematch → commit: valid replacement roster |
| WF-3 | Stale preview: clear refresh/conflict message; no overwrite |

Use real PostgreSQL/separate connections for concurrency checks. Force overlap with barriers/hooks: pause after snapshot acquisition, finish the competing update, then resume commit. Check invariants afterward. Keep exhaustive-oracle logic independent of flow logic; compare objective values when ties exist. Students independently inspect expected results.

For D-1, record matched count, cost, and runtime on seeded cases (e.g., 5, 15, 30 passengers); compare costs only at equal maximum matched counts. For D-2, record success/conflict counts and blocking observations, with latency when measured. Sample sizes are experiments, not established support limits.

**Demo target:** Reset a local fictional event; create/seed its roster; preview, commit, reload; show the hand-check; force cancellation between preview and commit and show rejection. Explain both decisions, one real debugging incident, reused components, and the actual-route limitation. Add executable reset/test commands and exact interactions to README once implemented. Demo duration comes from the course schedule.

## Implementation roadmap

| Checkpoint | Work and completion gate |
|---|---|
| E0 — Contract | Confirm scope, input bounds, matching contract, invalidation policy, preview identification. Scaffold/pin dependencies, initialize Git, record starting commit, encode hand-check fixture. |
| E1 — Behavior | Implement matcher, greedy, validator, independent checks; then schema, seed/reset, coordinated mutations, preview/commit, minimal UI. Demonstrate persistent valid roster and an edge case. |
| E2 — Control | Exercise cancellation, retries, rollback, forced conflicts. Evaluate D-1/D-2; retain agent diffs, independent human checks, and a consequential correction/rejection/redesign. |
| E3 — Defense | Verify clean setup/demo; record actual outputs, real debugging story, limitations, attribution, final decision evidence. Prepare required PDFs and arrange access/demo submission. |

Within E1, build matching first, persistence/transactions second, minimal UI third. Collect evidence throughout; phase labels do not postpone human review or transaction correctness. Canvas determines deadlines.

**Risks/fallback:** Optimizer correctness, concurrent updates, and UI integration are the main risks within two weeks. Omit optional features/polish first. If custom min-cost flow is infeasible, use an exact optimizer for explicitly bounded small trips; document/enforce limits and retain independent checks. Record significant scope changes and reasons. Attribute reused solvers rather than claiming their algorithm as student work.

The minimum under this project plan remains a reproducible create/register → match → commit → display workflow, rejection of a stale commit, and independent validation.
