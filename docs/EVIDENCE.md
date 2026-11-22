# Project evidence

**Status:** Development record. W0 results and student-run verification are recorded below. Design and planned checks live in [ARCHITECTURE.md](ARCHITECTURE.md).

The [course specification](../PROJECT_SPEC.md) requires the content below, but does not require separate documents for each category. These are working records for the final slide deck; DEL-3 does not require a separate written report.

## Validation results — VR-1 through VR-3, RR-4

For each significant claim, retain the starting state, exact command/interaction, independently established expectation and derivation, actual output, and code/test/commit. Record failures and subsequent verification where relevant. Agent-reported success alone is not independent acceptance (AR-3).

| Claim/check | Input or reset state | Command / interaction | Expected result and independent basis | Actual output / artifact | Code / test / commit |
|---|---|---|---|---|---|
| M-01 matching optimum | Architecture's 2×2 fixture | TODO after implementation | 2 matched, cost 4; enumerate both complete assignments | Not run | TODO |
| M-08 coverage before cost | Architecture's restricted-compatibility fixture | TODO after implementation | 2 matched, cost 3; only full assignment is A→D2/B→D1 | Not run | TODO |
| C-02 stale commit | Preview, then commit driver cancellation | TODO after implementation | `409`, no canceled driver assigned; version/invariant contract | Not run | TODO |
| C-13 publication version check | Roster mutation during preview computation | TODO after implementation | `409`; newer state preserved and no stale preview published | Not run | TODO |
| C-17 terminal failure | Fail after business writes; race/replay the same key; also lose failure-commit acknowledgement | TODO after implementation | Business state unchanged; durable `not_applied` receipt prevents later application; missing commit confirmation remains unknown | Not run | TODO |
| C-18 dataset lifetime | Change M-01's unused cost 100→0 while retaining trips | TODO after implementation | Existing plan still costs 4 but optimum becomes 1; startup/seed change must refuse service until explicit reset | Not run | TODO |
| WF-1 persistence | Seeded fictional trip | TODO after implementation | Valid saved roster after reload; inspect fixture and invariants | Not run | TODO |
| WF-4 directional costs | One North driver/East passenger; costs North→East 7, East→North 19 | TODO after implementation | 1 matched, cost 7 in preview, database, and reloaded UI; hand-read directional table | Not run | TODO |
| U-01 / U-04 browser state | Deliver v6 conflict/GET before delayed v5 data; deliver terminal/unknown/old-key mutation replies | TODO after implementation | Old preview cleared, version floor stays ≥6; only matching terminal outcome releases pending operation | Not run | TODO |

## Agent work and human oversight — AR-1 through AR-3

Preserve at least two traceable agent-work episodes, including an actual consequential human correction, rejection, or redesign. Do not fabricate incidents or approvals. Students define objectives, invariants, scope, and acceptance criteria, inspect generated changes, independently check them, and decide what to retain. Agents may assist with bounded implementation/testing tasks.

