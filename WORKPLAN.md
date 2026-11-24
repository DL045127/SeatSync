# GroupRide implementation workplan

This is the execution and handoff record for the local CS 378AC carpool project. An organizer creates a trip, registers drivers/passengers, previews an allocation, saves it, reloads it, and rematches after availability changes. The main claim is maximum passenger coverage followed by minimum synthetic pickup cost, with consistent persisted state during overlapping changes.

## Start here

1. Read [AGENTS.md](AGENTS.md), then the current handoff below.
2. Read [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the selected stack, contracts, and acceptance-check definitions. It owns technical decisions; this file owns execution order and status.
3. Read [PROJECT_SPEC.md](PROJECT_SPEC.md) for course requirements and [EVIDENCE.md](docs/EVIDENCE.md) for observations and human review. [README.md](README.md) owns verified setup/demo instructions once they exist.
4. Inspect `git status --short`, `git log -5 --oneline`, and the files before changing anything. Preserve existing work. Check this handoff against the actual checkout; do not assume recorded progress is current.
5. Resume the first unfinished checkpoint whose prerequisites pass. A later targeted user request takes precedence over this sequence.

## Current handoff — update at every stopping point

| Field | Current value |
|---|---|
| Last updated | 2026-11-23 |
| Implementation baseline | `e2510d7` — finalized architecture contracts; Git already exists |
| Handoff revision | Technical release candidate `5d86e5b` includes the W6 audit and C-12 regression (`f306937`) and the verified ISSUE-039 correction. |
| Completed | W0–W5 implementation and measurements, W6 clean build and test runs, and the draft PDFs. |
| Runnable state | Fresh clone of `5d86e5b` and empty demo/test databases. Setup 2/2, matching 69/69, unit 33/33, database 1/1, concurrency 47/47 and Chromium 12/12. [W6 release-candidate verification](docs/EVIDENCE.md#w6-release-candidate-verification) |
| Current checkpoint | W6 review reopened U-02 and identified incomplete D-1 records and reproduction instructions (ISSUE-040–042). |
| Next bounded task | Strengthen U-02 to observe the retry and reject the skipped-POST control. Complete D-1 evidence and the clean-checkout instructions, then verify the revised candidate. |
| Optional follow-up | [One-city meeting-point demo](#stretch-goal--one-city-meeting-points) after the required checkpoints, if time permits. |
| Environment | Node v24.22.3 and npm 11.19.1 verified with Homebrew `node@24` first on `PATH`. The default shell still selects Node 26, which crashes on a missing simdjson dylib (ISSUE-002); prepend `$(brew --prefix node@24)/bin` to `PATH` for all project commands. Exact project versions are in `package.json`/`package-lock.json`. |
| Blockers | ISSUE-040 keeps R2 open. ISSUE-041–042 affect retained evidence and W6 reproduction. ISSUE-004 remains a documented offline-reset limitation. Student acceptance and course actions remain open for R3. |
| Human review | The student accepted W1, reported the original W2 failure, and ran the corrected W2 suite. For A-4 the student observed matching previews across two tabs, persistence after reload and the stale-save review prompt, and accepted W3. A-3 (W2) and A-5 (W4) reviews are pending. For A-6 (W5), the three decisions are recorded. The student deferred independent inspection until after the technical work and will record what they checked before submission. [A-4 evidence](docs/EVIDENCE.md) |
| External course tasks | Proposal and six-slide draft PDFs are prepared. Public GitHub read access was observed. Confirm team/partner access, Canvas deadlines and submissions, template, demo booking and student provenance. |
| Latest validation | Review clone at `5c3525c`: all suites and three evaluations passed. A control that omitted the passenger retry POST also passed U-02 three times. [W6 technical review](docs/EVIDENCE.md#w6-technical-review) |

The W3 commit includes the preview and commit services and routes, browser pages and reducer, demo script, Playwright configuration, and workflow tests. The W4 commit adds `tests/concurrency/races-recovery.integration.test.ts` and four test-only hooks across the commit, preview, repository, and trip service modules. The W5 checkpoint adds the three evaluation scripts (`scripts/eval-matching.ts`, `scripts/eval-concurrency.ts`, `scripts/eval-responsiveness.ts`), their `eval:*` npm commands, and the retained artifacts under `eval/`; preview instrumentation and the test-mode telemetry endpoint also ship in the application.

Handoff verification on 2026-11-21 copied the current tracked and non-ignored untracked files to a temporary directory. With the existing installed dependencies linked in, `npm run test:setup`, `npm run typecheck`, and `npm run lint` passed without `.env` or generated `.next` files.

## Bugs and open issues

Use this register for observed bugs, unresolved design questions, and environment problems that affect implementation or a release gate. Give each entry a stable ID (`ISSUE-001`, `ISSUE-002`, etc.). Routine unfinished features stay in their checkpoints; confirmed limitations belong in ARCHITECTURE and the final presentation.

Add implementation bugs as they are discovered.

| ID / kind | State | Summary and reproduction steps or question | Impact / affected checks or gate | Owner / next action | Resolution / evidence |
|---|---|---|---|---|---|
| ISSUE-001 / environment | open | `docker info` returns permission denied on the `desktop-linux` socket from the workspace session. | W0/R0 PostgreSQL startup and verification from this session | Run database checks from the regular macOS terminal or a workspace session with Docker socket access. | User confirmed `docker info` succeeds in the regular terminal. Workspace access remains open. |
| ISSUE-002 / environment | closed | The project requires Node 24. The default shell still selects the Node 26 installation. | W0/R0 verification on the selected runtime | Prepend `$(brew --prefix node@24)/bin` to `PATH` when running project commands. | Verified `node --version` → `v24.22.3` and `npm --version` → `11.19.1` with that PATH. |
| ISSUE-003 / environment | open | `npm ping` failed with `ENOTFOUND registry.npmjs.org` in the workspace session. | W0 dependency installation and reproducible build from this session | Run dependency installation from the regular macOS terminal or a workspace session with registry access. | User confirmed `npm ping` succeeds in the regular terminal. Workspace access remains open. |
| ISSUE-004 / limitation | deferred | An app read starting after reset checks for sessions can take a pre-reset snapshot while it waits and may return DATASET_MISMATCH. Identified by inspection. | Startup overlapping an offline reset | Stop the app before reset and wait for reset completion before startup. Revisit if online reset becomes supported. | [Operating contract](docs/ARCHITECTURE.md#9-local-operation-and-implementation-roadmap) |
| ISSUE-005 / gap | closed | C-18 exercises the validator directly. The readiness script exercises the HTTP route against the disposable test database. | W0/R0 coverage of the dataset guard | Keep the HTTP readiness check in the setup procedure. | The student's host run observed 200 ready, 503 `DATASET_MISMATCH`, and 200 ready after reset. [Readiness evidence](docs/EVIDENCE.md#w0-readiness-check) |
| ISSUE-006 / bug | closed | The earlier test created its fixture with `CREATE TEMP` as the app role, which lacks TEMPORARY, so it failed at 42501 before COMMIT and the loose predicate passed anyway. | Recovery after COMMIT | — | Fixed: the deferrable-FK fixture is created by the setup role with `GRANT INSERT` to the app; the app INSERT succeeds (deferred) and COMMIT is rejected. The test requires `CommitRejected` with SQLSTATE 23503 and unchanged durable state. Verified live. [Gate review corrections](docs/EVIDENCE.md#w2-gate-review-corrections-issue-006-019-020-and-issue-014-tightening) |
| ISSUE-007 / test failure | closed | Host C-18 expected reset to reject with an app session connected. The preceding denied `Pool.query` removed the session. | W0/R0 live C-18 gate | The fixed test keeps the app client checked out through the reset assertion. | User confirmed the corrected test passed. Host npm log confirms exit 0 at 22:02:40 local time. [Host follow-up](docs/EVIDENCE.md#w0-host-verification-follow-up) |
| ISSUE-008 / bug | closed | Impossible calendar dates silently rolled over, and English dates parsed. | W1 departure validation | Retain leap/calendar vectors. Track UTC round-trip behavior in ISSUE-012. | Fix in the W1 diff on `fc3817a` at `src/contracts/normalize.ts`. Regression suite and direct probes passed. [Technical re-review](docs/EVIDENCE.md#w1-technical-re-review) |
| ISSUE-009 / bug | closed | Direct schema imports previously bypassed label, date, zone, or numeric normalization. | W1 shared mutation contracts and W2 request identity | Use the public normalizers in W2 routes. | Fix in the W1 diff on `fc3817a`. Reviewer reran invalid bodies, module export checks and canonical fingerprint comparisons. [Closure verification](docs/EVIDENCE.md#w1-closure-verification) |
| ISSUE-010 / bug | closed | Array-wrapped driver ID could produce an assignment without a compatible seat. | M-09 matcher input validation | Retain type and roster-bound regressions. | Primitive-string guard in the W1 diff on `fc3817a`, `src/matching/types.ts`. Two-driver reproduction rejected with MatchInputError. [Boundary verification](docs/EVIDENCE.md#w1-boundary-verification) |
| ISSUE-011 / coverage | closed | M-10 previously omitted the activity filter. | M-10 / M-07 projection and inactive membership | Use the verified projection when implementing the service. | Fix in the W1 diff on `fc3817a` at `src/matching/project.ts` and `tests/matching/matching.test.ts`. M-10 and direct inactive-member checks passed. [Technical re-review](docs/EVIDENCE.md#w1-technical-re-review) |
| ISSUE-012 / bug | closed | Offset conversion could yield a UTC year the normalizer rejected on a second pass. | W1 normalized request replay | Retain upper/lower year and minute-precision regressions. | Four-digit UTC guard in the W1 diff on `fc3817a`, `src/contracts/normalize.ts`. Out-of-range instants reject on the first pass and accepted boundary bodies reparse identically. [Boundary verification](docs/EVIDENCE.md#w1-boundary-verification) |
| ISSUE-013 / bug | closed | Conflicts previously identified the original key as not_applied and uncertain responses omitted its key. | C-09 and same-key recovery | Retain response and replay checks. | Private working diff on `7483c57`, mutation.ts and http.ts. Direct conflict, EPIPE and 08007 response probes passed. [Correction review](docs/EVIDENCE.md#w2-correction-review) |
| ISSUE-014 / bug | closed | Business callbacks raising EPIPE/EPERM entered failure-receipt finalization because the SQLSTATE regex matched Node errnos. | C-17 same-key retry | — | Fixed: `sqlState` requires two leading digits; transport errors are retryable and never terminalize. Verified live by a real mid-transaction socket drop before COMMIT, now asserting exactly `TransientFailure`/`DATABASE_UNAVAILABLE` plus unchanged state, no receipt, and exactly one application on retry. [Gate review corrections](docs/EVIDENCE.md#w2-gate-review-corrections-issue-006-019-020-and-issue-014-tightening) |
| ISSUE-015 / bug | closed | The trip lock must survive rollback to the business savepoint. | C-17 failure finalization | Retain the two-backend blocking check. | In the W2 diff on `7483c57`, the host run verified the waiter, A’s 422, B’s 200, persisted capacity and single version increment. [Host rerun](docs/EVIDENCE.md#w2-host-rerun) |
| ISSUE-016 / bug | closed | Losing the read-only COMMIT acknowledgement returned 500 because `withTransaction` wraps it as `CommitOutcomeUnknown` (no SQLSTATE/errno). | W2 read availability | — | Fixed: the GET route treats `CommitOutcomeUnknown`/`CommitRetryable`/`TransientFailure` as retryable 503. Verified live by a route regression injecting a socket drop at the read COMMIT (200 → 503 DATABASE_UNAVAILABLE → 200). [W2 gate observed](docs/EVIDENCE.md#w2-gate-observed-issue-016-fix-and-the-real-failure-path-checks) |
| ISSUE-017 / bug | closed | Previous reader counted decoded code units. | W2 HTTP input boundary | Retain multibyte and exact-boundary checks. | W2 diff on `7483c57`, http.ts. Multibyte regression passed and streaming probes accepted 16,384 bytes and rejected 16,385. [Correction review](docs/EVIDENCE.md#w2-correction-review) |
| ISSUE-018 / test failure | closed | The integration suite previously left app sessions open across offline resets. | Reproducible database suite | Retain per-case pool cleanup. | W2 diff on `7483c57`. All 17 cases completed their guarded setup and reset on the host. [Host rerun](docs/EVIDENCE.md#w2-host-rerun) |
| ISSUE-019 / coverage | closed | The lock-wait case only observed a waiter before a success commit; the racing failure-finalization interleaving was unverified. | C-17 failure finalization | — | Fixed: added a 21st case where A takes a terminal 422 and pauses at before-failure-commit holding the key lock, B is observed waiting in `pg_locks` on that lock, and on release B replays the identical 422 with roster/version unchanged. Verified live 21/21. Duplicate receipt INSERT requires 23505. [C-17 racing-failure coverage](docs/EVIDENCE.md#w2-c-17-racing-failure-coverage-closes-issue-019) |
| ISSUE-020 / test hook | closed | A throwing before-COMMIT hook released a client with a transaction still open. | Test harness cleanup | — | Fixed: the hook call is wrapped to ROLLBACK (or discard the client if rollback also fails) and rethrow. Two database-free unit tests cover both cleanup paths. [Gate review corrections](docs/EVIDENCE.md#w2-gate-review-corrections-issue-006-019-020-and-issue-014-tightening) |
| ISSUE-021 / bug | closed | A trip registration with a pending creation replaced the key; a delayed Home receipt could erase a newer key. | U-02/U-04 | — | Fixed: `claimSlot`/`clearPendingIfOwner` guard acquisition and release on both pages, both navigation directions. Verified live by three browser tests (zero new POSTs, unchanged bytes). [Third-round fixes](docs/EVIDENCE.md#w3-correction-review-third-round-of-fixes) |
| ISSUE-022 / bug | closed | Create with 2026-02-30T09:30Z, or register a name of 81 ASCII letters: each sent a POST and left a pending op after a receipt-free 400. | U-02/U-04 | — | Fixed: the create page runs `normalizeCreateTrip` and the registration forms run `normalizeLabel` before claiming the slot, so both invalid inputs are caught locally (0 POSTs, field error, corrected submit succeeds). Verified live. [Fourth-round fixes](docs/EVIDENCE.md#w3-correction-review-fourth-round-of-fixes) |
| ISSUE-023 / bug | closed | A delayed v5 preview after v6 hid the v6 details while Save stayed enabled; an old-key conflict left the floor below its reported version. | U-01/U-04 | — | Fixed: the reducer holds the full accepted preview and the page renders from it; the mutation reducer raises the floor from any reply's version before the key guard. New reducer unit tests. [Third-round fixes](docs/EVIDENCE.md#w3-correction-review-third-round-of-fixes) |
| ISSUE-024 / workflow | closed | Preview and saved views previously omitted named assignments and unassigned riders. | WF-1/WF-2/WF-4 | — | WF-2 checks the specific remaining rider after capacity reduction. [Second-round verification](docs/EVIDENCE.md#w3-second-round-verification) |
| ISSUE-025 / bug | closed | A cached plan assigns the same passenger UUID in uppercase and lowercase and reports two matches. Both result fields return 200. | C-14, preview integrity | — | Fixed: the preview result validator requires canonical lowercase UUIDs for `driverId`, `passengerId` and every unassigned id before the uniqueness scan, so the uppercase spelling is non-canonical and the row is refused (≥500); the cost regression fixtures now use real UUIDs so UUID validation cannot mask a cost/uniqueness regression. New mixed-case-duplicate cases run against both result fields. Verified live. [Fifth-round fixes](docs/EVIDENCE.md#w3-correction-review-fifth-round-of-fixes) |
| ISSUE-026 / coverage | closed | The initial case used sequential commits. | C-01 and mutant | — | The revised case forces a lock wait. An isolated reviewer run observed A blocking B, the ordinary assertion failing on the mutant, and the restored guard returning STALE_VERSION. [W4 correction verification](docs/EVIDENCE.md#w4-correction-verification) |
| ISSUE-027 / coverage | closed | C-05 threw TransientFailure after all business writes, which took the outer rollback path. | C-05 | — | Fixed: a `TerminalBusinessError` is thrown between the assignment DELETE and INSERT (`__setCommitPlanMidHook`), taking the savepoint-recovery path; the prior plan/version and both receipts (applied + not_applied) are verified from the database. Verified live. [W4 corrections](docs/EVIDENCE.md#w4-technical-review-corrections) |
| ISSUE-028 / coverage | closed | C-08 used handwritten repeatable-read SQL for the interleaved read. Dashboard isolation can regress independently. | C-08 | — | Fixed: the actual `getTripSnapshot` is paused after its trip-row read (`__setSnapshotBarrier`); a cancellation is committed meanwhile; the returned snapshot is asserted internally consistent. Verified live. [W4 corrections](docs/EVIDENCE.md#w4-technical-review-corrections) |
| ISSUE-029 / coverage | closed | C-15 allowed one preview to finish before the other observed a cache miss and checked only IDs and versions. | C-15 | — | Fixed: both publishers rendezvous past a cache miss before either publishes, and both responses' full optimal and greedy results are compared with the stored row. Verified live. [W4 corrections](docs/EVIDENCE.md#w4-technical-review-corrections) |
| ISSUE-030 / coverage | closed | In the earlier durable case, the fault fired after the helper had set `committed = true`, testing the application-response loss rather than a lost COMMIT acknowledgement. | C-16, recovery when a successful COMMIT acknowledgement is lost | — | Fixed: the retained C-16 case now wraps the checked-out client's `query` at `before-success-commit` so the next `COMMIT` runs for real and then rejects with `ECONNRESET`, placing the error inside `commitOrClassify` before `committed` is set. The caller gets `OutcomeUnknown`; an independent connection sees the durable driver and `applied/201` receipt before retry; the backend pid changes; the same-key replay returns the identical stored `response_json` (including the committed driver's id) with unchanged roster/version and no second receipt. Verified live in the suite. [C-16 fault placement resolved](docs/EVIDENCE.md#c-16-fault-placement-resolved-in-the-suite) |
| ISSUE-031 / evaluation | closed | 113 of 400 competing requests counted under load started after the final preview. | P-01 competing latency | Fixed: the preview-load completion time is captured as `windowEnd` and competing samples are filtered to `startedAt <= windowEnd`; the artifact records in-window vs after-window counts (290 vs 110 on the fourth-round run). Verified live. [Fourth-round corrections](docs/EVIDENCE.md#w5-correction-verification-fourth-round) |
| ISSUE-032 / evaluation | closed | D-1 sampled passenger counts up to each class label. Only one of ten cases labeled 50 actually had 50 passengers. | D-1 size-class evidence | — | Fixed: the size classes use a fixed-count generator with exact driver/passenger counts (assertion-guarded) and retain per-seed actual sizes and per-algorithm results. Every "50" case has 50 passengers, every "30" has 30. Verified live. [W5 corrections](docs/EVIDENCE.md#w5-technical-review-corrections) |
| ISSUE-033 / evaluation | closed | Holder identity and the stale rejection were verified, but the wait timer stopped at blocker detection and the outside-lock check accepted any 409. | D-2 measurement and rejection checks | — | Fixed: the artifact records both `blockDetectMs` and the full `blockingIntervalMs` (wait start → cancellation completes), and both variants require the EXACT `STALE_VERSION` code. Observed blocking interval 35 ms. Verified live. [Second-round corrections](docs/EVIDENCE.md#w5-correction-verification-second-round) |
| ISSUE-034 / evaluation | closed | The histogram was sampled after the final competing batch, and one valid matcher duration among 100 records passed. | P-01 telemetry | Fixed: telemetry is snapshotted when the preview load finishes, and the gate requires a finite matcher duration for every computed preview (`everyComputeTimed`); a partial-telemetry control now fails. Verified live (`finiteMatcherDurations: 100`). [Fourth-round corrections](docs/EVIDENCE.md#w5-correction-verification-fourth-round) |
| ISSUE-035 / evaluation | closed | A five-passenger trip passed as a 50-passenger run; the harness ignored rejected seed inserts. | P-01 maximum-size workload | Fixed: each seed insert's status is checked (a rejection aborts seeding) and the persisted active roster is read from the database before timing; the gate requires exactly 20 drivers/50 passengers and records the observed counts. The `P01_NEGATIVE_CONTROL=roster` control (5 passengers) now fails `rosterIsMax:false`. Verified live. [Fourth-round corrections](docs/EVIDENCE.md#w5-correction-verification-fourth-round) |
| ISSUE-036 / evaluation | closed | Process-group shutdown fixed the original stalled-child case, but when port 3100 stayed bound after the final signal, shutdown only warned and its caller exited 0. | Failed cleanup could look successful to a scripted rerun. W5 measurements stand. | Fixed: after the final SIGKILL and re-probe, if the port still accepts connections `shutdownServer` throws, which propagates to `main().catch` and exits non-zero. The normal run returns without throwing (exit 0, port refused); a full run with an independent listener holding the port through the final probe reported the cleanup error and exited 1. Verified live. [Exit-status gap closed](docs/EVIDENCE.md#issue-036-exit-status-gap-closed) |
| ISSUE-037 / evaluation | closed | A normal run followed by `P01_FAULT=telemetry` overwrote the normal artifact with a `control: "none"`, `pass:false` failure. | Retained W5 evidence | Fixed: a `P01_FAULT=…` run is routed like a control — it writes `eval/p01-control.json` labeled `control: "fault:<name>"` and leaves the normal artifact untouched. Verified live (normal artifact stays `control: none`/`pass:true`). [ISSUE-036/037 resolution](docs/EVIDENCE.md#issue-036-and-issue-037-resolution) |
| ISSUE-038 / coverage | closed | C-12 exercised a foreign driver but lacked a direct check for a foreign preview at the same trip version. | Cross-trip preview validation | Added a case expecting 404 NOT_FOUND and an unchanged target snapshot. | W6 test diff over `2d4768b`, concurrency 47/47. [W6 candidate audit](docs/EVIDENCE.md#w6-candidate-audit) |
| ISSUE-039 / browser test | closed | On `f306937` the lost-create test read the trip ID before the server response was captured. | Chromium clean-checkout reproduction | Wait for the unknown-outcome alert after delivery of the simulated 503. | Fix `5d86e5b`. Full Chromium 12/12, focused repeats 10/10. [W6 release-candidate verification](docs/EVIDENCE.md#w6-release-candidate-verification) |
| ISSUE-040 / coverage | open | Clearing a pending passenger operation and refreshing without retrying passed U-02 three times. | U-02 / R2 | Observe the replay request, exact body/key and durable outcome after reload. Repeat the skipped-POST control. | [W6 technical review](docs/EVIDENCE.md#w6-technical-review) |
| ISSUE-041 / evidence | open | D-1 retains aggregate tiny-oracle counts and omits per-case timings. | W6 evaluation traceability | Record the contracted case data and regenerate the artifact. | [W6 technical review](docs/EVIDENCE.md#w6-technical-review) |
| ISSUE-042 / documentation | open | Fresh README sequence runs matching before installation. The automated demo-DB browser rehearsal uses an untracked config. | W6 clean reproduction | Put install first and document the demo-DB browser invocation. Verify both from a fresh clone. | [W6 technical review](docs/EVIDENCE.md#w6-technical-review) |

Use states `open`, `in progress`, `needs verification`, `closed`, or `deferred`. For a bug, include starting data, steps/command, expected behavior, and actual behavior, or link to that reproduction in EVIDENCE. Label a suspected cause as a hypothesis until investigated. For a question, record the decision needed and what work depends on it.

Reference blocking issue IDs in the current handoff and affected checkpoint. An unresolved issue that violates a gate keeps that gate unpassed; deferring it does not waive the requirement. A deferral needs a reason and an explicit supported-scope/limitation update where relevant.

When a fix is implemented, move the issue to `needs verification`. Close it only after recording the fix revision/diff and actual regression-check result in EVIDENCE; close a question with a link to the recorded decision. Retain closed rows and their links for traceability. Detailed investigation, root cause, fix, and verification belong in EVIDENCE; consequential contract changes belong in ARCHITECTURE. Use a real issue as the course debugging case when suitable.

## Checkpoints and gate rules

Statuses are `not started`, `in progress`, `blocked`, or `passed`. Record an owner, code revision/diff, and evidence link when work starts or finishes. `Blocked` means a concrete impediment with a next recovery action, not an unrun check. A gate passes only after its required observations are recorded; skipped or unavailable checks remain open.

Technical gates permit dependent implementation to proceed. Independent human acceptance is tracked separately in EVIDENCE and is required for submission; a pending human review does not require stopping routine implementation. If a change affects an already passed check, reopen that check and rerun it before releasing the changed behavior.

| Checkpoint | Course milestone / effort target | Prerequisite | Status | Owner / verified revision / evidence |
|---|---|---|---|---|
| W0 — Reproducible foundation | E0 / days 1–2 | Read the selected contracts | Passed | Codex / W0 scaffold changes from `b88d98a` / [W0 closeout](docs/EVIDENCE.md#w0-closeout) |
| W1 — Matching with independent answers | E1 / day 3 | W0 | Passed | W1 diff on `fc3817a`. Technical checks passed and the student accepted A-2 on 2026-11-23. [W1 closeout](docs/EVIDENCE.md#w1-closeout) |
| W2 — Durable mutations | E1 / days 4–5 | W0 and W1 | Passed | Codex / W2 diff on `7483c57` / live 21-case suite incl. the C-17 racing-failure interleaving; ISSUE-006/014/016/019/020 closed. A-3 human review pending. [C-17 racing-failure coverage](docs/EVIDENCE.md#w2-c-17-racing-failure-coverage-closes-issue-019) |
| W3 — Complete browser workflow | E1 / days 6–7 | W2 | Passed | Committed at `9040695`. The student accepted the verified W3 workflow after checking persistence and stale-save handling in two tabs. [Fifth-round fixes](docs/EVIDENCE.md#w3-correction-review-fifth-round-of-fixes) |
| W4 — Races and failure recovery | E2 / days 8–9 | W3 | Passed | W4 commit with parent `22b538a` (application baseline `9040695`). Live 46-case concurrency suite incl. the strengthened C-01/05/08/15/16 (ISSUE-026–030 closed; C-16 now covers a lost COMMIT acknowledgement of a durable write, a transport-error unknown outcome, and a confirmed rollback) and the C-01 version-guard mutant; WF-3 via e2e. A-5 student review pending. [C-16 fault placement resolved](docs/EVIDENCE.md#c-16-fault-placement-resolved-in-the-suite) |
| W5 — Evaluation and scope defense | E2–E3 / day 10 | W4 | Passed | Working diff on `8f3187a`. ISSUE-031–035 closed: P-01 ends the window at preview completion (excludes the trailing batch), requires a finite matcher duration per compute, and verifies the persisted 20/50 roster; `roster`/`duplicate`/`preview`/`edits` controls all fail. D-1/D-2 human responses and the P-01 judgment are recorded. A-6 inspection is deferred at the student’s request until after technical work. [Fourth-round corrections](docs/EVIDENCE.md#w5-correction-verification-fourth-round) |
| W6 — Clean reproduction and submission | E3 / days 11–14 | W5 | In progress | Baseline suites passed. Resolve ISSUE-040–042 and repeat the affected checks. Student acceptance and course submissions remain pending. [W6 release-candidate verification](docs/EVIDENCE.md#w6-release-candidate-verification) |

Days are effort estimates, not deadlines. Check Canvas during W0; the proposal can be due before implementation finishes. Do not wait for W6 to begin required human review, attribution, or scheduling.

### Checkpoint closeout

After implementing each checkpoint, update [EVIDENCE.md](docs/EVIDENCE.md) and the handoff before marking the checkpoint passed or moving to the next one. Capture evidence as it becomes available so the closeout is a short review of the existing records.

- Record what changed and link the commit or current diff, relevant tests, fixtures, and outputs.
- Record what was verified, including the starting state, command or interaction, expected result and its basis, and actual result. Carry forward failed or unrun checks and their next actions.
- Update the agent episode and any technical decision, debugging case, attribution, or scope record that applies. Preserve the symptom, cause, fix, and rerun for a real debugging incident with potential for the final deck.
- Record what the student independently inspected or ran and their decision and reason when supplied. Mark any outstanding human review as pending. Follow the technical gate rules above for implementation progress.
- Link the evidence from the checkpoint row and update the gate status and next bounded task in the handoff.

### W0 — Reproducible foundation

**Build:** Verify tools and pin compatible exact versions for the architecture's Node/Next/React/TypeScript/PostgreSQL stack. Scaffold into this existing repository without overwriting its docs. Add the npm lockfile, strict TypeScript, lint/test configuration, Compose database, `.env.example`, and ignores for secrets, dependencies, build output, and database volumes.

Implement numbered migrations for the eight architecture tables, separate app/setup database roles, demo/test database separation, the canonical `data/zones.json`, and guarded offline reset. Add the pool/transaction foundation and dataset comparison guard; keep business routes for W2/W3. Retain independently specified fixture inputs and expected answers before implementing the solver. Record the bounded agent request before code changes.

**Gate:** From an empty disposable database, installation, migration, reset, typecheck, lint, build, and local startup succeed using documented commands. Reapplying migrations is safe. Reset refuses a non-designated target. The app role cannot edit seed costs; a changed fixture with retained state is rejected; intentional reset removes old trips/receipts and gives fresh IDs (C-18). A placeholder UI proves startup only, not a working carpool workflow.

**Leave behind:** Actual dependency versions/source attribution, verified setup commands in README, schema/fixture checks and outputs in EVIDENCE, and exact environment details. No passing placeholder tests or invented output.

### W1 — Matching with independent answers

**Build:** Strict shared input contracts and normalization vectors; pure greedy matcher, Bellman–Ford min-cost flow, feasibility validator, deterministic result ordering, and a separate exhaustive oracle. Respect the architecture's roster/cost bounds and active-status rules. Keep database and network code out of the matcher.

**Start here:** Use [normalization and idempotency](docs/ARCHITECTURE.md#normalization-and-idempotency) for shared contracts, [pure matching](docs/ARCHITECTURE.md#pure-matching) for the algorithm and output, and [acceptance checks](docs/ARCHITECTURE.md#acceptance-checks) for M-01 through M-10. The hand-checked inputs and outcomes already live in [matching.json](tests/fixtures/matching.json). Its matrices are driver rows and passenger columns, with `null` for a missing edge and `0` for a usable zero-cost edge. WF-4's end-to-end check belongs to W3. Keep the oracle independent of flow logic and compare objective values on ties. Record the bounded W1 request under A-2 when implementation is assigned.

**Test wiring:** `vitest.config.ts` currently includes only the PostgreSQL integration file. Add a database-free matching test command and select its files separately from `test:database`. W1 can be built and tested with Node 24 and installed npm dependencies. Docker and `.env` are needed for the later live database work. Leave receipt persistence, stored preview publication, and browser behavior for W2/W3. ISSUE-004 and ISSUE-006 remain tracked for database work and do not block W1.

**Gate:** M-01 through M-10 pass. Hand fixtures establish M-01 = 2 matched/cost 4 and M-08 = 2/cost 3; oracle comparisons cover the retained 100 tiny seeds. Substituting greedy for the optimizer must fail M-01/M-08. Restore the real implementation after the controlled mutation and retain the observation. A student independently checks the fixture reasoning; mark that review pending until actually done.

**Leave behind:** Reproducible fixtures/oracle seeds, actual matching outputs, attribution for the established algorithm, and an early maximum-size timing measurement. Investigate poor timing now; the final responsiveness gate is W5.

### W2 — Durable mutations

**Build:** The shared mutation helper first: global request-key lock → receipt lookup → trip lock → business savepoint → terminal receipt/commit. Implement consistent reads, create/register/edit/cancel/withdraw services, then their JSON routes. Apply normalization, bounds, error/outcome metadata, and dataset readiness at the service boundary. Roster changes follow whole-plan invalidation even before the matching UI exists.

**Gate:** C-04, C-09, C-10, C-11, C-12, C-17, and C-19 pass against real PostgreSQL. Check duplicate registration/creation, conflicting keys, no-ops, record caps, membership, terminal failure after partial work, lost failure acknowledgement, and failure to persist a receipt. Same-key replay resolves the original outcome; it never performs a finalized failure later. Existing rows/version survive rollback. Extend boundary checks through HTTP, not just the pure matcher.

**Leave behind:** Tests with real separate connections, narrow test-only fault hooks, and logs showing both business state and receipt state. No public fault-injection routes. Record the first implementation episode and its human-review status in EVIDENCE.

### W3 — Complete browser workflow

**Build:** Snapshot/read → compute → version-check/persist preview, then commit by preview ID using W2's helper. Implement the minimal creation/roster/preview/saved-plan pages, totals and unassigned riders, one reducer for version/preview state, and session-storage recovery. Add cancellation, capacity reduction, withdrawal, and explicit rematching.

**Gate:** C-02, C-03, C-07, C-14; WF-1, WF-2, WF-4; and U-01 through U-04 pass. An organizer can create → register → preview → save → reload, then cancel/reduce capacity → rematch. A stale preview rejects without overwriting current state. The North→East fixture stays at 1 match/cost 7 through API, database, and UI. Terminal failures release pending UI state; unknown outcomes retain the same key; delayed replies cannot restore an old preview.

**Leave behind:** A runnable demo and exact browser steps in README. Prefer automated browser checks for ordering/reload behavior; retained deterministic manual checks are allowed by the architecture, but must include input, actions, expected and actual observations. Mark each check's method explicitly. This is the first internal workflow release, not submission readiness.

### W4 — Races and failure recovery

**Build/check:** Complete controlled concurrency and uncertain-commit tests using real PostgreSQL and separate clients. Force interleavings with barriers and bounded watchdogs. Exercise both commit outcomes and distinguish a confirmed rollback from lost commit acknowledgement. Check connection cleanup and subsequent pool use.

**Gate:** C-01, C-05, C-06, C-08, C-13, C-15, C-16, and WF-3 pass, alongside regression checks affected by the changes. Two commits cannot overwrite each other; consistent reads do not mix versions; publication rejects changed input; same-version previews converge on one stored result. Removing the commit version guard must be detected by C-01, then the normal implementation must pass again.

**Leave behind:** Reproduction scripts and actual database/browser observations, a second traceable implementation episode, and real defect/regression records as they occur. A deliberate mutant establishes test sensitivity; it is not the required real debugging story or a fabricated human correction.

### W5 — Evaluation and scope defense

**Run:** The D-1 matching comparison, D-2 short/long-lock preview experiment, and P-01 responsiveness experiment exactly as defined in architecture section 8. Keep seeds, input sizes, cache status, environment, code revision, and raw measurements. The lock experiment's artificial gate does not measure real CPU responsiveness.

**Gate:** Zero fixture/oracle/invariant discrepancies. On the documented demo machine, maximum-bound solver p95 ≤100 ms; real competing HTTP request p95 ≤500 ms and increase over idle p95 ≤250 ms, without timeouts. Use a production build, warmup, and the specified uncached work. Complete the two decision records with choice, alternative, implementation, actual evidence, and the student's response; agent measurement alone does not fill the human-response field.

**Leave behind:** Retained evaluation artifacts linked from EVIDENCE, resolved performance failures or a documented smaller supported scope with rerun checks, and explicit limitations. If human review is pending, mark measurements complete and the course decision record pending; continue independent preparation.

### W6 — Clean reproduction and submission

**Gate:** A fresh checkout at the recorded candidate revision and empty designated database reproduce the README setup, production build, validation, and demo without hidden local files or secrets. Inspect actual test counts/skips; a zero exit code from an empty suite is insufficient. All 38 current acceptance IDs have retained outcomes, or a justified scope revision explicitly updates the architecture, this plan, and evidence before the final rerun.

Student(s) must also complete these course deliverables and records:

- [ ] Independently inspect/execute important agent-generated changes; retain two implementation episodes and a real consequential human correction/rejection/redesign.
- [x] Record D-1/D-2 judgments, the ISSUE-007 debugging story, library versions, AI contributions and operating limitations.
- [ ] Confirm the complete team roster, per-person contributions and the human correction decision for the episode record.
- [x] Prepare the [proposal PDF](deliverables/proposal.pdf) and the [six-slide draft](deliverables/presentation-draft.pdf).
- [ ] Confirm the Canvas deadline, review the proposal and record its actual submission.
- [ ] Apply the supplied Canvas six-slide template to the draft, check the per-person credits and export the final deck.
- [ ] Rehearse the successful workflow, edge/failure case, independent expected answer, decisions, attribution, and limitation; both teammates can explain the work.
- [x] Verify public repository read access and screen the candidate and reachable Git history for course-material indicators. [W6 candidate audit](docs/EVIDENCE.md#w6-candidate-audit)
- [ ] Confirm student account ownership, partner collaborator status and provenance of source, tests and data.
- [ ] Submit the required repository URL/PDFs, reserve the demo slot, and finish the default-branch code/writeup before Canvas's available-until deadline. Record actual confirmations, not assumptions.

### Stretch goal — One-city meeting points

**Optional · Not started.** W0–W6 and the release gates can all pass independently of this goal.

Choose one city, one fixed event venue, and up to 16 named public meeting points. Drivers select a starting point and passengers select a pickup point. Give the organizer a reproducible offline demo using a separate city fixture loaded through the [guarded offline reset](docs/ARCHITECTURE.md#seeded-data-lifetime).

For each eligible pair, estimate the extra driving minutes via the pickup point compared with driving directly from the driver's start to the venue. Record the travel-time source, date, and rounding rule with the fixture. Use the existing matcher to maximize passengers served, then minimize the sum of those individual detour estimates. Label that sum in the preview and saved plan. Street-address entry, live traffic, and multi-stop route optimization are outside this stretch goal.

**Acceptance check.** Use two one-seat drivers at different starting points and two passengers at different pickup points, with two feasible pairings whose totals differ. Hand-calculate the four detours from the retained travel times before running the app. Preview the trip, save, and reload. Verify the named assignments, two matched passengers, and the lower expected total in minutes. Record the fixture, calculations, and observed browser result in [EVIDENCE.md](docs/EVIDENCE.md) when implemented.

## Release gates

| Release | Required observations | Current state |
|---|---|---|
| R0 — Setup ready | W0 passed; reproducible environment/database; actual commands in README | Passed |
| R1 — Internal workflow demo | W0–W3 passed; success, reload, availability change, and stale-preview handling observable | Passed. The W3 technical checks and A-4 student acceptance are recorded. [Evidence](docs/EVIDENCE.md#w3-fifth-round-verification) |
| R2 — Technical release candidate | W0–W5 technical checks/measurements passed; all 38 checks accounted for; evidence traceable to candidate code | Reopened after the U-02 control passed with replay disabled (ISSUE-040). [W6 technical review](docs/EVIDENCE.md#w6-technical-review) |
| R3 — Submission ready | R2 plus W6 clean reproduction, independent human acceptance, required PDFs/access/submissions/booking | Not passed |

These gates describe readiness; they do not automatically publish, deploy, or submit anything. Human course actions can remain pending while technical preparation continues. R2 is insufficient to claim R3.

## Command contracts and evidence

README lists the existing W0 commands and distinguishes verified commands from pending checks. Later scripts are planned. Add scripts as their associated behavior is implemented and record actual verification in EVIDENCE.

| Introduce by | Planned commands |
|---|---|
| W0 | `npm ci`, `docker compose up -d --wait db`, `npm run db:migrate`, `npm run demo:reset`, `npm run dev`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm start`, `npm run test:setup`, `npm run test:database`, and `npm run test:readiness` |
| W1 | `npm run test:matching`; an initial `npm run eval:matching` for solver timing |
| W2 | `npm run test:unit` (database-free contract/helper checks) and `npm run test:concurrency` with the first real-PostgreSQL cases; extend it through W4 |
| W3 | `npm run demo`; `npm run test:e2e` if browser automation is implemented, otherwise retained exact manual steps |
| W5 | Final `npm run eval:matching`; `npm run eval:concurrency`; `npm run eval:responsiveness` |
| W6 | Rerun the verified README procedure from a clean checkout; retain its complete results |

For every gate, EVIDENCE must identify starting state/input, command or interaction, independently established expectation, observed result, and code/test/revision. Store raw outputs in a small path such as `artifacts/W4/` when generated, and link them from EVIDENCE. Do not create empty evidence placeholders or treat these proposed paths as existing artifacts. Keep credentials and machine-specific secrets out of outputs.

## If progress slips

At the end of W0, resolve tool/database setup before building dependent services. By the end of day 7, prioritize a complete W3 workflow over visual polish or deferred features. If matching correctness threatens completion, use the architecture's explicitly bounded exact fallback (8 passengers/4 drivers), retain independent known answers, and update all affected API/UI/test limits. Greedy cannot satisfy the optimality claim.

If responsiveness fails, profile and reduce supported bounds consistently before adding workers. Keep maps, authentication, messaging, separate services, and other deferred features out of this implementation. Any change to a claimed behavior or supported bound needs its reason, affected checks, and new evidence recorded in ARCHITECTURE/EVIDENCE; do not silently skip a failing gate.

## Handoff procedure

Before ending an implementation session, update the current handoff and checkpoint/release rows. Record:

- The exact code revision plus any uncommitted diff/files; never erase someone else's partial work to make the table look clean.
- What was completed and what is partially implemented, with relevant paths and test IDs.
- Exact commands and observed results, including failures, skipped checks, environment limitations, and artifact links.
- The smallest next action, its prerequisites, and how the next person will know it worked.
- Any blocker and recovery action, referencing issue IDs from the register, plus human decisions/reviews still pending.

Keep this as the single active work queue. Do not start a separate handoff document or duplicate the architecture. Changes to technical decisions belong in ARCHITECTURE, observations in EVIDENCE, and verified operation in README.
