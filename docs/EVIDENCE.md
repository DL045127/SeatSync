# Project evidence

**Status:** Development record template; no implementation results or human acceptance are claimed. Keep actual artifacts here or link to retained files/commits. Design and planned checks live in [ARCHITECTURE.md](ARCHITECTURE.md).

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
| A-1 | TODO | TODO | TODO | Pending |
| A-2 | TODO | TODO | TODO | Pending |

D-0, D-BASE, D-CONTRACTS, and D-HANDOFF record design/planning provenance. Capture the two implementation episodes and consequential human correction as development proceeds; these records alone do not fulfill them. Agent-proposed redesigns are not recorded as human corrections.

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
| Codex | Documentation consolidation, initial design, baseline selection, and contract review follow-up, 2026-11-19 | Consolidated plans; selected/drafted architecture, contracts, alternatives, and comparison experiments; resolved documented seed-lifetime, terminal-outcome, and UI-ordering gaps; updated README/evidence templates | Human review pending; no application code or runtime validation |
| Codex | Implementation workplan and agent guidance, 2026-11-20 | Added checkpoints, release gates, restart state, check ownership, and handoff instructions; linked existing docs and reconciled retained design commit references | Human review pending; documentation verification only |

The proposal PDF, final slide PDF, live demonstration, repository access, and Canvas submissions remain required. See [PROJECT_SPEC.md](../PROJECT_SPEC.md) for the full deliverable and acceptance checklist.