| Episode | Specific bounded request | Resulting diff / commit | Observations and independent human checks | Human decision and reason |
|---|---|---|---|---|
| D-0: initial design | Flesh out the full architecture and propose alternatives, tradeoffs, and evaluation comparisons | [ARCHITECTURE.md](ARCHITECTURE.md), README, and this record; combined design diff retained in `e2510d7`, not a separate episode commit | At that draft: agent checked relative links and 27 planned check IDs, retained the original 17 IDs, confirmed the course spec was unchanged, and independently enumerated M-01 (2 matched/cost 4) and M-08 (2/cost 3). Human review remains pending; these are document/fixture checks, not application results. | Pending; proposed choices are not recorded as independently accepted |
| D-BASE: baseline selection | Choose a combination of existing and alternative components and finalize the initial design | [ARCHITECTURE.md](ARCHITECTURE.md), README, and this record; combined design diff retained in `e2510d7`, not a separate episode commit | Agent selected stored previews, specified retry recovery/response ordering, and revised comparisons. Agent document checks: 4 Markdown files, 10 local links resolve, balanced fences, 34 unique planned checks retaining all 27 previous IDs with C-13 explicitly revised, course spec byte-for-byte unchanged. Separate enumeration confirmed M-01 = 2/cost 4, M-08 = 2/cost 3, WF-4 = 1/cost 7. These are document/fixture observations; application checks have not run. | User requested finalization; independent human review of the selected details remains pending |
| D-CONTRACTS: review follow-up | Recommend solutions for the first three architecture review issues | [ARCHITECTURE.md](ARCHITECTURE.md) and this record; combined design diff retained in `e2510d7`, not a separate episode commit | Agent specified dataset lifetime/reset enforcement, global terminal receipts with savepoint rollback, and one reducer for version/preview state. Document checks passed: 38 unique planned checks retaining all 34 prior IDs, 11 local links resolve, balanced fences, clean whitespace diff, unchanged course spec. Added C-17/C-18/C-19/U-04 and strengthened U-01. Database/UI implementation and human validation have not run. | Recommendations documented; independent human acceptance pending |
| D-HANDOFF: implementation workplan | Create WORKPLAN.md with checkpoints/release gates so someone without prior context can resume, plus AGENTS.md if useful | [WORKPLAN.md](../WORKPLAN.md), [AGENTS.md](../AGENTS.md), and navigation/evidence updates; uncommitted documentation diff from `e2510d7` | Inspected the clean documentation-only baseline. Document checks passed: all 38 acceptance IDs assigned exactly once to W0–W5; 26 local links resolve; balanced fences; clean whitespace diff; unchanged course spec. All seven implementation checkpoints and four release gates remain unpassed. No application or runtime results. | User requested the handoff documents; independent review pending |
| A-1: W0 foundation | User asked to proceed with W0. Implement the scaffold, local PostgreSQL setup, migrations, seed/reset safeguards, and verify the W0 gate where tools permit. | W0 scaffold changes from `b88d98a` | The student ran the host setup, reported the C-18 failure, supplied the assertion output, and reran the corrected test successfully. Host logs confirm exit 0 for the rerun. [W0 setup verification](#w0-setup-verification) | Overall acceptance and rationale pending. The student verified C-18 on the host. |
| A-2 | TODO | TODO | TODO | Pending |
| A-1 follow-up | Proceed with W0 live startup and readiness verification. Add a repeatable check on the disposable test database. | [Readiness script](../scripts/check-readiness.ts) and [app database selection](../src/db/pool.ts) in the W0 diff | Typecheck, lint, setup tests, and production build passed. The student ran and shared all three successful HTTP results. [Readiness check](#w0-readiness-check) | Student verified the readiness behavior on the host. Overall review and decision rationale remain pending. |

D-0, D-BASE, D-CONTRACTS, and D-HANDOFF record design/planning provenance. Capture the two implementation episodes and consequential human correction as development proceeds; these records alone do not fulfill them. Agent-proposed redesigns are not recorded as human corrections.

## W0 setup verification

Observed on local macOS with Node 24.22.3, npm 11.19.1, and Docker Compose 5.5.1. Code is the uncommitted W0 diff based on `b88d98a`. The user previously confirmed registry and Docker access in the regular macOS terminal. The checks below ran in the workspace session.

| Command and starting state | Expected observation | Actual result and code |
|---|---|---|
| `npm run test:setup`, Node 24 and no installed dependencies | A marked loopback URL is accepted. Wrong database, host, port, role, and URL overrides are rejected. Row order is ignored and an unused edge change is detected. | 2 passed, 0 failed, 0 skipped. [Setup tests](../tests/setup.test.ts) |
| `docker compose config --quiet`, checked-in Compose file | Compose parses the service, loopback port, volume, and health check. | Exit 0. [Compose file](../compose.yaml) |
| `node --check` for setup, pool, transaction, CLI, and database integration test | Node parses their TypeScript syntax. | Exit 0 for each. |
| `npm install --package-lock-only`, pinned manifest and a fresh temporary npm cache | npm resolves the pinned graph and writes an installable lockfile. | Failed with registry `ENOTFOUND`. Lockfile pending. [Manifest](../package.json) |
| `docker info --format '{{.ServerVersion}}'`, configured desktop socket | Docker returns an engine version. | Permission denied in the workspace. |
| [W0 host procedure](../README.md#setup-and-demonstration), empty designated databases | Clean install and production/dev startup pass. Repeated migration is safe, the app role cannot modify costs, and C-18 rejects drift and restores a fresh trip on reset. | Pending dependency install and live Docker access. [Database integration test](../tests/database.integration.test.ts) |

### W0 scaffold review

The two setup tests, Compose configuration check, and whitespace check passed again. Registry DNS and Docker socket access still fail here, so the lockfile, clean install, lint, typecheck, build, startup, and live PostgreSQL checks remain open.

- ISSUE-004 is a code review finding. Reset checks app sessions once. An app read arriving afterward may wait on its first `SELECT` with a repeatable-read snapshot from before `TRUNCATE`. PostgreSQL documents that the truncated tables can appear empty to an older snapshot. A live reproduction is pending. [App lock](../src/db/pool.ts) · [Reset](../src/db/setup.ts) · [PostgreSQL TRUNCATE](https://www.postgresql.org/docs/18/sql-truncate.html)
- ISSUE-005 is a coverage gap. The C-18 integration test checks the validator directly and the documented HTTP smoke check covers only the ready response. [Integration test](../tests/database.integration.test.ts) · [Readiness route](../src/app/api/health/route.ts)
- ISSUE-006 is a code review finding. The transaction helper catches every `COMMIT` exception and reports an unknown outcome. A database test should distinguish a rejected commit from an unacknowledged commit before W2 relies on the helper. [Transaction helper](../src/db/transaction.ts)

### W0 host verification follow-up

The lockfile is present. Host npm debug logs report exit 0 for lockfile generation, `npm ci`, both `db:migrate` runs, and `demo:reset`. The host `npm run test:database` exited 1. The user supplied the output showing reset returned a fresh trip UUID where C-18 expected it to reject an open app session.

For ISSUE-007, inspection of the installed `pg-pool` confirmed that `Pool.query` releases the client with the SQL error and removes it from the pool. The preceding expected permission failure therefore removed the session the reset assertion required. The [C-18 test](../tests/database.integration.test.ts) now holds a checked-out client across both assertions and releases it in `finally`. Typecheck and lint passed after the change. The workspace rerun failed during its first connection with `EPERM 127.0.0.1:55432`. The user confirmed that `npm run test:database` passed in the regular terminal, and the host npm log reports exit 0 at 22:02:40 local time on 2026-11-21. ISSUE-007 is closed on the current uncommitted diff.

With the installed dependencies, workspace `npm run test:setup` passed 2/2 and `npm run lint`, `npm run typecheck`, and `NEXT_TELEMETRY_DISABLED=1 npm run build` each exited 0. The production build included `/` and `/api/health`.

### W0 readiness check

Run `npm run build && npm run test:readiness` from the regular terminal with PostgreSQL running and the configured disposable test database free. The script checks the production landing page and ready response, changes the East-to-North fixture cost from 19 to 20 and expects `503 DATASET_MISMATCH`, stops production, resets the test database, and checks the development landing page and ready response. The expected outcomes follow from the canonical fixture and readiness contract. See [script](../scripts/check-readiness.ts).

In the workspace, typecheck, lint, setup tests, and the production build passed after the script and database-selection changes. A direct `npm start -- --port 3100` returned listener `EPERM`. `npm run test:readiness` returned connection `EPERM` during the initial test-database reset. The student then ran the command in the regular terminal. Their output reports successful compilation and the following live results:

```text
Production: landing page and 200 ready
Production with drift: 503 DATASET_MISMATCH
Development after reset: landing page and 200 ready
```

### W0 closeout

- **Change.** The current W0 diff from `b88d98a` contains the scaffold and lockfile, Compose database setup, migrations, immutable fixture guard, reset command, and readiness route and checks. [Setup procedure](../README.md#setup-and-demonstration)
- **Verification.** Host install, repeated migration, reset, C-18, and HTTP readiness passed. Workspace setup tests, lint, typecheck, and build passed. The C-18 failure and fix are retained as a candidate debugging story. [Host results](#w0-host-verification-follow-up) · [Readiness results](#w0-readiness-check)
- **Human review.** The student executed C-18 and the live readiness check and supplied their results. Overall design acceptance and rationale remain pending.
- **Gate and handoff.** W0 and R0 passed. ISSUE-005 and ISSUE-007 are closed. The reset-overlap and commit-error findings remain tracked as ISSUE-004 and ISSUE-006. W1 begins with the pure matchers and their independent validation. [Workplan](../WORKPLAN.md)

## Two decisions — DR-1

The selected baseline and planned D-1/D-2 comparisons are in the architecture. Complete these records from actual evidence; change the baseline if evidence warrants it.

| Required record | D-1: matching strategy | D-2: concurrency strategy |
|---|---|---|
| Problem / requirement | Maximize coverage, then minimize independent pickup cost | Preserve correctness while trip inputs change during computation |
| Chosen solution and considered alternative | Selected baseline: Bellman–Ford min-cost flow; compare greedy and bounded exact search. Independent human acceptance pending. | Selected baseline: compute preview outside locks, then version-check and persist it under a short lock; commit the stored preview. Compare preview computation under the trip lock with the same commit path. Independent human acceptance pending. |
| Implementation change / commit | Not implemented | Not implemented |
| Evaluation fixture, command, observed evidence | Planned: M-01/M-08, tiny oracle, seeded runtime/quality experiment in architecture §8. No application results. | Planned: publication race C-13, rollback/retry checks, lock wait experiment in architecture §8, and separate real-HTTP responsiveness P-01. No application results. |
| Human response: retained, changed, or rejected, and why | TODO | TODO |

Record significant scope changes and reasons alongside the relevant decision (FR-3, PR-4).

## Debugging case — DR-2

Capture one substantive, real incident; hypothetical bugs or deliberately broken comparisons are not observed debugging stories. This may overlap with a decision above.

Link the incident to its ID in the [WORKPLAN issue register](../WORKPLAN.md#bugs-and-open-issues). Keep active issue status there; retain investigation details and fix verification here. Other issue fixes can link to the validation records above without becoming separate course case studies.

Candidate case for the final deck, ISSUE-007. See the [host verification record](#w0-host-verification-follow-up) for the observed runs.

- **Symptom and reproduction.** On a designated PostgreSQL test database, `npm run test:database` failed C-18. Reset returned a new trip UUID where the test expected it to reject an open app session.
- **Investigation and root cause.** The student's assertion output pointed to the reset check immediately after an expected permission error. The installed `pg-pool` source showed that `Pool.query` releases and removes the client on query error. The assertion therefore ran after the app session had disconnected.
- **Fix and code.** Check out an app client explicitly and keep it connected across both the rejected write and the reset assertion. Release it in `finally`. The test change is in the W0 diff. [C-18 test](../tests/database.integration.test.ts)
- **Verification.** The student reran `npm run test:database` in the regular terminal and confirmed it passed. The host npm log reports exit 0 at 22:02:40 local time on 2026-11-21. Typecheck and lint also passed after the change.
- **Remaining limitation.** C-18 tests a connection already open when reset checks for app sessions. Startup that overlaps reset and the HTTP response to drift are tracked separately in WORKPLAN.

## Attribution and contributions — RR-3

Record dependency versions, reused source URLs and starting versions/commits, student additions/modifications, each team member's contributions, and significant AI work. Do not include prohibited course homework material.

| Contributor / component | Source and version / commit | Contribution or reused functionality | Review / evidence |
|---|---|---|---|
| Student team member(s) | TODO | TODO per person | TODO |
| Libraries / reused starting code | TODO when installed/adopted | TODO | TODO |
| Codex | Documentation consolidation, initial design, baseline selection, and contract review follow-up, 2026-11-19 | Consolidated plans; selected/drafted architecture, contracts, alternatives, and comparison experiments; resolved documented seed-lifetime, terminal-outcome, and UI-ordering gaps; updated README/evidence templates | Human review pending; no application code or runtime validation |
| Codex | Implementation workplan and agent guidance, 2026-11-20 | Added checkpoints, release gates, restart state, check ownership, and handoff instructions; linked existing docs and reconciled retained design commit references | Human review pending; documentation verification only |
| W0 libraries and runtime | [npm package pins](../package.json), [lockfile](../package-lock.json), [Node pin](../.node-version), [PostgreSQL official image tag](../compose.yaml) | Next.js and React scaffold, pg client, TypeScript and ESLint, tsx scripts, Vitest database checks, and Zod pinned for W1. The scaffold was written for this repository. | Host installation passed. |
| Codex | W0 foundation, 2026-11-21 | Created app scaffold, Compose/bootstrap, SQL migrations, setup and readiness code, fixtures, and tests. | A-1 above. Human review pending. |

The proposal PDF, final slide PDF, live demonstration, repository access, and Canvas submissions remain required. See [PROJECT_SPEC.md](../PROJECT_SPEC.md) for the full deliverable and acceptance checklist.
