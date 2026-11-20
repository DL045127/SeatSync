# Repository instructions

GroupRide is a local CS 378AC carpool coordination project. The repository starts with a selected architecture and no application implementation. Verify the current tree rather than assuming that initial state still holds.

## Orient and resume

- Read [WORKPLAN.md](WORKPLAN.md), especially its current handoff and first unfinished checkpoint. Follow the user's current scope; a documentation task does not authorize starting the application implementation.
- Use [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for technical contracts, [PROJECT_SPEC.md](PROJECT_SPEC.md) for course requirements, [docs/EVIDENCE.md](docs/EVIDENCE.md) for results/oversight, and [README.md](README.md) for verified operation.
- Inspect Git status/history and existing files before edits. Preserve unrelated changes. Checkpoints are implementation/readiness gates, not repeated permission requests; continue authorized work when prerequisites pass.
- Keep work bounded and reviewable. Revisit a selected design when a concrete requirement, test, or measurement warrants it; record the reason and update affected checks.

## Implementation rules

- Follow the architecture's module boundaries and pinned stack. Keep matching pure, business writes in the trip service, SQL parameterized, and each transaction on one checked-out client.
- Preserve the consequential contracts: maximum coverage before minimum cost; immutable server previews; key → trip → child lock order; global terminal success/failure receipts; same-key recovery for uncertain outcomes; full-plan invalidation on roster changes; dataset changes through explicit offline reset; monotonic browser versions and atomic preview invalidation.
- Use the architecture's full protocol, not these abbreviated reminders, to implement savepoints, receipt replay, failure classification, normalization, and connection cleanup. Do not replace unknown outcomes with claimed rollback or clear a browser operation merely because HTTP returned an error.
- Keep fixture expectations and the test oracle independent of the optimizer's flow logic. Include observable outputs and plausible defects the checks detect. Use real PostgreSQL for transaction/concurrency evidence and deterministic interleavings instead of timing-only sleeps.
- Implement the smallest complete workflow before optional features. Scope reductions must update the claim, limits, fixtures, and evidence together.

## Verification and evidence

- Commands in WORKPLAN/ARCHITECTURE are planned until scripts exist and have been run. Never claim a build, test, benchmark, or clean setup passed without observing it. Do not add no-op scripts to satisfy a gate.
- Run checks appropriate to the change. Documentation changes need link/contract/format checks; implementation needs the relevant checkpoint checks. Broaden testing when changes or failures justify it. Record skipped/unavailable checks and leave their gates open.
- Record discovered bugs, unresolved design questions, and environment impediments in the [WORKPLAN issue register](WORKPLAN.md#bugs-and-open-issues). Include reproduction/impact and next action; reference blocking IDs in the handoff. Close bugs only with a fix revision and actual verification in EVIDENCE. Retain closed entries, and do not treat a deferred gate failure as passing.
- Before an agent implementation episode, record its bounded request in EVIDENCE; afterward add its diff/revision and actual checks. Mark the human decision pending until the student independently reviews it. Do not invent human acceptance, corrections, debugging incidents, or submission confirmations.
- Attribute reused code/libraries with source and version. Course homework material is prohibited, including code, tests, data, and handouts; do not introduce it into files or history.
- Keep app/setup credentials separate, use fictional demo data, and keep secrets/volumes out of Git. Reset only an explicitly designated local demo/test database with the app stopped, following the architecture's guards.

## Leave a useful handoff

Update WORKPLAN's current state, affected checkpoints, actual verification, unfinished work, and next action before stopping. Put technical changes in ARCHITECTURE, results and human review in EVIDENCE, and verified commands in README. Keep these documents aligned; do not create additional planning files for the same information.

Pending human course review blocks a submission-ready claim, not independent technical progress. Report the technical result and the remaining human action accurately.
