# Project evidence

**Status:** Development record template; no implementation results or human acceptance are claimed. Keep actual artifacts here or link to retained files/commits. Design and planned checks live in [ARCHITECTURE.md](ARCHITECTURE.md).

The [course specification](../PROJECT_SPEC.md) requires the content below, but does not require separate documents for each category. These are working records for the final slide deck; DEL-3 does not require a separate written report.

## Validation results — VR-1 through VR-3, RR-4

For each significant claim, retain the starting state, exact command/interaction, independently established expectation and derivation, actual output, and code/test/commit. Record failures and subsequent verification where relevant. Agent-reported success alone is not independent acceptance (AR-3).

| Claim/check | Input or reset state | Command / interaction | Expected result and independent basis | Actual output / artifact | Code / test / commit |
|---|---|---|---|---|---|
| M-01 matching optimum | Architecture's 2×2 fixture | TODO after implementation | 2 matched, cost 4; enumerate both complete assignments | Not run | TODO |
| C-02 stale commit | Preview, then commit driver cancellation | TODO after implementation | `409`, no canceled driver assigned; version/invariant contract | Not run | TODO |
| WF-1 persistence | Seeded fictional trip | TODO after implementation | Valid saved roster after reload; inspect fixture and invariants | Not run | TODO |

## Agent work and human oversight — AR-1 through AR-3

Preserve at least two traceable agent-work episodes, including an actual consequential human correction, rejection, or redesign. Do not fabricate incidents or approvals. Students define objectives, invariants, scope, and acceptance criteria, inspect generated changes, independently check them, and decide what to retain. Agents may assist with bounded implementation/testing tasks.

| Episode | Specific bounded request | Resulting diff / commit | Observations and independent human checks | Human decision and reason |
|---|---|---|---|---|
| A-1 | TODO | TODO | TODO | Pending |
| A-2 | TODO | TODO | TODO | Pending |

## Two decisions — DR-1

Proposed D-1/D-2 comparisons are in the architecture. Complete these records from actual evidence; change the proposed decision if evidence warrants it.

| Required record | D-1: matching strategy | D-2: concurrency strategy |
|---|---|---|
| Problem / requirement | TODO | TODO |
| Chosen solution and considered alternative | TODO | TODO |
| Implementation change / commit | TODO | TODO |
| Evaluation fixture, command, observed evidence | TODO | TODO |
| Human response: retained, changed, or rejected, and why | TODO | TODO |

Record significant scope changes and reasons alongside the relevant decision (FR-3, PR-4).

## Debugging case — DR-2

Capture one substantive, real incident; hypothetical bugs or deliberately broken comparisons are not observed debugging stories. This may overlap with a decision above.

- **Symptom and reproduction:** TODO
- **Investigation and root cause:** TODO
- **Fix and code/diff/commit:** TODO
- **Verification command and observed result:** TODO
- **Remaining limitation:** TODO

## Attribution and contributions — RR-3

Record dependency versions, reused source URLs and starting versions/commits, student additions/modifications, each team member's contributions, and significant AI work. Do not include prohibited course homework material.

| Contributor / component | Source and version / commit | Contribution or reused functionality | Review / evidence |
|---|---|---|---|
| Student team member(s) | TODO | TODO per person | TODO |
| Libraries / reused starting code | TODO when installed/adopted | TODO | TODO |
| Codex | Documentation consolidation, 2026-11-19 | Consolidated supplied plans into architecture/evidence records; simplified README | Human review pending; no application code or runtime validation |

The proposal PDF, final slide PDF, live demonstration, repository access, and Canvas submissions remain required. See [PROJECT_SPEC.md](../PROJECT_SPEC.md) for the full deliverable and acceptance checklist.
