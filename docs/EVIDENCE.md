# Project evidence

**Status:** Development record. W0 results and student-run verification are recorded below. Design and planned checks live in [ARCHITECTURE.md](ARCHITECTURE.md).

The [course specification](../PROJECT_SPEC.md) requires the content below, but does not require separate documents for each category. These are working records for the final slide deck; DEL-3 does not require a separate written report.

## Validation results — VR-1 through VR-3, RR-4

For each significant claim, retain the starting state, exact command/interaction, independently established expectation and derivation, actual output, and code/test/commit. Record failures and subsequent verification where relevant. Agent-reported success alone is not independent acceptance (AR-3).

| Claim/check | Input or reset state | Command / interaction | Expected result and independent basis | Actual output / artifact | Code / test / commit |
|---|---|---|---|---|---|
| M-01 matching optimum | Architecture's 2×2 fixture `[[1,2],[2,100]]`, A before B | `npm run test:matching` | 2 matched, cost 4; the two complete plans cost 4 (cross) and 101 (diagonal); greedy costs 101 | Optimizer: 2 matched, cost 4. Greedy: 2 matched, cost 101. Passed. | [matching.test.ts](../tests/matching/matching.test.ts) · [matcher](../src/matching/mincostflow.ts) / `fc3817a` + W1 diff |
| M-08 coverage before cost | Architecture's restricted-compatibility fixture `[[1,1],[2,null]]` | `npm run test:matching` | 2 matched, cost 3; only full plan is A→D2/B→D1; greedy serves 1 for cost 1 | Optimizer: 2 matched, cost 3, A→D2/B→D1. Greedy: 1 matched, cost 1. Passed. | [matching.test.ts](../tests/matching/matching.test.ts) / W1 diff |
| M-02–M-05, M-07, M-09 matcher behavior | Capacity, empty supply, edge-presence, tie/stability, validator-rejection, and bounds fixtures built in-test | `npm run test:matching` | Per architecture acceptance checks M-02–M-05, M-07, M-09 | All passed (42 tests, 3 files) | [matching.test.ts](../tests/matching/matching.test.ts), [contracts.test.ts](../tests/matching/contracts.test.ts) / W1 diff |
| M-06 / M-10 oracle agreement | 100 retained deterministic seeds (bounded 4 drivers / 7 passengers) | `npm run test:matching` | Optimizer count and cost equal the independent exhaustive oracle on every seed; reconstructed flow and summed cost agree | 0 discrepancies on the 100 seeds; an ad hoc 2000-seed cross-check also found 0 | [oracle.ts](../tests/matching/oracle.ts), [random.ts](../tests/matching/random.ts) / W1 diff |
| Greedy-substitution mutant | M-01 and M-08 fixtures run through greedy | `npm run test:matching` | Greedy must fail M-01 (cost 101≠4) and M-08 (1≠2 matched); real optimizer passes both | Mutant failed both expectations; optimizer passed. Passed. | [mutant.test.ts](../tests/matching/mutant.test.ts) / W1 diff |
| Normalizer/fingerprint vectors | Fixed UUID, label (NFC/trim), timestamp (offset→UTC ms), integer (−0, bounds), canonical-JSON, and SHA-256 fingerprint vectors | `npm run test:matching` | Observed values match the pinned vectors; key order does not change the fingerprint; method/route changes do | All passed; create-trip fingerprint pinned to `3d70b8bc…d8885` | [contracts.test.ts](../tests/matching/contracts.test.ts), [normalize.ts](../src/contracts/normalize.ts) / W1 diff |
| Early solver timing | Dense 20-driver/50-passenger uncached instance, 100 samples after warmup | `npm run eval:matching` | Pure solver p95 well under the W5/P-01 100 ms target on this host | p95 ≈ 1.9 ms, median ≈ 1.7 ms on Node 24.22.3 (not the demo-machine gate) | [eval-matching.ts](../scripts/eval-matching.ts) / W1 diff |
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
| A-2: W1 matching and contracts | User asked to implement W1 only: shared input contracts/normalization vectors, pure greedy matcher, Bellman–Ford min-cost flow, feasibility validator, deterministic ordering, and the independent exhaustive oracle, and to verify M-01 through M-10 using the existing fixtures. A follow-up request asked to address four reviewer findings (ISSUE-008 through ISSUE-011) before W2. | W1 diff on `fc3817a`: `src/contracts/{normalize,index}.ts`, `src/matching/{types,greedy,mincostflow,validate,project,index}.ts`, `tests/matching/*`, `vitest.matching.config.ts`, `scripts/eval-matching.ts`, and `package.json` scripts | `npm run test:matching` passed 69/69 on the final reviewed diff ([closure verification](#w1-closure-verification)), with M-01=2/cost 4 and M-08=2/cost 3; the optimizer agreed with the independent oracle on the 100 retained seeds; the greedy mutant failed M-01/M-08; lint, typecheck, production build, and `test:setup` passed. Timestamp, mutation-contract, matcher-bound, and projection corrections were each reproduced as fixed. [W1 closeout](#w1-closeout) · [review follow-up](#w1-review-follow-up-corrections-and-verification) | Accepted W1 on 2026-11-23. My run matched my hand calculations: M-01 seats two for cost 4 (2 + 2), and M-08 seats two for cost 3 because B needs D1 and A can ride with D2. The public validators rejected the invalid departure, unknown driver zone, and blank passenger name, and accepted the valid passenger. |
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

## W1 closeout

- **Change.** Added the shared input contracts and normalization (`src/contracts/normalize.ts`, `src/contracts/index.ts`) with fixed vectors, and the pure matching engine: `src/matching/types.ts` (input validation, roster bounds, canonical-UUID guard, and ASCII ordering), `greedy.ts` (comparison baseline), `mincostflow.ts` (Bellman–Ford min-cost max-flow, `mincostflow-v1`), `validate.ts` (independent feasibility validator), `project.ts` (pure active-member filtering and directional zone-cost projection), and `index.ts` (`computeMatch`). Tests live in `tests/matching/`: `matching.test.ts` (M-01–M-10, `computeMatch`, and the ISSUE-010 bounds/canonical-ID regressions), `contracts.test.ts` (normalizer/fingerprint vectors plus the ISSUE-008 timestamp and ISSUE-009 mutation-contract regressions), `mutant.test.ts` (greedy substitution), with the independent `oracle.ts`, deterministic `random.ts`, and `fromMatrix.ts` helpers. Added `vitest.matching.config.ts`, the `test:matching` and `eval:matching` scripts, and `scripts/eval-matching.ts`. No database or network code entered the matcher. The hand fixtures in [matching.json](../tests/fixtures/matching.json) were used unchanged.
- **Verification.** After the W1 review corrections, `npm run test:matching` passed 69/69 across 3 files. M-01 = 2 matched/cost 4 and M-08 = 2 matched/cost 3 (A→D2/B→D1); greedy produced cost 101 on M-01 and 1 match on M-08. The optimizer agreed with the independent oracle on the 100 retained seeds (and 0 discrepancies on an ad hoc 2000-seed cross-check). The greedy-substitution mutant failed M-01 and M-08 as required, confirming fixture sensitivity; the real implementation remains in place. `npm run lint`, `npm run typecheck`, `NEXT_TELEMETRY_DISABLED=1 npm run build`, and `npm run test:setup` (2/2) passed. `npm run eval:matching` reported p95 ≈ 1.9 ms on this host (early measurement; the demo-machine P-01 gate is W5). Observed on local macOS with Node 24.22.3.
- **Human review.** The student accepted W1 on 2026-11-23 after checking M-01 and M-08 by hand and exercising the public validators. The A-2 decision above records the observations.
- **Gate and handoff.** W1 passed on 2026-11-23. All recorded W1 technical findings are closed. [Closure verification](#w1-closure-verification)

### W1 review

Reviewed the W1 working tree on `fc3817a` with Node 24.22.3. `npm run test:matching` passed 42/42, `npm run test:setup` passed 2/2, and lint, typecheck, and the production build passed. `npm run eval:matching` returned 50 matches for cost 113 on the dense 20 × 50 case, with a 1.948 ms p95 over 100 samples. The live database suite was outside this database-free review.

The optimizer agreed with direct enumeration on all 2,304 two-driver/two-passenger combinations with each edge independently missing or costing 0, 1, or 2 and each driver having 0, 1, or 2 seats. For each configuration the review enumerated both passengers' choices of either driver or no ride, rejected missing edges and overcapacity, then compared the best count and cost with `computeMatch`. In a disposable copy, replacing the optimizer export with `greedyMatch` made the ordinary M-01/M-08 tests fail (101 versus 4 twice, 1 versus 2 once). Restoring the implementation passed all three selected tests. A separate production build with a client component importing the shared create-trip normalizer also passed.

| Issue | Reproduction on the W1 working tree | Observed result |
|---|---|---|
| ISSUE-008 | Call `normalizeTimestamp` with `2026-02-29T12:00:00Z`, then with `March 1, 2026 12:00:00Z`. Both should reject. | Both produced `2026-03-01T12:00:00.000Z`. |
| ISSUE-009 | Parse `{baseVersion:-1,seatCapacity:9.5}` with the edit schema, `{baseVersion:0.5,active:false}` with the withdrawal schema, and `{previewId:"junk"}` with the commit schema. Fingerprint two parsed commit bodies differing only in UUID letter case on the same route. | All three invalid bodies parsed. The equivalent commit bodies produced different hashes. The exported version maximum is 4,294,967,295 while the migration uses a signed PostgreSQL integer. |
| ISSUE-010 | Call `computeMatch` with 21 distinct UUID drivers and no passengers, then with 51 distinct UUID passengers and no drivers. Also supply one edge from driver `a` to passenger `b\0c`, a second driver `a\0b`, and a second passenger `c`, with one seat per driver and NUL as the separator in these malformed IDs. | Both over-limit calls succeeded. The malformed-ID case returned two assignments from one supplied edge, and feasibility validation accepted both. |
| ISSUE-011 | Inspect the M-10 fixture. Supply its intended precondition as a negative control by giving a one-seat driver an extra `active: false` property in a compatible one-passenger input to `computeMatch`. | M-10 contains no activity values or projection call. The matcher consumes an already-projected input and the control assigned the passenger. Filtering at the production projection boundary still needs verification. |

#### W1 review follow-up: corrections and verification

Applied on the W1 working tree (uncommitted diff on `fc3817a`), Node 24.22.3, database-free.

| Issue | Correction | Verification |
|---|---|---|
| ISSUE-008 | Rewrote `normalizeTimestamp` (`src/contracts/normalize.ts`) to match a strict ISO 8601 pattern with an explicit offset, then validate month, day (leap-aware), time-of-day, and offset components before any `Date` conversion. | `2026-02-29T12:00:00Z`, `2026-04-31…`, `1900-02-29…`, `March 1, 2026 12:00:00Z`, `24:00:00`, and `+30:00` now reject; `2024-02-29` and `2000-02-29` are accepted. Added leap-year/month-end/time-of-day vectors. `npm run test:matching` passed. |
| ISSUE-009 | Added `normalizeEditDriver`, `normalizeWithdrawRequest`, and `normalizeCommit` (`src/contracts/index.ts`) that validate `baseVersion`/`seatCapacity` as bounded integers and lowercase the preview UUID before hashing. Set `LIMITS.versionMax` to `2^31 − 1` (PostgreSQL signed `integer`), matching migration `001_foundation.sql`. | `baseVersion:-1`, `seatCapacity:9.5`, `baseVersion:0.5`, `previewId:"junk"`, and `baseVersion:2^31` reject. Upper/lower-case preview IDs normalize to one value and hash identically. Unknown fields still reject. Verified by new vectors and a direct reproduction. |
| ISSUE-010 | Added `MATCH_LIMITS` (20 drivers / 50 passengers) and a canonical lowercase-UUID guard in `buildCostLookup` (`src/matching/types.ts`), both enforced before the lookup is built. Canonical UUIDs cannot contain the NUL edge-key separator, so the key is injective. | 21 drivers and 51 passengers now reject; exactly 20/50 are accepted. The malformed NUL-ID case rejects with `MatchInputError` instead of producing a phantom assignment. Added regression tests. |
| ISSUE-011 | Added a pure `projectMatchInput` (`src/matching/project.ts`) that filters inactive drivers and passengers and projects the directional zone-cost table into edges. Rewrote the M-10 test to run projection with both an inactive driver and an inactive passenger and assert the exact assigned/unassigned IDs, with a negative control that an active member is not dropped. | The projection excludes both inactive roles; the match assigns only the active pair at the directional cost. If the filter were omitted the exact-ID assertions would fail. `npm run test:matching` passed. |

After the corrections: `npm run test:matching` passed 60/60 (3 files), `npm run test:setup` 2/2, `npm run lint`, `npm run typecheck`, and `NEXT_TELEMETRY_DISABLED=1 npm run build` all passed, and `npm run eval:matching` reported p95 ≈ 1.9 ms (50 matched, cost 113). The optimizer still agreed with the independent oracle on the 100 retained seeds; the greedy mutant still fails M-01/M-08. The live PostgreSQL suite remains out of scope for this database-free checkpoint (ISSUE-001). The service-boundary enforcement of lifetime roster caps (including inactive records) and canonical-UUID normalization of stored IDs is W2 work; the matcher now rejects out-of-bound or non-canonical input defensively.

#### W1 technical re-review

Reviewed the uncommitted W1 corrections against `fc3817a` on Node 24.22.3. Ran `npm run test:matching` (60/60), `npm run test:setup` (2/2), `npm run lint`, `npm run typecheck` and `NEXT_TELEMETRY_DISABLED=1 npm run build`. All passed. `npm run eval:matching` matched 50 at cost 113, p95 2.017 ms over 100 samples. Live PostgreSQL was outside the W1 verification scope. A-2 student acceptance was pending at this review.

Additional reproductions can be run from the repository root with Node 24 using `node --input-type=module` and the exports from [contracts](../src/contracts/index.ts) and [matching](../src/matching/index.ts).

| Issue | Probe and observation |
|---|---|
| ISSUE-008 | Create-trip rejected both the original impossible February 29 and the English date. A valid 2024 leap day normalized and reparsed. The calendar and century regressions also passed. |
| ISSUE-009 | The new normalizers rejected the original invalid edit, withdrawal and commit. Upper/lowercase spellings of the same preview UUID yielded the same normalized commit hash. However, `editDriverSchema.safeParse({baseVersion:-1,seatCapacity:9.5})`, `withdrawRequestSchema.safeParse({baseVersion:0.5,active:false})`, and `commitSchema.safeParse({previewId:"junk"})` all returned success. The prepared route code should have one public validation path. |
| ISSUE-010 | The limit tests and original NUL-ID reproduction passed. For a different malformed input, use a canonical UUID string `id`, two one-seat drivers with IDs `id` and `[id]`, and two distinct canonical passenger IDs. Supply two cost-1 edges from only the string driver, one to each passenger. `computeMatch` returned two assignments including one from the array driver. Only one seat belonged to a compatible driver. Regex and edge-key string conversion coerce the array, while membership and capacity maps treat the IDs as distinct. |
| ISSUE-011 | M-10 exercised both activity filters. On a separate projected fixture with an active North driver and East passenger plus one inactive member of each role, only the active pair matched, at cost 7 (reverse cost 19). Replacing either assigned member with the corresponding inactive member made `assertFeasible` reject. |
| ISSUE-012 | For `{name:"n",destinationLabel:"d",departAt:"9999-12-31T23:30:00-01:00"}`, `normalizeCreateTrip` emitted `+010000-01-01T00:30:00.000Z`. A second call with that output rejected the departure. The browser stores and transmits the normalized body and the server validates it again. The new parser also rejects minute-precision `2026-11-22T09:30Z`; the documented departure contract does not require an explicit seconds field. |

##### W1 re-review corrections (ISSUE-009, ISSUE-010, ISSUE-012)

Applied on the W1 working tree (uncommitted on `fc3817a`), Node 24.22.3, database-free.

| Issue | Correction | Verification |
|---|---|---|
| ISSUE-010 | `assertCanonicalUuid` (`src/matching/types.ts`) now takes `unknown` and checks `typeof id === "string"` before the UUID pattern, so an array like `[id]` that coerces to a valid UUID string is rejected rather than treated as a distinct capacity-map key. | The two one-seat-driver reproduction (`id` and `[id]`, edges only from the string driver) now throws `MatchInputError` instead of returning two assignments. Added as a regression in `matching.test.ts`; the 2000-seed oracle cross-check stays at 0 mismatches. |
| ISSUE-009 | The exported mutation schemas now carry the bounds themselves: `baseVersion` and `seatCapacity` use a shared `int().gte().lte()` builder, and `commitSchema`'s `previewId` is a case-insensitive UUID that lowercases via `.transform`. There is one validation path, so a W2 route that parses a schema directly gets the same rejection as the helper. | `editDriverSchema.safeParse({baseVersion:-1,seatCapacity:9.5})`, `withdrawRequestSchema.safeParse({baseVersion:0.5,active:false})`, and `commitSchema.safeParse({previewId:"junk"})` now return `success: false`; valid bodies pass and a mixed-case preview UUID lowercases. The four earlier assertions that expected `NormalizationError` now assert rejection generally, since the schema (ZodError) rejects first; a dedicated test pins the schema behavior. |
| ISSUE-012 | `normalizeTimestamp` (`src/contracts/normalize.ts`) makes seconds optional (minute precision is valid) and verifies the canonical `toISOString()` output matches the input pattern, rejecting inputs whose offset conversion produces an unsupported six-digit UTC year. | `9999-12-31T23:30:00-01:00` now rejects on the first pass. Re-normalizing any accepted value (including `0000-01-01T00:00:00Z`, `9999-12-31T23:59:59.999Z`, and `2026-11-22T09:30Z`) returns the same string, and the whole create-trip body survives a second `normalizeCreateTrip`. Added idempotence, minute-precision, and extended-year regressions. |

After these corrections: `npm run test:matching` passed 66/66, `npm run test:setup` 2/2, `npm run lint`, `npm run typecheck`, and `NEXT_TELEMETRY_DISABLED=1 npm run build` all passed, and `npm run eval:matching` matched 50 at cost 113 (p95 ≈ 1.0 ms). ISSUE-008 and ISSUE-011 remain closed. The live PostgreSQL suite stays out of scope for this database-free checkpoint (ISSUE-001), and student acceptance of A-2 is a separate course requirement. Lifetime roster caps on the full roster (including inactive records) and canonical-UUID normalization of stored IDs remain W2 service-boundary work.

#### W1 boundary verification

Reviewed the uncommitted W1 diff on `fc3817a` with Node 24.22.3. The 66 matching tests and both setup tests passed, as did lint, typecheck and the production build. For seeds 0 through 1999, `computeMatch(randomCase(seed)).optimal` agreed with `oracleObjective` on count and cost. The dense 20 × 50 benchmark matched 50 at cost 113 with p95 1.053 ms. Live PostgreSQL was outside this review.

- **ISSUE-010, closed.** Supplied drivers identified by a UUID string and an array containing that UUID, each with one seat, plus two passengers with edges only to the string driver. `computeMatch` rejected the input with `MatchInputError`. [ID guard](../src/matching/types.ts)
- **ISSUE-012, closed for W1.** Create-trip rejected both `9999-12-31T23:30:00-01:00` and `0000-01-01T00:00:00+01:00` on the first pass. Complete accepted bodies with UTC years 0000 and 9999, minute precision, and an offset crossing into leap day were identical after a second normalization. These are JavaScript round-trip checks. Database persistence is W2 work. [Timestamp normalizer](../src/contracts/normalize.ts)
- **ISSUE-009, partial.** Direct edit, withdrawal, and commit parsing rejected the three original malformed bodies. An uppercase preview UUID parsed to the same value as the lowercase commit helper. Further probes of the public contracts below still produced divergent results. [Public schemas and helpers](../src/contracts/index.ts)

| Input and invocation | Result |
|---|---|
| `createTripSchema.safeParse({name:"Review",destinationLabel:"Hall",departAt:"bad"})` | Success. The create normalizer rejected the same input. |
| `addDriverSchema.safeParse({name:"A",zoneId:"missing",seatCapacity:1})` and `addRequestSchema.safeParse({name:" ",zoneId:"north"})` | Both succeeded. With known zones set to `north`, both registration helpers rejected their inputs. |
| Use name `"  Cafe\u0301 "`, destination `"Hall"`, and departure `"2026-11-22T09:30Z"`. Fingerprint the outputs of direct create-schema parsing and create normalization with POST and the same route. | The two hashes differed. A caller using the public schema directly can fingerprint raw labels and a raw departure. |
| Parse `{baseVersion:-0,seatCapacity:-0}` with the edit schema and with the edit helper. | `Object.is(parsed.baseVersion,-0)` was true for the schema and false for the helper. The serializer encodes both zeros identically. |

##### ISSUE-009 closure: schemas made private, normalizers are the single public path

Applied on the W1 working tree (uncommitted on `fc3817a`), Node 24.22.3, database-free.

- **Change.** Removed `export` from all six Zod schemas (`createTripSchema`, `addDriverSchema`, `addRequestSchema`, `editDriverSchema`, `withdrawRequestSchema`, `commitSchema`) in `src/contracts/index.ts`; they are now shape-only building blocks. The route-facing API is the `normalize*` helpers, which are the single validation and canonicalization path (NFC/trim/code-point labels, calendar-validated timestamps, zone-enum checks). A route can no longer import a schema and skip the fix. Also added `.transform((n) => (n === 0 ? 0 : n))` to the shared `boundedInt` builder so any numeric output canonicalizes `-0` to `0`, matching the helpers.
- **Verification.** No schema is exported from the contracts module (checked by importing the module and asserting the names are absent). `normalizeCreateTrip({…,departAt:"bad"})`, `normalizeAddDriver({…,zoneId:"nowhere"})`, and `normalizeAddRequest({name:"   ",…})` all reject — the three cases the raw schemas accepted. `normalizeEditDriver({baseVersion:-0,seatCapacity:-0})` returns `+0` for both fields. A valid create body re-normalizes to one fingerprint. The earlier-divergent schema-vs-helper fingerprint comparison no longer has two public paths to diverge. New tests: the single-validation-path block (rejections, no exported schemas, self-consistent fingerprint) and the `-0` canonicalization case. `npm run test:matching` passed 69/69, `test:setup` 2/2, lint, typecheck, and production build passed, `eval:matching` matched 50 at cost 113 (p95 ≈ 1.0 ms), and the 2000-seed oracle cross-check stayed at 0 mismatches.
- **Status.** ISSUE-009 closed following the verification below. The student subsequently accepted A-2 on 2026-11-23.

### W1 closure verification

Reviewed the uncommitted W1 diff on `fc3817a`. To identify the exact fix and regression file, run `git hash-object src/contracts/index.ts tests/matching/contracts.test.ts`. The reviewed blobs were `e22f0f23346ff3006d4f9065b29aafbf4aa55fa9` and `17ef90c1cba1104f639bc84b90f9c22c4fa62c90`, respectively.

- On Node 24.22.3, `npm run test:matching` passed 69/69 and `npm run test:setup` passed 2/2. Lint, typecheck and the production build passed. Comparing `computeMatch(randomCase(seed)).optimal` with the exhaustive oracle on count and cost for seeds 0–1999 found zero mismatches. `npm run eval:matching` returned 50 matches, cost 113, and p95 1.001 ms on the dense 20 × 50 case.
- The contracts module exported no Zod schema. A direct probe of all six mutation helpers rejected the previously malformed bodies. The edit helper returned positive zero for both `baseVersion` and `seatCapacity` supplied as `-0`. The commit helper lowercased a mixed-case preview UUID.
- For a create body with name `"  Cafe\u0301  "`, destination `" Hall "` and departure `2026-11-22T10:30+01:00`, the expected normalized values were `Café`, `Hall`, and `2026-11-22T09:30:00.000Z`. Independently hashing the literal UTF-8 JSON tuple `["request-v1","POST","/api/trips",{"departAt":"2026-11-22T09:30:00.000Z","destinationLabel":"Hall","name":"Café"}]` produced `479c5c97e34c07728361b51ef7698b0ecc5ee7a5e59d9306df2f4dcad9e2b5d9`. The public path produced that hash for the original input, the equivalent canonical input and the re-normalized JSON round-trip.

Live PostgreSQL checks belong to the database checkpoints. The student accepted A-2 on 2026-11-23.

### W2 prerequisite check

On 2026-11-23, the accepted W1 contracts and regression file matched the blob IDs above. The current working tree passed `npm run test:matching` (69/69), `npm run test:setup` (2/2), lint and typecheck on Node 24.22.3. The Compose configuration passed `docker compose config --quiet`. W1 is still uncommitted on `fc3817a`.

Both test database URLs passed the local target and role guards. Read-only connection probes for the app and setup roles both failed before executing SQL with `EPERM` at `127.0.0.1:55432`. This session also received permission denied from `docker compose ps` (ISSUE-001). The earlier host C-18 and readiness runs remain the latest live evidence. W2 starts with the shared mutation helper, including ISSUE-006. Its seven PostgreSQL acceptance checks are W2 deliverables.

## Two decisions — DR-1

The selected baseline and planned D-1/D-2 comparisons are in the architecture. Complete these records from actual evidence; change the baseline if evidence warrants it.

| Required record | D-1: matching strategy | D-2: concurrency strategy |
|---|---|---|
| Problem / requirement | Maximize coverage, then minimize independent pickup cost | Preserve correctness while trip inputs change during computation |
| Chosen solution and considered alternative | Selected baseline: Bellman–Ford min-cost flow; compare greedy and bounded exact search. Independent human acceptance pending. | Selected baseline: compute preview outside locks, then version-check and persist it under a short lock; commit the stored preview. Compare preview computation under the trip lock with the same commit path. Independent human acceptance pending. |
| Implementation change / commit | Pure matcher implemented in W1: Bellman–Ford min-cost flow with greedy comparison and independent oracle (`src/matching/`). The seeded runtime/quality D-1 experiment and demo-machine measurement are still to run in W5. | Not implemented |
| Evaluation fixture, command, observed evidence | W1: `npm run test:matching` — M-01=2/cost 4, M-08=2/cost 3, optimizer matches the oracle on 100 seeds, greedy mutant fails M-01/M-08; `npm run eval:matching` p95 ≈ 1.9 ms on this host. The full D-1 5/15/30/50-passenger comparison on the demo machine is W5. | Planned: publication race C-13, rollback/retry checks, lock wait experiment in architecture §8, and separate real-HTTP responsiveness P-01. No application results. |
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
| Bellman–Ford min-cost max-flow | Established algorithm; referenced min-cost flow notes in [ARCHITECTURE §6](ARCHITECTURE.md#matching-and-transaction-protocols) ([UIUC CS473 min-cost flow notes](https://courses.grainger.illinois.edu/cs473/fa2022/notes/G-mincostflow.pdf)) | Algorithm design only (shortest augmenting paths over residual graph with negative reverse edges). The implementation in `src/matching/mincostflow.ts` was written for this repository; no external code was copied. | Attribution per RR-3. The notes are a textbook reference, not course homework material. |
| Zod | `zod` 4.6.7 (see [package pins](../package.json)) | Request contract parsing / unknown-field rejection in `src/contracts/index.ts` | Pinned in W0; first used in W1. |
| Codex | W1 matching and contracts, 2026-11-21; review corrections 2026-11-22 | Implemented shared contracts/normalization, greedy and Bellman–Ford matchers, feasibility validator, roster projection, independent oracle, and M-01–M-10 tests; then corrected the timestamp validator, mutation-contract normalization and version maximum, matcher input bounds/canonical IDs, and M-10 inactive-filter coverage. | A-2 accepted by the student on 2026-11-23. |

The proposal PDF, final slide PDF, live demonstration, repository access, and Canvas submissions remain required. See [PROJECT_SPEC.md](../PROJECT_SPEC.md) for the full deliverable and acceptance checklist.
