# GroupRide

Carpool coordination for organization events: create a trip, register drivers and passengers, preview assignments, commit them, and recover when availability changes.

**W5 is committed at `2d4768b`.** The trip workflow, race and recovery checks, and matching, concurrency and responsiveness evaluations passed. W6 reproduced the candidate from a fresh checkout and empty databases. The [38-check results](docs/EVIDENCE.md#validation-results--vr-1-through-vr-3-rr-4) include one additional cross-trip preview check in the W6 diff. Student review and submission tasks remain open. [Current handoff](WORKPLAN.md)

## Documentation

- [Workplan and current handoff](WORKPLAN.md): start here for the next task, implementation checkpoints, release gates, and progress tracking.
- [Agent instructions](AGENTS.md): repository conventions, verification, evidence, and handoff requirements for coding agents.
- [Selected initial architecture](docs/ARCHITECTURE.md): component choices, contracts, alternatives and tradeoffs, acceptance checks, comparison experiments, and implementation roadmap.
- [Project evidence](docs/EVIDENCE.md): required validation results, agent/human work records, two decisions, debugging case, and attribution. Fill these during development.
- [Course specification](PROJECT_SPEC.md): supplied requirements and final acceptance checklist.

The selected design is one Next.js application with PostgreSQL, explicit SQL transactions, and bounded min-cost flow matching. The browser supports trip creation, registration, server-generated previews, version-checked saves and same-key retry after an uncertain outcome.

## Setup and demonstration

Use Node `24.22.3` (see `.node-version`), npm, and a running Docker engine with Compose. On a Mac with Homebrew `node@24`, select it for the current shell with `export PATH="$(brew --prefix node@24)/bin:$PATH"`. Copy `.env.example` to `.env` if the file does not exist. The checked-in credentials are for disposable local demo and test databases on port 55432.

Verified in the workspace with Node 24:

```sh
npm run test:setup
npm run test:matching
docker compose config --quiet
```

Run the full W0 setup sequence in a shell with npm registry and Docker access. Use the existing `package-lock.json` for `npm ci` and retain it in Git.

```sh
npm ci
docker compose up -d --wait db
npm run db:migrate
npm run db:migrate
npm run demo:reset
npm run test:database
npm run lint
npm run typecheck
npm run build
npm run test:readiness
```

`npm run test:readiness` launches production and development servers on temporary loopback ports. It uses the designated disposable test database. Expect a working landing page and HTTP 200 readiness in production, HTTP 503 `DATASET_MISMATCH` after one cost changes, and HTTP 200 readiness in development after an offline reset. The check clears the test database and seeds a fresh starter trip. Stop any app using the test database first. If interrupted during the drift check, stop its app process and use `npm run demo:reset -- test` to restore the test fixture.

For W2, stop any app using `groupride_test`, then run `npm run test:unit` and `npm run test:concurrency -- --reporter=verbose`. The concurrency suite uses the two test URLs in `.env` and resets the designated test database before each case.

For W3, run the preview/commit integration cases (part of `npm run test:concurrency`) and the browser workflow checks. The browser checks need Chromium installed once with `npx playwright install chromium`; then, with the database running and `groupride_test` free, run `npm run test:e2e`. It builds a production server on loopback port 3100 against the test database (reset first) and drives real Chromium through WF-1, WF-2, WF-3, WF-4, U-02, and U-03. Reducer ordering (U-01, U-04) is covered database-free by `npm run test:unit`.

For W5 evaluation, `npm run eval:matching` runs the exact-size classes and 100 oracle seeds. With the designated `groupride_test` database free, `npm run eval:concurrency` runs D-2. After `npm run build`, `npm run eval:responsiveness` starts the production server on port 3100 and writes `eval/p01-responsiveness.json`. Both database experiments reset `groupride_test`. P-01 verifies the persisted 20-driver/50-passenger roster before timing, ends the measured window the instant the preview load finishes (classifying competing requests by start time against that boundary), requires 100 distinct freshly-computed previews each with a finite matcher duration, and records competing GET/PATCH latency, matcher duration, cache hits and event-loop delay. The `roster`, `duplicate`, `preview`, and `edits` values of `P01_NEGATIVE_CONTROL` each produce a failing run and write `eval/p01-control.json`. Observed on this host (Node 24, commit `8f3187a`): D-1 oracle 100/100, solver p95 ≈ 1.8 ms; D-2 both variants `STALE_VERSION` with the full blocking interval; P-01 roster `20d/50p`, 100 fresh previews, competing under-load p95 ≈ 12 ms, increase ≈ 2 ms.

To open the app against your demo database, run `npm start` after building or use `npm run dev`, then visit `http://127.0.0.1:3000`.

`npm run demo:reset` replaces all data in the designated demo database and prints its new starter trip ID. Stop the app before running it and wait for reset to finish before restarting. A startup read overlapping reset may briefly report `DATASET_MISMATCH` (ISSUE-004). `npm run test:database` replaces data only in the designated test database. Both databases are bootstrapped on first start with an empty Compose volume. For a clean rehearsal, use a fresh Compose project with port 55432 available.

## Demonstration (W3 workflow)

With the database running and the app stopped, build then start the demo:

```sh
npm run build
npm run demo
```

`npm run demo` resets the demo database, prints a fresh starter trip ID, and starts the production server on `http://127.0.0.1:3000`. The WF-4 directional-cost walk-through:

1. Open `http://127.0.0.1:3000` and create a trip (any name/destination; departure as ISO 8601 with an offset, e.g. `2026-03-01T09:30:00+00:00`). You land on `/trips/<id>`.
2. Under **Register**, add a driver in zone `north` with 1 seat, then a passenger in zone `east`.
3. Click **Preview**. The current page shows the preview version. The fixture’s expected result is 1 match at cost 7, visible in the status line after saving.
4. Click **Save plan (commit)**. The status line shows `assigned`, `Matched: 1`, `Total cost: 7`.
5. Reload the page: the saved plan persists.
6. Click **Reduce capacity** or **Cancel** on the driver: the plan clears and the status becomes `needs_rematch`. Preview and save again to rematch.

Open the same `/trips/<id>` URL in a second browser profile to see the stale-commit flow: if one tab commits, the other tab's commit is rejected with a review/refresh prompt rather than silently overwriting the saved plan.

## Course deliverables

The course requires a runnable GitHub repository accessible to staff, a short proposal PDF, a final slide deck PDF, and a live demonstration. Submit the required URL/PDFs and reserve a demo slot through Canvas by its deadlines. The final deck is the writeup; no separate written report is required.

The [proposal PDF](deliverables/proposal.pdf) and [six-slide presentation draft](deliverables/presentation-draft.pdf) are ready for student review. The deck must be transferred into the official Canvas template. The [W6 checklist](WORKPLAN.md#w6--clean-reproduction-and-submission) tracks the remaining course actions.
