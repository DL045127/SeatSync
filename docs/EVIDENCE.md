# Project evidence

**Status:** Checkpoint A of the address extension is recorded in `feat: support offline address trips (checkpoint A)`. Checkpoint B (independent projection check, leg reuse and recovery, read and commit validation) was implemented and verified on a working diff over `161df83` ([closeout](#checkpoint-b-closeout)); the [technical review](#checkpoint-b-technical-review) found five defects and the [corrections](#checkpoint-b-corrections) fix and verify them. The [correction review](#checkpoint-b-correction-review) reopened B for ISSUE-071–073, which the [second corrections](#checkpoint-b-second-corrections) fix and verify. The [independent B signoff review](#independent-b-signoff-review) verified these fixes. The [C technical review](#checkpoint-c-technical-review) reproduced two defects. The [review corrections](#checkpoint-c-review-corrections) passed their PostgreSQL and loopback regressions. The [follow-up corrections](#zero-seat-handoff-and-legacy-retry-date-corrections) cover the zero-seat handoff and legacy retry dates. The [latest C corrections](#covered-publication-race-and-malformed-cooldown-corrections) address competing covered publishers and malformed cooldown dates. The [independent C signoff review](#independent-c-signoff-review) verified these corrections. The [D pilot rehearsal](#checkpoint-d-pilot-preparation) passed on loopback. The [two-region live run](#austin-and-seattle-live-pilot) completed. The [D technical review](#checkpoint-d-technical-review) confirmed both saved plans and opened ISSUE-083–086. The [D review corrections](#checkpoint-d-review-corrections) address the original cases. The [independent correction review](#checkpoint-d-correction-review) reopened ISSUE-084 for two more wrong-building selections. The [primary street number follow-up](#primary-street-number-follow-up) corrected those cases. Its [independent review](#independent-review-of-primary-street-numbers) kept ISSUE-084 open and recorded ISSUE-087 for numeric venue names. The [independent review of grid pickups and numeric venues](#independent-review-of-grid-pickups-and-numeric-venues) verified ISSUE-087, kept ISSUE-084 open for city-qualified addresses and recorded ISSUE-088 for ambiguous venue selection. The [locality and venue ambiguity corrections](#locality-and-venue-ambiguity-corrections) address the original reproducers. The [independent review](#independent-review-of-locality-and-venue-ambiguity) identified remaining cases in ISSUE-084 and ISSUE-088. The [highway and street matching corrections](#highway-searches-and-independent-street-matching) address those cases. The [highway and street review](#independent-review-of-highway-and-street-matching) closed ISSUE-088. The [directional highway and locality corrections](#directional-highways-and-locality-without-commas) address the remaining search findings. The [independent directional-highway review](#independent-review-of-directional-highways-and-attached-localities) identified collisions involving FL and OR. The [Florida and Oregon corrections](#florida-postal-codes-and-oregon-route-numbers) cover those cases. The [general locality correction](#general-locality-matching-and-state-aliases) addresses country-suffixed and state-only searches and equivalent state representations. The [locality and unit ambiguity corrections](#locality-and-unit-ambiguity-corrections) address ISSUE-089–091 and passed [independent verification](#independent-verification-of-the-three-shared-search-rules). [Checkpoint D passed its technical gate](#checkpoint-d-technical-closeout). A-10 student inspection remains pending. The zone release and its W6 record are below and unchanged. Design and planned checks live in [ARCHITECTURE.md](ARCHITECTURE.md) and [ARCHITECTURE-v2.md](ARCHITECTURE-v2.md).

## Regression relevance audit

On 2026-11-26 the student asked Codex to catch up on GroupRide and assess earlier checkpoint tests against the changed workflows. The audit starts at `d6f9b8a`, with pre-existing course documentation and deliverable edits in the worktree. Application and test sources were reviewed without edits. Student inspection remains pending.

| Tests | Current coverage and disposition |
|---|---|
| W0 setup, C-18, L-01/L-02 upgrade/reset | Keep the guarded reset, drift and role checks. The address upgrade still needs to preserve W6 zone plans, previews and receipts. The reconstructed W6 upgrade test also checks an invitation ID is backfilled. Its title and downgrade comment still name 002 alone even though the fixture now removes and reapplies 002–004. [Upgrade case](../tests/concurrency/address-reset-upgrade.integration.test.ts) |
| W1 matching, oracle and greedy controls | Keep the independent fixtures, oracle, validation and greedy controls. Both location modes call the same solver after building different directed edge costs. Zone cost 7 and address detour seconds exercise different projections. The independent address projection comparison checks that routing times produce the right edges before the solve. [Zone solver tests](../tests/matching/matching.test.ts) · [Address comparison](../tests/matching/address-projection.compare.test.ts) |
| W2–W4 mutations and interleavings | Keep the PostgreSQL tests for receipts, savepoint rollback, lock scope, stale publication and commit, and uncertain outcomes. Guest registration, details edits, and plan clearing use these transaction paths. Older capacity, cancellation and withdrawal bodies still enter the current service and protect supported callers and pending retries. Tests for lost HTTP replies and lost database COMMIT acknowledgements observe distinct failures. [Mutation cases](../tests/concurrency/mutations.integration.test.ts) · [Race and recovery cases](../tests/concurrency/races-recovery.integration.test.ts) |
| W3 browser and reducer | Keep the directional cost, reload, stale-save, rematch and session-storage cases. WF-2 already uses **Edit driver**. The inactive-roster browser test verifies hidden rows, while the receipt and database tests verify the records remain inactive. The reducer checks response ordering independent of how the dashboard renders driver cards. [Organizer browser cases](../tests/e2e/workflow.spec.ts) · [Reducer cases](../tests/unit/reducer.test.ts) |
| A–D address search, projection, reuse and deadlines | Keep picker confirmation and stale-result cases, provider stub tests, signed scope, evidence validation and handoff tests. Invitations use the same location picker, selection service, and address matching path. The address invitation browser case checks invite scope and registration. The organizer address workflow separately verifies keyboard operation, saved units and reload. [Organizer address cases](../tests/e2e/address.spec.ts) · [Invitation cases](../tests/e2e/invite.spec.ts) |
| W5/W6 evaluations and demos | Keep the W6 artifacts tied to their recorded zone baseline. D-1 evaluates the solver shared by both modes. D-2 measures the zone lock experiment and P-01 measures the zone HTTP load. The address run of the responsiveness script supplies L-17 fixture evidence. The zone `test:demo` scenarios still cover stale save and rematch, while the fixture `demo:invites` walkthrough verifies the guest registration and address-plan happy path. [Evaluation commands](../README.md#setup-and-demonstration) · [Invitation demo](../README.md#run-the-invitation-demo) |

- **ISSUE-094.** The L-04 test titled “EVERY write route” constructs eight handler entries. Clear-plan POST and the invite search, driver and passenger actions are absent. Both new route modules call the common request guards by inspection. The existing test still checks the eight older entries. Extend the table with the current endpoints and their real methods and params before relying on its broad claim. [Existing boundary test](../tests/concurrency/address-selection.integration.test.ts) · [Clear route](../src/app/api/trips/[tripId]/match/clear/route.ts) · [Invite route](../src/app/api/invites/[inviteId]/[action]/route.ts)
- **ISSUE-095.** The earlier address-workflow SQL capture runs a dashboard read before committing a plan. Only the stored-hit lookup needs `match_previews` in that state. The later L-12 test commits a plan, seeds a hit for the new version and exercises both preview SQL paths. Both checks reject a textual `evidence` reference, so `SELECT *` could load the column while passing either check. The repository currently uses explicit projections. Keep and strengthen the later case, then remove the older overlapping probe. [Earlier probe](../tests/concurrency/address-workflow.integration.test.ts) · [L-12 probe](../tests/concurrency/address-evidence-reads.integration.test.ts) · [Repository projections](../src/trips/repository.ts)
- **ISSUE-096.** Current browser coverage includes a zone details edit that invalidates a saved plan, address replacement and persistence on a trip with no saved plan, guest registration on an open trip, and a successful address invitation demo. Add a post-save roster-change scenario through the current address interface, with the old plan invalidated and the replacement checked after reload. A late invite registration or a replacement pickup would exercise a path that the older capacity PATCH tests do not enter. [Address edit workflow](../tests/e2e/address.spec.ts) · [Invitation workflow](../tests/e2e/invite.spec.ts) · [Demo script](../scripts/demo-invites.ts)
- **ISSUE-097.** `npm run test:readiness` exited 1 at the production landing-page assertion. `GET /` returned 200 and the new heading `Create a trip`, while the script expected `<h1>GroupRide</h1>`. The assertion ran before the health and drift checks. An in-memory diagnostic changed the expected heading and ran the same readiness phases. It observed production landing and health 200, production 503 `DATASET_MISMATCH` after changing the seeded edge, and development landing and health 200 after reset. The readiness contract still applies. The checked-in command still fails until its assertion is updated. [Readiness script](../scripts/check-readiness.ts) · [Current landing page](../src/app/page.tsx)

On Node v24.22.3, `npm run lint` and `npm run typecheck` passed. `test:setup` passed 2 cases, `test:matching` passed 71, `test:unit` passed 469, `test:database` passed 1, `test:concurrency` passed 289 across 12 files, and `test:e2e` built production and passed 35 Chromium cases. `test:demo` passed all three zone cases on the production build at port 3000 against `groupride_test`. On the same server, `demo:invites` registered two drivers and three passengers, and reloaded the saved fixture plan with two matches, one unassigned rider and 82 seconds of estimated detour. The PostgreSQL runs emitted the `pg` deprecation warning about overlapping queries on one client. The audit used the designated test database, fixture data and loopback provider stubs. Live provider calls and the historical timing experiments were outside this rerun.

## Regression audit follow-up

The student asked to implement the four audit dispositions and reassess database concurrency coverage for the invitation workflow. Starting revision `d6f9b8a` with the audit and course edits already in the worktree. The bounded change covers the readiness script, tests for route guards and display-read projections, a browser rematch after guest registration, and a controlled PostgreSQL race between guest registration and an organizer action. Student inspection is pending.

| Finding | Change on the working diff |
|---|---|
| ISSUE-094 · L-04 route inventory | The integration test exercises 12 trip, search, and invite actions with their actual methods, paths and parameters. Each rejects the origin and fetch-metadata cases independently with `403 CROSS_SITE_REQUEST`. The receipt count stays unchanged. [Route inventory](../tests/concurrency/address-selection.integration.test.ts) |
| ISSUE-095 · L-12 display queries | A cached preview hit and an assigned dashboard read are checked separately against the column names supplied by real PostgreSQL results. A wildcard projection would add unallowed columns even if the SQL never refers to `evidence` by name. The earlier overlapping probe was removed. [Display-read test](../tests/concurrency/address-evidence-reads.integration.test.ts) |
| ISSUE-096 · Late guest and rematch | Chromium saves Dana with Pat at 230 seconds. A new browser context joins Brooke by invitation using the Bravo pickup. The organizer reloads and sees the cleared plan, saves a replacement, then reloads with Brooke as the sole match and Pat unassigned. The expected Bravo detour is `239 + 344 - 519 = 64` seconds from the directed fixture. [Invitation test](../tests/e2e/invite.spec.ts) · [Fixture](../data/fixture-places.json) |
| ISSUE-097 · Readiness | The production and development landing checks look for the current `Create a trip` heading. The health, fixture-drift and reset assertions are retained. [Readiness script](../scripts/check-readiness.ts) |

The earlier concurrency cases still exercise guarded writes, savepoint rollback, consistent dashboard snapshots, versioned preview publication, and same-key recovery. Those guarantees apply to invitations and organizer edits through the shared trip lock and mutation service. The address-specific PostgreSQL tests also exercise routing handoff and publication timeouts, which a zone fixture cannot cover. The added controlled race pauses an address guest registration before its transaction commits, observes its PostgreSQL backend blocking an organizer commit, and then releases it. The registration succeeds once, the save gets a receipted `409 STALE_VERSION`, and replay returns the original guest receipt without an extra version increment. A fresh organizer read sees both passengers and an empty saved plan. Durable receipt rows confirm one application and one rejection. [Shared race tests](../tests/concurrency/races-recovery.integration.test.ts) · [Routing races](../tests/concurrency/geoapify.integration.test.ts) · [Invitation race](../tests/concurrency/address-workflow.integration.test.ts)

Review blobs on `d6f9b8a` are `e5bb2bd1a076` (readiness), `288d58604082` (route inventory), `3b5985d70cbf` (display queries), `17cda2b9b28b` (invitation contention and duplicate removal), and `8432c7800018` (Chromium rematch). The initial typecheck found the project library declarations omit `Promise.withResolvers`. The race uses a regular promise barrier. The first projection run wrapped a reused pool client twice and double-counted its query. The recorder now wraps each client once, and all 64 focused PostgreSQL cases passed.

On Node v24.22.3 and the designated `groupride_test` database, the full `npm run test:concurrency` passed all 289 cases in 12 files. `npm run test:e2e` built production and passed all 35 Chromium cases, including the 64-second invitation rematch. The repaired `npm run test:readiness` observed 200 in production, 503 `DATASET_MISMATCH` with fixture drift, and 200 in development after reset. Lint, typecheck, setup (2), matching (71), and unit (469) passed. The existing `pg` warning about overlapping queries on one client still appeared. Verification used fixture data and loopback stubs. Live provider and timing measurements were outside this rerun.

## Organizer interface refresh

The student asked to make GroupRide look like a production application. This episode covers the trip creation form, organizer workspace, address picker, and their responsive layout and interaction states on the working diff over `7dc163f`. Verify existing browser workflows and inspect the layout at desktop and mobile widths. Student inspection is pending.

The interface adds a shared header, responsive setup and organizer pages, visible registration labels, and clearer selection, notice, and plan states. The trip header displays the saved name and departure in UTC. The road photo is an original generated asset served locally as a 168 KiB WebP. Desktop setup and phone dashboard screenshots were inspected at 1440 px and 390 px respectively. The phone regression selects a venue by touch, creates an address trip, and checks that both pages fit the viewport.

The stylesheet and screen changes are on the working diff over `7dc163f`. Review blobs are `a4f585611e45` for CSS, `8398bde0be0f` for the shared layout, `14efa080bd3e` for trip creation, `d8d099c8534c` for the dashboard, `de93c2f7579c` for the picker, and `7bbd3b625edd` for the address browser test.

Node 24 lint, typecheck, the production build, 461 unit tests, and all 27 Chromium workflows passed. The browser run used the designated PostgreSQL test database and the offline fixture provider. Student inspection is pending.

### Local departure entry

The student asked for a calendar date, ordinary time and time zone in the create-trip form, with conversion to the backend timestamp format. Verify the UTC conversion, daylight-saving transitions and existing create and retry workflows. Student inspection is pending.

Trip creation sends the resolved UTC instant through the existing create-trip normalizer and pending-operation workflow. The time-zone list puts common U.S. zones and UTC first, followed by the browser’s other IANA zones. The form blocks skipped clock times and offers both UTC instants for repeated times. Source blobs are `98c3a2351528` for the form and `1bf34c244a31` for conversion.

Lint, typecheck and all 469 unit tests passed. The production Chromium suite passed 26 unrelated workflows in the full run. The new clock-change case passed on a focused production rerun after scoping its alert selector to the departure form. It verifies that there is no POST in the spring gap and that selecting the second occurrence in the fall persists the expected UTC instant. The browser used the local test database and fixture provider.

### Trip dashboard loading after creation

The student reported that creating a trip redirected to a dashboard that stayed on its loading state. Investigate the local development load, repair the browser read sequencing, and verify the existing trip creation and recovery workflows. Student inspection is pending.

The running development server reproduced the stuck dashboard on an existing local trip. Chromium recorded four successful snapshot responses and the loading message stayed visible. React replayed the mount effects in development. The effect that copied the rendered generation into the ref reset the counter between starts, so the reducer saw four starts while the requests reused the first two generations.

The dashboard now allocates monotonically increasing read generations and handles the initial fetch in the mount effect. The separate refresh effect runs when a newer version invalidates the snapshot. Only the latest request can change the load error. On the same development server and saved trip, Chromium observed two successful responses, a visible dashboard, and no loading message. The check read the existing trip without writing demo data. The dashboard diff is blob `9597a4191e22` and the browser regression is `1dc4442ce9a6`.

On Node 24, lint, typecheck, 469 unit tests and all 28 Chromium workflows passed. The production browser regression creates a fixture trip and verifies that its initial snapshot replaces the loading state after one GET. The production suite also covers trip registration, stale previews, lost responses and UTC departure conversion. Student inspection remains pending.

### Clear a carpool plan

The student requested a way to clear the current plan and asked why the preview displays a version number. Add a version-checked clear action for saved plans and allow the organizer to discard an unsaved preview. Keep the roster intact, preserve same-key recovery, and hide internal version numbers from the organizer view. Student inspection is pending.

The clear action uses the existing plan invalidation transaction and keyed receipts. Its version check prevents a clear prepared for one plan from removing a replacement. Discarding a preview only dismisses it in the browser. The dashboard leaves version markers available for automated checks while the organizer sees readiness text. The service is blob `6c1b97870be9`, route `92018a38b665`, dashboard `ebbc6c76ea79`, and browser regression `c06f725ff46a`.

Lint, typecheck, the production build, 71 matching tests, 469 unit tests and all 29 Chromium workflows passed. The new browser check discards a preview, dismisses and accepts the clear confirmation, reloads with the roster intact, saves a replacement, and verifies that a same-key replay and a stale new-key request leave that replacement intact. The browser used the designated PostgreSQL test database. Student inspection remains pending.

### Edit registered participants

The student asked to edit driver and passenger details. Add roster forms for names, zones or selected addresses, driver seats, and address driver detour limits. Use the existing version check and keyed mutations, preserve unchanged registrations, and verify plan invalidation and persistence in both location modes. Student inspection is pending.

The edit forms show the current registration and ask for a signed replacement only when the organizer chooses to change an address. The service uses the existing participant PATCH routes, validates the editable fields and version, and matches a replacement token to the trip, provider, and participant role. The repository updates the original participant row. A saved plan stays in place when the submitted details match the stored details. An effective change invalidates the plan through the existing roster mutation path.

Review blobs are `ae35ab6386ca` (contracts), `3c5fa6e715ca` (service), `96400a52da8c` (repository), `0dbfdf99ff66` (organizer page), `09458bdd54de` (address browser tests), and `b7d671100902` (zone browser tests).

Lint, typecheck, the production build, 71 matching tests, 469 unit tests, 73 focused PostgreSQL integration tests and all 31 Chromium workflows passed. The new browser tests verify zone and address edits, address retention during a name change, roster persistence after reload, and saved-plan invalidation only on an effective change. Verification used the designated test database and fixture or loopback data. Student inspection remains pending.

### Seat changes through Edit driver

The student asked to remove the Reduce capacity shortcut now that Edit driver supports changing seats. Update the browser workflow and walkthrough to use the edit form. Student inspection is pending.

The dashboard now uses the Edit driver form for seat changes. The workflow reduces the seat count from two to one, confirms the saved plan clears, and saves a replacement with one matched passenger. Lint, typecheck, the production build, and both focused Chromium workflows passed.

### Active dashboard rosters

The student asked why canceled drivers and withdrawn passengers remain visible. Inspect the source of those rows and hide inactive registrations from the organizer’s roster. Verify that the dashboard stays clear after reload and that a replay does not restore a withdrawn passenger. Student inspection is pending.

The dashboard previously rendered all registrations returned by the server. Cancellation and withdrawal mark the registrations inactive in PostgreSQL. The roster now renders only active rows and shows an empty state when none are active. The snapshot API still returns inactive records for the existing read contract, and matching excludes them. Dashboard blob `ee0c43a9536f` and browser tests `cac6847532a0` passed lint, typecheck, the production build, and both focused Chromium workflows. The tests verify immediate removal from view, reload, and receipt replay.

### Driver cards in carpool plans

The student asked for plan cards titled by driver with passenger rows beneath. Use the same layout in the preview and saved plan, retain per-passenger costs and unassigned riders, and verify grouping and reload. Student inspection is pending.

The preview and saved plan share a responsive grid of cards. Each active driver has a card with filled seats and a passenger list with individual costs. Drivers without riders show an empty card. The unassigned list remains below the cards. Review blobs are `2ed116bbdb19` for the dashboard, `cbcb3d0f437b` for styles, `12df51ef70a8` for zone workflows, and `735701b00984` for address workflows.

Lint, typecheck, the production build and all 33 Chromium workflows passed on Node 24. The new browser regression verifies multiple passenger rows, individual driver groupings, an empty card, an unassigned passenger, and the same plan after reload in a 390 px viewport.

### Compact color-coded participant rows

The student requested compact, color-coded driver and passenger rows for larger rosters. Keep the two labeled rosters, participant actions, and driver cards. Verify that short entries fit on one row and longer entries and actions can wrap at phone widths. Student inspection is pending.

Drivers use green rows and passengers use blue rows. The text headings and action labels identify roles independently of color. Short roster entries fit on one line at desktop widths and can wrap on phones. Plan cards use the same colors with more compact headers and passenger rows. Review blobs are `a0f380f6678d` for the dashboard, `a2fb736c9375` for CSS, and `0b19eb935bff` for browser assertions.

The first browser run found that the compact row refactor disabled Cancel when tab storage was blocked. The affected workflow expects the existing feedback and zero requests. Restored the existing action state and reran verification.

Lint, typecheck, the production build, and all 33 Chromium workflows passed on the final revision. The layout check covers compact rows and distinct role colors on desktop, driver cards after reload, and a 68-character passenger name at 390 px without horizontal overflow.

### Shareable trip invitations

The student asked for shareable invite links that let guests register themselves as a driver or passenger. Add a separate guest page and scoped registration and address search. Verify both trip modes, receipt recovery and the separation between the public invitation and organizer data. Student inspection is pending.

Migration 004 adds a separate random invitation ID to every trip. The organizer can copy a guest link, and guests can register with either role. The guest view exposes the trip name, destination, and departure. Its address selections bind to the invitation ID. Guest registration shares the roster limits, locking, and same-key recovery of the organizer workflow.

Review blobs are `966e503b94a3` for the migration, `048dd95a0ab8` for the trip service, `1f00f8127862` for search, `c5613f8cb7ae` for guest registration, and `6cb7f4fbc91b` for the browser tests. The additive migration succeeded on the local demo database. A browser opened the existing trip’s invitation page on port 3000 and confirmed that the organizer ID was absent from the guest page. That check submitted no demo registrations.

Lint, typecheck, the production build, 2 setup tests, 469 unit tests, the database test, 289 PostgreSQL concurrency tests, and 35 Chromium workflows passed. The initial concurrency run caught three assertions that pinned the old migration history and snapshot keys. Updated the expectations and used the W6 upgrade fixture to verify a distinct invite ID is added to an existing trip. The full concurrency rerun passed. Chromium verified both registration roles in both trip modes, the guest token scope, an invalid link, the organizer preview, and exact-key retry following a lost response. External hosting and student inspection remain pending.

### Automated invitation demo

The student asked for a script that creates a trip, shares its invitation, and onboards fictional drivers and passengers. Drive the organizer and guest browser interfaces, verify the saved plan, and preserve existing trips. Simulate delivery by opening the link in each guest session. Student inspection is pending.

#### Headed demo reload correction

The student reported that the headed invitation demo opened Chromium and repeatedly refreshed without completing. Reproduce the navigation loop on the local development server and verify that the guided run reaches its saved plan. Student inspection is pending.

Chromium reproduced repeated main-frame navigations even without request interception. The Next development socket sent `reloadPage` with `HMR hash mismatch`. Closing the socket stabilized the form but the full headed submission still stalled. The Webpack development probe failed on a browser import of `node:crypto`. The demo documentation now starts a production build on the existing database, and the script reports its stages, checks the landing response, and brings the organizer tab forward.

The production build passed, and the headed demo ran on port 3000. It registered both drivers and all three passengers, saved and reloaded the plan with two matches and one unassigned rider, and displayed the Enter-to-close prompt. Lint and whitespace checks passed. The script is blob `df1b8ab4ec3c`. The Next development problem is tracked separately as ISSUE-093.

#### Fictional address invitation demo

The student requested an address-mode walkthrough with fictional places. Change venue and guest registration to use the fixture picker, verify the provider before issuing any address search, and check the saved detour totals after reload. Student inspection is pending.

The demo now uses the fixture Event Hall and confirms named pickup and driver addresses through the same organizer and guest pickers as a manual run. A non-cacheable health header identifies the configured address provider while preserving the existing readiness JSON. The script requires the header to indicate fixture before launching Chromium or making an address search.

Lint, typecheck, the production build and the end-to-end demo passed against the local production app. The old build without the provider header was rejected before search. The updated build registered both drivers and all three passengers, saved and reloaded Brooke with Dana at 64 seconds and Alex with Eli at 18 seconds, and left Casey unassigned. Fixture attribution and the 82-second total were verified. The walkthrough used zero live provider requests.

### Manual plan editing deferral

The student requested an estimate for moving passengers between drivers and an Unassigned area, recalculating the pickup costs of the chosen assignments, and saving the adjusted preview. The student then asked to commit the current project and defer that feature.

### Guest self-withdrawal

The student requested that participants who register through an invite be able to leave on their own. Give new guest registrations a private link and reuse the existing withdrawal, plan invalidation, and same-key recovery rules. Verify that the shared invite alone grants no removal access. Student inspection is pending.

New guest registrations return a private link in their keyed receipt. PostgreSQL stores a token hash. The leave route checks the trip, role and token under the trip lock and marks only that registration inactive. A successful departure invalidates the saved plan. Repeating the departure has no effect on the trip version.

Migration 005 applied to the local demo without a reset. The production suite passed all 36 Chromium workflows and the final guest form passed the three focused invite workflows. Matching passed 71 tests and unit passed 469. The database smoke test and 65 focused PostgreSQL tests passed. The new browser test verifies both roles, rejection without the private token, saved-plan invalidation and recovery after a lost response. Review blobs are `c31c86f5fe84` (migration), `686a4c9e0066` (service), `5160cb570bc7` (guest form) and `a29ce9a80647` (browser test).

### Private registration workflow review

On the working tree over `d6f9b8a`, a targeted Chromium review used the existing production build, separate organizer and guest browser sessions, and a new fictional zone trip on the designated test database. The driver and passenger joined through the public invite, and the organizer saved a plan with both participants.

- Interrupt the passenger's leave request before dispatch. In the same guest tab, open the driver's private link, reload, and choose **Retry leaving**. The page reports **You left the trip**. The organizer's next read shows the passenger gone and the driver still active. The guest form restores a pending operation by invite and action without matching the private registration (ISSUE-098).
- Reopen the departed passenger's saved private link. It offers **Leave trip** again. The form determines the management view from the URL fragment and never looks up the registration or its assignment (ISSUE-099).
- Keep the organizer dashboard open throughout the departure. Five seconds later it still shows **Plan saved** at the original version. Reloading shows **No active passengers** and **Needs a new plan**. The dashboard reads on mount and after local actions, with no refresh triggered by another guest's change (ISSUE-100).

The targeted review used no database reset or live routing. The full suite was not rerun.

### Private registration workflow corrections

The student asked to correct ISSUE-098–100. Bind leave recovery to its exact private link, show the returning guest’s current status from the server, and refresh the visible organizer dashboard after changes from another browser. Preserve the join-only shared invitation. Student inspection is pending.

Leave retry now requires the invite route, role and token to match the current private link. A late receipt settles only its own stored operation and cannot present a success or error on a different registration. A read-only status request reports whether the guest has left, awaits a saved plan, or has a current saved assignment. Drivers get the count of their own assigned passengers. The organizer polls every two seconds while the tab is visible and uses the same version-aware snapshot reducer.

The Chromium regression interrupts a passenger’s leave before dispatch, opens the driver’s private link in the same tab, and confirms that no retry appears and both participants remain registered. It then retries on the passenger’s link and loses the committed response, recovers with the same key, and reopens the saved link to confirm the left status. It also checks waiting and saved states for both roles and observes the organizer’s roster and plan update without changing the document time origin. Review blobs are `6d9ca1212b4f` (guest form), `6257d66fc3ba` (dashboard), `b888a15e0463` (service), and `94622cbc0ebf` (Chromium regression).

The production build, lint and typecheck passed. The full Chromium suite passed 36 workflows, and the final change to read status while awaiting a matching retry passed all three invite workflows. The database smoke test and all 289 PostgreSQL concurrency tests passed. Matching passed 71 tests and unit passed 469. Verification used fictional data and zero live provider calls. Independent verification remains pending.

### Independent review of private registration corrections

Reviewed the uncommitted guest changes over `d6f9b8a`. The inspected migration, guest form, organizer dashboard, trip service and browser regression match the blobs above. On Node v24.22.3, lint, typecheck, the database smoke test, all 289 PostgreSQL integration cases, and all 36 Chromium cases against a fresh production build passed. Matching passed 71 cases and unit passed 469. The private registration browser case confirmed retry scoping, guest status and the organizer update without navigation. A separate local probe confirmed that both private actions reject cross-site requests with 403 and that a token from one trip gets 404 for status and leave on a different trip. Used fictional trips in `groupride_test` and the fixture provider.

- **ISSUE-101.** Open the organizer's driver editor and type an unsaved name. Leave as a passenger from a separate Chromium context. Once the organizer sees the passenger disappear, the driver's edit form is gone and the original name is back on the roster. The document time origin is unchanged and no edit was submitted. Polling installs the newer trip version, and the editor is mounted only while its original version equals the current one. Preserve the draft and surface the conflict while retaining the original version check on save. [Polling and edit form](../src/app/trips/[tripId]/page.tsx)
- **ISSUE-102.** Chromium inspected a terminal 201 registration response with the pre-005 receipt shape, produced by omitting `leaveToken` from a successful fixture registration response. The page reported that registration was saved and returned to an enabled **Join as passenger** form. The previous release's receipts have this shape, and exact-key replay returns the stored body. Keep a confirmed registration in a completed view even when the old receipt cannot provide a private link. [Guest response handling](../src/app/join/[inviteId]/JoinForm.tsx)

The three original corrections were independently reproduced. Polling signoff for an organizer with an open participant edit remains pending under ISSUE-101. Student inspection is pending.

### Organizer draft and legacy registration corrections

The student asked for fixes to ISSUE-101 and ISSUE-102. Preserve an open participant draft during visible dashboard polling and stale-version recovery. Show completion for older successful guest receipts without private links. Student inspection is pending.

The organizer editor stays mounted while snapshots refresh. A newer trip version pauses saving until the organizer reviews the latest participant details and chooses **Keep draft**. The keyed save uses the reviewed version and the existing server-side check. An applied invite receipt without a private token shows **You’re registered** and directs the guest to the organizer for help leaving.

The browser regressions use a separate guest session to trigger a roster update and preserve a driver’s unsaved name and seats. A second writer commits immediately before the organizer PATCH, exercising the real stale response and a subsequent successful save. For the legacy receipt case, the first registration commits with a lost response. After reload, the same-key replay reaches PostgreSQL, Chromium receives the older response shape, and the roster still has one registration. [Browser regressions](../tests/e2e/invite-leave.spec.ts)

On the working diff over `d6f9b8a`, lint, typecheck, matching (71), unit (469), and all 38 Chromium workflows passed. Chromium built and started the production server against the designated PostgreSQL test database with the fixture provider. The PostgreSQL concurrency suite remains covered by the preceding independent run. Review blobs are `fd339a93c838` (dashboard), `9ce452e74a02` (guest form), and `c2f0228ca675` (browser regressions).

### Guest workflow correction review

On the working diff over `d6f9b8a`, all five invitation Chromium workflows passed against a fresh production build and the designated PostgreSQL test database. They covered private-link retry scoping, status on return, organizer roster and plan updates without navigation, and draft preservation through a real competing update and rejected save. The legacy receipt test performed a real same-key replay and removed the token from the delivered response to reproduce the old wire format. The guest saw confirmation and the roster contained exactly one registration.

A separate Chromium timing probe reproduced ISSUE-103. Start a second guest registration from a shared invite. Hold its successful HTTP response after PostgreSQL commits. In the same tab switch to the first guest’s private link for that invite and wait for the management view, then release the reply. Session storage loses the pending request. Returning to the shared invite shows the join form with no retry, while the organizer’s roster already contains the second guest. The noncurrent-page success branch clears the key before delivering the new private link. Preserve recovery on the original invite and verify that replay delivers the link with exactly one registration. [Guest reply handling](../src/app/join/[inviteId]/JoinForm.tsx)

### Late guest registration reply correction

The student asked to fix ISSUE-103. Keep a successfully applied registration recoverable when its response arrives while a different private link is open. Use the original request key on the shared invite to recover the receipt. Student inspection is pending.

The browser retains a successful off-page registration in its existing pending slot until the guest returns to the shared invite and receives the confirmation. The late response leaves the open private registration unchanged. The new Chromium regression holds a committed passenger response while the driver’s link is open, waits for the reply to finish there, then returns to the shared invite and reloads. Before the fix, the test failed because **Retry registration** was absent. The test verifies that replay uses the original key and shows the exact private link from the committed receipt, with one passenger registration in PostgreSQL. [Browser regression](../tests/e2e/invite-leave.spec.ts)

On the working diff over `d6f9b8a`, lint, typecheck, and all 39 Chromium workflows passed against a fresh production build and the designated PostgreSQL test database. Chromium used the fixture provider. The separate PostgreSQL concurrency suite was not rerun for this browser change. Review blobs are `c84441aa4ba4` (guest form) and `13ca7c20b6d9` (browser regression).

Independent review of the two recorded blobs reran both invitation spec files against a fresh production build and the designated PostgreSQL database. All six Chromium workflows passed. The delayed-response case verified that the driver’s private link stayed open, the shared invite restored the passenger’s retry after reload, and the retry used the first request’s key and returned its exact private link. The organizer’s roster contained exactly one passenger before and after replay. ISSUE-103 is technically closed. Student inspection remains pending.

### Adversarial matching correctness review

The student asked for an explanation and adversarial review of lowest-cost matching. On `3b3b65b`, all 71 matching tests passed. A separate matrix enumerator bypassed the production cost lookup and checked all 64 assignments for each of 157,464 instances. These cover every three-driver, three-passenger matrix with cells absent, zero or one, and all combinations of driver capacities one and two. Both objective values agreed in every case, and all returned plans passed feasibility. A separate sparse case with 20 drivers and 50 passengers required reassigning 19 riders to reach 20 matches and cost 20. It passed.

**ISSUE-104.** With fictional directed leg seconds of 0.5, 0.25, and 0.25000000000000006 for driver to pickup, pickup to venue, and driver to venue, respectively, the computed difference is 0.49999999999999994. The documented nearest-second rule and the test reference yield zero. Production adds 0.5 before taking the floor, which rounds the intermediate sum to 1 in floating point. A direct projection produced no edge at a zero-minute limit and a one-second edge at a one-minute limit. This is a discrepancy in the input to the solver. No live provider frequency was measured. Application code was unchanged and student inspection is pending. [Projection](../src/matching/address.ts) · [Independent reference](../tests/matching/address-reference.ts)

### Route-based pickup cost proposal

On 2026-11-26 the student asked Claude Code to revise the matcher design. The goal was to account for passengers who share an address or live near each other in the same car, and to use those costs when choosing the plan. This was a documentation episode only. No application code, tests or schema changed.

The student made these decisions during the discussion:

- A driver should be charged only for the actual extra time needed to pick up the passengers in their car.
- The matcher should optimize using that combined cost.
- Larger trips must remain supported.
- Where optimality cannot be proven, plans should carry labels that distinguish proven plans from best-found plans.

The student also supplied review comments on an intermediate shared-address design. These covered:

- a canonical cost matrix shared by both solve phases;
- the `y ≤ x` stop constraint;
- a separate result version and Save → reload check;
- treating solver runtime as an experiment;
- a retryable failure on timeout;
- corrections to the multi-stop credit estimate and coverage argument.

The resulting design is [section 12](ARCHITECTURE-v2.md#12-proposed-route-based-pickup-cost) of the address architecture. ISSUE-105 to ISSUE-108 record the open decision, benchmark, credit budget and evidence-keying work.

One correction to the earlier discussion: the design offers a "within X minutes" cost guarantee only when every route was enumerated. Otherwise the label says the plan is not verified as cheapest.

Checks: section anchors and new repository links were verified to resolve. The hand-computed fixture arithmetic in section 12.7 was rechecked by enumeration. No build or test was run because no code changed. The student has not yet reviewed the written design.

### Technical review of route-cost bounds

The student requested a technical review of section 12 before implementation. For a frozen matrix, a validated plan placing N passengers at cost U establishes an upper bound U on the minimum estimated cost at exactly N placements. If maximum coverage is unresolved, a higher-coverage plan can cost more than U. A gap needs a valid lower bound at that same coverage. Zero is always valid for nonnegative costs. A restricted route list can produce feasible plans but its minimization bound alone gives no global lower bound. RT-07 needs to enumerate the optimum at the returned coverage and test coverage separately. Keep the best validated solution from each phase and cap candidate sets examined as well as feasible columns emitted.

The existing matrix planner was exercised offline with 50 distinct fictional pickups and all 2,450 directed off-diagonal pairs. It produced 50 one-by-49 requests costing 2,450 base credits for the second round, or 3,020 including the proposed 570 for the first. The four-block alternative needs a planner that can deliberately include diagonal cells and discard those results. Neither figure includes surcharges or retries. No provider calls or application edits were made. The written design and the limit migration still await a student decision.

### Route-cost proposal revision 2

The student asked Claude Code to address the bounds review above. The student also stated that API credits are the main concern: one plan generation should not consume a heavy share of the 3,000 daily credits. The student proposed running the existing solver and then pricing each driver's actual route. This was a documentation episode only. Section 12 was revised as follows:

- **Labels.** Every plan reports passengers placed and estimated total detour. Coverage proof and cost proof are separate, and cost claims are scoped to N passengers. A "within X" gap appears only with a lower bound from a complete route enumeration, rounded up to whole minutes.
- **Solver.** The best validated plan is kept across all stages. Work budgets count candidate sets examined. Enumeration and repair share the preview deadline.
- **Limits.** The subset rule is withdrawn. Rule 2 (each pickup must fit the limit on its own) is now an explicit product decision. "Coverage can only fall" is qualified to the same canonical matrix, and the new limit meaning is shown to organizers and drivers.
- **Saved plans.** Validation recomputes the stored pickup sequence's cost and compares it with both the stored cost and the best-order cost. RT-08 now separates a committed replay from an unsaved old preview, which the existing `ALGORITHM_CHANGED` guard rejects.
- **Oracle.** It returns the minimum cost at each passenger count, correcting RT-07.
- **Credits.** Credits are predicted before dispatch, using square-block batching, and checked against a route-pricing allowance. Full mode is used when affordable. Otherwise economy mode applies, built on the student's proposal: it starts from the existing flow plan, regroups using zero-credit straight-line approximations calibrated from round-1 road times, fetches only each chosen car's k×k block, then prices and repairs.

Economy mode is needed because pricing the flow plan alone keeps per-pair groupings: RT-01 would report the 10-minute split instead of the 7-minute pair.

Checks, run offline in a scratch script:

- RT-01 to RT-05 were rechecked by brute-force enumeration under rules 1–3, giving minimum cost per passenger count: RT-01 {1: 4, 2: 7} min, RT-02 {1: 5, 2: 12}, RT-03 {1: 5}, RT-04 4 before and after the withdrawal, RT-05 {1: 3, 2: 7}.
- The RT-10 repair outcome is (2 placed, 12 min).
- The credit table was computed with the documented formula: 63, 111 + 150, 570, 1,000, 388 and 250.
- New anchors resolve.

No code, build or provider call was involved. Allowance figures are predictions, not measurements. The student has not reviewed revision 2.

### Reuse extension design proposal

On 2026-11-26 the student asked Claude Code for a thorough design to reduce Geoapify credits by storing known places and driving times. The student expects trips to repeat locations. Earlier in the discussion, the student made these decisions:

- cost is the current priority;
- the route-based matcher redesign (section 12) is not being pursued now;
- storing places and times is worth pursuing.

The student also pointed out that the stored data need not link a person to an address.

This was a documentation episode only; no application code, schema or tests changed. The design is [section 13](ARCHITECTURE-v2.md#13-proposed-reuse-of-known-places-and-driving-times).

Claude Code drafted revision 1 after reading the search, selection, invite, routing-evidence, permit and reset code. An independent reviewer agent then checked revision 1 against the code without being told the expected conclusions, and reported 11 defects. Claude Code spot-checked the central claims in the code before revising:

- `summarySchema` is strict, and the partition check covers only `fetched + reused + local`.
- `needsLive` considers only ID and identical-coordinate matches.
- The routing permit is keyed by trip.
- `geoapify.ts` checks the abort signal before reporting observations.
- Invite registration verifies tokens against the invite ID.
- Reset uses a try-lock and refuses connected sessions.

Revision 2 resolves all 11 defects (V1–V11 in section 13.11). The most important change is that a trip ID is no longer treated as an organizer credential. All reuse is scoped to a workspace cookie, because anyone who can reach the server can create a trip and would otherwise list saved participant addresses or probe routing history.

Checks: the new anchors resolve, and the credit figures reuse the formula verified in the previous entry. No build, test or provider call was run. Revision 2 has not been independently re-reviewed, and the student has not reviewed it. ISSUE-109 to ISSUE-112 record the open decisions, measurements and privacy follow-up.

### Technical review of reuse revision 2

Reviewed section 13 against the existing trip, search, evidence, matrix and reset code. In an offline probe of the current matrix planner, 16 drivers needed the same final 20 pickups and four drivers needed all 50. The existing trip-local pickup batches cost 400 base credits. Resolving a different cell in each driver row from the workspace made the residual batches cost 500. A single covering rectangle also cost 500. Include the original trip-local batch plan among the alternatives and scope the guarantee to predicted base credits. The probe used fictional coordinates and no provider calls.

Before C1, bind shared-cache reads, writes and provenance display to verified workspace ownership on the requested trip. Frozen ID-keyed evidence, caches shared by coordinate, and billed physical cells need distinct accounting. Before C2, require saved candidates to pass the numbered-address and locality checks before issuing fresh tokens. Before C3, define pass expiry on lookup, recovery after failed registration, and browser/server deletion on failed Forget. The review covers the proposed contracts; no application implementation or student approval was recorded.

### Reuse design revision 3

The student asked Claude Code to revise section 13 to address the technical review of revision 2. This was a documentation episode only; no code, schema or tests changed.

Claude Code first confirmed the review's code claims:

- The evidence validator caps durations at 1,000,000 seconds and 1,100 legs.
- Stored snapshots combine house number and street in one line.
- The wrong-building filter in `geoapify.ts` operates on structured provider fields.

It also re-derived the counterexample with the documented formula: today's plan costs 400 (a 16×20 request plus a 4×50 request); the residual plan costs 500 (sixteen 1×19 requests plus four 1×49 requests); the covering plan costs 500. The 49→50 passenger case costs 21.

Revision 3 ([section 13](ARCHITECTURE-v2.md#13-proposed-reuse-of-known-places-and-driving-times), W1–W12) makes these changes:

- **Ownership.** The store is read and written only when the requester's session owns the trip, and provenance is redacted for non-owners on previews, stored winners and saved dashboards.
- **Credits.** Today's request plan is always a candidate, so predicted base credits never exceed today's.
- **Saved places.** Free text never yields a token. Saved places are selected by ID, and existing house-number and locality rules decide only whether a provider search is withheld.
- **Provenance.** Per-leg origins go in evidence version 3, so commit can detect a shifted count. Physical cells and predicted credits are recorded separately.
- **Retention.** Freshness and deletion ages are separate, with a global purge, a 1,000,000-second ceiling and repair of future-dated rows.
- **Generation.** The dataset generation is captured and compared inside every delayed write.
- **Passes.** Explicit lifecycle states, a default of off, and a test that no secret reaches logs or spans.
- **Workspaces.** Established before any write, serialized across tabs, with ownership fixed in the trip transaction, and sessions that support rotation and revocation.

Checks: the section 13 and EVIDENCE anchors resolve, and the four credit figures above were recomputed. No build, test or provider call was run. ISSUE-113 is set to needs verification, pending an independent review of revision 3. The student has not reviewed revision 3. The proposed defaults (30-day freshness, a 180-day pass, and passes off by default) await the ISSUE-109 and ISSUE-112 decisions.

### Independent technical review of reuse revision 3

Reviewed the proposed contracts against the current matrix batcher, evidence and summary validators, preview publication, commit guard and selection scope. Ran two offline Node 24 probes against the repository's `matrixBatches` with fictional points. Section 13 has no implementation to exercise. No application suite, database operation or provider request ran in this review.

- **Predicted credits (SC-04).** P0 in 13.7 runs after the new trip-local coordinate lookup. Today's planner only reuses ID-keyed evidence and resolves identical endpoints. The difference matters even with an empty workspace store. In a 20×50 roster, let 16 existing drivers already have ID-keyed observations for the first 30 pickups. In four groups of four they also retain coordinates for the next one, two, three or four pickups respectively, now registered under fresh IDs. Such partial rows can be retained as drivers successively reduce capacity to zero and later restore it. Four new drivers have no observations. Today's pickup batches are 16×20 and 4×50, plus 24×1 to the venue, costing **424** base credits. Applying coordinate reuse first yields pickup batches 4×19, 4×18, 4×17, 4×16 and 4×50, plus 20×1 to the venue, costing **500**. A single covering rectangle for the pickup family plus the venue batch costs **520**. Include the actual pre-extension dispatch plan independently of both new sources of reuse. Apply evidence precedence when consuming its response.
- **Summary validation (SC-03).** A fresh driver and two distinct passenger IDs at one pickup produced five logical provider legs but three requested cells (1×1 and 2×1). The proposed lower bound of five would reject a valid preview at Save. Count physical cells from dispatched rectangles and logical legs from required ID pairs. Use this cold case for publication, Save and reload. Classify carried identical-endpoint zeros consistently as local so a reused zero never implies a provider observation timestamp.
- **Privacy through rematches (SC-02).** A stored estimate from last week has origin `store` when the owner first uses it and origin `trip` when a later preview inherits it by ID. The redacted range then includes last week's timestamp, even if this trip was created today. Even the first preview's merged reuse count and empty redacted range can disclose reuse. Use a non-owner response that omits observation and acquisition metadata on previews and saved dashboards, or track original provenance across generations and specify exactly what a non-owner may infer. Exercise at least two trip versions.
- **Upgrade and selection.** SC-03 promises that a v2 preview can still be committed. The algorithm identifier embeds the evidence schema, and the current commit guard rejects a different identifier before reading evidence. Specify the accepted schema/algorithm/policy combinations and preserve the preview's actual identifier on Save. Test an unsaved v2 preview across the upgrade as well as replay of a completed receipt. For SC-11, select-by-ID resolves the `12` versus `112` token defect. Separate the workspace-only venue selection before a trip exists from participant selection on an owned trip. Require any supplied locality to agree before a saved venue name suppresses a paid search.
- **Retention scope.** The proposed deletion ages concern reuse tables. Frozen trip evidence and attached addresses have separate existing retention. Global deletion in bounded batches at startup or on writes also gives eventual cleanup, with no hard deletion date while the server is idle. Specify the scope and any required cleanup schedule before the owner decides ISSUE-109/112.

ISSUE-113 remains open for design corrections. Owner-only store access, explicit saved-place selection, generation checks on delayed writes and expiry checks before renewing passes are implementable using the current architecture. SC-13 and SC-14 can proceed independently. No owner decision or implementation signoff was inferred.

### Reuse design revision 4

The student asked Claude Code to address the four remaining gaps in the independent review of revision 3. This was a documentation episode only; no code, schema or tests changed.

Claude Code confirmed the upgrade finding in the code:

- `expectedAlgorithm` builds the address identifier from the solver, the evidence schema and the routing policy.
- Save rejects any preview whose identifier differs (`src/trips/commit.ts`).
- Save records the current identifier rather than the preview's own.

It also checked the shared-address arithmetic: one driver and two co-located passengers need 5 required legs (keyed by location ID) but 3 coordinate-deduplicated cells. The 424-versus-500/520 coordinate-reuse counterexample is taken from the reviewer's offline probe and was not re-derived here.

Revision 4 ([section 13](ARCHITECTURE-v2.md#13-proposed-reuse-of-known-places-and-driving-times), X1–X6) makes these changes:

- **Credits.** The guaranteed plan P0 is computed by today's rules alone, before coordinate or store reuse.
- **Validation.** Physical request metrics are recorded as dispatched shapes and validated only against the credit formula, with no rule relating cells to fetched legs. A cold shared-address round trip is added as SC-16.
- **Non-owners.** They see the plan, detours and attribution, but no origin counts, request or credit metrics, or observation dates, on any trip version, stored winner or saved plan. SC-02 now spans two versions and a reload.
- **Upgrade.** A committable-identifier set keeps version-2 previews saveable after the upgrade, and Save records the preview's own identifier. SC-03 exercises a real pending preview across the upgrade.
- **Smaller changes.** Saved venues can be selected before a trip exists. A supplied locality must match before a saved name withholds the provider. Deletion ages are stated to cover only the reuse tables, with no fixed date while the app is idle.

Checks: the new anchors resolve. No build, test or provider call was run. ISSUE-113 is set to needs verification, pending an independent review of revision 4. The student has not reviewed revision 4.

### Independent technical review of reuse revision 4

Reviewed X1–X6 against the proposed migration and the current batcher, commit path, summary serializer, venue-token scope and locality matcher. An offline Node 24 probe called the repository functions with fictional inputs. SC-02, SC-03, SC-04 and SC-16 are proposed acceptance checks for the feature. No database, provider, build or browser run was part of this review.

| Item | Review result |
|---|---|
| X1 · Credit bound | Recomputed P0/P1/P2 as 400/500/500 for scattered store hits and 424/500/520 for coordinate-only hits, using the revision-3 review roster. Both now choose P0. Including the pre-extension batches in the same minimum establishes the predicted base-credit bound for the same input and available ID-keyed evidence, including any eligible permit handoff. |
| X2 · Shared pickup | The current batcher expanded three physical cells to five required ID-keyed legs. Recording the two rectangle shapes (1×1 and 2×1) yields three predicted base credits. The revised Save rule accepts that accounting. |
| X3 · Non-owner display | Omitting acquisition metadata closes the original two-version disclosure while the trip has an owner. The proposed migration at 13.5 uses `ON DELETE SET NULL` on the trip's workspace. After the 365-day workspace purge, an originally owned trip with retained store-derived evidence looks like a pre-feature trip under the ownerless exception in 13.3. Its saved plan can expose observation dates again. Preserve an immutable distinction for trips created before migration, or redact acquisition metadata on every ownerless trip. Extend SC-02 to expire the workspace of a saved trip, read its stored preview and dashboard, and compare with a genuine pre-feature trip. |
| X4 · Upgrade | The proposed allowlist matches the exact identifier emitted by today's code. Saving the preview's original identifier preserves the pending v2 workflow. An actual summary returned by the current serializer has **no** `version` property. Decode that legacy shape explicitly, and bind each accepted algorithm identifier to its own evidence and summary formats so a v3 row cannot opt into the weaker v2 check. Exercise the recorded pending-preview case using the unmodified legacy payload. |
| X5 · Venue selection | Null scope matches the existing venue creation path. The current locality helper rejected a saved Dallas venue for an Austin, TX locality and accepted an Austin venue with state Texas. The revised name rule defines the no-locality duplicate case and keeps selection explicit by ID. |
| X6 · Retention | The revised design separates reuse-table cleanup from retained trip data and discloses idle-server retention. The 1,000-row limit per table means the next startup or reuse write **starts** cleanup. A backlog may need several passes. |

ISSUE-113 remains open for the X3 workspace-deletion case. C0 measurements can proceed. The live-reuse and guest-pass decisions remain with the owner. No application behavior or proposal text changed during this review.

### Reuse implementation planning

The student requested implementation steps for section 13. The workplan now maps REUSE-0–REUSE-4 to code entry points, dependencies and observable acceptance checks. The architecture adopts the simpler ISSUE-113 rule from the revision 4 review. A verified workspace owner can see acquisition metadata. A pre-migration trip and a trip whose workspace was purged both retain the plan, detours and attribution. SC-02 covers both ownerless cases. ISSUE-113 awaits verification through the implemented preview and dashboard routes.

Documentation checks verified the workplan and handoff links, coverage of SC-01 through SC-16, and both ownerless-trip cases in SC-02. The working diff passed the whitespace check. REUSE-0 measurements, REUSE-1–REUSE-4 implementation and their runtime checks remain pending. ISSUE-109 governs live cross-trip retention and ISSUE-112 governs guest passes. Student inspection is pending. [Workplan steps](../WORKPLAN.md#implementation-steps-for-reusable-places-and-driving-times) · [Design review](#independent-technical-review-of-reuse-revision-4)

### Reuse checkpoint names and issue register audit

The reuse extension now uses REUSE-0 through REUSE-4. Earlier reuse design reviews used C0–C4 for these same five steps. Earlier address checkpoint C, its C1–C3 work items and the SC acceptance identifiers retain their original meanings.

The register contains 113 consecutive issue IDs. Recorded states are 97 closed, 14 open, one deferred (ISSUE-004) and one awaiting verification (ISSUE-113). The audit checked the IDs, states, evidence references and next actions against the current design and recorded reviews. Five older evaluation rows needed their evidence moved into the resolution column. The ISSUE-103 row now places the verified replay outcome there as well.

ISSUE-108 spans two proposals. REUSE-1.2 addresses new shared pickups and RT1 covers conflicting legacy observations. ISSUE-109 and ISSUE-112 still require owner decisions. ISSUE-110 still requires measurements. ISSUE-111 and ISSUE-113 require evidence from the implemented workspace and preview routes. The guest workflow fixes through ISSUE-103 have recorded verification in the code shipped in `5c42e9b`. The environment reports for ISSUE-001 and ISSUE-003 remain scoped to the restricted workspace. This was a records audit. Application suites, environment access and provider calls were outside its scope.

## Checkpoint D pilot preparation

The student asked Codex to proceed from committed C (`2b50353`). This episode covers D1 attribution on suggestions, previews and saved estimates, and preparing the Geoapify search path against fictional provider responses. Live L-19 measurements depend on the owner’s L-18 project and credit confirmation. Student inspection is pending.

**L-18 display check.** Production Chromium displayed linked Geoapify and OpenStreetMap credit and a fictional municipal source credit on suggestions, the preview, the saved plan and a reload. The disclosure was visible before typing. The browser made zero external requests. This test substitutes live-format provider metadata into fixture responses. [Browser case](../tests/e2e/address.spec.ts)

**L-19 rehearsal.** A counting loopback server accepted three autocomplete requests with the US filter and limit of five. Only the two participant searches carried the venue bias. Each query returned one selectable building after wrong-number, foreign, city-only and out-of-range answers were rejected. The real selection, registration and preview services produced one assignment costing 100 seconds after two matrix calls. With routing disabled, a seat reduction reused three legs, saved the plan, replayed the same key and reloaded the assigned dashboard. A subsequent search 429 blocked the routing adapter from sending another matrix call. These are observations with fictional data. [PostgreSQL rehearsal](../tests/concurrency/live-search.integration.test.ts)

**Verification on the working diff over `2b50353`.** Node 24 lint, typecheck and the production build passed. The npm scripts passed setup 2/2, matching 71/71, unit 443/443, database 1/1, concurrency 250/250 and Chromium 25/25. Relevant Git blob prefixes are `0a5f7de0c7fa` (search adapter), `3925450d3dcc` (shared limiter), `37a040b13009` (loopback rehearsal) and `493679ecb722` (browser checks).

**Live gate (L-18).** The owner confirmed a dedicated free/no-card project with 3,000 daily credits, a dashboard baseline of 0 used today, and a combined cap of 20 credits for the two small trips. The server can load the API key and its independent signing secret. The authorized L-19 run uses public buildings, fictional participants and one driver and passenger per region, followed by a disconnected seat reduction, rematch, commit, receipt replay and reload. Record the final provider dashboard reading separately from calculated usage.

### Austin and Seattle live pilot

The owner reported 0 credits used today before dispatch and approved up to 20 for two small trips. The local demo database initially lacked usable address generation state. The first attempt stopped before any provider dispatch. The normal additive `npm run db:migrate -- demo` completed, verified the zone dataset and preserved the existing demo data. Both trips ran through GroupRide’s search, registration, routing, publication and commit services on the D working diff over `2b50353`. Only fictional participant names and published building addresses were used.

| Region and local demo trip | Search latency for venue / driver / pickup | Cold preview latency | Directed live estimates in seconds, driver→pickup / pickup→venue / driver→venue |
|---|---|---|---|
| Austin · `1a4dfde7-f2eb-48aa-aca3-d2e1429f825f` | 802 / 524 / 577 ms | 973 ms | 51 / 376 / 427 |
| Seattle · `b0ff7968-6258-44aa-92d1-75a2d031c3b1` | 1,182 / 2,159 / 2,384 ms | 929 ms | 81 / 258 / 339 |

The run selected the first selectable building matching each planned street address, city and ZIP. All six selections had building precision and credited OpenStreetMap contributors. Each cold preview fetched three legs in two successful matrix requests and matched the passenger. The two routed legs summed exactly to the direct route in each case, giving zero incremental seconds. These are individual service latency observations. [Planned public buildings](ARCHITECTURE-v2.md#checkpoint-d-pilot-preparation)

For each trip the runner disabled routing, reduced the driver from two seats to one, and rematched. Each rematch reused all three legs and fetched zero. Both saves succeeded and retrying the same key returned the original receipt. Independent reads of the two preview rows per trip confirmed identical directed observations and timestamps. A fresh production server with routing off and the provider key disabled served both saved assignments to Chromium. Reload preserved the passenger–driver pair and the linked Geoapify and OpenStreetMap credits, with no external browser requests.

**Usage.** Six successful autocomplete requests plus four successful local matrix requests (1×1 and 2×1 for each city) give **12 calculated credits**. The returned distances incurred zero distance surcharges. The owner reported 0 credits both before the run and on the first post-run check. The pilot finished around 8:54 p.m. Central on November 24 (02:54 UTC on November 25). On November 25 the owner confirmed the pilot total of 12 credits, matching the calculation. [Technical closeout](#checkpoint-d-technical-closeout) [MyProjects usage statistics](https://myprojects.geoapify.com/help/) The larger Austin group run was outside this two-trip budget authorization. [Autocomplete pricing](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/) · [Matrix pricing](https://apidocs.geoapify.com/docs/route-matrix/)

### Checkpoint D technical review

Independent review covered the working diff over `2b50353`, including all four untracked files. Lint and typecheck passed. The D PostgreSQL rehearsal passed (1/1), and a clean copy of the tracked and untracked source built and passed the L-18 Chromium workflow (1/1). The full-suite counts above are the implementer's results. All additional probes used fictional provider replies or read-only inspection of the two documented pilot trips.

The built search and preview HTTP routes shared a cooldown in both directions. After a search 429, the next cold preview returned 503 `ROUTING_QUOTA` with a nine-second retry hint and zero matrix dispatches. In a fresh process, a matrix 429 stopped the next search with 503 `ADDRESS_PROVIDER_UNAVAILABLE` and the same hint. Read-only demo database queries confirmed one saved assignment at zero additional seconds and one applied save receipt per trip. Within each trip the rematch preserved all three leg records, including timestamps. The new review spent zero provider credits.

| Finding | Independent observation | Verification needed for closure |
|---|---|---|
| ISSUE-083 | A synthetic autocomplete request through the installed Next.js 16.4.6 fetch wrapper and an in-memory tracing provider put the dummy API key, query and venue bias in both the span name and the `http.url` attribute. The probe used no external collector. | Check both provider transports with recording enabled and assert that credentials, query and coordinates stay out of recorded spans and fetch logs. |
| ISSUE-084 | The real search service received stub buildings numbered `12`, `12 1/2` and `99`. An ordinary `12 Example Street` query signed only the exact building. A `12 1/2 Example Street` query also signed only number 12. With `Example Hall, 12 Example Street` it signed all three. | Assert the correct signed candidate and reject incompatible numbers for each form. |
| ISSUE-085 | Holding the sole test pool connection before a slow provider reply delayed dispatch to 1.36 s after search entry. The service then returned HTTP status 200 at 5.71 s. | Exercise one absolute five-second deadline across both waits and confirm that expired work cannot dispatch later. |
| ISSUE-086 | The pre-entry notice names the search text and venue bias sent to Geoapify. For routing it says only that estimates use selected coordinates. The matrix transport sends driver, pickup and venue coordinates to the provider. | Verify the pre-entry disclosure names the recipient and identifies the routing inputs. |

The saved trips substantiate the functional pilot. The first reported dashboard reading remains zero against 12 calculated credits. Project Statistics for both dates and A-10 independent student inspection remain outstanding.

### Checkpoint D review corrections

The student requested corrections for ISSUE-083–086 on the D working diff over `2b50353`. This episode covers provider trace and log privacy, complete house-number matching before signing, a single search deadline, and explicit routing disclosure. Verification uses synthetic markers, loopback provider responses and the designated PostgreSQL test database. D signoff, usage reconciliation and A-10 student inspection remain open.

| Finding | Correction and verification on the uncommitted diff over `2b50353` |
|---|---|
| ISSUE-083 | Both adapters use a shared Node HTTP transport (production HTTPS), blob `076ba1a8e54d`. A synthetic control URL appeared in the installed Next.js 16.4.6 span name, its `http.url` attribute and the full-URL development log. The loopback provider received the dummy key, query and bias for autocomplete, and the dummy key and endpoint coordinates for routing. None of those markers appeared in recorded spans, fetch metrics or logs. [Regression](../tests/concurrency/provider-privacy.integration.test.ts) |
| ISSUE-084 | The search adapter (`dbbb636d342d`) compares the complete number with the provider's structured `housenumber` before signing. Against five competing buildings, the service signed only `12 1/2` for the fractional query and only `12` for `Example Hall, 12 Example Street`. Using each token to create a trip confirmed its street in PostgreSQL. The same check covers case-insensitive suffixes, ranges, attached ½, and a named building followed by a street and ZIP. [Signing and storage regression](../tests/concurrency/live-search.integration.test.ts) |
| ISSUE-085 | The search service (`71d98bfe5900`) shares the route's absolute deadline. A real 1.4-second wait for the only pool connection followed by a partial provider body produced `ADDRESS_PROVIDER_UNAVAILABLE` inside the original five-second budget's test tolerance (4.8–5.7 seconds). The upstream socket closed and the pool served the next query. Canceling a pool wait or allowing the signing-key wait to expire resulted in zero provider requests after release. [Deadline regressions](../tests/concurrency/live-search.integration.test.ts) |
| ISSUE-086 | The picker (`395dd2b7b468`) explicitly names Geoapify as the recipient of the selected driver start, passenger pickup and venue coordinates for driving estimates. The production Chromium case checks the visible notice before entering the venue and still checks attribution on suggestions, preview, save and reload. [L-18 browser case](../tests/e2e/address.spec.ts) |

Two additional offline probes checked the deadline boundaries. A stalled incoming JSON body returned HTTP 503 `ADDRESS_PROVIDER_UNAVAILABLE` at 5,004 ms and canceled the stream. In a separate process with HTTPS dispatch intercepted, filling all five limiter slots with roughly 500 ms left on a search budget made the adapter exit at 5,004 ms with zero dispatches.

On the corrected working diff, Node 24 lint, typecheck and the production build passed. The suites passed setup 2/2, matching 71/71, unit 443/443, database 1/1, concurrency 254/254 and production Chromium 25/25 (796 tests). The new trace regression is blob `122dc48fa92e`, the expanded PostgreSQL rehearsal is `124e76d8b31d`, and the Chromium specification is `f96202aa1cc2`.

The correction run used zero live provider requests. The owner’s November 24–25 Statistics check across all project keys and the A-10 student inspection are separate pending items.

### Checkpoint D correction review

Independent review on the working diff over `2b50353` verified the Next.js fetch privacy fix, the shared deadline and the routing disclosure. Lint, typecheck and the 54 tests in the live-search, provider-privacy and Geoapify integration files passed. A clean copy of the source built and passed the L-18 Chromium workflow. A loopback TLS check also exercised GET and POST through the production transport. An incomplete request body sent to the built search route returned HTTP 503 `ADDRESS_PROVIDER_UNAVAILABLE` after 5,012 ms. The original fractional and named-venue address regressions passed.

**ISSUE-084 reopened.** A separate PostgreSQL probe gave the search service four fictional buildings on Example Street, numbered `12`, `12-B`, `4B` and `99`. The review checked which suggestions had signed tokens, created a trip with the indicated token and reloaded its street from the database.

| Search | Buildings with a signed token | Street saved and reloaded |
|---|---|---|
| `12 Example Street` | `12` | `12 Example Street` |
| `12-B Example Street` | All four | `99 Example Street` |
| `12 Example Street, 4B` | `4B` | `4B Example Street` |
| `12 Example Street, Apt 4B` | `12` | `12 Example Street` |

The number parser treats an unrecognized hyphenated letter suffix as an unnumbered query. Its reverse scan of comma-separated parts can also choose an apartment identifier as the primary number. Verify both cases at the signing and storage boundaries before closing the issue. The review used zero live provider requests. The owner’s L-19 credit reconciliation and A-10 student inspection remain pending.

### Primary street number follow-up

The student asked Codex to correct reopened ISSUE-084 on the D working diff over `2b50353`. This episode covers hyphenated suffixes, trailing apartment identifiers, clarification when a single primary number cannot be determined, and verification through signing, storage and the picker. Tests use fictional addresses and the designated test database. D remains open.

The parser (`98082eeb40d0`) distinguishes a full street number from a subsequent apartment identifier. The Geoapify adapter (`bba0d3a178b8`) compares that number against the structured `housenumber` before signing. The fixture adapter uses the same clarification rule. For competing primary numbers or unsupported numeric forms, the search route returns `INVALID_INPUT` and the picker displays the correction prompt.

| Query against fictional buildings 99, 4B, 12B, 12 and 12-B | Only signed choice and street reloaded from PostgreSQL |
|---|---|
| `12-B Example Street` | `12-B Example Street` |
| `12 Example Street, 4B` or `12 Example Street, Apt 4B` | `12 Example Street` |
| `12-b Example Street, 4B` | `12-B Example Street` |
| `4B Example Street` | `4B Example Street` |
| `12B Example Street` | `12B Example Street` |

The same signing path retained the fractional, named-venue and range controls. With only competing buildings available, a request for `13-B Example Street, 4B` returned an empty list. For ambiguous input the HTTP route returned 400 `INVALID_INPUT` with a prompt to enter one building number and street name. The provider stub recorded zero requests in those cases. [Signing, storage and route regressions](../tests/concurrency/live-search.integration.test.ts)

The first browser run found two alert elements because Next.js exposes a separate route announcer. The assertion now reads the alert inside the venue picker. In production Chromium, entering two numbered streets cleared the old venue, displayed the clarification, and left Create trip disabled after pressing Enter. Selecting the corrected street enabled creation again. All 26 browser workflows passed. [Browser regression](../tests/e2e/address.spec.ts)

On the uncommitted working diff over `2b50353`, Node 24 lint, typecheck, the production build and 800 tests passed (setup 2, matching 71, unit 444, database 1, concurrency 256, Chromium 26). The signing and HTTP regressions are in blob `e71c4228eb1b`, and the browser regression is in `a2ca85f1cdf5`. This follow-up used zero live requests. Independent verification of ISSUE-084, the owner’s L-19 Statistics reconciliation and A-10 student inspection remain pending.

### Independent review of primary street numbers

On the D working diff over `2b50353`, all six live-search integration cases passed. They exercised the original fractional and named-venue cases and both previously reported wrong-building cases through signing, saving and PostgreSQL reload. Lint and typecheck passed. A clean source copy built and passed both production Chromium cases selected for this review. The clarification cleared the prior choice, disabled Create trip and allowed a fresh selection. L-18 attribution also passed. The implementer's full run covered 800 tests.

Separate review probes used the search route with a fictional Geoapify response. For the grid-number query, five buildings on the same fictional road had different structured house numbers. The test registered a passenger with one of the signed tokens and read the stored pickup back from PostgreSQL.

| Query | Observed result |
|---|---|
| `12-B Example Road` and `12 Example Road, 4B` | Only building `12-B` and building `12`, respectively, had a signed token. |
| `N6W23001 Example Road` | All five buildings were signed, including the exact match. A passenger registered with the number 99 token reloaded at `99 Example Road`. USPS documents this form of primary number. [Publication 28, Appendix D3](https://pe.usps.com/text/pub28/28apd_004.htm) |
| `12 Example Road - 99 Other Road` | The provider received one request. The search returned 200 and signed building 12 despite the two distinct street addresses. |
| `Studio 54 Theater` and `7-Eleven` | Both searches returned 400 `INVALID_INPUT` before dispatch. In each case the stub was configured to return a building with that exact name. The `Studio Theater` control dispatched once and returned a signed choice. |

ISSUE-084 remains open for the wrong-building and competing-address cases. ISSUE-087 tracks legitimate named venues rejected by numeric parsing. Matching the complete alphanumeric primary number, or asking before signing an unsupported address, closes the first failure path. The named-place case needs its own regression so that tightening the address rule preserves searches by name. Review used zero live provider requests. L-19 dashboard reconciliation and A-10 student inspection remain pending.

### Grid pickups and numeric venue names

The student requested corrections for ISSUE-084 and ISSUE-087 on the checkpoint D working diff over `2b50353`. This episode covers exact alphanumeric pickup numbers, clarification for competing streets, and lookup of named places containing digits. Verify with fictional provider responses through the search route, passenger registration and PostgreSQL reload. Checkpoint D remains open for independent review and the owner’s L-19 reconciliation.

Before the implementation changed, four focused regressions failed on their original conditions. The grid search signed five choices, the spaced dash returned 200, and both reported venue names returned 400. All provider responses were fictional.

| Review case | Observed route or storage result |
|---|---|
| `N6W23001 Example Road` | Five buildings included a partial number, a transposed number, and number 99 with the requested address in its display name. Only the exact structured number produced a signed pickup. Its token registered a passenger who reloaded at `N6W23001 Example Road`. The lowercase grid after a venue prefix and the digit-leading grid `6W220` also reloaded correctly. A missing grid number yielded zero suggestions. |
| `12 Example Road - 99 Other Road` | HTTP 400 `INVALID_INPUT` asked for one building and street. The response contained no suggestions and the provider received zero calls. Grid numbers on either side of a dash and a split grid number were also exercised. |
| `Studio 54 Theater` and `7-Eleven` | Each search dispatched the original text once. Only the exact structured venue name received a token, which created a trip that reloaded with the expected venue at `42 Example Road`. Competing answers included a similar name and an address whose display text echoed the query. |

The test also saved and reloaded `1-800-Flowers` and exercised a venue name that could be parsed as a street address. For `F45 Training`, one candidate had house number F45 and another had the exact venue name at number 42. The route asked for clarification. An explicit quoted-name search sent the unquoted name to the provider, signed only the exact venue and reloaded number 42. An initial clarification rule interrupted the pilot rehearsal when the provider repeated the query as a name on both correct- and wrong-number buildings. The correction preserves the full-number match in that case. All 11 focused integration cases then passed. [Route and storage regressions](../tests/concurrency/live-search.integration.test.ts)

In production Chromium, the picker asked for clarification for both comma-separated and dash-separated streets. Enter left Create trip disabled. A fresh selection using the corrected street or the quoted venue name enabled creation again. Node 24 lint, typecheck and the production build passed. The suites passed setup 2/2, matching 71/71, unit 444/444, database 1/1, concurrency 261/261 and Chromium 26/26, totaling 805 tests. [Browser regression](../tests/e2e/address.spec.ts)

The implementation is the working diff over `2b50353`. The classifier is blob `b052a25210aa`, the Geoapify adapter is `8e073ea77ceb`, and the route and storage regressions are `f8bfb2535a7f`. This episode used zero live provider requests. Independent verification, the owner’s L-19 credit reconciliation and A-10 student inspection remain pending.

### Independent review of grid pickups and numeric venues

Independent review of the working diff over `2b50353` passed lint, typecheck, all 11 live-search cases and the provider-privacy regression. A clean source copy built and passed two production Chromium cases covering clarification, recovery through a fresh selection, and L-18 attribution. The grid pickup, `Studio 54 Theater` and `7-Eleven` signed and reloaded correctly. ISSUE-087's original lookup failure is closed. The full 805-test count is from the implementation run.

An independent probe used the search route, a fictional provider and the designated PostgreSQL test database. It created a trip with each sole signed choice and reloaded the venue. It exercised two changes to the controls:

| Control | Variation | Observed outcome |
|---|---|---|
| `12 Example Road - 99 Other Road` returned 400 with zero dispatches. | Enter `12 Example Road, Austin, TX - 99 Other Road, Dallas, TX`. | One dispatch, HTTP 200, only `12 Example Road` signed. The first address could be saved and reloaded without clarification. |
| For `F45 Training`, the provider returned the exact venue at `42 Example Road` and an unnamed building at `F45 Other Road`. The route returned 400 asking for clarification. Quoting the name saved the exact venue. | Append `, Austin, TX` to the unquoted query and keep the same provider replies. | HTTP 200. Only the unnamed building at `F45 Other Road` was signed. It could be saved and reloaded. |
| Use the same bare `F45 Training` control. | Add a third provider result at `17 Training`. | HTTP 200. The only signed and reloaded choice was again `F45 Other Road`. No individual result had both the street `Training` and the number `F45`. |

ISSUE-084 remains open because splitting on commas before checking street separators loses the second address in these fully qualified inputs. ISSUE-088 tracks the new ambiguity check. Compare the name independently of the city and state, and require any evidence for an exact street address to come from one eligible result with both the matching number and street. As a locality control, `Studio 54 Theater, Austin, TX` signed and reloaded the exact venue. Review made zero live provider requests. L-19 credit reconciliation and A-10 student inspection remain pending.

### Locality and venue ambiguity corrections

The student requested corrections for ISSUE-084 and ISSUE-088 on the uncommitted D working diff over `2b50353`. Codex will test competing fully qualified addresses before dispatch, and verify that a named venue and a numbered street are distinguished using evidence from individual eligible provider records. The episode uses fictional responses, the designated PostgreSQL test database, and the production picker on loopback. D remains open for independent verification and L-19 credit reconciliation.

Before the fix, the four new regression cases returned HTTP 200 where the reviewer expected 400. These included the fully qualified competing addresses, both reported F45 variants, and a control with a city-level result carrying the desired house number and street.

| Route input or provider variation | Outcome after correction |
|---|---|
| `12 Example Road, Austin, TX - 99 Other Road, Dallas, TX` | HTTP 400 `INVALID_INPUT`, no suggestions and zero provider dispatches. A separate classifier probe clarified all 42 combinations of three first addresses, two second addresses and seven separators. All five addresses were accepted individually. |
| `F45 Training, Austin, TX` with the exact venue at 42 Example Road and an unrelated building at F45 Other Road | HTTP 400 with the exact-name clarification and no signed choices. |
| Bare `F45 Training` with an additional building at 17 Training | HTTP 400. The number on one building and the street on a different building could not establish a match. A city-level result with both fields also failed to establish a selectable street address. |
| Quoted venue or confirmed street | `"F45 Training", Austin, TX` sent the unquoted name with the locality and saved only the venue at `42 Example Road`. Adding an eligible building with number F45 and street Training made the unquoted query sign and save only `F45 Training`. The tests reloaded each saved venue from PostgreSQL, including when the unrelated F45 building was still present. |

The pilot rehearsal still supplies decoys whose names echo the query. Its three fictional addresses now have consistent search text and structured streets so that a successful street lookup has both pieces of evidence on the intended building. The original number, grid, apartment, quota and disconnected workflow checks remain in that suite. [Route and storage regressions](../tests/concurrency/live-search.integration.test.ts)

Node 24 lint, typecheck and the production build passed. All 808 tests passed (setup 2, matching 71, unit 444, database 1, concurrency 264, production Chromium 26). Chromium confirmed that entering both city-qualified addresses cleared the old venue and kept Create trip disabled through Enter. Selecting the quoted venue with a city and state enabled creation again. The browser regression is blob `2dda0171c3dc`. [Picker workflow](../tests/e2e/address.spec.ts)

The uncommitted working diff is based on `2b50353`. The classifier is blob `8d8fb3d8c7dc`, the adapter is `e98df934aff8`, and the route regressions are `5219e9c189ad`. The correction run used zero live provider requests. Independent verification of ISSUE-084 and ISSUE-088, the owner’s L-19 Statistics reconciliation and A-10 student inspection remain pending.

### Independent review of locality and venue ambiguity

The reported corrections passed on the working tree over `2b50353`. The Austin–Dallas query separated by a dash returned 400 before dispatch. Both previously reported F45 variants asked for clarification. Quoting the venue and adding a literal street match to the provider results produced the expected saved venues in separate tests. Lint, typecheck, 15 focused search and privacy integration cases, a clean-copy production build and both selected Chromium cases passed. The full 808-test run is the implementer's result. This review made zero live provider requests.

Additional route probes used fictional provider results and the designated PostgreSQL test database. Each row described as saved was read back through the trip dashboard service.

| Variation | Observed response |
|---|---|
| `12 Example Road, Austin, TX, or 99 Other Road, Dallas, TX` | One dispatch, HTTP 200 and a single signed choice. The saved venue reloaded at `12 Example Road, Austin, TX`. A single address ending in `Portland, OR 97201` also passed. |
| `2500 I-35 Frontage Road, Austin, TX` and `12 US-183 Highway, Austin, TX` | Both single addresses returned 400 before dispatch. Both were classified as addresses on the prior reviewed source. Typing `I 35` in the first query produced one dispatch and saved the provider's `2500 I-35 Frontage Road`. |
| `F45 Training, Austin, TX` with only `F45 Other Road` and `17 Training` in the reply | One dispatch and HTTP 200. Only `F45 Other Road` was signed and it persisted on reload. Adding the exact venue name at `42 Example Road` to the same two replies produced the expected clarification. |

ISSUE-084 remains open. The separator check treats a hyphen inside a highway name as the start of another street, and skips the word `or` directly after a comma. ISSUE-088's two original probes pass, but signing still depends on whether the exact venue appears in the provider reply. Its absence permits a house-number-only match for the same ambiguous query. Test with the venue added and removed while keeping both decoys fixed.

One additional control documents the behavior of literal street comparison. With a single building at `24 West Example Street`, the query `24 W Example St` signed that address when the provider omitted its name. With the same building named `24 W Example St`, the route asked for clarification and quoting the name recovered the same venue. This is a useful control for future changes to street comparison.

L-18 stays passed. L-19 credit reconciliation and A-10 student inspection remain pending.

### Highway searches and independent street matching

The student requested fixes for the latest ISSUE-084 and ISSUE-088 reproductions and verification against prior corrections. On the D working tree over `2b50353`, exercise comma-separated alternatives, single highway addresses and the same provider results with the venue present and absent. Verify dispatch, signing and PostgreSQL reload using fictional addresses, then run the existing checkpoint suites. D stays open for independent review and L-19 reconciliation.

Nine focused route regressions failed against the previously reviewed implementation. The comma-plus-“or” pair returned 200, both hyphenated highways returned 400, and a matching number still allowed a building on another street when the exact venue was absent.

| Input or change to the provider reply | Observed correction |
|---|---|
| `12 Example Road, Austin, TX, or 99 Other Road, Dallas, TX` | HTTP 400 `INVALID_INPUT` with zero provider calls and no signed choice. Combinations with the two highways also clarified. |
| `2500 I-35 Frontage Road, Austin, TX` and `12 US-183 Highway, Austin, TX` | Each search dispatched once and signed only the requested building. Both saved and reloaded through PostgreSQL, with and without the provider echoing the address as a venue name. The spaced `I 35` and Oregon ZIP+4 controls also passed. |
| `F45 Training, Austin, TX` with only `F45 Other Road` and `17 Training` | HTTP 200 with an empty list. Adding the exact venue at `42 Example Road` prompted for clarification. Quoting the name signed and saved that venue. Adding the genuine street match signed and saved only `F45 Training` with either set of results. |
| `24 W Example St` and a building at `24 West Example Street` | The unquoted query saved the correct building both with and without an echoed venue name. Matching recognizes common directional and suffix abbreviations in position. A different number or another street with number 24 received no token. |

The classifier regression uses seven individual addresses and 294 ordered two-address combinations, including highways, grid and fractional numbers, ranges, apartment identifiers, and an Oregon state/ZIP. A separate PostgreSQL control caught an intermediate regression where an inline `Apt 4B` was compared as part of the street and prevented selection. The classifier now removes a labeled trailing unit using the same unit syntax it accepts after a comma. [Classifier regressions](../tests/unit/location-query.test.ts) · [Search and storage regressions](../tests/concurrency/live-search.integration.test.ts)

Two negative controls used isolated copies and the exact source revisions from the previous review. Restoring only the former classifier (`8d8fb3d8c7dc`) failed all seven paired-address cases. Restoring only the former adapter (`e98df934aff8`) with the corrected classifier failed all three venue-removal cases by returning a signed decoy. The competing-address route test still passed in that copy.

On the final working tree, lint, typecheck, the production build and all 822 tests passed (setup 2, matching 71, unit 452, database 1, concurrency 270, production Chromium 26). Chromium verified that the comma-and-“or” pair clears the old selection and keeps Create trip disabled until a fresh choice. The source blobs over `2b50353` are `cc2928243abb` (classifier), `dea664efc212` (adapter), `3fbdcb9b9eac` (route and storage regressions), `ffcfa24b0ef5` (classifier regressions) and `3214d8990888` (browser). This episode used zero live provider requests. Independent verification, the owner’s L-19 reconciliation and A-10 student inspection remain pending. [Browser workflow](../tests/e2e/address.spec.ts)

### Independent review of highway and street matching

Reviewed the D working tree over `2b50353`, including the untracked classifier (`cc2928243abb`) and search adapter (`dea664efc212`). On Node 24, lint, typecheck, all eight classifier tests (including the 294 pairs), and all 21 live-search and provider-privacy integration tests passed. A clean copy built and passed both selected Chromium workflows for clarification and L-18 attribution. The implementer ran the full 822-test suite. This review made zero live provider requests.

A separate probe sent 22 requests through the search route with fictional provider replies and the designated PostgreSQL test database. For each of the 12 searches that produced a single signed choice, the review created a trip and read its venue back. The comma-plus-“or” Austin–Dallas pair returned 400 before dispatch. Each reported single I-35 and US-183 address signed and saved correctly. With just the two F45 decoys the route returned zero choices. Adding the exact venue prompted for clarification, quoting it saved that venue, and adding the genuine numbered street saved its own building. The abbreviated `24 W Example St` worked with and without a provider name. These results close ISSUE-088.

| Remaining finding | Route observation and control |
|---|---|
| ISSUE-089 · Locality without a preceding comma | The fictional provider returned the same building with number `12`, street `Example Road`, city `Austin`, state `TX` and ZIP `78701`. The search `12 Example Road, Austin, TX 78701` signed that building and the saved venue reloaded. Removing the comma after `Road`, removing both commas, or entering `12 Example Road 78701` produced HTTP 200 with zero suggestions after one dispatch each. A separate run against the previous reviewed source signed and reloaded that building for all four spellings. The current adapter compares the full street component, which still contains the locality or ZIP for these inputs. Compare any locality suffix against the same candidate’s structured fields and retain the split-record rejection. |
| ISSUE-084 · Direction before a state highway | Both `24 N TX-35 Frontage Road, Austin, TX` and the `North` spelling returned 400 before dispatch. The same search with the direction omitted and the spaced `N TX 35` control each signed and reloaded their corresponding fictional building. The classifier recognizes the hyphen after a state code only at the start of the street, so a preceding direction makes `35 Frontage Road` look like a second address. Cover the direction and state code together while keeping actual pairs on the clarification path. |

L-18 remains passed. L-19 still awaits the owner’s November 24–25 project Statistics across all keys to reconcile 12 calculated credits with the first reading of zero. A-10 student inspection remains pending.

### Directional highways and locality without commas

The student authorized a bounded correction for ISSUE-084 and ISSUE-089 if it fits the current search design. Verify the directional state-highway spellings and the city and ZIP forms through classification, signing and PostgreSQL reload. Exercise conflicting provider records and the earlier competing-address and F45 controls. The checks use fictional responses and the designated test database. D remains open.

Before the implementation changed, both directional route tests returned HTTP 400, and the missing-comma test received an empty list for a building that the fully comma-delimited control had just saved. Both new directional cases also failed in the classifier suite.

| Case | Observed result |
|---|---|
| `24 N TX-35 Frontage Road, Austin, TX` and the `North` spelling | Each dispatched once per search and saved and reloaded the street with the north prefix. The building on South TX-35 and the wrong-number building received no token. Two complete addresses joined by “, or” still returned 400 before dispatch. The classifier suite covered nine standalone inputs and 504 ordered pairs. |
| `12 Example Road Austin, TX 78701`, `12 Example Road Austin TX 78701` and `12 Example Road 78701` | Each signed exactly one building and reloaded as `12 Example Road, Austin, TX 78701`. Removing that building left zero choices. A wrong street, number, city or ZIP on a different record could not supply a missing field. The full state name and abbreviated street also resolved. |

The application changes are confined to the classifier and Geoapify candidate comparison. The classifier preserves the direction on a state route. To infer where a street ends, the adapter compares trailing fields against one provider row, then checks the remaining full street. A literal street already delimited by a comma keeps the prior behavior. [Classifier](../src/locations/house-number.ts) · [Adapter](../src/locations/geoapify.ts) · [Signing and storage tests](../tests/concurrency/live-search.integration.test.ts)

The uncommitted fix over `2b50353` is identified by blobs `58783a285992` (classifier), `f609db01385e` (adapter), `232d7d9d19df` (route and storage tests) and `ff0319591818` (classifier tests). Node 24 lint, typecheck and the production build passed. All 827 tests passed (setup 2, matching 71, unit 454, database 1, concurrency 273, production Chromium 26). The route suite also verified an Oregon multiword city with an apartment and ZIP+4, and repeated the F45 venue-present and venue-absent controls with an attached locality. This correction used zero live provider requests. Independent verification of ISSUE-084/089, L-19 reconciliation and A-10 student inspection remain pending.

### Independent review of directional highways and attached localities

Reviewed the working diff over `2b50353`, including classifier `58783a285992` and search adapter `f609db01385e`. Node 24 lint, typecheck, all 10 classifier tests with 504 paired-address checks, and all 24 focused live-search and provider-privacy integration tests passed. A clean copy built and passed the two selected Chromium workflows for clarification and L-18 attribution. The full 827-test run is the implementer’s result.

A separate probe sent 22 search requests with fictional provider replies to the real route and saved and reloaded the 11 single signed choices on the designated PostgreSQL test database. All three Austin city/ZIP forms selected the expected venue and returned zero choices when the street and locality occurred on different buildings. Both `N TX-35` and `North TX-35` signed only the northbound street, and pairing either with a second address returned 400 before dispatch. The F45 decoys, clarification and quoted venue controls also passed.

| Open issue | Independent reproduction and controls |
|---|---|
| ISSUE-089 · Florida state and ZIP discarded | Given only a building at `12 Example Road, Miami, OK 74354`, the query `12 Example Road Miami FL 33101` signed that building and the saved venue reloaded in Oklahoma. With only `Miami, FL 33102` in the reply, both `Miami FL 33101` and `Miami, FL 33101` signed and saved the wrong ZIP. Returning both Florida ZIPs signed both. Spelling out `Florida` signed only the correct ZIP and returned zero when it was absent. The unit parser consumes `FL 33101` as a floor identifier before the adapter checks locality. The previous reviewed source returned zero choices for the Oklahoma row. |
| ISSUE-084 · Oregon route mistaken for an alternative | Both `24 N OR-99 Frontage Road, Eugene, OR` and the `North` spelling returned 400 with zero provider calls. Removing the direction signed and saved the corresponding `24 OR-99 Frontage Road` building. Highway normalization exposes `or 99` to the alternative-address check. The previous reviewed source also rejected the directional query. |

An independent classifier check substituted each of the 50 state abbreviations into the same synthetic inputs. Only `OR` rejected the single directional highway. Every version with a genuine second street asked for clarification. Only `FL` dropped the final ZIP from the inline city/state/ZIP input. The review made zero live provider requests. L-18 remains passed. The owner’s L-19 credit reconciliation and A-10 student inspection remain pending.

### Florida postal codes and Oregon route numbers

The student asked Codex to correct ISSUE-089 and ISSUE-084 on the D working tree over `2b50353`. Reproduce the wrong Miami selection and the directional Oregon highway rejection, then verify the correct building, wrong and missing results, floor syntax, and competing streets through offline tests and PostgreSQL reload. D stays open for independent review and L-19 reconciliation.

Before the correction, the route returned a signed Oklahoma building for the inline Miami query. The two hyphenated directional Oregon inputs and a spaced directional control returned 400. The new classifier cases also failed on the Oregon highway and on Florida’s missing ZIP.

| Regression | Outcome after correction |
|---|---|
| `12 Example Road Miami FL 33101`, `12 Example Road Miami, FL 33101` and the fully comma-delimited form | Each returned zero suggestions for the Oklahoma building alone or the wrong Florida ZIP alone. With the exact building among the decoys, only its token could be selected, and it saved and reloaded as `12 Example Road, Miami, FL 33101`. The same checks covered spelled-out Florida, an explicit floor, sparse rows, a conflicting city or state, and a ZIP+4 selection. |
| `24 N OR-99 Frontage Road, Eugene, OR` and the `North` spelling | Each dispatched once per search and signed only the matching building, which saved and reloaded from PostgreSQL. A spaced directional route also worked. The route number stays attached to the code during the check for a second street. |

The classifier table covers ten standalone addresses and 630 ordered pairs. A separate regression checks the directional highway, a genuine pair, and both inline and comma-delimited state/ZIP text for every US state abbreviation. An additional offline probe crossed all 50 codes with 16 compass spellings and both hyphenated and spaced route numbers. It accepted all 1,600 single highways and clarified all 1,600 when a second numbered street was appended. For a locality ending in a ZIP, signing now requires the corresponding structured fields on the same building even if the street has its own comma. Earlier positive fixtures that queried a ZIP now include the matching postal fields. [Classifier regressions](../tests/unit/location-query.test.ts) · [Signing and storage regressions](../tests/concurrency/live-search.integration.test.ts)

The uncommitted revision over `2b50353` has blobs `d9dc99d8be31` (classifier), `70b18f47d596` (adapter), `61090160c6b4` (classifier tests) and `087e8d2aef11` (signing and storage tests). Lint, typecheck, the production build and all 834 tests passed on Node 24 (setup 2, matching 71, unit 456, database 1, concurrency 278, production Chromium 26). This episode used zero live provider requests. Independent verification of ISSUE-089 and ISSUE-084 and the owner’s L-19 reconciliation remain pending. A-10 student inspection is separate.

### Independent review of the Florida and Oregon corrections

Reviewed the uncommitted D classifier `d9dc99d8be31` and adapter `70b18f47d596` over `2b50353`. On Node 24, lint, typecheck and all 456 unit tests passed, including the 630 paired-address checks and all 50 state abbreviations. All 29 focused search and privacy integration tests passed. A clean copy built and passed the two selected Chromium workflows for address clarification and L-18 attribution. The full 834-test run is the implementer’s result.

A separate probe exercised the real search route with 29 fictional provider scenarios on the designated PostgreSQL test database. It saved and reloaded all 14 single signed choices. The original inline and comma-delimited Miami queries rejected the Oklahoma and wrong-ZIP buildings, and signed only the matching Florida building. Both `FL 4` and `Floor 33101` worked with that postal address. Both directional Oregon spellings and the spaced directional control signed the northbound building. Pairing each with a second numbered street returned 400 before dispatch. ISSUE-084 closes on this revision. The F45 decoy and quoted-name checks also passed.

| Finding | Observation and control |
|---|---|
| ISSUE-089 · A country suffix bypasses the locality check | With only `12 Example Road, Miami, OK 74354` in the reply, `12 Example Road, Miami, FL 33101` returned zero suggestions. Appending `, USA` or `, United States` signed the Oklahoma building, and its venue reloaded there. When both buildings were present, appending `, USA` signed both. The explicit state without a ZIP (`12 Example Road, Miami, FL`) also allowed the Oklahoma choice. The exact-street shortcut skips locality validation whenever the locality’s last word is not a ZIP. The previous reviewed adapter also allowed the country-suffix case. |
| ISSUE-090 · A single structured state field can hide the correct building | For the same street, city and ZIP, a provider row containing only `state: "Florida"` produced no suggestion for the comma-delimited query ending in `FL 33101`. Writing `Florida 33101` signed and saved it. With only `state_code: "FL"`, the reverse occurred. Both fields are optional in the adapter schema. The previous reviewed source signed and reloaded the correct row in both cross-spelling cases. Compare equivalent US state names and codes before checking the row’s supplied locality. |

This review made zero live requests. L-18 remains passed. L-19 still awaits the owner’s November 24–25 project Statistics across all keys to reconcile 12 calculated credits with the first reading of zero. A-10 student inspection remains pending.

### General locality matching and state aliases

The student requested general corrections for ISSUE-089 and ISSUE-090 on the D working tree over `2b50353`. Reproduce the country-suffix bypass and both one-field state failures. Verify that each explicit qualifier is supported by one provider row, across ZIP and country variants, state names and codes, sparse and conflicting results, and PostgreSQL save/reload. Use fictional responses and keep checkpoint D open.

The five initial signing regressions all failed on the prior adapter. Its literal-street shortcut skipped a comma-delimited locality whenever its last word was not a ZIP. Its state comparison also needed the literal query spelling in a provider field. The correction checks the full street and every supplied locality component on one US result. The same check covers explicit qualifiers on named and free-text searches in both providers. The state crosswalk covers all 50 states, DC and five US territories. A provider’s original state spelling remains visible after save and reload. [Matcher](../src/locations/us-locality.ts) · [USPS Publication 28, Appendix B](https://pe.usps.com/text/pub28/28apb.htm)

The PostgreSQL regressions submit the reported Miami forms with the Oklahoma building alone, with conflicting or incomplete records, and with the exact Florida row among those alternatives. They check for zero suggestions in the first two cases and one signed selection that persists in the third. Oregon cases also cover inline ZIP and country, quoted and numeric names, and a free-text venue search. The unit table checks each state alias in both directions with three ZIP forms and four country endings. Another 480 pasted-address variants exercise every comma placement across five localities, with matching state representations, a conflicting city or state, and a changed ZIP. Existing highway and F45 positive fixtures now supply their actual city and state. The Chromium clarification case uses the catalog’s Fixtureville venue and also checks that asking for the same venue in Austin leaves Create trip disabled.

The uncommitted D revision over `2b50353` has source blobs `a8eb34096735` (locality matcher), `5524168cd884` (classifier), `0d6dfa8eb0c7` (Geoapify) and `26ab4156d53c` (fixture). The signing and storage tests are `d8680819ffc0` and the classifier and locality suite is `7418415ed215`. Lint, typecheck, the production build and all 847 tests passed on Node 24. Totals were setup 2, matching 71, unit 461, database 1, concurrency 286 and Chromium 26. Verification used zero live Geoapify requests. Both issues await independent verification. D stays open, L-18 passed, the owner’s L-19 credit reconciliation remains pending and the student’s A-10 inspection is separate.

### Independent review of locality matching and state aliases

Reviewed the D working tree over `2b50353` on 2026-11-25, including the new locality matcher `a8eb34096735`, classifier `5524168cd884` and live adapter `0d6dfa8eb0c7`. Lint, typecheck and all 461 unit tests passed, including the state crosswalk and 480 comma-placement cases. Docker Desktop was stopped on the first integration run and PostgreSQL refused the connection. After starting Docker Desktop and bringing up the existing Compose database, all 37 focused search and privacy integration cases passed. A clean copy built and passed the two selected Chromium workflows for address clarification and L-18 attribution. The full 847-test run is the implementer’s result.

A separate probe exercised 20 searches with fictional provider records and the designated test database. All 13 single signed choices were saved and reloaded. The Miami country-suffixed and state-only queries rejected Oklahoma, and both Florida name/code representations worked when only one field was present. An explicit Florida query rejected a provider row with contradictory state fields. The quoted venue also honored the Miami and Florida qualifiers.

| Finding | Independent result and control |
|---|---|
| ISSUE-089 · A city is discarded as a suite | For `12 Example Road, Ste. Genevieve, MO`, the only provider row was in Springfield, Missouri. The route signed that row and the saved venue reloaded in Springfield. Supplying both cities signed both. The numbered-address classifier consumes the entire city component as a suite before locality matching. A quoted venue search for the same city selected only Ste. Genevieve, and a genuine `Ste. 4B` still worked. |
| ISSUE-090 · Contradictory state fields can survive signing | A row containing `city: Miami`, `postcode: 33101`, `state: Florida` and `state_code: OK` was rejected for `12 Example Road, Miami, FL 33101, USA`. Omitting only the state from the query signed the same row and the saved address reloaded as `12 Example Road, Miami, OK 33101`. Agreement between the provider’s two state fields is checked only when the query supplies a recognized state. The single-field Florida control still saved correctly. |
| ISSUE-091 · City name read as a state | A provider row with city Washington, state DC and ZIP 20001 received zero suggestions for `12 Example Road, Washington, 20001, USA`. Both the explicit `Washington, DC 20001` and ZIP-only forms signed and reloaded that row. The locality matcher interprets the city as the state of Washington and rejects DC before considering an exact whole-city match. |

The review made zero live provider requests. L-18 remains passed. L-19 still awaits the owner’s November 24–25 Statistics across all project keys to reconcile 12 calculated credits with the initial reading of zero. A-10 student inspection remains pending.

#### Geographic scope of the three locality issues

On 2026-11-25, a Node 24 probe ran the current Geoapify search adapter against fictional building records for each of the 50 state codes. Across 350 searches, the transport returned one synthetic US building per call. The probe measured which candidates the adapter returned. It made zero live requests.

| Pattern | Outcome across the 50 state codes | Control |
|---|---|---|
| ISSUE-089 · A numbered address with `Ste. Genevieve` as the requested city | The adapter returned a building in a different city in 50/50 cases. | An ordinary mismatched city was rejected in 50/50. |
| ISSUE-090 · The provider state name contradicted its state code | A query giving only city and ZIP returned the inconsistent building in 50/50 cases. | Including its state code in the query rejected the contradiction in 50/50. |
| ISSUE-091 · The city had the name of a different state and the search supplied city and ZIP | The adapter dropped the matching building in 50/50 cases. | Including the building’s actual state restored it in 50/50. An ordinary city plus ZIP also worked in 50/50. |

These deliberately constructed records establish that all three behaviors are independent of the building’s state. The probe did not measure how often these inputs or provider records occur in real searches.

### Locality and unit ambiguity corrections

The student asked Codex to investigate and address ISSUE-089–091 on the D working tree over `2b50353`. Recheck the suite-like city, contradictory provider state fields and city names that match state names with fictional search replies. Preserve actual suite identifiers, explicit state checks and PostgreSQL save and reload. D remains open.

All three new signing tests failed against the prior source. The suite-like city and the conflicting-state row each received a token. The Washington, DC row received no suggestion. The correction keeps long alphabetic unit-like words in locality unless marked with `#`, screens inconsistent Geoapify state fields before any candidate or clarification logic, and accepts an exact city plus a verified ZIP even when the city also names a state.

The route regressions use the rejected row alone, then mix it with the valid row and save and reload the only signed selection. The controls cover inline locality, `Ste. 4B`, an explicitly supplied state, and searches by street, unqualified text and quoted venue. The unit table repeats the locality patterns using all 50 state codes, DC and five territories and checks a wrong ZIP and a conflicting explicit state. These fixtures establish behavioral coverage across states.

Source blobs on the uncommitted D diff are `a60387a3d433` (classifier), `44ba58ba85a1` (locality matcher) and `9fc0e4485556` (adapter). Test blobs are `dd9cbd38bb53` (route and storage) and `4cdb50c9ec2c` (unit).

Lint, typecheck, the production build and all 850 tests passed on Node 24. Totals were setup 2, matching 71, unit 461, database 1, concurrency 289 and Chromium 26. Verification used zero live Geoapify requests. D stays open for independent verification and the owner’s L-19 credit reconciliation. A-10 student inspection remains pending.

### Independent verification of the three shared search rules

On 2026-11-25 the reviewer checked the uncommitted classifier `a60387a3d433`, locality matcher `44ba58ba85a1` and Geoapify adapter `9fc0e4485556` over `2b50353`. Lint, typecheck, 461 unit tests and 40 focused search and privacy integration cases passed. The PostgreSQL regressions verified signing and reload for the original reports, including rejection when only the unsuitable building was available. The implementer’s full run covered 850 tests, the production build and Chromium.

An independent probe exercised the production search adapter with fictional provider replies. It ran 23 searches for each of 50 states, DC and five territories, for 1,288 passing checks and zero live requests.

- ISSUE-089 uses the syntax of the unit identifier. Searches for `Ste. Odile`, `Ste Marie` and `Suite Meadow` accepted the matching city and rejected another city. `Ste. B7`, `Unit B`, `Floor 17` and `Suite #Cedar` worked as unit designators. Unmarked `Suite Cedar` did not select the building.
- ISSUE-090 screens provider rows before creating candidates or checking for an ambiguous venue. Numbered streets, city-and-ZIP searches, free text and quoted names all rejected conflicting state fields and accepted the consistent control.
- ISSUE-091 uses the candidate’s exact city and ZIP. The probe rotated the state name used as the fictional city across all 56 jurisdictions. The correct ZIP and an explicit matching state succeeded. A wrong ZIP or an explicitly conflicting state failed.

The three issues are closed on this diff. L-18 remains passed. Checkpoint D still awaits the owner’s L-19 credit reconciliation. A-10 student inspection is separate.

### Checkpoint D technical closeout

On 2026-11-25 the owner confirmed that Geoapify recorded **12 credits** for the combined Austin and Seattle pilot. This matches the 12 calculated from six autocomplete requests and four matrix requests, within the approved cap of 20. The earlier dashboard reading of zero was provisional. The owner’s confirmation closes L-19. [Pilot measurements](#austin-and-seattle-live-pilot)

**D passed its technical gate on the uncommitted working diff over `2b50353`.** L-18 passed the account and attribution checks. L-19 demonstrated both trips, including the disconnected rematch, save, receipt replay and reload. All search review findings are closed. A-10 independent student inspection remains pending. [Search verification](#independent-verification-of-the-three-shared-search-rules)

## Checkpoint C implementation

On 2026-11-24 the student asked Codex to start checkpoint C from clean `main` at `8ece067`. The first bounded work item is C1 (L-13): implement the Geoapify matrix adapter, drive it through a counting loopback provider, and verify publication and failure behavior. Student inspection is pending.

C2 starts on the C1 working diff. Codex will exercise one live workload per trip, handoff of settled cells, race-safe publication and an absolute deadline across provider and PostgreSQL waits (L-14–L-16).

For C3 Codex will wire preview generations to the waiting organizer’s UI, deliver delayed responses in Chromium, and measure the separate competing trip with a 20-driver/50-passenger address fixture on loopback (L-17).

| Check | Starting state and observed outcome |
|---|---|
| L-13 | A fictional one-driver, one-pickup trip used a counting HTTP stub. The two requests contained the exact pinned profile and submitted longitude/latitude pairs. The response preserved their IDs despite different returned snaps. Fractions produced `round(403.25 + 346.75 − 519.50) = 231`; a null time excluded the pickup. Refused credentials, quota, malformed cells, socket loss and a stalled body yielded 503, zero new preview rows and zero new receipts. A successful retry published once. [Integration cases](../tests/concurrency/geoapify.integration.test.ts) |
| L-14 / ISSUE-050 | While X’s old workload was held open, a same-version peer received 429. After X was canceled and Y acquired a seat, the successor waited for settlement, reused only P→V, fetched Y→P and Y→V, and published one row without X’s endpoint. Peak concurrent workloads for the trip was one. A second case interrupted an actual stalled body and retained a validated no-route observation. Separate trip and policy controls refused unrelated handoff. [PostgreSQL and counting-stub cases](../tests/concurrency/geoapify.integration.test.ts) · [Permit scope check](../tests/unit/routing-permit.test.ts) |
| L-15 | Two fixture publishers computed different costs (60 and 120 seconds) and returned identical public results with one stored row. A roster edit during an HTTP batch gave the old publisher 409 and left zero rows. [Race cases](../tests/concurrency/geoapify.integration.test.ts) |
| L-16 | With a 900 ms injected budget, the test spent 450 ms at a routing barrier while holding either the sole pool connection or the trip row lock. Both returned 503 within the 1,200 ms watchdog, published nothing and recovered on the same pool. After a real publication COMMIT with an injected missing acknowledgement, retry returned the durable preview ID with no further upstream calls. [Deadline and recovery cases](../tests/concurrency/geoapify.integration.test.ts) |
| L-17 | The reducer and Chromium checks deliver delayed errors and successes across roster changes. A new request immediately disables Save and duplicate Preview. The current generation alone can finish loading, and a successful retry enables Save. [Reducer](../tests/unit/reducer.test.ts) · [Browser checks](../tests/e2e/address.spec.ts) · [Production fixture measurements](../eval/l17-responsiveness.json) |

**Observed verification on the working diff over `8ece067`.** On Node v24.22.3, `npm run lint` and `npm run typecheck` exited 0. Setup passed 2/2, matching 71/71, unit 441/441, database 1/1, concurrency 222/222 and Chromium 24/24, with no skips. The commands were `npm run test:setup`, `npm run test:matching`, `npm run test:unit`, `npm run test:database`, `npm run test:concurrency` and `npm run test:e2e`. Playwright built and started the production app on loopback. In the twelve-second browser deadline case, the server published successfully, the first response stalled, Save stayed disabled on timeout, and Retry returned the same preview ID.

`npm run eval:responsiveness -- --address` observed 20 active drivers, 50 active passengers and 100 distinct newly published previews with zero stored hits. The first fetched all 1,070 fixture legs. The other 99 recomputed using prior observations after capacity edits. Each seated 50 at 11,500 seconds (= 50 × 230). Across 475 competing GET/PATCH requests starting in the load window, p95 was **23.2 ms** versus **10.3 ms** idle, an increase of **12.9 ms**. Both limits (500 ms and +250 ms) passed with zero timeouts or errors. [Raw timings, sample counts and checks](../eval/l17-responsiveness.json)

The sparse-batch test initially failed because it assumed a target ordering after grouping. The correction checks each returned column against its submitted coordinate and original request index. The independent maximum-roster case checks all 1,070 indices. [ISSUE-075 regression checks](../tests/unit/matrix-batches.test.ts)

The loopback tests seed the Geoapify provider namespace on fictional test snapshots and use a dummy key. The responsiveness run uses the shipped fixture provider and real HTTP to the local app. Live address search, account usage and upstream latency await D. Human inspection of A-9 is pending.

The [course specification](../PROJECT_SPEC.md) requires the content below, but does not require separate documents for each category. These are working records for the final slide deck; DEL-3 does not require a separate written report.

### Checkpoint C technical review

Reviewed the uncommitted diff over `8ece067`. Lint and typecheck passed, as did setup (2/2), matching (71/71), unit (441/441), database (1/1) and concurrency (222/222). An isolated production build passed all 22 address and zone Chromium workflows, including both new L-17 cases. The two other Chromium cases are covered by the implementer’s 24/24 run. The retained L-17 raw samples reproduce p95 of 10.31 ms idle (200 requests) and 23.16 ms under load (475 requests), with zero timeouts. The 100 previews include one cold solve and 99 covered rematches.

- **ISSUE-076, L-14.** Held the first preview after its two loopback matrix responses fully settled. Changed only driver capacity twice. A barrier confirmed both newer requests had read their respective versions and entered the permit wait before releasing the first. The requests returned 409, 409 and 200. The last response reported three required, three fetched and zero reused, and the provider saw four requests in total. The intermediate holder exited on its version recheck before copying its inherited observations. The next waiter replaced its handoff with that holder’s empty map.
- **ISSUE-077, L-13.** A counting-stub 503 carrying `Retry-After: 7` produced an application 503 with no retry header. The adapter parses the header but forwards it only for 429. Preserve the hint with the routing-unavailable classification.
- **L-16 control.** Held the sole pool connection while invoking a preview with its normal ten-second budget. The pool’s earlier acquisition timeout produced the expected retryable 503.

The additional probes used a temporary source copy, synthetic trips in the designated database and a loopback provider. C is in correction. A-9 student review is pending.

### Checkpoint C review corrections

The student asked Codex to address ISSUE-076 and ISSUE-077 on the reviewed, uncommitted C diff over `8ece067`. The bounded work is to reproduce both failures, preserve settled cells through successive permit holders, forward valid retry guidance on temporary provider failures, and verify the corrections using the counting loopback stub and the designated test database. A-9 independent student review remains pending.

**ISSUE-076.** The regression pauses v at publication after both provider responses have settled. A barrier at admission confirms v+1 is waiting before the second capacity edit and v+2 is waiting before v is released. Before the fix, all three statuses and the single database row were already correct, but both original rectangles appeared twice in the stub log. After the fix, the two older requests returned `409 STALE_VERSION`. The latest returned 200 with three reused cells, zero fetched cells and the expected 231-second assignment. PostgreSQL held exactly its preview ID at v+2. Each permit now owns a copy of matching-policy observations before its version recheck. An intermediate stale exit can hand them on, and the current holder filters them against its roster and validated evidence. [Counting-stub regression](../tests/concurrency/geoapify.integration.test.ts) · [Permit and policy scope](../tests/unit/routing-permit.test.ts)

**ISSUE-077.** After one successful rectangle the stub returned 503 on the second. Before the fix the application dropped Retry-After values of both 7 and 0. Afterward each response preserved the interval, the `ROUTING_UNAVAILABLE` code and the 503 status. The HTTP-date cases used a fixed receive time and returned seven seconds. Negative, fractional, malformed and missing hints produced no retry header. Every case left zero published rows. The existing quota test still requires `ROUTING_QUOTA`, its seven-second hint and zero further provider calls during cooldown. [Loopback cases](../tests/concurrency/geoapify.integration.test.ts)

**Fix revision.** Uncommitted working diff on `8ece067`. The verified Git blob prefixes are `71799daafce9` (permit), `7b655fd8a170` (preview service), `0d1676ac25bb` (adapter error), `49b4ef490671` (Geoapify transport) and `c3ef94705f9b` (PostgreSQL regressions).

**Observed rerun.** Node 24 `npm run lint` and `npm run typecheck` exited 0. The full `test:setup` (2/2), `test:matching` (71/71), `test:unit` (441/441), `test:database` (1/1), `test:concurrency` (232/232) and `test:e2e` (24/24) npm suites passed with zero skips. Playwright built and served the production candidate. The L-17 timings above are retained from the original run. Provider traffic during correction testing used the loopback stub. Checkpoint signoff and A-9 student review are pending.

### Verification of the C corrections

On the working diff over `8ece067`, lint, typecheck, an isolated production build, setup (2/2), matching (71/71), unit (441/441), database (1/1) and concurrency (232/232) passed. The 24 Chromium cases were last run by the implementer. The real PostgreSQL and loopback tests confirmed the original ISSUE-076 and ISSUE-077 reproductions. In an isolated copy, removing the inherited permit map made the three-version test send two extra matrix requests. Removing 5xx retry-hint forwarding failed all five expected-header cases. The four invalid or missing-hint controls still passed.

- **ISSUE-078.** Paused the cold one-driver preview after both rectangles were decoded and before publication. Lowered the only driver's capacity to zero. The successor immediately published an empty plan, but an independent SQL read found zero retained legs despite all three observations having settled. Released the old preview (409), restored two seats, and turned routing off. The rematch returned 503 ROUTING_UNAVAILABLE. Already-settled eligible legs can be copied without waiting for any pending upstream work.
- **ISSUE-079.** Two loopback 503 responses each supplied a valid hint seven seconds after the injected receive time. Both lost their header. One used `Sun Nov 06 08:49:37 1994`, the other `Saturday, 01-Jan-50 00:00:07 GMT` with a 2050 receive time. The parser accepts only the space-padded asctime spelling for days below ten and relies on the JavaScript century pivot for RFC 850 dates. [HTTP-date grammar and year rule](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7)

The zero-seat handoff blocks C signoff. A-9 student review and D1 remain pending.

### Zero-seat handoff and legacy retry-date corrections

The student asked Codex to correct ISSUE-078 and ISSUE-079 on the reviewed C working diff over `8ece067`. This episode covers immediate publication with eligible settled observations, seat restoration during an outage, and legacy Retry-After parsing against the receive time. Verification uses fictional trips, a loopback provider and the designated test database. Checkpoint signoff and A-9 review are pending.

**ISSUE-078.** Before the fix, a real PostgreSQL read of the zero-seat preview returned an empty leg array. After the fix, the same preview published while the first publisher was still paused. Its public result reported zero matches and zero required legs. The private evidence contained the three original directed durations (403.25, 346.75 and 519.5 seconds). The old publisher returned 409 when released. Restoring two seats with routing off returned 200, assigned the passenger at 231 seconds and reused all three legs with the same endpoints and observation times. The counting stub received two calls in total. Separate controls covered a settled no-route with a second batch stalled, a canceled driver, precedence of stored evidence, rejection after a corrupt candidate, and trip and policy isolation. [PostgreSQL cases](../tests/concurrency/geoapify.integration.test.ts) · [Snapshot isolation check](../tests/unit/routing-permit.test.ts)

**ISSUE-079.** Before the fix, both reported legacy dates produced a 503 without a retry hint. Both now return `503 ROUTING_UNAVAILABLE` with `Retry-After: 7`. The same loopback suite verifies both single-digit asctime day spellings, crossing a century, exactly 50 years ahead and one second beyond, and rejection of mismatched weekdays and malformed padding. The RFC 850 parser expands the year against the supplied receive instant before checking the weekday and calendar date. [Loopback cases](../tests/concurrency/geoapify.integration.test.ts) · [RFC 9110 §5.6.7](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7)

**Correction revision.** Working diff over `8ece067`. Git blob prefixes identify the permit (`066309b4a5a2`), preview service (`691e77bcae33`), transport (`11a48353ac56`), PostgreSQL regressions (`3ce0c07a225c`) and permit unit test (`72774f6bb0cf`). The targeted command `npm run test:concurrency -- geoapify.integration --reporter=verbose` passed all 44 cases.

**Full verification.** On Node 24, `npm run lint` and `npm run typecheck` passed. The `test:setup` (2/2), `test:matching` (71/71), `test:unit` (442/442), `test:database` (1/1) and `test:concurrency` (244/244) npm scripts all passed. The `test:e2e` script built the production app and passed all 24 Chromium cases. That gives 784 passing checks across the six suites. The L-17 latency figures come from the [earlier run](#checkpoint-c-technical-review). No live provider credits were used.

### Independent review of the zero-seat and date fixes

Reviewed the working diff over `8ece067`. Lint, typecheck, an isolated production build, setup (2/2), matching (71/71), unit (442/442), database (1/1) and PostgreSQL concurrency (244/244) passed. The 24 Chromium results are from the implementer’s run. The original zero-seat case retained all three legs and restored a 231-second assignment offline. The submitted asctime, two-digit year, rollover and fifty-year boundary cases passed.

- **ISSUE-080.** Held a cold preview after both provider rectangles settled. Cut the only driver's seats to zero, then paused the first zero-seat successor after computation and before publication. Released the old holder (409) and let a second zero-seat successor publish first. Both successors returned the same successful preview. An independent SQL read found zero legs in its evidence. Restoring two seats with routing disabled returned 503 ROUTING_UNAVAILABLE after just two upstream calls in the whole scenario. The first successor had a private copy of the observations, but the later winner had none.
- **ISSUE-081.** A stub 429 supplied `Sat, 01 Jan 10000 00:00:07 GMT`. JavaScript's date round trip preserved this malformed string. The application forwarded 251606727486 seconds in Retry-After. An immediate second request returned the same delay and the stub still had only one call, confirming that the shared limiter had adopted the value. The IMF-fixdate year has exactly four digits. [RFC 9110 §5.6.7](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7)

Both additional probes used an isolated source copy and the designated test database. C signoff awaits the covered-publication race correction. The A-9 student review remains pending.

### Covered publication race and malformed cooldown corrections

The student asked Codex to address ISSUE-080 and ISSUE-081 on the reviewed C working diff over `8ece067`. This episode covers competing zero-seat publishers, offline seat restoration, and the shared limiter after a malformed Retry-After date. Checks use the designated PostgreSQL test database and a counting loopback provider. Independent C signoff and A-9 review are pending.

**ISSUE-080.** Before the fix, the test sequence passed when the first covered caller inserted the row and failed when the second caller inserted it. PostgreSQL returned an empty leg array in the latter order. After the fix, barriers forced each order after the superseded routing holder exited with 409. In both runs the two callers received identical 200 responses, and the single stored preview contained all three durations (346.75, 403.25 and 519.5 seconds). Restoring two seats with routing off produced one match at 231 seconds and reused the same three directed observations and timestamps. The stub counted exactly two calls per run. A separate permit test checks trip and policy isolation, inheritance by a newer version, and cleanup when the last publisher exits. [Race regressions](../tests/concurrency/geoapify.integration.test.ts) · [Handoff lifetime test](../tests/unit/routing-permit.test.ts)

**ISSUE-081.** Before the fix, the malformed year 10000 on a loopback 429 produced a retry interval of 251,606,727,219 seconds. The fixed adapter returned `503 ROUTING_QUOTA` with the malformed hint omitted. On the same limiter, a retry 999 ms later returned a one-second hint with the stub still at one call. At 1,000 ms the next preview reached the stub and succeeded. The test advances the monotonic clock without replacing the adapter. [Loopback regression](../tests/concurrency/geoapify.integration.test.ts) · [HTTP-date grammar](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7)

**Correction revision.** Uncommitted working diff over `8ece067`. Git blob prefixes identify the preview service (`f7bef52ec048`), permit (`995f5f55db68`), transport (`50c724feafce`), PostgreSQL regressions (`a0e8111e25fe`) and unit tests (`ca280144fa3b`).

**Verification.** On Node 24, `npm run lint` and `npm run typecheck` passed. The `test:setup` (2/2), `test:matching` (71/71), `test:unit` (443/443), `test:database` (1/1) and `test:concurrency` (249/249) npm scripts passed. The `test:e2e` script built the production app and passed all 24 Chromium cases. The six suites passed 790 tests in total. The L-17 benchmark figures are from the earlier run. No live provider queries ran.

### Independent C signoff review

The uncommitted candidate over `8ece067` passed technical review on loopback. ISSUE-080 and ISSUE-081 are closed. Independent student inspection of A-9 is pending.

- With either zero-seat publisher winning, PostgreSQL stored one preview with all three original leg estimates. Restoring seats with routing disabled assigned one passenger at 231 seconds. The provider received exactly two matrix calls.
- An independent failure probe held two covered publishers, let the older routing request exit, then caused the first covered publisher to fail before insertion. The database still had zero rows and the surviving peer had all three observations. That peer published successfully and the shared state cleared. The outage rematch reused all three legs.
- The malformed five-digit year on a 429 produced `503 ROUTING_QUOTA` with the upstream retry hint omitted. At 999 ms the limiter still blocked a call, and at 1,000 ms a new preview succeeded.
- In a temporary source copy, disabling publication sharing caused the later-arriving winner to store zero legs. Removing the four-digit year check forwarded a retry interval exceeding 251 billion seconds. The regression assertions caught both changes.

Lint, typecheck, setup (2/2), matching (71/71), unit (443/443), database (1/1) and PostgreSQL concurrency (249/249) passed. An isolated production build passed the 22 address and zone Chromium workflows. The two remaining Chromium cases were last run in the implementer’s 24/24 run. No live provider queries ran.

## Validation results — VR-1 through VR-3, RR-4

For each significant claim, retain the starting state, exact command/interaction, independently established expectation and derivation, actual output, and code/test/commit. Record failures and subsequent verification where relevant. Agent-reported success alone is not independent acceptance (AR-3).

The table maps all 38 IDs in the [acceptance contract](ARCHITECTURE.md#7-validation-and-demo-contract) to the named test or benchmark and its observed result. Run each linked suite with the npm command shown. The [candidate audit](#w6-candidate-audit) records the initial W5 reproduction. The [W6 review corrections](#w6-review-corrections) record the full rerun and strengthened U-02 check at `1a831f1`.

| Acceptance ID | Reproduction command and executable check | Observed result |
|---|---|---|
| M-01 | [`npm run test:matching`](../tests/matching/matching.test.ts) | Passed. Two seated for cost 4. Greedy also seated two but cost 101. |
| M-02 | [`npm run test:matching`](../tests/matching/matching.test.ts) | Passed. One driver with two seats served exactly two of five compatible passengers. |
| M-03 | [`npm run test:matching`](../tests/matching/matching.test.ts) | Passed. Both empty supply and zero capacity yielded zero matches and zero cost. |
| M-04 | [`npm run test:matching`](../tests/matching/matching.test.ts) | Passed. The missing edge was excluded and the zero-cost edge remained usable. |
| M-05 | [`npm run test:matching`](../tests/matching/matching.test.ts) | Passed. Tied optima gave stable assignments across repeated and permuted inputs. |
| M-06 | [`npm run test:matching`](../tests/matching/matching.test.ts) | Passed. Match count and cost agreed with exhaustive enumeration on all 100 tiny seeds. |
| M-07 | [`npm run test:matching`](../tests/matching/matching.test.ts) | Passed. The validator rejected duplicates, excess capacity, wrong totals, unknown members, missing partition members and incompatible pairs. |
| M-08 | [`npm run test:matching`](../tests/matching/matching.test.ts) | Passed. The only full plan seated two for cost 3. Greedy seated one for cost 1. |
| M-09 | [`npm run test:matching`](../tests/matching/matching.test.ts) | Passed. Invalid inputs were rejected and inclusive seat/cost boundaries were accepted. The bounds regressions also exercised the maximum roster. |
| M-10 | [`npm run test:matching`](../tests/matching/matching.test.ts) | Passed. Production projection removed inactive participants. The independently summed assignment cost and match count agreed with the oracle. |
| C-01 | [`npm run test:concurrency`](../tests/concurrency/races-recovery.integration.test.ts) | Passed. One contending commit returned 200, the other 409. Disabling the version guard let both apply. |
| C-02 | [`npm run test:concurrency`](../tests/concurrency/preview-commit.integration.test.ts) | Passed. Canceling a driver after preview made commit return 409 STALE_VERSION and left zero assignments. |
| C-03 | [`npm run test:concurrency`](../tests/concurrency/preview-commit.integration.test.ts) | Passed. Adding a participant after preview made the old preview stale at commit. |
| C-04 | [`npm run test:concurrency`](../tests/concurrency/mutations.integration.test.ts) | Passed. Concurrent same-key driver and passenger registrations each produced one record and one version increment. |
| C-05 | [`npm run test:concurrency`](../tests/concurrency/races-recovery.integration.test.ts) | Passed. A terminal failure between plan DELETE and INSERT restored the prior plan and version. The original success receipt and new failure receipt both persisted. |
| C-06 | [`npm run test:concurrency`](../tests/concurrency/races-recovery.integration.test.ts) | Passed. Writes to trip B completed on a second connection while trip A’s row lock remained held. |
| C-07 | [`npm run test:concurrency`](../tests/concurrency/preview-commit.integration.test.ts) | Passed. Reducing capacity cleared the plan, advanced the version once and set needs_rematch. The replacement respected the new capacity. |
| C-08 | [`npm run test:concurrency`](../tests/concurrency/races-recovery.integration.test.ts) | Passed. A cancellation committed between dashboard reads. The original snapshot remained internally consistent. |
| C-09 | [`npm run test:concurrency`](../tests/concurrency/mutations.integration.test.ts) | Passed. An equivalent payload replayed, conflicting reuse returned 409, and a stale edit under a new key was rejected. |
| C-10 | [`npm run test:concurrency`](../tests/concurrency/mutations.integration.test.ts) | Passed. Retrying the original key after a later mutation replayed its stored response without another effect. |
| C-11 | [`npm run test:concurrency`](../tests/concurrency/mutations.integration.test.ts) | Passed. Current-version no-op edits and repeated cancellations preserved the version. Replaying registration left the participant inactive. |
| C-12 | [`npm run test:concurrency`](../tests/concurrency/mutations.integration.test.ts) · [foreign-preview case](../tests/concurrency/preview-commit.integration.test.ts) | Passed. The foreign driver edit returned 404. Competing adds respected the 20-driver limit and inactive passenger records counted toward 50. The W6 addition also rejected a foreign preview at equal versions with 404 NOT_FOUND and preserved the target snapshot. |
| C-13 | [`npm run test:concurrency`](../tests/concurrency/races-recovery.integration.test.ts) | Passed. Changing the roster during preview computation produced 409 with zero stale preview rows. Retry published successfully. |
| C-14 | [`npm run test:concurrency`](../tests/concurrency/preview-commit.integration.test.ts) | Passed. Malformed IDs and extra commit fields were rejected. A superseded algorithm conflicted and invalid stored JSON produced an error without a trip mutation. |
| C-15 | [`npm run test:concurrency`](../tests/concurrency/races-recovery.integration.test.ts) | Passed. Concurrent cache misses returned the same stored preview ID and results. Only one row persisted and the trip version stayed fixed. |
| C-16 | [`npm run test:concurrency`](../tests/concurrency/races-recovery.integration.test.ts) | Passed. Transport loss, durable commit with a lost acknowledgement and confirmed rollback each discarded the connection. Same-key recovery produced one effective mutation. |
| C-17 | [`npm run test:concurrency`](../tests/concurrency/mutations.integration.test.ts) | Passed. Savepoint rollback preserved prior state. A waiting same-key retry replayed the terminal failure. Lost acknowledgement and failure-receipt persistence errors followed their distinct recovery paths. |
| C-18 | [`npm run test:database`](../tests/database.integration.test.ts) · [readiness](../scripts/check-readiness.ts) | Passed. App-role cost editing returned 42501. A retained-data cost change failed dataset validation and migration. Offline reset restored the fixture with a new trip ID. Readiness returned 503 DATASET_MISMATCH during drift. |
| C-19 | [`npm run test:concurrency`](../tests/concurrency/mutations.integration.test.ts) | Passed. Concurrent identical creates returned one trip ID. Conflicting input returned 409. A finalized failed creation replayed with zero trips created. |
| WF-1 | [`npm run test:e2e`](../tests/e2e/workflow.spec.ts) · [persisted totals](../tests/concurrency/preview-commit.integration.test.ts) | Passed. Create, register, preview, save and reload preserved the named assignment and totals. |
| WF-2 | [`npm run test:e2e`](../tests/e2e/workflow.spec.ts) | Passed. Changing availability cleared the saved plan and manual rematching saved a valid replacement. |
| WF-3 | [`npm run test:e2e`](../tests/e2e/workflow.spec.ts) | Passed. Two tabs saw the same trip. A save in one made the other tab’s stale save request a review and refresh. |
| WF-4 | [`npm run test:e2e`](../tests/e2e/workflow.spec.ts) · [persisted totals](../tests/concurrency/preview-commit.integration.test.ts) | Passed. A North driver and East passenger produced one persisted match at cost 7 through the service and the browser. |
| U-01 | [`npm run test:unit`](../tests/unit/reducer.test.ts) | Passed. Learning version 6 invalidated the version-5 preview. Delayed responses could not lower the version floor. |
| U-02 | [`npm run test:e2e`](../tests/e2e/workflow.spec.ts) | Passed. After withdrawal and reload, the browser sent the original key and body, received the original applied receipt and preserved the withdrawn roster and trip version. [Negative control](#w6-review-corrections) |
| U-03 | [`npm run test:e2e`](../tests/e2e/workflow.spec.ts) | Passed. Unavailable session storage blocked writes before transmission while reading and previewing still worked. |
| U-04 | [`npm run test:unit`](../tests/unit/reducer.test.ts) | Passed. A matching finalized failure released the pending operation. Unknown outcomes and old-key replies preserved it, and Commit remained disabled while a write or refresh was pending. |
| P-01 | [`npm run eval:responsiveness`](../scripts/eval-responsiveness.ts) · [W6 run](../eval/w6/p01-responsiveness.json) | Passed. 100 fresh previews on the 20/50 fixture, zero cache hits. The competing client’s p95 was 12.5 ms (+1.7 ms over idle), with zero errors and timeouts. |

Earlier supporting checks from the W1 record:

| Claim/check | Input or reset state | Command / interaction | Expected result and independent basis | Actual output / artifact | Code / test / commit |
|---|---|---|---|---|---|
| Greedy-substitution mutant | M-01 and M-08 fixtures run through greedy | `npm run test:matching` | Greedy must fail M-01 (cost 101≠4) and M-08 (1≠2 matched); real optimizer passes both | Mutant failed both expectations; optimizer passed. Passed. | [mutant.test.ts](../tests/matching/mutant.test.ts) / W1 diff |
| Normalizer/fingerprint vectors | Fixed UUID, label (NFC/trim), timestamp (offset→UTC ms), integer (−0, bounds), canonical-JSON, and SHA-256 fingerprint vectors | `npm run test:matching` | Observed values match the pinned vectors; key order does not change the fingerprint; method/route changes do | All passed; create-trip fingerprint pinned to `3d70b8bc…d8885` | [contracts.test.ts](../tests/matching/contracts.test.ts), [normalize.ts](../src/contracts/normalize.ts) / W1 diff |
| Early solver timing | Dense 20-driver/50-passenger uncached instance, 100 samples after warmup | `npm run eval:matching` | Pure solver p95 well under the W5/P-01 100 ms target on this host | p95 ≈ 1.9 ms, median ≈ 1.7 ms on Node 24.22.3 (not the demo-machine gate) | [eval-matching.ts](../scripts/eval-matching.ts) / W1 diff |

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
| A-3: W2 durable mutations | User asked to proceed with W2 in the current working tree: build the shared mutation helper first (global request-key lock → receipt lookup → trip lock → business savepoint → terminal receipt/commit), including ISSUE-006 (distinguish an explicit server-rejected commit from a lost acknowledgement); then consistent reads, create/register/edit/cancel/withdraw services and their JSON routes with normalization, bounds, error/outcome metadata, and dataset readiness; then the real-PostgreSQL C-04/C-09/C-10/C-11/C-12/C-17/C-19 checks. | W2 diff on `7483c57`: `src/contracts/errors.ts`, `src/db/{advisory-lock,transaction,pool}.ts`, `src/trips/{mutation,repository,service}.ts`, `src/app/api/http.ts` and the trip route handlers, `tests/concurrency/mutations.integration.test.ts`, `vitest.concurrency.config.ts`, and `package.json` scripts. [W2 closeout](#w2-closeout) | Database-free checks passed. The 21-case live suite passed, including C-17 failure replay under contention. [C-17 host evidence](#w2-c-17-racing-failure-coverage-closes-issue-019) | Student reported the original W2 failure and reran the suite. Independent acceptance of the W2 implementation (A-3) is pending; the technical gate is satisfied. |
| A-4: W3 complete workflow | User committed W2 (`eb1e864`) and asked to proceed with W3: snapshot→compute→version-checked preview publish, commit by preview ID via W2's helper, the minimal creation/roster/preview/saved-plan pages, one reducer for version/preview state, session-storage recovery, and the W3 checks. | W3 diff on `eb1e864`: `src/trips/{preview,commit}.ts`, preview/commit repository functions, `src/app/api/trips/[tripId]/match/{preview,commit}/route.ts`, `src/app/api/http.ts` (`runPreview`), `src/app/page.tsx`, `src/app/trips/{reducer,pendingStore}.ts`, `src/app/trips/[tripId]/page.tsx`, `tests/concurrency/preview-commit.integration.test.ts`, `tests/unit/reducer.test.ts`, `playwright.config.ts`, `tests/e2e/`. A review round then added the five corrections (ISSUE-021–025). [W3 progress](#w3-progress) · [corrections](#w3-implementation-review-corrections) | The final host run passed 36 concurrency checks, 33 unit tests and 12 Playwright cases, including WF-1 through WF-4 and U-02/U-03. Lint, typecheck, build pass; `npm run demo` and README walk-through added. The student opened the same trip in two tabs and saw matching previews. After saving in the first tab, reloading the second showed the saved plan. On the stale-save check the student saw “The trip changed. Review the refreshed state and resubmit.” | Accepted W3 as reviewed. The student based the decision on the saved plan persisting after reload and the review prompt when a second tab attempted a stale save. |
| A-6: W5 evaluation and scope defense | User committed W4 (`8f3187a`) and asked to proceed with W5: run the D-1 matching comparison (both algorithms on M-01/M-08, the 100 tiny oracle seeds, and 5/15/30/50-passenger sizes up to 20 drivers; zero fixture/oracle/invariant discrepancies; median/p95 pure solver time at the maximum bounds with warmup), the D-2 outside-lock-vs-long-lock preview experiment on real PostgreSQL with a controllable gate and a bounded watchdog (both variants preserve invariants; the stale long-lock preview's commit is rejected), and the P-01 responsiveness experiment on a production build (100 uncached max-size preview requests while a competing client reads/edits another trip; competing-request p95 and increase-over-idle measured). Retain seeds, sizes, cache status, environment, revision, and raw artifacts. | W5 diff on `8f3187a`: `scripts/eval-matching.ts` (D-1), `scripts/eval-concurrency.ts` (D-2), `scripts/eval-responsiveness.ts` (P-01), the three `eval:*` npm scripts, the eval-only test-DB-gated server telemetry (`src/trips/preview-telemetry.ts`, `src/app/api/eval/telemetry/route.ts`, instrumentation in `publishPreview`), and the retained artifacts `eval/d1-matching.json`, `eval/d2-concurrency.json`, `eval/p01-responsiveness.json`. [W5 closeout](#w5-closeout) · [fourth-round corrections](#w5-correction-verification-fourth-round) | After four review rounds, ISSUE-031–035 are closed. D-1 exact sizes (oracle 100/100); D-2 full blocking interval + exact `STALE_VERSION`; P-01 ends the window at preview completion (290 in-window / 110 excluded), requires a finite matcher duration per compute, and verifies the persisted 20/50 roster — the `roster`, `duplicate`, `preview`, and `edits` controls all fail; normal run competing under-load p95 12 ms, increase 1.7 ms. Full suites, lint, typecheck, build passed live. | The student approved the D-1 and D-2 judgments below and the following P-01 judgment. “I would accept the responsiveness evidence for the current scope. The benchmark used a trip with 20 drivers and 50 passengers and computed 100 distinct previews with zero cache hits. While that work ran, a client reading and editing another trip had a p95 latency of 12.5 ms, only 2.2 ms above idle. Both figures are within our targets of 500 ms and 250 ms, respectively. This supports the current roster limits on the tested machine. I would repeat the measurement before raising those limits or claiming similar performance with many simultaneous users.” The student chose to defer independent inspection until after the technical work. Before submission, record what they personally inspected or ran and what they observed. [P-01 results](../eval/p01-responsiveness.json) · [Decision record](#two-decisions--dr-1) |
| A-5: W4 races and failure recovery | User committed W3 (`9040695`) and asked to proceed with W4: add the controlled-concurrency and uncertain-commit integration coverage (C-01, C-05, C-06, C-08, C-13, C-15, C-16) against real PostgreSQL with separate clients, forcing interleavings with barriers/`pg_locks`/`pg_blocking_pids` and bounded watchdogs (no timing sleeps); distinguish a confirmed rollback from a lost commit acknowledgement; check connection cleanup and subsequent pool use; and prove the suite's sensitivity with a controlled commit-version-guard mutant that C-01 must detect, then restore the guard and pass again. Two review rounds then strengthened five checks (ISSUE-026–030) to drive the real code paths, including a third C-16 case that simulates a lost database acknowledgement after a durable commit. The [final verification](#c-16-fault-placement-resolved-in-the-suite) records the retained regression check. | W4 diff on `9040695`: `tests/concurrency/races-recovery.integration.test.ts` (10 cases) and four test-only seams — `__setCommitVersionGuardEnabled` (`src/trips/commit.ts`), `__setPublishBarrier` (`src/trips/preview.ts`), `__setCommitPlanMidHook` (`src/trips/repository.ts`), and `__setSnapshotBarrier` (`src/trips/service.ts`). [W4 closeout](#w4-closeout) · [corrections](#w4-technical-review-corrections) · [C-16 durable case](#w4-correction-c-16-durable-lost-acknowledgement-case) | After the corrections: `npm run test:concurrency` 46/46 (incl. the strengthened C-01/05/08/15/16 and the C-01 mutant), `npm run test:e2e` 12/12 (incl. WF-3), `npm run test:unit` 33/33, `npm run test:matching` 69/69, `npm run test:setup` 2/2, lint, typecheck, and the production build all passed live on the local test database. The mutant is test-sensitivity evidence, not the required real debugging story. | Pending: independent student review and decision. |
| A-7: Address checkpoint A (offline workflow and migration) | The student asked the agent to follow the WORKPLAN searchable-pickups sequence and implement checkpoint A: A1 schema upgrade and transactional generation reset, A2 fixture search and signed selections, A3 dual-mode create and register, A4 one complete offline trip in the browser; satisfy L-01–L-04 against real PostgreSQL and Chromium, preserve zone behavior, and record observations. Bounded to checkpoint A: no live provider, no leg reuse or retention (B), no deadlines or permits (C). | Working diff over `12aaab3` (uncommitted): `db/migrations/002_address_trips.sql`, `src/db/setup.ts`, `src/locations/*`, `src/routing/*`, `src/matching/address.ts`, `src/trips/{address-evidence,address-preview,address-roster}.ts` and mode-aware `{service,repository,preview,commit}.ts`, `src/contracts/{index,errors}.ts`, the cross-site check in `src/app/api/http.ts` and the eight write routes, `src/app/api/locations/search/route.ts`, `src/app/locations/LocationPicker.tsx`, the two pages, `data/fixture-places.json`, and eleven test files. [Checkpoint A closeout](#checkpoint-a-closeout) | Lint and typecheck exit 0. Setup 2/2, matching 69/69, unit 192/192, database 1/1, concurrency 104/104 (47 prior + 57 new), Chromium 22/22 (12 prior + 10 new), no skips. These are the counts after both rounds of review corrections ([first](#checkpoint-a-corrections), [second](#checkpoint-a-second-corrections)); the first closeout run had unit 158, concurrency 88 and Chromium 16. Eight sensitivity mutants were applied in the first round (seven caught, one undetectable because a second layer covers it) and more in the corrections round. One product defect was found and fixed by the author (ISSUE-053); the technical review then found six more (ISSUE-048, 054–058), all now fixed. | Pending: the student has not yet reviewed or run this work. |
| A-8: Address checkpoint B (independent verification, reuse and recovery) | The student committed checkpoint A and asked the agent to proceed with checkpoint B: B1 verify the address projection independently (L-05, L-06, L-10); B2 build trip-local leg reuse with zero-seat retention and verify cold-versus-reused equivalence, 2→0→2 seats through an outage, incremental cell counts, pruning and a cold rebuild after corrupt evidence (L-07–L-11); B3 validate reads and commits by SQL and serialized response (L-11, L-12). Bounded to B: no live adapter, permits, handoff or deadlines (C), no live search (D). | Working diff over `161df83` (uncommitted): `src/matching/address.ts` (retention), `src/trips/address-{evidence,preview,metrics}.ts`, `preview.ts`, `repository.ts`, `src/routing/{adapter,index}.ts`, `src/contracts/errors.ts`, and nine test files including `tests/matching/address-{reference,projection.compare}` and `tests/concurrency/address-{reuse,evidence-reads}.integration.test.ts`. [Checkpoint B closeout](#checkpoint-b-closeout) | Lint and typecheck exit 0. Setup 2/2, matching 71/71, unit 230/230, database 1/1, concurrency 199/199 and unit 435/435 after the second corrections, Chromium 22/22, no skips (counts after the technical review's corrections; the first closeout run had concurrency 144). 150 seeded scenarios agree with an independent reference and the exhaustive oracle. Sixteen mutants were caught in the first round, ten more in the corrections and six in the second corrections. One design gap was found by the author (ISSUE-064); the technical review then found five defects (ISSUE-065–069) and a sibling was found while fixing them (ISSUE-070), all fixed. | Pending: the student has not yet reviewed or run this work. |
| A-9: Address checkpoint C | The student asked Codex to start C. Verify the adapter, preview concurrency, shared deadline and waiting organizer on loopback (L-13–L-17). | Working diff on `8ece067` covering routing, preview, transactions, browser, tests and address evaluation. [C implementation and results](#checkpoint-c-implementation) | [Acceptance observations](#checkpoint-c-implementation) · [First corrections](#checkpoint-c-review-corrections) · [Follow-up corrections](#zero-seat-handoff-and-legacy-retry-date-corrections) · [Publication and cooldown corrections](#covered-publication-race-and-malformed-cooldown-corrections) | A-9 independent student inspection and decision pending. |
| A-10: Address checkpoint D | Start D after the independent C signoff. Prepare attribution and the two-region live pilot. | Working diff over `2b50353` covering autocomplete, quota sharing, attribution and the four review corrections. | [D pilot preparation](#checkpoint-d-pilot-preparation) · [Review corrections](#checkpoint-d-review-corrections) · [Primary number follow-up](#primary-street-number-follow-up) · [Grid pickups and numeric venues](#grid-pickups-and-numeric-venue-names) · [Locality and venue ambiguity](#locality-and-venue-ambiguity-corrections) · [Highway and street matching](#highway-searches-and-independent-street-matching) · [Directional highways and locality](#directional-highways-and-locality-without-commas) · [Florida and Oregon](#florida-postal-codes-and-oregon-route-numbers) · [General locality matching](#general-locality-matching-and-state-aliases) · [Locality and unit ambiguity](#locality-and-unit-ambiguity-corrections) | A-10 student inspection pending. L-18 and L-19 passed. The owner confirmed 12 credits for both trips combined. [Closeout](#checkpoint-d-technical-closeout) |

D-0, D-BASE, D-CONTRACTS, and D-HANDOFF record design/planning provenance. A-1 through A-6 are the retained implementation and evaluation episodes; A-4 (W3) is student-accepted, A-5 (W4) awaits independent student review. A-1 documents a student-reported failure that changed the C-18 test fixture. The student supplied the assertion and verified the correction. The student still needs to confirm their own correction decision and rationale for the course episode record. Agent-proposed redesigns are not recorded as human corrections.

### W6 candidate audit

Bounded request for this episode: reconcile the 38 acceptance IDs against executable checks and observed results, fill attribution and course records where evidence exists, document the reset-overlap limitation, and prepare course materials for student review. Verify the W5 candidate from a fresh checkout and add a focused check if a contracted behavior lacks coverage. Student decisions and external confirmations remain with the student.

On 2026-11-23 the reviewer cloned `2d4768b` with `git clone --no-local` into a temporary directory, copied the tracked `.env.example` to `.env`, and used Node 24.22.3. A lockfile install (`npm ci --offline --no-audit --no-fund`) used the host npm cache. The checkout had its own dependencies. An isolated Compose project started PostgreSQL on a new volume. Demo migration ran twice, followed by test migration. Playwright used Chromium installed in the host browser cache.

| Commands in the fresh checkout | Observed result |
|---|---|
| `npm run test:setup`, `test:matching`, `test:unit`, `test:database`, `test:concurrency`, `test:e2e` | 2/2, 69/69, 33/33, 1/1, 46/46 and 12/12 respectively. No skipped tests reported. |
| `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:readiness` | All exited 0. Production was ready, drift returned 503, and development was ready after offline reset. |
| `npm run eval:matching`, `npm run eval:concurrency`, `npm run eval:responsiveness` | D-1 agreed with the oracle on 100/100 seeds and solver p95 was 2.047 ms. D-2 passed both lock variants. P-01 counted 291 in-window competing requests, 100 distinct uncached previews and 100 finite matcher durations. Competing p95 was 11.7 ms (+1.5 ms). The repository retains the original W5 JSON files. |
| `npm run demo` | Reset the separate demo database, served the create-trip page and returned HTTP 200 with a ready status. The browser suite exercised the save/reload/rematch path on the test database. |

**C-12 verification delta.** The candidate already tested cross-trip driver references and record caps. The audit added an equal-version foreign-preview commit test to the preview/commit suite. With only that test overlaid on the candidate, the concurrency suite passed 47/47 and typecheck passed. The W6 candidate includes this regression and the acceptance map. The disposable Compose service was stopped after verification.

**Repository and course checks.** The configured GitHub repository’s metadata endpoint returned HTTP 200 without credentials on 2026-11-23. Public read access was observed. Team ownership, partner setup, Canvas submission and demo booking require student confirmation. A local scan of all refs through `2d4768b` inspected 134 reachable file blobs. Homework/handout/starter-code markers appeared only in repository instructions, the specification, workplan and evidence. No historical PDF paths were found. This is a path/content screen. Students must confirm the provenance of code, tests and data, including any material without those labels.

### W6 release-candidate verification

The student asked to proceed with W6. Retain the audit, focused C-12 regression and draft PDFs in Git. Reproduce that revision from a fresh clone and empty designated databases, verify all 38 acceptance IDs, and record the exact candidate and results. Student acceptance and submission remain pending.

On the first W6 candidate (`f306937`), 47/47 concurrency cases passed. Chromium passed 11/12. The lost-creation test sometimes asserted the committed ID while the pending banner was already visible but the intercepted POST had yet to finish. On that failure, closing the context disposed the pending response. The correction waits for the browser’s unknown-outcome alert, which is rendered after it consumes the simulated 503. The test still checks the original key, trip ID and persisted state. The verification below closes ISSUE-039.

An intermediate fix (commit `0bcd81c`) reached the expected 503 handler, but its alert selector also matched the Next.js route announcer. The final test waits for the exact recovery message.

**Technical outcome.** Candidate `5d86e5b` includes the C-12 cross-trip regression and ISSUE-039 test fix. A separate clean clone used only the tracked env example, Node 24.22.3, the lockfile, the host npm/Chromium caches and a new isolated PostgreSQL volume. The demo database was migrated twice and the test database once. Both began empty. All 38 architecture IDs have a row in the acceptance table. The original suites passed. The subsequent review below qualifies the U-02 result.

| Check | Observed on `5d86e5b` |
|---|---|
| Setup, matching, unit, database, concurrency and full Chromium suites | 2/2, 69/69, 33/33, 1/1, 47/47 and 12/12 passed, with zero skips. |
| ISSUE-039 regression | `npm run test:e2e -- --grep "a lost creation retries" --repeat-each=10` passed 10/10. |
| Lint, typecheck, production build and readiness | All exited 0. The readiness check observed healthy production, 503 on dataset drift and healthy development after reset. |
| Production demo database | `npm run demo` reset the demo database and served the creation page and health endpoint. Chromium replayed the three WF scenarios against the running demo on port 3000. All passed, including the cost-7 save/reload, rematch and stale-save prompt. |
| D-1 and D-2 | The solver matched the oracle on 100/100 seeds with zero discrepancies and a maximum-bound p95 of 1.936 ms. The long-lock run recorded a 28 ms blocking interval. Both stale-version checks passed. Historical artifacts are in `5c3525c:eval/w6/`. |
| P-01 | The 20-driver, 50-passenger run served 100 distinct uncached previews. Competing p95 was 12 ms and the change from idle was +1.4 ms, with zero errors or timeouts. Historical artifact is in `5c3525c:eval/w6/p01-responsiveness.json`. |

The initial verification marked R2 passed. The subsequent review reopened it for U-02. Student inspection, attribution confirmation, final template and submissions remain open under R3. The demo and isolated database service were stopped after verification.

### W6 technical review

Reviewed `2d4768b..5c3525c` from a fresh clone at `5c3525c` with Node 24.22.3, cached lockfile dependencies and Chromium, and a new PostgreSQL volume. Setup 2/2, matching 69/69, unit 33/33, database 1/1, concurrency 47/47 and Chromium 12/12 passed. The corrected lost-create case passed 10/10 repeats. Lint, typecheck, build and readiness passed. All three demo browser scenarios passed on port 3000 using the prior rehearsal’s temporary Playwright config. The isolated database service was stopped.

- **ISSUE-040 · U-02.** In the review clone, the passenger Retry handler was changed to clear the pending key, report success and refresh without transmitting a mutation. The existing [U-02 test](../tests/e2e/workflow.spec.ts) passed 3/3 repeats, and a database read found all three originally submitted passengers. The visible row and cleared banner therefore cannot establish receipt replay. A separate control that changed the retry name received 409 and failed the test. To close the finding, explicitly forward and confirm the first write, hide its success, reload, observe both keyed requests and compare their bodies. Verify the stored outcome, version and participant state after retry, including a cancellation between attempts. The skipped-POST control must fail.
- **ISSUE-041 · D-1 evidence.** The review run agreed with the oracle on 100/100 seeds, with zero discrepancies and maximum-bound solver p95 of 1.84 ms. The artifact at `5c3525c:eval/w6/d1-matching.json` retained four aggregate oracle counts. Individual inputs, objectives, feasibility and timing for the tiny seeds cannot be inspected in that run. Size-class entries include objectives and sizes, while runtime is summarized only for the separate maximum-bound batch. Retain the observations specified in [D-1](ARCHITECTURE.md#d-1-exact-matching-versus-greedy) when regenerating the artifact. D-2 passed both variants. P-01 served 100 distinct fresh previews with 100 finite matcher durations and competing p95 of 12.4 ms (+1.9 ms over idle).
- **ISSUE-042 · Clean-checkout instructions.** Before dependency installation, the first README command block passed setup 2/2 and then failed with `vitest: command not found`. Matching passed 69/69 after `npm ci`. The standard [browser config](../playwright.config.ts) starts port 3100 and resets the test database. Reproducing the separately reported automated demo check on port 3000 used an untracked config without the test reset. Put installation before matching and retain the demo browser invocation or its equivalent in the repository. The manual README demo works.

The acceptance map contains 38 distinct IDs. The proposal has one page and the draft deck has six. A marker scan of the 151 blobs reachable from `5c3525c`, including extracted text from both PDFs, matched only AGENTS, PROJECT_SPEC, WORKPLAN and EVIDENCE. Student provenance confirmation, the official template and submission tasks remain open.

### W6 review corrections

Bounded request: address ISSUE-040–042. Verify receipt replay across reload and cancellation with a skipped-POST control, retain case-level D-1 measurements, and reproduce the documented installation and demo commands in a fresh checkout. Student review is pending.

Candidate `1a831f1` was cloned into an empty directory with its own dependencies. The run used Node 24.22.3, the tracked env example, host caches for npm and Chromium, and an isolated Compose project with a fresh volume. The demo server and database service were stopped after verification.

| Finding | Verification on the corrected candidate |
|---|---|
| ISSUE-040 | The [browser case](../tests/e2e/workflow.spec.ts) forwarded the registration and hid its 201 reply. A separate PATCH withdrew the passenger. After reload, Chromium sent the same POST bytes and key, received the original 201 receipt with the replay header, and cleared the pending slot. The durable snapshot stayed at version 2 with one withdrawn passenger. In the disposable clone the prior review control cleared the pending operation and refreshed without resending. The case failed waiting for the retry response. Restoring the candidate passed 5/5 consecutive runs. |
| ISSUE-041 | The D-1 artifact at `27426c1:eval/w6/d1-matching.json` records both algorithms’ objectives, feasibility and runtime on two fixtures, 100 tiny seeds and 40 size-class cases. A separate enumeration over the 100 serialized tiny inputs reproduced every oracle and optimizer objective. All 142 pairs had finite timings and passed feasibility. The class totals reconciled to their 40 individual records. Maximum-bound solver p95 was 2.126 ms. |
| ISSUE-042 | In README order, `npm ci` installed the lockfile, setup passed 2/2 and matching passed 69/69. With the production demo running on port 3000, the tracked [demo configuration](../playwright.demo.config.ts) ran through `npm run test:demo`. All three browser scenarios passed, covering save/reload, rematch and stale save. |

The full clean run passed database 1/1, unit 33/33, concurrency 47/47, and Chromium 12/12, plus lint, typecheck, build and readiness. [D-2](../eval/w6/d2-concurrency.json) passed both lock variants. [P-01](../eval/w6/p01-responsiveness.json) recorded 100 distinct uncached previews, competing-client p95 of 12.5 ms (+1.7 ms over idle), zero errors and zero timeouts. All 38 acceptance IDs have passing evidence. R2 passed. Independent student acceptance and the R3 course checklist remain pending.


### W6 follow-up review

Reviewed the six W6 commits through `27426c1`. A fresh clone with Node 24.22.3, the host npm and Chromium caches, and a new Compose volume reproduced setup 2/2, matching 69/69, unit 33/33, database 1/1, concurrency 47/47 and Chromium 12/12. Lint, typecheck, production build, readiness and all three evaluations passed. The demo command passed 3/3 against port 3000. The omitted-retry control failed waiting for the registration response, and restored U-02 passed 5/5. The demo and isolated database were stopped after verification.

The retained and fresh D-1 runs each contained 142 paired case records. Independent enumeration of each artifact’s 100 serialized tiny inputs reproduced its oracle and optimizer results. D-2 observed a 28 ms blocking interval in the rerun. P-01 served 100 distinct uncached previews with competing p95 of 12.3 ms (+1.6 ms over idle). Both runs’ competing percentiles agreed with their respective raw HTTP samples to reporting precision. The acceptance map had 38 distinct IDs. The proposal and deck PDFs contained one and six pages respectively.

- **ISSUE-043 · Dense benchmark correctness.** In a second disposable clone, a control returned all passengers unassigned for inputs with 1,000 edges. The [maximum-bound benchmark](../scripts/eval-matching.ts) exited 0, reported zero discrepancies and recorded 0 matched at cost 0 with solver p95 of 0.003 ms. The unmodified candidate returned a feasible 50 matched at cost 113 and p95 of 1.944 ms. For the fixture’s 50 passengers, the lowest incoming costs sum to 113. Choosing those drivers assigns at most four passengers to any eight-seat driver, so this lower bound is attainable. Both real plans passed feasibility. Check the timed results outside the measured interval and require the control to fail.
- **ISSUE-044 · Retained timing samples.** The D-1 artifact at `27426c1:eval/w6/d1-matching.json` stores the sample count and the two solvers’ median and p95 for the dense fixture. It omits the 100 individual timings per solver. The other 142 cases describe different inputs. Retain the dense samples and verify that their percentiles reproduce the summaries.

The independent result and rerun support R2 for the current candidate. These findings concern future benchmark runs and the ability to audit their reported timings. ISSUE-040–042 remain closed. Student reviews and the course checklist remain open under R3.

### W6 dense benchmark corrections

Bounded request: address ISSUE-043 and ISSUE-044 in D-1. Validate each dense solver result outside the timed interval, retain the timing observations, repeat the skipped-work control, and verify that the published percentiles can be reproduced. Independent student review is pending.

Fix `c15b268` was run from a fresh clone using Node 24.22.3 and the cached lockfile install. Every measured call stops its clock before feasibility and objective validation. Both solvers returned a feasible plan with 50 matches at cost 113 on all 100 dense samples. Independently summing the cheapest incoming edge for each passenger gives 113, and those choices use at most four of any driver’s eight seats.

| Disposable-clone check | Observed result |
|---|---|
| Return all 50 passengers unassigned on the 1,000-edge optimizer input | `npm run eval:matching` exited 1 with exactly 100 objective discrepancies, one per dense optimizer sample. |
| Corrupt one greedy assignment’s driver ID on measured sample 37 while retaining the claimed count and cost | Exit 1 with exactly one feasibility discrepancy on `dense/sample-37/greedy`. |
| Restore the candidate and run D-1 again | Exit 0, zero discrepancies and oracle agreement on 100/100 seeds. Median/p95 were 1.629/1.854 ms for the optimizer and 0.705/0.801 ms for greedy. |

The [retained W6 artifact](../eval/w6/d1-matching.json) contains 100 finite, nonnegative observations in acquisition order for each solver. A separate Python check sorted each raw array and exactly reproduced the stored median and p95 from its 50th and 95th observations. Both negative controls ran only in the disposable checkout. Matching passed 69/69, lint and typecheck exited 0. Database and browser suites were last verified in the [W6 follow-up review](#w6-follow-up-review). R2 stands, and R3 student tasks remain open.

### W6 completion review

On 2026-11-24 a fresh clone of local candidate `8e2dc04` reproduced the README procedure using Node 24.22.3, the tracked env example, locally cached lockfile dependencies and Chromium, and a new isolated PostgreSQL volume. Review covered all eight commits after W5 (`2d4768b`). The acceptance table contains all 38 distinct architecture IDs.

| Check | Observed on the local candidate |
|---|---|
| Setup and release suites | Setup 2/2, matching 69/69, unit 33/33, database 1/1, concurrency 47/47 and Chromium 12/12. Lint, typecheck, production build and readiness passed. |
| Demo and registration recovery | The documented demo command passed all three browser scenarios on the demo database. Suppressing the registration retry POST failed U-02 at the response assertion. Restoring the candidate passed 5/5 repeats. The demo and database service were stopped. |
| D-1 | The independent enumeration agreed on all 100 tiny inputs. The dense fixture served 50 at cost 113 with optimizer p95 2.020 ms in the full run. The retained and fresh timing arrays reproduced their reported percentiles. Skipping dense solver work failed all 100 samples. Corrupting one greedy assignment failed its single measured sample. Restoring both solvers passed. |
| D-2 and P-01 | The observed lock holder blocked cancellation for a measured interval of 26 ms. Both stale paths returned STALE_VERSION. P-01 served 100 fresh previews with zero cache hits. Competing p95 was 12.7 ms (+2.4 ms over idle), with zero errors or timeouts. |

**Submission status.** A live read of GitHub’s default branch returned `main` at `2d4768b`, eight commits behind the reviewed candidate. The local proposal has one page and the draft deck has six. Their seven source links resolve to the cited Git revision. A keyword screen of 171 reachable file blobs, including PDF text, found course-material terms only in project records. Student confirmation of provenance and contributions is outstanding. Publication of the final candidate, student reviews, the official-template deck, demo rehearsal/booking and Canvas confirmations remain on the [W6 course checklist](../WORKPLAN.md#w6--clean-reproduction-and-submission).

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

## W2 closeout

W2 passed its technical gate on the uncommitted diff based on `7483c57`. It adds the mutation helper, services, five trip mutation handlers, a trip snapshot handler and an integration suite. A-3 owns the file list. The final host run passed all 21 PostgreSQL cases. [C-17 host evidence](#w2-c-17-racing-failure-coverage-closes-issue-019)

- **Human review.** The student independently ran the suite and reported its original failure. The corrected suite passed on the host. The A-3 decision remains pending. [Host rerun](#w2-host-rerun) This is not a submission-ready claim.

### W2 implementation review

The production build, lint, typecheck, 69 matching tests and two setup tests passed. Vitest listed nine W2 tests. A read-only test-database connection attempt returned `EPERM` on 127.0.0.1:55432, and Docker denied access to its socket. Live W2 assertions remain unobserved. These errors establish a session access limitation. They do not establish the state of the host daemon or database.

The following response probes used Node 24 with a local client double for `runKeyedMutation` wrapped in `runMutation`. The double supplied canonical dataset rows, recorded SQL, and returned successful command tags unless a case below specified an error. These results verify application control flow only.

| Finding | Input and observation | Required behavior |
|---|---|---|
| ISSUE-013 | Supply an applied receipt with a different fingerprint. The 409 returned the same key with `outcome: "not_applied"`. Throw ECONNRESET at COMMIT and the HTTP 503 reports `outcome: "unknown"` with an empty key. | A conflict must leave the original outcome intact. Identify the actual pending key on an uncertain commit. |
| ISSUE-006 | Throw EPIPE or 08007 at COMMIT. Both became HTTP 500 INTERNAL_ERROR. A deferred-constraint-shaped 23503 also became 500. Both commit handlers classify by code shape. | Distinguish a proven rollback from lost acknowledgement or explicitly unknown resolution. An uncertain outcome requires same-key recovery. A confirmed rollback alone cannot finalize a receipt. |
| ISSUE-014 | Throw an ordinary invariant Error inside the business callback. The helper ran a full rollback, attempted zero receipt inserts and returned 503 DATABASE_UNAVAILABLE. The suite injects an already classified TerminalBusinessError instead. | Roll back non-transient internal business failures to the savepoint and persist a terminal 500 receipt. Keep transient, receipt-write and commit failures outside this path. |
| ISSUE-015 | Source inspection shows SAVEPOINT precedes the callback that calls requireTrip / SELECT FOR UPDATE. | Acquire an existing trip lock before the savepoint so it survives rollback of business writes while finalizing the receipt. |
| ISSUE-016 | Return an empty zone result during the dataset guard. The helper reports DATABASE_UNAVAILABLE rather than DATASET_MISMATCH. An injected ECONNREFUSED from pool.connect produces 500 INTERNAL_ERROR. The GET route also has a generic 500 fallback for pool errors. | Preserve the readiness error and return the documented retryable database status for connection or lock failures. |
| ISSUE-017 | Pass readJsonBody a POST body consisting of 16,100 ASCII spaces followed by JSON.stringify of name and destinationLabel each containing 80 copies of 界 and departAt equal to 2026-01-01T00:00:00Z. The 16,647-byte, 16,327-code-unit body parsed successfully. | Enforce the 16 KiB limit in bytes during the read. |

By inspection, the test suite creates its app pool in beforeAll, resets in beforeEach and closes the pool only in afterAll. After the first test releases a connection to the pool, the next reset can see an app session in pg_stat_activity and refuse to run (ISSUE-018). Keep the offline reset guard and isolate each test's pool.

The C-04/C-12/C-19 tests do not force concurrent requests. C-11 reads the canceled driver without replaying its registration key. C-17 severs a success connection before COMMIT and checks for an absent receipt. It does not lose acknowledgement of an already committed failure or test failed receipt persistence. The suite also lacks an explicit server-rejected COMMIT and route-level checks. Close ISSUE-019 with deterministic interleavings, state/receipt assertions and HTTP observations. Listing or passing the current nine tests would still leave these gate requirements open.

#### W2 implementation review: corrections

Applied on the W2 working tree (uncommitted on `7483c57`), Node 24.22.3. Database-free checks were observed; the real-PostgreSQL suite remains blocked (ISSUE-001, `ECONNREFUSED` on 55432).

| Issue | Correction | Verification |
|---|---|---|
| ISSUE-006 | New shared classifier `src/db/commit-outcome.ts`: a failed COMMIT is `unknown` by default and only `rolled-back` for SQLSTATEs that prove a server rollback (integrity-constraint class 23 and a short allowlist). Class 08 (incl. 08007) and transport errors with no SQLSTATE stay `unknown`. Both the transaction helper and the mutation helper use it; neither keys off mere code shape. | `npm run test:unit` (`commit-outcome.test.ts`): 08007/EPIPE/no-code → unknown; 23503/23505/23514 → rolled-back; 57P01/XX000 → unknown. |
| ISSUE-013 | A key-reuse conflict now omits `operation` metadata entirely (no false `not_applied`). An `OUTCOME_UNKNOWN` response carries the normalized request key, threaded through `runMutation(requestKey, op)`. | `npm run test:unit` (`http.test.ts`): conflict body has no `operation`; unknown-outcome body has `operation: { key, outcome: "unknown" }`. |
| ISSUE-014 | The mutation helper now finalizes an unexpected business `Error` (not just `TerminalBusinessError`) via `ROLLBACK TO SAVEPOINT` and a terminal 500 receipt. Transient failures, lost/unknown-commit signals, and live connection errors are not finalized. | Covered by the C-17 "terminal failure after writes" integration case (durable 500 receipt, replay); logic is unit-exercised through the classifier/response tests and typecheck. |
| ISSUE-015 | The helper acquires the trip row lock in a `lockTrip` phase BEFORE `SAVEPOINT business_work`, and passes the locked row to the business callback; the services no longer lock inside the savepoint. A rollback to the savepoint therefore preserves the trip lock while the failure receipt commits. A terminal error thrown while locking (e.g. trip not found) is finalized directly, since no business writes happened. | Source structure; integration C-17/C-12 exercise the lock-before-savepoint path. |
| ISSUE-016 | `classifyFailure` preserves `DatasetMismatch` and maps class 08 and no-SQLSTATE failures (including a refused pool acquisition) to a retryable `DATABASE_UNAVAILABLE`/`DATABASE_BUSY`. The trip GET route maps the same conditions to 503 instead of a generic 500. | Logic exercised by typecheck and the integration suite; the GET route uses the shared `sqlState` classifier. |
| ISSUE-017 | `readJsonBody` enforces the 16 KiB limit in BYTES while reading: it rejects an over-limit `Content-Length` immediately and streams the body, aborting as soon as accumulated bytes exceed the cap. Multibyte content is counted by UTF-8 size, not UTF-16 code units. | `npm run test:unit` (`http.test.ts`): the 16,647-byte / 16,327-code-unit multibyte body is rejected; a 16 KB ASCII body passes. |
| ISSUE-018 | The integration suite opens a dedicated app pool per test and closes it in `afterEach`, before the next test's offline reset, so the reset guard never sees a stale app session. | Suite lifecycle rewritten; cannot run here (no DB), but each test now reseeds with no app sessions open. |
| ISSUE-019 | Added concurrent creation (C-19), concurrent duplicate registration (C-04), a concurrent record-cap race (C-12), the registration-key replay after cancellation (C-11), the lost-acknowledgement-of-a-committed-failure and failed-receipt-insert cases plus an explicit server-rejected COMMIT (C-17), and HTTP route-level checks (status, replay header, missing-key 400). The suite now has 13 tests. | `npm run test:concurrency` discovers 13 tests and fails only at `beforeEach` with `ECONNREFUSED 127.0.0.1:55432`. The correction review below also found missing assertions and incorrect fault placement. |

Database-free gate after corrections (observed, Node 24.22.3): `npm run test:unit` 10/10, `npm run test:matching` 69/69, `npm run test:setup` 2/2, `npm run lint`, `npm run typecheck`, and `NEXT_TELEMETRY_DISABLED=1 npm run build` all passed. The seven PostgreSQL acceptance checks (C-04/C-09/C-10/C-11/C-12/C-17/C-19) and the live ISSUE-006 two-case confirmation remain unobserved and keep the W2 database gate open.

### W2 correction review

Reviewed the corrected working diff on `7483c57` using Node 24.22.3. Unit (10/10), matching (69/69), setup (2/2), lint, typecheck and the production build passed. Vitest listed 13 integration tests. A read-only PostgreSQL connection attempt returned `EPERM` at `127.0.0.1:55432`. No live W2 assertion was verified in this review.

| Issue | Independent check and observation | Remaining action |
|---|---|---|
| ISSUE-014 | Inject a raw SQL error into the business callback of `runKeyedMutation` using the client double described in the prior review. Codes `55P03`, `57014`, `40001` and `40P01` each attempted a terminal failure receipt and returned 500 with `not_applied`. The control, an ordinary invariant Error, also entered the terminal path as intended. Its raw error message was copied into the response. | Identify retryable query errors before terminalizing. Verify absence of a receipt and success of a same-key retry after a real lock timeout. Use a generic public message for unexpected internal failures. |
| ISSUE-016 | Refuse `pool.connect()` with ECONNREFUSED when calling createTrip and addDriver through runMutation. Both returned 500 INTERNAL_ERROR. GET also returned 500 for EPIPE and for the pg-pool acquisition timeout Error with no code. A dataset mismatch inside the mutation helper correctly returned 503 DATASET_MISMATCH. However, in a fresh process, returning an empty zone list to registration's preliminary SELECT made a valid north registration return 400 before the guard. Restoring the fixture in the same process still returned 400 from the cache. | Map pool acquisition and registration reads consistently. Validate registration against the immutable fixture and check database drift inside the guarded transaction. |
| ISSUE-006 | Inject EPIPE, 08007 and 23503 at COMMIT. The first two produced 503 OUTCOME_UNKNOWN with the normalized key, and the constraint error yielded a rejected commit without terminal metadata. An explicit 40001 at COMMIT still produced OUTCOME_UNKNOWN. | Distinguish a server-confirmed serialization failure from loss of acknowledgement. Add a real deferred constraint rejection. [PostgreSQL transaction retry guidance](https://www.postgresql.org/docs/18/mvcc-serialization-failure-handling.html) |
| ISSUE-019 | Inspect the fault order. The committed-failure test destroys the socket before COMMIT is issued, then expects a durable 422 receipt. The receipt-insert test destroys the socket after a successful insert. The rejected-COMMIT test fails an immediate duplicate insert and converts arbitrary exceptions to an accepted 500. | Suppress delivery of the result after a real successful COMMIT and verify its receipt on another connection. Fail the actual failure-receipt INSERT and assert rollback, no terminal metadata and same-key recovery. Use a deferred constraint at COMMIT and assert the specific classification. |

The C-04/C-12/C-19 tests launch promises together without a barrier proving the second transaction contended on the key or trip. C-04 covers driver retries only. C-17 replays after finalization and does not test a waiting retry during failure finalization. The HTTP test titled POST/PATCH only invokes POST. Add deterministic two-client interleavings and assert the original mutation version and outcome through the relevant HTTP routes.

Direct probes confirmed that fingerprint conflicts omit operation metadata, unknown outcomes return the normalized key, and the reader accepts 16,384 bytes and rejects 16,385. ISSUE-013 and ISSUE-017 are technically closed. The lock callback preceded the savepoint in the observed SQL trace (ISSUE-015). The suite now isolates its app pools by inspection (ISSUE-018). Real lock retention and consecutive offline resets remain to be observed.

#### W2 correction review: second round of fixes

Applied on the W2 working tree (uncommitted on `7483c57`), Node 24.22.3. Database-free checks were observed; the real-PostgreSQL suite remains blocked (ISSUE-001, `ECONNREFUSED` on 55432).

| Issue | Correction | Verification |
|---|---|---|
| ISSUE-014 | `toTerminal` now calls `isRetryableQueryError` (`src/db/commit-outcome.ts`) and returns undefined for lock timeout (55P03), statement cancellation (57014), serialization/deadlock (40001/40P01), class 08, and transport errnos, so a transient error inside business work does NOT write a terminal receipt. Unexpected internal failures still terminalize, now with a generic public message ("An unexpected internal error occurred."), never the raw error text. | `npm run test:unit` (`isRetryableQueryError`): 55P03/57014/40001/40P01/08006/ECONNRESET → retryable; a plain invariant Error and 23505 → not retryable. Integration test "a retryable lock timeout inside business work does NOT finalize the key" asserts a `TransientFailure`, no receipt, and a successful same-key retry. |
| ISSUE-006 | The commit classifier is now three-way: a server-confirmed class-40 serialization/deadlock failure is `retryable-rollback`, surfaced by the mutation helper as a retryable `TransientFailure` (DATABASE_BUSY), not `OUTCOME_UNKNOWN`. Class 23 stays `rolled-back`; class 08 and no-SQLSTATE stay `unknown`. | `npm run test:unit` (`classifyCommitFailure`): 40001/40P01 → retryable-rollback; 23503/23505 → rolled-back; 08007/EPIPE → unknown. The live suite exercises a real COMMIT path. |
| ISSUE-016 | `pool.connect()` is now wrapped so a refused/timed-out acquisition becomes a retryable `TransientFailure` instead of a raw 500. Zone validation for registration uses the immutable `canonicalDataset` fixture (no pre-guard DB read, no process-wide cache of drifted zones); the guarded transaction still rejects a drifted database with DATASET_MISMATCH. The trip GET route also maps uncoded pool-acquisition timeouts and class 08 to a retryable 503. | Reproduced with a client double: a refused `pool.connect` now throws `TransientFailure` (was 500). Zone validation is fixture-based; typecheck/lint/build pass. |
| ISSUE-019 | Rewrote the mis-timed C-17 faults: the committed-failure case commits the receipt for real and faults AFTER commit (new `after-success-commit` point), then verifies the durable `not_applied` receipt from a SECOND connection and a replay; the failed-receipt case faults the actual failure-receipt INSERT and asserts rollback, no receipt, and a successful same-key retry; added a dedicated ISSUE-014 lock-timeout case and a same-key retry WAITING on the key lock during failure finalization (two concurrent requests → one executes, one replays). Added concurrent passenger retries to C-04 and a real PATCH (valid edit 200, stale 409) to the HTTP test. The suite now has 15 tests. | `npm run test:concurrency` discovers 15 tests and fails only at `beforeEach` with `ECONNREFUSED 127.0.0.1:55432`. |

Database-free gate after this round (observed, Node 24.22.3): `npm run test:unit` 13/13, `npm run test:matching` 69/69, `npm run test:setup` 2/2 (84 total), `npm run lint`, `npm run typecheck`, and `NEXT_TELEMETRY_DISABLED=1 npm run build` all passed. The PostgreSQL acceptance checks and the live ISSUE-006/014/019 confirmations remain unobserved and keep the W2 database gate open.

#### W2 verification of the second round

Review of the working diff on `7483c57`. The reviewer ran `npm run test:unit` (13), `test:matching` (69), `test:setup` (2), lint, typecheck and the production build on Node 24.22.3. All passed. Vitest listed 15 concurrency cases. A read-only connection probe using the designated test URL returned `EPERM 127.0.0.1:55432`. The seven PostgreSQL checks remain unobserved in this review.

| Issue | Independent check and observed result | Required evidence |
|---|---|---|
| 014 / 016 | With a client double returning the canonical dataset and no prior receipt, throw a coded Error during business work. For `55P03`, the response was 503 DATABASE_BUSY with zero receipt insert attempts. For `EPIPE` and `EPERM`, the helper attempted a terminal receipt and returned 500 with `not_applied`. For `57P01`, it skipped the receipt but returned 500. A GET pool double rejecting with EPIPE/EPERM also returned 500. An uncoded pg-pool acquisition timeout returned 503. Registration now uses fixture zones. | Confirm transport and transient errors at both service and HTTP boundaries, including absence of a terminal receipt. |
| 006 | Reject the client's COMMIT with `40001`. The keyed mutation returned 503 DATABASE_BUSY, while `withTransaction` threw CommitOutcomeUnknown. With `40003`, the keyed helper returned DATABASE_BUSY with no unknown-operation metadata. PostgreSQL identifies 40003 as statement completion unknown. [Error codes](https://www.postgresql.org/docs/current/errcodes-appendix.html) | Exercise both helpers' retryable, definite and unknown branches. Retain a live rejection at COMMIT and a lost-ack replay. |
| 019 / C-17 | Replay the integration test's two fault conditions with a recording client. The failure path visited `after-business-writes`, `before-failure-receipt-insert`, `before-failure-commit`, issued COMMIT and returned 422. The test expects OutcomeUnknown. The delivery-loss hook runs only after a success. A plain post-commit Error also goes through generic failure mapping. | Withhold acknowledgement of an actual failure-receipt COMMIT at the client boundary. Observe the unknown response and verify the original failure from a separate connection and on replay. |
| 019 / 015 | Source inspection shows the receipt INSERT test throws before issuing SQL, the lock timeout is a synthetic 55P03, and two Promise.all callers may run sequentially. The suite has no deferred rejection at COMMIT. The new passenger retry and HTTP PATCH assertions are present. | Cause the receipt INSERT itself to fail. Use separate clients and a barrier to observe a same-key waiter and retention of the trip lock during failure finalization. Verify the original business state, receipt and replay. For C-12 cover the passenger cap and retained inactive records as well as the driver cap. |

W2 remains in progress. After correcting these paths, run `npm run test:unit` and `npm run test:concurrency` with the app stopped against the designated test database. Record the seven named acceptance results and update the gate. A-3 awaits the student's independent review and decision.

#### W2 correction review: third round of fixes

Applied on the W2 working tree (uncommitted on `7483c57`), Node 24.22.3. Database-free checks were observed; the real-PostgreSQL suite remains blocked (ISSUE-001, `ECONNREFUSED` on 55432).

| Issue | Correction | Verification |
|---|---|---|
| ISSUE-014 / 016 | Root cause: `sqlState` matched any five uppercase chars, so Node errnos `EPIPE`/`EPERM` were read as SQLSTATEs. `sqlState` now requires two LEADING DIGITS (real SQLSTATE classes are digits), and a new `isTransportError` recognizes `E…` errnos and pg-pool acquisition-timeout messages. `isRetryableQueryError` and `classifyFailure` treat transport errors as retryable, so a transport error in business work no longer writes a terminal receipt, and the GET route reuses the shared classifier so EPIPE/EPERM/uncoded pool timeouts map to 503. | `npm run test:unit` (`sqlState`/`isTransportError`): EPIPE/EPERM/ECONNRESET are not SQLSTATEs and are transport+retryable; 55P03/40001 are SQLSTATEs. Double probe: an EPIPE thrown in business work yields `TransientFailure`, not a terminal receipt. |
| ISSUE-006 | The commit classifier is three-way and now consistent across BOTH helpers: `withTransaction` raises a new `CommitRetryable` for a server-confirmed class-40 serialization/deadlock rollback (previously it returned unknown), matching the keyed helper's retryable 503. `40003` (statement_completion_unknown) is classified `unknown` in both — it keeps the unknown-operation metadata W3 needs, not DATABASE_BUSY. | `npm run test:unit` (`classifyCommitFailure`): 40001/40P01 → retryable-rollback, 40003/08007 → unknown, 23505 → rolled-back. Double probe: `withTransaction` raises `CommitRetryable` for a 40001 COMMIT. |
| ISSUE-019 / C-17 | New `after-failure-commit` fault point runs after the real failure-receipt COMMIT returns; the lost-ack test faults there, so the 422 receipt is genuinely committed, the helper reports `OutcomeUnknown` (via a `committed` flag that converts any post-commit fault to unknown), and the test verifies the durable 422 from a SECOND connection and on replay. | Covered by the rewritten C-17 lost-ack test (runs under PostgreSQL). Helper logic typechecks; the `committed` flag is set after every receipt COMMIT. |
| ISSUE-019 / 015 | The failed-receipt-INSERT test now causes a REAL duplicate-key (23505) at the helper's own INSERT and asserts full rollback with no surviving receipt and a successful retry. Added a deterministic two-client test: writer A holds the trip row lock paused at the failure COMMIT while writer B's same-trip edit blocks, released via a gate with a bounded watchdog (not a fixed sleep), asserting B completes strictly after A. Added the C-12 passenger cap with retained inactive records. The suite is now 17 tests. | `npm run test:concurrency` discovers 17 tests and fails only at `beforeEach` with `ECONNREFUSED 127.0.0.1:55432`. |

Database-free gate after this round (observed, Node 24.22.3): `npm run test:unit` 15/15, `npm run test:matching` 69/69, `npm run test:setup` 2/2 (86 total), lint, typecheck, and the production build all passed. The PostgreSQL acceptance checks and the live ISSUE-006/014/019 confirmations remain unobserved and keep the W2 database gate open.

#### W2 verification of the third round

On the working diff over `7483c57`, the reviewer passed 15 unit, 69 matching and 2 setup tests, lint, typecheck and the production build. Compose configuration validated. Docker socket access was denied. The guarded PostgreSQL probe and the verbose concurrency run both returned EPERM at 127.0.0.1:55432. All 17 integration cases stopped in setup before their assertions ran.

- Using a recording client with the canonical dataset, EPIPE and EPERM during mutation work yielded 503 DATABASE_UNAVAILABLE with no receipt insert. A 57P01 during work also yielded 503 without an insert. At COMMIT, 40001 yielded DATABASE_BUSY and 40003 yielded OUTCOME_UNKNOWN with the pending key. The general transaction helper raised CommitRetryable and CommitOutcomeUnknown respectively. Throwing at the new post-failure-commit hook produced OUTCOME_UNKNOWN after the failure-receipt write and acknowledged COMMIT in the double. Live receipt durability still needs PostgreSQL.
- For GET, inject EPIPE or EPERM when checking out the client to observe 503. Inject EPIPE or 08006 only on COMMIT after a successful read to observe 500 INTERNAL_ERROR. The read-only transaction wraps the cause in CommitOutcomeUnknown. GET can safely retry this read. [Read route](../src/app/api/trips/[tripId]/route.ts)
- The trip-lock test leaves a process-wide hook active for writer B. Its unconditional post-write fault also rolls back B's edit and produces 422, while the assertion expects 200. Scope injection to A. Identify B waiting on A at the database before releasing A. Elapsed time and promise completion order cannot establish that relationship. The same-key race also allows sequential execution. [Integration tests](../tests/concurrency/mutations.integration.test.ts)
- The suite now includes a duplicate-key receipt INSERT and 50 retained passenger records. Pin the INSERT failure to 23505 since the current assertion accepts any Error. The lock-timeout case injects a JavaScript error. The suite still needs the real rejected COMMIT called for by ISSUE-006, for example a constraint deferred until COMMIT. The SQLSTATE comment also needs narrowing because PostgreSQL includes alphanumeric classes such as P0. [PostgreSQL error codes](https://www.postgresql.org/docs/18/errcodes-appendix.html)

For the host run, stop test-database clients, use Node 24 and the existing local test URLs, then run `docker compose up -d --wait db` and `npm run test:concurrency -- --reporter=verbose`. The suite migrates and resets the designated test database before each case. Record the verbose outcomes for C-04/09/10/11/12/17/19 after the corrections. A-3 human review remains pending.

#### W2 host failure and trip-lock test correction

The student ran the W2 suite on the host and reported 16 of 17 cases passing. The trip-lock test reached its final assertions and received 422 for writer B, which should have returned 200. The bounded agent task is to correct the fault injection, demonstrate B waiting for A in PostgreSQL and verify the committed edit. Student acceptance of the correction is pending.

On the working diff over `7483c57`, the [trip-lock test](../tests/concurrency/mutations.integration.test.ts) now clears the injected fault while A is paused before its failure COMMIT, then starts B on an identified PostgreSQL backend. A polls `pg_blocking_pids` until PostgreSQL reports that A blocks B. The final assertions require A’s 422, B’s 200, only the original driver with the edited capacity, and exactly one version increment.

Reviewer checks on Node 24.22.3 passed lint, typecheck and 15 unit tests. The command below reached database setup in the workspace and stopped with EPERM on port 55432. On the host, run it against the designated test database with test-database clients stopped. After it passes, rerun the complete suite. The subsequent full-suite result is recorded below.

```sh
npm run test:concurrency -- -t "trip row lock is held" --reporter=verbose
npm run test:concurrency -- --reporter=verbose
```

#### W2 host rerun

On November 23 at 12:27 CST the student ran `npm run test:unit` and `npm run test:concurrency -- --reporter=verbose` in this checkout with Node 24.22.3 and npm 11.19.1. The host npm logs ending in `18_27_33_331Z-debug-0.log` and `18_27_33_945Z-debug-0.log` show exit 0 for the unit suite and unfiltered concurrency suite respectively. Vitest recorded the integration file as passed in 1.97 s. The 17 enabled cases cover C-04, C-09, C-10, C-11, C-12, C-17 and C-19. The earlier failing trip-lock case passed as part of this run. [Integration tests](../tests/concurrency/mutations.integration.test.ts)

The host result verifies repeated guarded resets and the corrected C-17 assertions. PostgreSQL identified A as blocking B, A returned 422, B returned 200 and the stored trip reflected B’s capacity edit and a single version increment. ISSUE-015 and ISSUE-018 are closed on the W2 working diff over `7483c57`. The remaining read error and transaction coverage items are tracked in the [issue register](../WORKPLAN.md#bugs-and-open-issues). Student acceptance of A-3 is pending.

#### W2 gate observed: ISSUE-016 fix and the real failure-path checks

On 2026-11-24 the Docker engine was started and the W2 suite ran against the designated local test database (`127.0.0.1:55432`) with Node 24.22.3. Observed results:

- **ISSUE-016 (open bug) fixed.** A trip GET can finish reading and then lose the connection at the read transaction's COMMIT. `withTransaction` wraps that as `CommitOutcomeUnknown`, which has no SQLSTATE or errno, so the GET route previously returned 500. The GET route now treats `CommitOutcomeUnknown`/`CommitRetryable`/`TransientFailure` as retryable — correct because a READ-ONLY transaction has nothing to commit — and returns `503 DATABASE_UNAVAILABLE`. A new `__setTransactionCommitFaultHook` injects a real socket drop at the read COMMIT. New route regression "GET returns 503 when the read COMMIT acknowledgement is lost (ISSUE-016)" passed live: a normal GET is 200, the lost-COMMIT GET is 503 `DATABASE_UNAVAILABLE`, and a subsequent GET recovers to 200. [GET handler](../src/app/api/trips/[tripId]/route.ts)
- **ISSUE-006 verified with a real server-rejected COMMIT.** New test "a REAL server-rejected COMMIT (deferred-constraint violation)…" arranges a `DEFERRABLE INITIALLY DEFERRED` FK violation on `ON COMMIT DROP` temp tables so PostgreSQL rejects the transaction AT COMMIT (not at INSERT). Observed from a second connection: neither the business change nor a receipt survived. Passed live.
- **ISSUE-014 verified with a real connection loss.** New test "a REAL connection loss during business work…" destroys the backing socket mid-transaction before COMMIT. Observed: a retryable outcome (TransientFailure/OutcomeUnknown), unchanged trip state and no receipt from a separate connection, and exactly one successful application on same-key retry. Passed live. The earlier synthetic 55P03 case is retained alongside it.
- **Full gate observed.** `npm run test:concurrency` passed 20/20 (C-04/C-09/C-10/C-11/C-12/C-17/C-19, including the passenger cap with retained inactive records and the trip-lock contention case), and `npm run test:unit` passed 15/15. `npm run test:matching` 69/69, `npm run test:setup` 2/2, lint, typecheck, and the production build also passed. A benign `pg` deprecation warning is emitted by the socket-drop test (a statement racing the forced disconnect); it does not affect the asserted outcome. [Integration tests](../tests/concurrency/mutations.integration.test.ts)

With these observed, the seven named W2 acceptance checks and ISSUE-006/014/016 are verified. ISSUE-004 (reset-overlap readiness) remains open and is W-later work; it does not gate W2. Student acceptance of A-3 (independent review of the W2 implementation) is pending; the technical gate is satisfied.

#### W2 gate review

Host npm logs confirm an unfiltered concurrency run exited 0 and Vitest recorded the integration file as passed. The reviewer reran all 15 unit tests, lint and typecheck. A read-only database probe returned EPERM at 127.0.0.1:55432 in the review session. The GET regression exercises the read-only COMMIT failure response and recovery. The connection-loss test checks durable state and same-key recovery, though its assertion allows either TransientFailure or OutcomeUnknown for a drop before COMMIT.

- **ISSUE-006.** The bootstrap revokes TEMPORARY from PUBLIC and grants the app role CONNECT. On a clean setup the first CREATE TEMP TABLE in the pre-COMMIT hook fails before the deferred insert. The test leaves status at zero on every exception and ignores the caught error. A recording client rejecting that statement with 42501 observed ROLLBACK, zero COMMIT calls and a passing status predicate. Use a setup-owned fixture, require the insert to succeed and require CommitRejected with SQLSTATE 23503 from COMMIT. Retain the independent durable-state checks. [Bootstrap](../db/init.sql) · [Tests](../tests/concurrency/mutations.integration.test.ts)
- **ISSUE-019.** The C-17 same-key race still uses Promise.all without observing a waiter. Its assertions also hold for two sequential calls. The separate trip-lock test observes contention on a trip between different keys. Pin the failure-receipt INSERT assertion to SQLSTATE 23505 and establish the advisory-key wait before releasing the first transaction. [Concurrency suite](../tests/concurrency/mutations.integration.test.ts)
- **ISSUE-020.** A client double with a throwing transaction commit hook observed no ROLLBACK and release(false). The hook runs outside the error handling that discards the client or rolls back its transaction. This concerns harness isolation when that hook throws. [Transaction helper](../src/db/transaction.ts)

The 20-case host result stands. The W2 gate is reopened for ISSUE-006 and ISSUE-019. A-3 remains pending.

#### W2 gate review corrections (ISSUE-006, 019, 020) and ISSUE-014 tightening

Applied on the W2 working diff over `7483c57`, Node 24.22.3, verified live against the local test database on 2026-11-24.

- **ISSUE-006 — false pass fixed.** The old test created the deferrable fixture with `CREATE TEMP TABLE` as `groupride_app`, but the bootstrap revokes `TEMPORARY`, so on a clean setup that failed with `42501` before any COMMIT and the loose predicate still passed. The fixture is now created by the SETUP role (two persistent tables with a `DEFERRABLE INITIALLY DEFERRED` FK) with `GRANT INSERT` to the app. The app's fault hook inserts a row referencing a missing parent; the INSERT succeeds (deferred) and the COMMIT is rejected. The test now requires `CommitRejected` with SQLSTATE `23503` and keeps the independent no-change/no-receipt checks from a second connection. Confirmed directly: the app INSERT succeeds and COMMIT raises `23503`. The fixture is dropped in `finally`.
- **ISSUE-019 — real contention observed.** The same-key test now pauses request A before its success COMMIT while it holds the transaction-scoped advisory key lock, starts request B with the same key on a separate connection, and polls `pg_locks` until B's backend is waiting (`granted = false`) on exactly that advisory lock (reconstructed from `classid`/`objid` and `mutationLockId`). Only then is A released; B then replays A's applied receipt (same id, one driver, `replayed = true`). The failed-receipt-INSERT test now requires SQLSTATE `23505`.
- **ISSUE-020 — harness cleanup fixed.** `withTransaction`'s before-COMMIT fault hook ran outside error handling, so a throwing hook released the client with an open transaction. The hook call is now wrapped: on rejection it issues `ROLLBACK`, discards the client if rollback also fails, and rethrows. Covered by two database-free unit tests (rollback issued and no COMMIT; discard when rollback also fails).
- **ISSUE-014 — assertion tightened.** A disconnect injected BEFORE COMMIT now asserts exactly `TransientFailure` with `DATABASE_UNAVAILABLE` (the COMMIT was never reached, so an unknown-commit outcome is impossible here), alongside the retained durable-state and single-retry checks.

Observed live: `npm run test:concurrency` 20/20 (including the corrected ISSUE-006 `CommitRejected`/23503 case and the `pg_locks`-observed ISSUE-019 waiter), `npm run test:unit` 17/17 (incl. the two ISSUE-020 cleanup cases), `npm run test:matching` 69/69, `npm run test:setup` 2/2, lint, typecheck, and the production build. This closes ISSUE-006, ISSUE-019, and ISSUE-020. A-3 (independent student review) remains pending.

#### W2 verification of the gate review corrections

The host npm log ending in `2026-11-23T19_04_10_330Z-debug-0.log` recorded an unfiltered concurrency run with exit 0 after the suite was edited. Vitest recorded the 20-case integration file as passed. The reviewer independently reran the 17 unit, 69 matching and two setup tests, typecheck, lint and the production build. The review session’s connection probe returned EPERM at the designated PostgreSQL endpoint.

The setup-owned deferred FK and the exact CommitRejected/23503 assertion now verify ISSUE-006. The pre-COMMIT socket drop requires DATABASE_UNAVAILABLE and the failed receipt insert requires 23505. The two hook-cleanup tests exercise rollback and discard on failed rollback. These checks support the closures of ISSUE-006, ISSUE-014 and ISSUE-020. ISSUE-016 retains the passing GET recovery check.

ISSUE-019 remains partially verified. The lock-wait test pauses A at `before-success-commit` and verifies B replays a 201. The other C-17 failure checks start the same-key retry after the failure receipt has already committed. To demonstrate the racing failure case, pause A at `before-failure-commit`, observe B waiting on the advisory key, then verify both receive the same stored failure and the roster and version stay unchanged. Identify B by backend PID in the lock observation. [C-17 contract](ARCHITECTURE.md#acceptance-checks) · [Concurrency tests](../tests/concurrency/mutations.integration.test.ts)

#### W2 C-17 racing-failure coverage (closes ISSUE-019)

In the 21st case, A raises a terminal 422 after its business writes and pauses immediately before committing its failure receipt. B submits the same key on a separate connection. The observer sees an ungranted advisory lock matching the key before A is released. A is the original failure and B is the replay. Both return 422 with equal JSON field values, and the trip version and driver count stay unchanged. [Integration case](../tests/concurrency/mutations.integration.test.ts)

The reviewer confirmed the unfiltered host run exited 0 in npm log `2026-11-23T19_10_38_749Z-debug-0.log`; the test file contained 21 cases and Vitest recorded it as passed. The implementer also reported a passing isolated run. The reviewer independently passed 17 unit, 69 matching and two setup tests, lint, typecheck and the production build. This review session’s read-only database probe returned EPERM on port 55432.

The test uses a fresh key in a serial suite. It identifies the waiter by lock ID, and the replay flag and full body are checked independently of the injected fault. Pinning the waiter to B’s backend PID and disarming the global hook before starting B would make attribution explicit. C-17 and ISSUE-019 are closed. The technical gate permits W3 to begin, with A-3 student acceptance pending.

## W3 progress

W3 implements the preview/commit backend, the browser pages, a pure reducer, and session-storage recovery on the W2 commit `eb1e864`.

- **Change.** Preview publication `src/trips/preview.ts` (snapshot→reuse-or-compute-outside-locks→lock+recheck-version→publish/reuse) and commit `src/trips/commit.ts` (keyed mutation; no optimizer at commit; re-validate stored optimal against the current roster with `assertFeasible`; copy assignments, set `assigned`, bump version). Repository functions for zone costs, preview lookup/insert, and `commitPlan`. Routes `POST /api/trips/:id/match/preview` (non-keyed, `runPreview`) and `POST /api/trips/:id/match/commit` (keyed). UI: `src/app/page.tsx` (create), `src/app/trips/reducer.ts` (pure version/preview/pending-op reducer), `src/app/trips/[tripId]/page.tsx` (roster, preview/commit, cancel/reduce/withdraw, session-storage recovery). Tests: `tests/concurrency/preview-commit.integration.test.ts` and `tests/unit/reducer.test.ts`.
- **Verified live (service/API/DB).** `npm run test:concurrency` 33/33 against the local test database on 2026-11-24 (21 W2 + 12 W3). The W3 cases observed: WF-4 North→East = 1 match/cost 7 through preview→commit→reload (not the reverse 19); WF-1 persistence and consistent derived totals, and an empty optimal plan committable as `assigned`; C-02 cancel-after-preview and C-03 register-after-preview both reject the stale preview with `STALE_VERSION` and leave nothing assigned; C-07 capacity reduction clears the plan, bumps version, sets `needs_rematch`, and a manual rematch respects the reduced capacity (covering WF-2); C-14 malformed/unknown-field commit bodies rejected, superseded-algorithm preview rejected `ALGORITHM_CHANGED`, and corrupt stored JSON finalizes a 500 without mutating the trip; preview reuse returns the same stored id and a same-key commit replays once.
- **Verified database-free (reducer / ordering).** `npm run test:unit` 28/28 incl. the reducer cases for U-01 (a v6 GET or conflict clears a v5 preview atomically; delayed v5 reads/previews cannot restore it; the floor never decreases) and U-04 (receipt-backed not_applied releases the pending op; unknown retains it; a delayed old-key reply cannot clear a newer op; Commit disabled during a pending mutation or while awaiting a current snapshot). Lint, typecheck, and the production build pass; the build lists `/trips/[tripId]` and both match routes.
- **Verified live (browser layer).** Playwright `1.65.1` was added (pinned) and Chromium installed; `npm run test:e2e` runs a production build on loopback port 3100 against the reset test database and drives real Chromium. 5/5 passed on 2026-11-24: WF-1/WF-4 (create → register North driver + East passenger → preview → save → reload, status `assigned`/`Matched: 1`/`Total cost: 7`, not the reverse 19); WF-2 (reduce capacity clears the plan to `needs_rematch`, then rematch respects the reduced capacity); WF-3 (two browser contexts — after context A commits, context B's stale commit is rejected with "The trip changed. Review…" and its Commit is disabled, no silent overwrite); U-02 (a hung request leaves a pending op persisted to sessionStorage; a same-tab reload restores the identical key and route); U-03 (a context whose sessionStorage throws shows the blocked banner, reads and preview still work, and a cancel is blocked before sending with the driver still active). The suite resets the test database in a global setup. A benign `pg` deprecation warning is emitted by the server during the suite; it does not affect outcomes.
- **Demo.** `npm run demo` resets the demo database, prints a fresh starter trip, and starts the production server; the README "Demonstration (W3 workflow)" section gives the exact WF-4 click-path and the two-session stale-commit walk-through.
- **Human review.** A-4 is pending. No human has reviewed or accepted W3.

The initial host run reported passing checks for C-02, C-03, C-07, C-14; WF-1, WF-2, WF-3, WF-4 (service/API/DB + browser); and U-01 through U-04 (U-01/U-04 by reducer unit tests, U-02/U-03 by the browser suite). The subsequent implementation review identified additional work before technical closeout. [Review findings](#w3-implementation-review)

### W3 implementation review

Review of the working diff over `eb1e864`. The host npm logs show exit 0 for the full concurrency and Playwright commands, and the Playwright last-run record says passed. The reviewer passed 28 unit, 69 matching and two setup tests, lint, typecheck and the production build. The review session’s guarded database probe returned EPERM on port 55432. The direct probes below used the real component handlers with stubbed browser I/O, the pure reducer, and the preview route with a recording client.

| Issue | Observation | Regression to retain |
|---|---|---|
| 021 | In the create form, make storage writes throw and make fetch lose its response. Two submissions still transmitted two POSTs with different keys. The trip page also chooses storage by trip ID and sends form values without the shared normalization step. The U-03 test seeds the trip through the API and bypasses the create form. | With storage blocked, assert zero creation requests. Lose the response after successful creation, reload and retry the original key/body to obtain one trip. Verify a second trip cannot overwrite or bypass an unresolved operation in the same tab. |
| 022 | Deliver a 500 without operation metadata to the trip form after a newer pending key has been saved. The handler removed the newer storage entry and dispatched mutation/notApplied for the older key. A 409 key-reuse response and any 2xx response also remove storage regardless of receipt identity. The reducer’s key guard cannot recover deleted storage. U-02 checks stored key and route, then ends without clicking Retry. | Deliver an old reply while a newer operation is pending. Reload and verify the newer operation remains. Test metadata-free 500, conflicting key reuse, matching terminal 500 and replay of a committed registration with identical body and key. |
| 023 | Starting at a committable v5 preview, start a new GET and deliver an older-generation GET reporting v6. The reducer kept floor 5 and Commit enabled. Delivering a current preview at v6 while the snapshot is v5 instead cleared both preview and snapshot. The success handler does not request the required snapshot, leaving only the loading message. The error path ignores preview currentVersion, and failed GETs have no visible retry. | Control response ordering. Preserve newer version information even when discarding an obsolete payload. Refresh from preview/version errors and a newer preview, and exercise a failed initial GET and retry. |
| 024 | The matching section renders only the preview version. The current browser check asserts a preview-ready marker and only checks cost after saving. The trip view never renders the saved assignments or the unassigned passengers. | Verify Dana → Pat at cost 7 in the visible preview, check the saved pairing after reload, and verify the unassigned rider when capacity is reduced. |
| 025 | With a cached preview fixture and a healthy client double, the real route returned 200 for malformed JSON, an unknown field and a 16,412-byte body. It also returned the malformed cached result `{bogus:true}` as optimal. Injecting 55P03 into runPreview returned 500 INTERNAL_ERROR. | Exercise the request size/shape, corrupt cache and retryable read/publication paths through the actual preview endpoint. |

The publication and commit services implement separate compute and publication phases, a locked version check, and stored-plan validation. The current passing suites do not establish the browser contracts above. W3 and R1 are open. A-4 awaits the student’s independent decision.

#### W3 implementation review: corrections

Applied on the W3 working diff over `eb1e864`, Node 24.22.3, verified live against the local test database on 2026-11-24.

- **ISSUE-021 — creation recovery.** Introduced one tab-wide pending-operation record (`src/app/trips/pendingStore.ts`, single `groupride.pending.v1` key) shared by the create page and trip page. The home page persists the create op before sending, blocks when storage is unwritable (the submit button is disabled and no request is sent), keeps the op on a lost/unknown response, and offers **Retry creation** with the original key; a terminal success clears it and navigates. Verified by the browser test "ISSUE-021: blocked storage sends zero creation requests; a lost creation retries to one trip" (blocked storage → 0 POSTs; aborted first response → retry reuses the one original key).
- **ISSUE-022 — receipt-based clearing.** The trip page now clears storage/reducer state only for the current key and only on a receipt-backed terminal outcome: 2xx (applied), 409 (conflict/key-reuse), or a 500 **with** `operation.outcome === "not_applied"`. A 503, an unknown outcome, a network error, or a 500 **without** metadata keeps the exact operation. A reply whose key no longer matches the current pending op clears nothing (`stillCurrent()` guard). The U-02 browser test now clicks **Retry** and asserts exactly one passenger is added.
- **ISSUE-023 — version ordering.** The reducer now raises the version floor from **any** valid response's observed version, even when the payload is discarded as obsolete-generation or below-floor (`get/received` and `preview/received` compute the floor before deciding acceptance). A stale-generation GET/preview reporting v6 therefore clears a v5 preview and disables Commit. The trip page refetches when the floor rises past the shown snapshot and surfaces a read failure with a **Retry load** button instead of looping on "Loading." New reducer unit tests cover the obsolete-GET, below-floor, and stale-preview floor cases (31 unit tests total).
- **ISSUE-024 — visible plan.** The matching section renders the optimal vs. greedy comparison, named assignments (passenger → driver with cost), and unassigned riders; the saved-plan section renders named assignments and unassigned riders. The browser tests assert "Pat → Dana (cost 7)" in the visible preview before save and in the saved view after reload, and a named unassigned rider after a capacity reduction.
- **ISSUE-025 — preview route contract.** The route rejects a non-empty/oversized/malformed body (`readEmptyBody`, 16 KiB byte cap) with 400, the service validates the stored/computed result shape and refuses to serve a corrupt cache as 200 (surfaces ≥500), and transient database failures (lock/statement timeout, serialization, connection loss, retryable/unknown commit) map to a retryable 503 via `classifyPreviewFailure`. Three route-level integration cases cover these.

Observed live: `npm run test:concurrency` 36/36 (incl. 15 preview/commit with the 3 new ISSUE-025 cases), `npm run test:e2e` 6/6 (WF-1/2/3/4, U-02/U-03, and the ISSUE-021 creation-recovery case), `npm run test:unit` 31/31 (incl. ISSUE-023 reducer cases), `npm run test:matching` 69/69, `npm run test:setup` 2/2, lint, typecheck, and the production build. The implementation marked the five issues closed after this run. The subsequent review below reopened four. A-4 remains pending.

#### W3 correction review

Reviewed the working diff over `eb1e864`. With Node 24 the reviewer passed 31 unit, 69 matching and two setup tests, lint, typecheck and the production build. A read-only probe of the designated local test database returned `EPERM` on port 55432. The preceding 36 PostgreSQL and six browser passes are host observations. The reviewer exercised the actual page handlers with in-memory storage and controlled responses, and the actual preview route with a cached-row client double.

| Issue | Starting state and action | Review result and regression to retain |
|---|---|---|
| 021 | Store a pending trip registration, visit Home and submit a creation in the same tab. | Home transmitted a POST and replaced the original key. The reverse path exists when a trip page ignores a pending creation or another trip's operation. Exercise navigation with an occupied slot and assert zero new POSTs and unchanged stored bytes. |
| 022 | Return a matching `422 ROSTER_LIMIT/not_applied`, a metadata-free 409, or a 200 identifying a different receipt key to the trip registration handler. Also return a JSON 500 without metadata on creation. | The 422 remained pending, the 409 and mismatched 200 cleared the slot, and Home cleared the creation. Validate normalized inputs before persistence, including whitespace-only rider names. Verify both pages clear only a matching terminal receipt, including 404/422 rejections. For lost acknowledgements, forward the first browser POST, confirm the server committed, suppress its reply and verify the same-key replay and one durable effect. The current browser cases abort or hold the first request before forwarding. |
| 023 | Start with a committable v5 preview. Return a preview 409 with `error.currentVersion = 6`, then fail the follow-up GET. | The floor stayed at 5 and Commit stayed enabled. Dispatch the observed version immediately. The mutation reducer also ignores version observations from old keys. A delayed discarded preview can replace the separate detail state and hide the currently committable plan. Cover these response orders through the page. |
| 024 | Inspect the preview and saved plan rendering and the WF-2/WF-4 browser assertions. | Both views resolve passenger and driver names. WF-4 checks the named cost-7 pair across reload. WF-2 only excludes the word “none”. Assert the exact unmatched fixture rider or derive that rider from the independently observed assignment. |
| 025 | POST literal JSON `null`, `42`, `"x"` or `[]` to the preview route with a healthy cached row. Then supply a cached result with `assignments: [null]` and numeric totals. | All returned 200. An unknown field and malformed JSON correctly returned 400. Require the documented empty-object shape and validate nested result elements before rendering. Expect 400 for the invalid inputs and an invariant error for the corrupt row. |

W3 is in progress. ISSUE-021/022/023/025 are open and ISSUE-024 remains closed. The R1 release and A-4 student acceptance remain open.

##### W3 correction review: second round of fixes

Applied on the W3 working diff over `eb1e864`, Node 24.22.3, verified live against the local test database on 2026-11-24.

- **ISSUE-021 — slot ownership across routes.** Both pages now inspect the shared slot before starting any operation. The create page restores a pending create for retry, and when the slot is owned by a trip operation it blocks creation (button disabled, a link to the pending trip) and sends nothing. Two browser tests: a true lost-acknowledgement (the first POST is forwarded and commits, its reply is suppressed, and Retry replays the original key to the same trip — one durable effect); and a trip-owned slot blocking creation with zero POSTs and unchanged stored bytes.
- **ISSUE-022 — one receipt check on both pages.** Added `isTerminalForKey(sentKey, body)` in `pendingStore.ts`: a pending op resolves (and its slot clears) ONLY when `operation.key` matches the sent key and `operation.outcome` is `applied`/`not_applied`. Both the create and trip pages use it, so a receipt-backed 422 now clears (no strand), while a metadata-free 409, a mismatched-key 200, a bare 500, a 503, and network errors all retain the op. Inputs are validated/trimmed before persisting so a whitespace-only name cannot strand the tab. Browser test ISSUE-022 covers the mismatched-key-200 retain then the matching-key replay.
- **ISSUE-023 — apply observed version before refreshing.** Added a `version/observed` reducer action that raises the floor and reconciles in one transition (hiding a stale snapshot and clearing a now-stale preview, disabling Commit) independent of fetching data. The preview handler dispatches the 409 `error.currentVersion` via this action BEFORE awaiting the refresh, so a failed refresh cannot leave an older plan committable. The preview detail is set only after the reducer accepts the preview, and the render gates the detail on `previewDetail.previewId === state.preview.previewId`, so a discarded/delayed preview cannot replace the committable plan's details. New reducer unit tests.
- **ISSUE-025 — strict body and nested cache validation.** `readEmptyBody` now accepts only an absent body or a literal empty object; `null`, `42`, `"x"`, and `[]` are 400. The preview result validator checks each assignment (`passengerId`/`driverId` strings, `cost` number) and each unassigned id, so a cached `assignments: [null]` is refused (≥500) rather than served as 200. Route-level integration cases cover the scalar/array bodies and the nested-null cache.
- **ISSUE-024 evidence.** The WF-2 browser test now derives the assigned rider from the saved view and asserts the OTHER named rider is the unassigned one (not merely "not none").

Observed live: `npm run test:e2e` 8/8 (WF-1/2/3/4, U-02/U-03, two ISSUE-021 cases, ISSUE-022), `npm run test:concurrency` 36/36 (15 preview/commit incl. the strengthened ISSUE-025 cases), `npm run test:unit` 33/33 (incl. `version/observed`), `npm run test:matching` 69/69, `npm run test:setup` 2/2, lint, typecheck, and the production build. The implementation marked these four issues closed after the host run. The verification below supersedes that status. A-4 (independent student acceptance) remains pending.

### W3 second-round verification

Reviewed the W3 working tree over `eb1e864`. On Node 24 the reviewer passed 33 unit, 69 matching and two setup tests, lint, typecheck and the production build. The guarded local test database connection returned `EPERM` on port 55432. The 36 PostgreSQL and eight browser passes above are the host run. For the cases below the reviewer executed the page handlers with in-memory storage and controlled fetch responses, the reducer, and the preview POST handler with a cached-row database client double.

| Issue | Reproduction and observed behavior | Acceptance check |
|---|---|---|
| 021 | Start with a pending creation, open an existing trip and submit a registration. One POST was sent and the creation key was replaced. Completing a Home request after its slot had changed also removed the newer key. Home now guards new creation when a trip owns the slot. | Exercise creation → trip and trip A → trip B. Require zero new POSTs and unchanged stored bytes, then deliver a late Home receipt and verify the new owner survives. |
| 022 | Create with departure `2026-02-30T09:30Z`, or register a passenger named three spaces. The forms persisted and sent both bodies. The shared server normalizers rejected them and the receipt-free 400 left the invalid operation pending. A matching 422 released the slot. A metadata-free 409/500 and a mismatched-key 200 retained it on the trip page. | Use browser-compatible shared normalizers before claiming the slot. Require a field error, no POST, an empty slot, and a successful corrected submission. |
| 023 | Accept a v6 snapshot and preview, then deliver a delayed v5 preview. The reducer kept v6, its displayed details disappeared, and Save remained enabled. A separate old-key conflict reporting v7 left the floor at 6. The preview 409 reporting v6 followed by a failed GET correctly raised the floor and disabled the v5 Save button. | Render the accepted preview payload from the reducer. Assert the visible v6 plan and the saved preview ID under reordered replies. Apply valid same-trip version observations before filtering replies by key. |
| 025 | The route rejected literal `null`, `42`, `"x"` and `[]` with 400 and returned 500 for a cached null assignment. Three space bytes were accepted as an empty request. A cached result with no assignments, five matches and cost −7 returned 200. | Reject nonempty invalid JSON. Check nonnegative integer counts and costs and their agreement with the assignment list for both cached results. |

The lost-ack creation test now forwards the first POST, suppresses its reply, and compares the retry trip ID to the committed one. Its final single-ID GET proves that trip exists. To verify uniqueness, count rows from a known starting state. Wait for the forwarded response explicitly before asserting the first ID, since the pending banner can render before the server responds. WF-2 now checks the name of the remaining rider.

W3 is in progress with ISSUE-021/022/023/025 open and ISSUE-024 closed. R1 remains open and A-4 awaits the student's independent decision.

##### W3 correction review: third round of fixes

Applied on the W3 working diff over `eb1e864`, Node 24.22.3, verified live against the local test database on 2026-11-24.

- **ISSUE-021 — slot ownership on both acquire and release, both directions.** Added `claimSlot(op)` and `clearPendingIfOwner(key)` in `pendingStore.ts`. Both pages claim the slot before sending (refusing to overwrite a slot owned by a different key, in either navigation direction) and release only a slot the key still owns, so a delayed receipt cannot clear a newer operation. Three browser tests: Home blocked by a trip-owned slot, a trip mutation blocked by a pending creation, and the lost-ack creation retry. Each asserts zero new POSTs and unchanged stored bytes.
- **ISSUE-022 — normalize/validate before claiming.** The create page trims and requires non-empty name/destination/departure, and the registration forms trim and reject a blank name with a field error, all before claiming the slot — so an impossible date or whitespace-only name never reaches storage or the network. Browser test: a blank name yields a field error, zero POSTs, no pending op, and a corrected submission succeeds.
- **ISSUE-023 — single source of truth + floor from old keys.** The full accepted preview payload now lives IN the reducer (`state.preview`), and the page renders from it, so a delayed/discarded preview the reducer rejects cannot replace the visible plan. The mutation reducer now raises the floor from every reply's observed version (a valid same-trip observation, even from an old key) before applying the key guard, so an old-key conflict reporting v7 raises the floor to 7 while leaving the newer pending op intact. New reducer unit tests; the earlier old-key U-04 test was updated to the corrected contract.
- **ISSUE-025 — absent-vs-malformed body and semantic cache invariants.** `readEmptyBody` reads the raw bytes and accepts only an absent body or a literal `{}`; a whitespace-only body is malformed JSON → 400. The preview result validator requires nonnegative integer `matchedCount`/`totalCost`, `matchedCount === assignments.length`, and `totalCost === sum(assignment costs)`, so a cached row with zero assignments / matchedCount 5 / cost −7 is refused (≥500). Integration cases cover the whitespace body and the semantic-corruption cache.
- **ISSUE-024 evidence / creation test.** The lost-ack creation test forwards the first POST (so the trip commits), hides the success behind a retainable 503, and asserts only the original key was transmitted, the retry resolved to the same id, and the committed trip is at version 0 — establishing one durable creation.

Observed live: `npm run test:e2e` 10/10, `npm run test:concurrency` 36/36 (15 preview/commit incl. the whitespace and semantic-cache cases), `npm run test:unit` 33/33, `npm run test:matching` 69/69, `npm run test:setup` 2/2, lint, typecheck, and the production build. The implementation marked the four issues closed after this host run. See the subsequent verification below. A-4 (independent student acceptance) remains pending.

### W3 third-round verification

Reviewed the working tree over `eb1e864`. The reviewer passed 33 unit, 69 matching and two setup tests, lint, typecheck and the production build. The local test database connection returned `EPERM` on port 55432. The ten browser and 36 PostgreSQL passes above are host observations.

| Issue | Reproduction and observed result | Status |
|---|---|---|
| 021 | In a page-handler probe, submit a registration with a creation or another trip's operation in the slot. Both sent zero POSTs and preserved the stored bytes. Calling the release helper with an old key preserved the owner. | Closed |
| 022 | Submit a creation dated `2026-02-30T09:30Z`. Separately, submit a passenger named 81 ASCII letters. With the page handlers connected to the real POST handlers through an in-process fetch adapter, both sent one POST, received 400 and retained the invalid body. Three spaces as a passenger name sent zero POSTs and left the slot empty. | Open. Apply the server's normalization rules before persistence. Require zero POSTs, a field error and successful corrected submission for both remaining inputs. |
| 023 | Start a v5 preview, accept v6 and its full preview, then deliver the delayed v5 reply. The rendered v6 preview remained visible and committable. With a newer operation pending, an old-key conflict reporting v7 raised the floor to 7 and preserved the newer key. | Closed |
| 025 | The actual preview route with a cached-row client double returned 400 for whitespace and 500 for the earlier impossible aggregate. With two assignments and total 1, cost pairs `[-1, 2]` and `[0.5, 0.5]` both returned 200. A repeated passenger with consistent costs and totals also returned 200. | Open. Each stored assignment needs a bounded integer cost and each passenger may occur only once. Test the optimal and greedy cache paths. |

The lost-ack browser test checks retry identity and the returned trip's version. Its banner can appear before the forwarded POST completes. Wait for the forwarded response or the displayed 503 outcome before checking the captured ID. A version-0 GET for that ID also cannot count other trip rows. The browser test exercises replay identity, and a database count can independently establish uniqueness.

W3 remains in progress with ISSUE-022 and ISSUE-025 open. ISSUE-024 stays closed. A-4 awaits student review.

##### W3 correction review: fourth round of fixes

Applied on the W3 working diff over `eb1e864`, Node 24.22.3, verified live against the local test database on 2026-11-24.

- **ISSUE-022 — run the shared normalizers before claiming the slot.** Earlier fixes only trimmed blank input. The create page now calls the real `normalizeCreateTrip` (the same rules the server applies) before claiming the slot, so an impossible date (`2026-02-30`), an over-length label, or a missing field is caught locally — zero POSTs, nothing persisted. The registration forms call `normalizeLabel(name, LIMITS.participantNameCodePoints)`, so an 81-character name is rejected with a field error before any request. Browser tests: impossible-date create (0 POSTs, then corrected create succeeds), 81-char passenger name (field error, 0 POSTs, corrected submit succeeds), and the retained blank-name case.
- **ISSUE-025 — per-assignment and uniqueness validation.** The preview result validator now requires each assignment cost to be an integer in the contract's `[0, 10000]` range (so `[-1, 2]` and `[0.5, 0.5]` are rejected even though each pair sums to 1) and enforces that each passenger appears at most once across the assignments and the unassigned list (a passenger assigned twice is rejected). Both the optimal and greedy cached results are validated. Integration cases cover the negative/positive pair, the fractional pair, and the duplicate passenger.

Observed live: `npm run test:e2e` 12/12 (incl. the impossible-date and over-length-name cases), `npm run test:concurrency` 36/36 (15 preview/commit incl. the per-assignment corruption cases), `npm run test:unit` 33/33, `npm run test:matching` 69/69, `npm run test:setup` 2/2, lint, typecheck, and the production build. The implementation marked both issues closed after the host run. See the subsequent verification below. A-4 (independent student acceptance) remains pending.

### W3 fourth-round verification

The reviewer ran 33 unit, 69 matching and two setup tests, lint, typecheck and the production build on the working diff over `eb1e864`. All passed. The local PostgreSQL probe returned `EPERM` on port 55432. The 12 browser and 36 PostgreSQL passes above are host observations.

- **ISSUE-022 is closed.** With the page handlers using in-memory session storage and controlled HTTP responses, an impossible departure and an 81-character name in each registration form produced zero POSTs and an empty slot. Correcting each input produced one POST. The creation body contained the UTC timestamp, and both registration bodies contained the trimmed NFC name.
- **ISSUE-025 remains open.** With a cached-row client double, the actual preview route accepted a valid control and returned 500 for negative and fractional cost pairs, an exact duplicate passenger and assigned/unassigned overlap. Each case was run independently against the optimal and greedy fields. Two assignments with the same UUID in lowercase and uppercase, correct totals and valid costs returned 200 in both fields. A non-UUID string passenger ID also returned 200. Require canonical participant UUIDs before testing uniqueness. Use valid fixture UUIDs for the cost cases and vary only the intended fault to keep the regressions discriminating.
- The lost-ack browser case checks retry identity. The pending banner can appear before the forwarded response is captured. The dedicated test database already supports direct row counts from the test process, as demonstrated by the [concurrent creation check](../tests/concurrency/mutations.integration.test.ts). No list endpoint is needed to count the browser fixture's rows.

W3 remains in progress on ISSUE-025. A-4 awaits independent student acceptance.

##### W3 correction review: fifth round of fixes

Applied on the W3 working diff over `eb1e864`, Node 24.22.3, verified live against the local test database on 2026-11-24.

- **ISSUE-025 — canonical-UUID participant IDs before the uniqueness check.** The preview result validator now requires each participant ID (`driverId`, `passengerId`, and every `unassignedPassengerIds` entry) to be a canonical lowercase UUID (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`) before scanning for duplicates. This closes the gap the reviewer reproduced: the same UUID in lowercase and uppercase no longer passes as two distinct passengers, because the uppercase spelling is not canonical, so the row is refused. A non-UUID passenger ID (e.g. `"a"`) is likewise rejected. The integration cost regressions now use real canonical UUIDs instead of the `"a"`/`"d"` placeholders, so UUID validation cannot mask a broken cost or uniqueness check — each row is refused only for the specific defect under test. New integration cases cover the lowercase/uppercase duplicate across two assignments and the assigned-vs-unassigned lowercase/uppercase overlap, each run independently against both the optimal and greedy cached fields.
- **Test refinement (nonblocking reviewer note).** Each corrupt-cache case now restores the untested sibling column to the preview's actual published result rather than a synthetic empty result (which omitted the seeded passenger), so a row is refused only for the corruption under test. The assertions now require exactly `500` with `error.code === "INTERNAL_ERROR"` — a corrupt cache is a deterministic invariant violation, not a retryable `503` — replacing the looser `status >= 500` check that would also have accepted an unrelated transient failure.

Observed live: `npm run test:concurrency` 36/36 (15 preview/commit incl. the mixed-case-duplicate cases across both result columns, asserting exact `500`/`INTERNAL_ERROR` against the real published sibling), `npm run test:e2e` 12/12, `npm run test:unit` 33/33, `npm run test:matching` 69/69, `npm run test:setup` 2/2, lint, typecheck, and the production build all passed. ISSUE-025's reproduced sub-finding is resolved; the W3 technical observations are met. A-4 (independent student acceptance) remains pending.

### W3 fifth-round verification

On the working diff over `eb1e864`, the reviewer exercised the actual preview POST handler with a cached-row database double. For each of the optimal and greedy columns, a canonical control returned 200. Eight corrupt variants per column returned 500 with `INTERNAL_ERROR`: a mixed-case passenger pair, mixed-case assigned/unassigned overlap, an uppercase driver ID, a non-UUID unassigned ID, an exact duplicate passenger, exact assigned/unassigned overlap, a negative cost offset by a positive cost, and two fractional costs summing to an integer. Each probe kept a valid result in the sibling column.

The reviewer passed 33 unit, 69 matching and two setup tests, lint, typecheck and the production build. The local test database probe returned `EPERM` on port 55432. The preceding 36 PostgreSQL and 12 browser passes are host observations. Follow-up fixture review confirmed that each of the five variants in each column restores the published sibling, and all 13 corruption responses (the three earlier cases plus ten loop iterations) require HTTP 500 and `error.code === "INTERNAL_ERROR"`. Reviewer lint and typecheck passed. The host reran the 15 preview/commit cases and the full 36-case concurrency suite after the refinement.

ISSUE-025 is closed. After technical verification, the student accepted the W3 working diff on `eb1e864` following the two-tab persistence and stale-save checks recorded in A-4. R1 passed.

## W4 closeout

Implemented on the working diff over `9040695` (committed W3), Node 24.22.3, verified live against the local test database on 2026-11-24. The episode (A-5) adds `tests/concurrency/races-recovery.integration.test.ts` and four test-only seams (all `__`-prefixed, never set by production): `__setCommitVersionGuardEnabled` (`src/trips/commit.ts`, the C-01 mutant), `__setPublishBarrier` (`src/trips/preview.ts`, the C-13/C-15 stale-window barrier), `__setCommitPlanMidHook` (`src/trips/repository.ts`, between the plan DELETE and INSERT for C-05), and `__setSnapshotBarrier` (`src/trips/service.ts`, inside the dashboard read for C-08). Interleavings use barriers, `pg_blocking_pids`/wait state, `pg_backend_pid`, and bounded `expect.poll` watchdogs; there are no timing-only sleeps. The bullets below describe the final, strengthened tests (after the [technical-review corrections](#w4-technical-review-corrections)).

- **C-01 — double-commit guard under contention.** Commit A pauses holding the trip row lock; commit B, on a separate connection, is observed blocked (`pg_blocking_pids`/wait state) before A releases. Exactly one commit applies (version v → v+1) and the other returns `409 STALE_VERSION`.
- **C-01 sensitivity mutant.** The identical contended scenario with `__setCommitVersionGuardEnabled(false)` lets both commits apply (version +2) — so the one-`200`/one-`409` assertion fails, proving the check has teeth. Restored, the contended path yields one `200` and one `409`.
- **C-05 — savepoint rollback during plan replacement.** A `TerminalBusinessError` thrown between the assignment DELETE and INSERT takes the savepoint-recovery path. The prior plan, version, status, and both receipts (the original `applied/200` and the new `not_applied/422`, read from the database) survive; the success receipt still replays.
- **C-06 — liveness on a second connection.** Writer A pauses holding trip A's row lock; trip B's registration on a separate pool completes and commits meanwhile.
- **C-08 — consistent dashboard read.** The actual `getTripSnapshot` is paused after its trip-row read; a cancellation is committed meanwhile; the returned snapshot is internally consistent (trip version unchanged, the canceled driver still active in the returned view), never a mixture.
- **C-13 — publication version recheck.** A roster mutation committed inside the publish stale window (barrier-forced) makes publication reject with `409` and insert no preview row for the stale version; a retry publishes cleanly at the new version.
- **C-15 — concurrent-preview convergence.** Both publishers rendezvous past a cache miss before either publishes; they converge on one stored id, with exactly one row for `(trip, version, algorithm)`, and both responses' full optimal and greedy results equal the stored row. Publication does not bump the trip version.
- **C-16 — uncertain COMMIT and connection disposal.** Three cases on a one-connection pool, each verifying backend replacement (`pg_backend_pid` changes): a transport error at the COMMIT call → `OutcomeUnknown` (no durable change); a durable commit whose query promise rejects with ECONNRESET before the helper receives the successful result → `OutcomeUnknown` with the `applied` receipt already present and a same-key replay returning it (`replayed === true`, unchanged roster/version); and a deferred-constraint violation → `CommitRejected` (`23503`).

Observed live after both correction rounds: `npm run test:concurrency` 46/46 (the 36 prior cases plus these 10 W4 cases — C-16 is three cases), `npm run test:e2e` 12/12, `npm run test:unit` 33/33, `npm run test:matching` 69/69, `npm run test:setup` 2/2, lint, typecheck, and the production build all passed. A-5 (independent student review and decision) remains pending; a deliberate mutant is test-sensitivity evidence, not the required real debugging story. The technical review and its corrections are recorded below.

### W4 technical review

On the uncommitted diff on `22b538a` (application baseline `9040695`), the reviewer ran `npm run test:concurrency -- tests/concurrency/races-recovery.integration.test.ts` on Node 24 against the designated test database. The first attempt stopped in setup because sandbox loopback access was denied. With local database access all eight cases passed. Lint and typecheck also passed. The earlier full-suite counts remain the host's observations.

The gate returns to **in progress**. Inspection of the [W4 suite](../tests/concurrency/races-recovery.integration.test.ts) against the [acceptance checks](ARCHITECTURE.md#acceptance-checks) identified five gaps.

- C-01 runs the two commits sequentially. The mutant test explicitly expects two successes. The suite has yet to observe two contending commits or run the same acceptance assertion against the mutant.
- C-05 injects a transient failure after all business writes. The mutation helper takes the full transaction rollback path. The specified fault between assignment deletion and insertion and the claimed terminal savepoint recovery remain unverified.
- C-08 establishes isolation with handwritten SQL. The dashboard service runs only before and after cancellation. Its own multi-query read could mix versions and this test would still pass.
- C-15 starts two calls together, but either can find an already published preview. The test also omits comparison of the returned optimal and greedy results with the stored results.
- C-16 simulates loss of a delivered result after PostgreSQL has acknowledged COMMIT. It demonstrates receipt replay. Transport failure at the COMMIT call, outcome recovery on that path, and disposal of the affected backend remain unverified by this case.

The [issue register](../WORKPLAN.md#bugs-and-open-issues) records the follow-ups as ISSUE-026 through ISSUE-030. A-5 independent student review remains pending.

#### W4 technical review: corrections

Applied on the working diff over `9040695`, Node 24.22.3, verified live against the local test database on 2026-11-24. Each strengthened test now drives the real code path the check names, with the behavior forced by a barrier and asserted on observable state. Two further test-only seams were added (all `__`-prefixed, never set by production): `__setCommitPlanMidHook` (`src/trips/repository.ts`, fires between the assignment DELETE and INSERT), `__setSnapshotBarrier` (`src/trips/service.ts`, fires after the dashboard trip-row read), and the existing `__setPublishBarrier` is now used as a 2-party rendezvous.

- **ISSUE-026 (C-01).** The two commits now genuinely contend: commit A pauses at `before-success-commit` holding the trip row lock while commit B, on a separate connection, is observed blocked on a lock (`pg_stat_activity.wait_event_type = 'Lock'`) by `pg_blocking_pids`/wait state before A is released. The acceptance assertion — exactly one `200` and one `409 STALE_VERSION`, version advanced by one — runs through that same contended path. The mutant drives the identical contended scenario with the guard off (both commits apply, version +2) and restored (one `200`, one `409`). The mutant no longer has a separate sequential expectation.
- **ISSUE-027 (C-05).** The injected failure is now a `TerminalBusinessError` thrown BETWEEN the assignment DELETE and the INSERT loop inside `commitPlan` (via `__setCommitPlanMidHook`), so it takes the savepoint-recovery path (`ROLLBACK TO SAVEPOINT` + a `not_applied` receipt), not the whole-transaction rollback. The test asserts the prior plan, version, plan version, and status survive; both receipts persist and are read directly from the test database (the original `applied/200` and the new `not_applied/422`); and the original success receipt still replays with no new effect.
- **ISSUE-028 (C-08).** The test now pauses the ACTUAL `getTripSnapshot` after its trip-row read (via `__setSnapshotBarrier`), commits a cancellation on another connection while it is paused, then lets it finish and asserts the returned snapshot is internally consistent (trip version unchanged, the canceled driver still active in the returned view). A regression of the dashboard read to READ COMMITTED would surface the mixture and fail.
- **ISSUE-029 (C-15).** Both publishers now rendezvous in the stale window (each confirmed past a cache MISS) before either takes the publication lock, so convergence is decided by the unique-key recheck under the lock. The test compares both callers' full `optimal` and `greedy` results against the stored row, not just the id/version.
- **ISSUE-030 (C-16).** Two cases now inject the fault AT the COMMIT call on a single-connection pool and observe backend replacement by `pg_backend_pid`. (1) Destroying the backing socket at `before-success-commit` makes the COMMIT fail with a genuine transport error → `OutcomeUnknown`; the backend is replaced; a same-key replay resolves to exactly one driver; the pool stays usable. (2) A deferred-constraint violation makes the server reject the COMMIT (`23503`) → `CommitRejected`; the backend is replaced; no business change or receipt persisted; a same-key retry applies cleanly.

Observed live: `npm run test:concurrency` 45/45 (36 prior plus the 9 W4 cases — C-16 is now two cases), `npm run test:e2e` 12/12, `npm run test:unit` 33/33, `npm run test:matching` 69/69, `npm run test:setup` 2/2, lint, typecheck, and the production build all passed. The implementation closeout marked all five issues addressed. The subsequent correction verification reopens ISSUE-030. A-5 (independent student review and decision) remains pending; the mutant is test-sensitivity evidence, not the required real debugging story.

#### W4 correction verification

The reviewer ran `npm run test:concurrency` on the uncommitted working tree on `22b538a` (application baseline `9040695`). All 45 PostgreSQL cases passed. Lint and typecheck passed. The E2E, unit, matching, setup and production-build results above are from the host. Code inspection and the live run verify C-05's mid-delete rollback and two durable receipts, C-08's interleaving inside the dashboard read, and C-15's two cache misses and full result comparisons.

Two isolated probes used a temporary copy of the working tree and the designated test database.

- **C-01.** With the version guard disabled by default, the ordinary acceptance test failed at its status assertion with actual `[200, 200]` and expected `[200, 409]`. After restoring the guard, the same scenario passed with additional checks that A's backend PID was in `pg_blocking_pids(B)` and B returned `STALE_VERSION`. The retained suite polls B's lock wait and checks HTTP statuses. Only the probe asserted the specific blocker and error code.
- **C-16.** In the socket-destruction case, a read on the replacement connection immediately before retry showed zero drivers, trip version 0 and no receipt for the key. The retry returned 201 with `replayed === false`. The deferred-FK case also verifies a rollback. Keep both checks and add a case that lets the database commit the write and receipt, then suppresses the successful COMMIT reply before the mutation helper receives it. Require an unknown outcome, a replacement backend, the durable original receipt before retry, and a matching same-key replay with unchanged roster and version.

ISSUE-026 through ISSUE-029 remain closed. ISSUE-030 keeps W4 in progress. A-5 remains pending independent student review.

#### W4 correction: C-16 durable lost-acknowledgement case

Applied on the working diff over `9040695`, Node 24.22.3, verified live against the local test database on 2026-11-24. C-16 now has three cases on a one-connection pool, each confirming the faulted backend is replaced (`pg_backend_pid` changes):

- **Lost DATABASE acknowledgement of a COMMIT that landed (the reopened gate).** At `before-success-commit` the test wraps the checked-out client's `query` once: the next `client.query("COMMIT")` runs the REAL commit on the server (durably writing the driver and the `applied` receipt), then the returned promise is rejected with a transport error (`ECONNRESET`) before the helper sees the result. The error therefore lands INSIDE `commitOrClassify`, before the helper sets `committed`, exercising the helper's own commit-classification path (not the later application-response loss). With no server SQLSTATE the outcome is `unknown` → `OutcomeUnknown`. Before any retry, independent SETUP-connection reads show the added driver and the single `applied/201` receipt already present (the commit is genuinely durable). The backend is replaced. A same-key replay on the replacement connection returns `replayed === true` with the IDENTICAL stored `response_json` (including the committed driver's id), the same roster and trip version, and no second receipt.
- **Transport failure at the COMMIT call (unknown, not durable).** Destroying the socket at `before-success-commit` makes the COMMIT fail with a transport error → `OutcomeUnknown`; same-key replay applies once.
- **Server-confirmed rollback.** A deferred-constraint violation at COMMIT → `CommitRejected` (`23503`); no business change or receipt; a same-key retry applies cleanly.

These cover both uncertain COMMIT outcomes — acknowledgement lost for a write that DID commit, and a transport failure with no durable change — and a server-confirmed rollback, each with connection disposal.

Observed live: `npm run test:concurrency` 46/46 (36 prior plus the 10 W4 cases — C-16 is now three cases), `npm run test:e2e` 12/12, `npm run test:unit` 33/33, `npm run test:matching` 69/69, `npm run test:setup` 2/2, lint, typecheck, and the production build all passed. A-5 independent student review remains pending.

#### C-16 fault placement review

The reviewer reran the working tree on `22b538a` with Node 24. All 46 concurrency cases passed on PostgreSQL. Lint and typecheck passed. The new case verifies the driver and applied receipt before retry and observes a replacement backend. The [mutation helper](../src/trips/mutation.ts) has already received a successful COMMIT reply and set `committed = true` before the test throws. Its catch takes the known-commit delivery-failure branch. The retained test also checks replay status and driver count but omits comparison with the stored response body and driver identities.

In a temporary copy, the reviewer used the existing `before-success-commit` hook to wrap the checked-out client's next query once. The wrapper verified the query was COMMIT, awaited the real PostgreSQL commit, and raised a simulated ECONNRESET in place of returning the reply. This put the error inside `commitOrClassify` before the helper could set `committed`. The targeted case passed (1 selected, 9 skipped). The independent reader saw the durable receipt and driver before retry. The caller received `OutcomeUnknown`, the backend changed, and the same-key replay returned the stored `response_json` with the same drivers and version.

ISSUE-030 remains open until this regression runs in the repository suite. A-5 remains pending independent student review.

##### C-16 fault placement: resolved in the suite

The retained C-16 "lost DATABASE acknowledgement" case now uses exactly the reviewer's technique: at `before-success-commit` it wraps the checked-out client's `query` so the next `COMMIT` runs for real on the server and then rejects with `ECONNRESET`, placing the error inside `commitOrClassify` before `committed` is set. Verified live: the targeted case and all 46 concurrency cases pass. The caller receives `OutcomeUnknown`; an independent SETUP connection sees the durable driver and the `applied/201` receipt before any retry; the backend pid changes; and the same-key replay returns the identical stored `response_json` (including the committed driver's id) with the same roster and trip version and no second receipt. `npm run test:concurrency` 46/46, `npm run test:e2e` 12/12, `npm run test:unit` 33/33, `npm run test:matching` 69/69, `npm run test:setup` 2/2, lint, typecheck, and the production build all passed. ISSUE-030 is now addressed; the W4 technical gate is met on the working diff over `9040695`. A-5 independent student review remains pending.

The reviewer reran the repository suite on the uncommitted diff on `22b538a` (application baseline `9040695`). All 46 PostgreSQL concurrency cases passed, including the retained C-16 case, and lint and typecheck passed. The browser, unit, matching, setup and build results above are from the host run.

## W5 closeout

Implemented on the working diff over `8f3187a` (committed W4), Node 24.22.3, verified live on 2026-11-24. The episode (A-6) adds three evaluation scripts and their npm commands and retains summary artifacts under `eval/`: `scripts/eval-matching.ts` (`npm run eval:matching` → `eval/d1-matching.json`), `scripts/eval-concurrency.ts` (`npm run eval:concurrency` → `eval/d2-concurrency.json`), and `scripts/eval-responsiveness.ts` (`npm run eval:responsiveness` → `eval/p01-responsiveness.json`). Each artifact records the algorithm/variant, Node version, platform, commit, timestamp, and summary observations. No production code changed; the existing test-only barriers are reused.

The bullets below summarize the implementation runs. The [second-round verification](#w5-second-round-verification) records which measurements passed review.

- **D-1 — exact matching versus greedy.** Both algorithms ran on M-01/M-08, 100 tiny oracle seeds, and the 5/15/30/50-passenger classes. The optimizer equals the independent oracle on all 100 seeds; zero fixture/oracle/invariant discrepancies. Costs compared only at equal cardinality: greedy is never cheaper there and matches fewer at larger sizes. Max-bound pure-solver p95 ≈ 1.8 ms (target ≤ 100 ms). The size classes now use EXACT counts (ISSUE-032).
- **D-2 — outside-lock versus long-lock preview.** Both variants persist the preview and use the same version-checked commit path, exercised with a controllable gate and a 5 s bounded watchdog. Outside-lock: a cancellation during paused compute makes publication return `409` and write no stale row. Long-lock: the concurrent cancellation is blocked specifically by the holder backend (`pg_blocking_pids`), then the published (now stale) preview's commit is rejected `409`, leaving version +1 and zero assignments (ISSUE-033). Both preserve invariants; short locks are retained.
- **P-01 — application responsiveness.** The harness ends the measured window at preview completion (excluding the trailing competing batch), requires a finite matcher duration per compute, and verifies the persisted 20/50 roster before timing. The current retained run shows competing p95 12.1 ms, an increase of 1.7 ms, 100 fresh previews and zero cache hits. All four negative controls failed as expected in the [fourth-round verification](#w5-correction-verification-fourth-round).

Observed live: `npm run eval:matching`, `npm run eval:concurrency`, and `npm run eval:responsiveness` all pass with the numbers above; `npm run test:concurrency` 46/46, `npm run test:unit` 33/33, `npm run test:matching` 69/69, `npm run test:setup` 2/2, `npm run test:e2e` 12/12, lint, typecheck, and the production build all passed. The initial implementation closeout marked W5 passed. The subsequent technical review reopens the gate. The D-1 and D-2 decision records are complete except the human-response field; A-6 (independent student review, which also fills those fields) remains pending. The lock experiment's artificial gate measures database coordination, not CPU responsiveness — that is P-01.

### W5 technical review

The reviewer ran the three evaluation scripts in a temporary copy using Node 24, the existing production build for P-01 and the designated test database. The submitted JSON files were preserved. All three unmodified scripts exited successfully. Lint and typecheck also passed. The application test-suite counts and production build reported above are from the host.

| Experiment | Independent observation | Outstanding measurement |
|---|---|---|
| D-1 | The hand fixtures passed, the optimizer agreed with the independent oracle on 100/100 seeds, and dense 20-driver/50-passenger solver p95 was 1.82 ms. | The generator samples counts between 1 and the requested maximum. The ten seeds labeled 50 yielded 5, 44, 17, 17, 22, 50, 3, 26, 46 and 26 passengers. None of the ten labeled 30 had 30. The aggregate 160 versus 156 belongs to a mixed-size sample. Retain exact-size cases and per-seed observations alongside the raw timing samples. |
| D-2 | Outside-lock publication returned `409 STALE_VERSION` and wrote zero stale rows. The long-lock run observed a lock wait, cancellation advanced the version, and stale commit returned `409 STALE_VERSION`. | The wait query only checks B's `wait_event_type`. Record the actual holder blocking B, wait duration, exact stale errors, retries and persisted state after the rejected commit. Release the gate and close clients on error as well as on success. |
| P-01 | The unmodified run timed previews at p95 22.6 ms idle and 21.8 ms with the other client running. In a second copy of the harness the reviewer directed every competing PATCH at a nonexistent driver and counted the returned 404s. All 154 edits failed, yet the harness printed zero errors and passed. | Time the same read/edit workload at idle and under 100 uncached previews. Check and consume responses on both clients. Enforce deadlines, count errors/timeouts and require completed samples. Record cache misses, in-server matcher time, event-loop delay and raw timings. |

The supplied P-01 artifact gives preview p95 values of 18.1 and 19.0 ms (increase 0.9 ms). The initial closeout quoted 17.8 and 19.4 ms (increase 1.6 ms). Neither pair measures the competing client's latency. The JSON files identify the underlying application revision `8f3187a`; the evaluation scripts in this run include uncommitted changes. Record an identifiable harness revision or diff and the demo machine alongside each corrected run. W5 is in progress and R2 is open. [Issue register](../WORKPLAN.md#bugs-and-open-issues)

#### W5 technical review: corrections

Applied on the working diff over `8f3187a`, Node 24.22.3, verified live on 2026-11-24. No production code changed; only the three evaluation scripts. Reported figures below are derived from the regenerated artifacts (`eval/d1-matching.json`, `eval/d2-concurrency.json`, `eval/p01-responsiveness.json`).

- **ISSUE-031 (P-01 measures the wrong client).** The harness now times the COMPETING GET/PATCH workload — the gate client — at idle and again under concurrent uncached max-size preview load, not the preview client. Every competing request has a 2000 ms deadline; a breach counts as a timeout. Any non-2xx competing response is an error. The run fails on missing samples, any error, any timeout, or a gate breach. A negative control (`P01_NEGATIVE_CONTROL=1`) points the competing workload at a non-existent trip: all 200 GET/PATCH requests return 404, and the harness now reports `errors: 200`, `successful: 0`, and `pass: false` — the exact control the earlier harness wrongly passed. Normal run: idle competing p95 10.1 ms, under-load p95 12.3 ms, increase 2.2 ms (gates ≤500 and ≤250), 0 errors, 0 timeouts, 200/200 successful per phase, 70 previews served as load.
- **ISSUE-032 (D-1 size labels were upper bounds).** The size classes now build instances with EXACT driver/passenger counts (a local fixed-count generator, not the up-to-bound `randomCase`), guarded by an assertion, and retain per-seed actual sizes and per-algorithm results. Every "50" case has 50 passengers, every "30" has 30. The optimizer still matches ≥ greedy and is never costlier at equal cardinality (e.g. 402 vs 401 matched at 50 passengers; 116 vs 109 at 15).
- **ISSUE-033 (D-2 observed any wait).** The long-lock harness now captures the holder backend's PID on its own client and asserts, via `pg_blocking_pids`, that the cancellation backend is blocked SPECIFICALLY by that holder; it records the holder/cancellation PIDs, the lock-wait duration, the exact `STALE_VERSION` commit rejection, and the final durable state after the rejected commit (version advanced by one, zero assignments).
- **ISSUE-034 (P-01 evidence incomplete).** The artifact retains the raw per-request latency arrays for both phases (200 samples each) and derives the reported percentiles from them; the timeout count is measured, not hard-coded. Black-box limits — server-internal matcher duration, preview cache-hit counts, and event-loop delay are not observable from the HTTP client — are recorded explicitly in the artifact rather than fabricated; the pure-solver p95 remains D-1's.

Observed live after the corrections: `npm run eval:matching` (oracle 100/100, exact-size classes, zero discrepancies, max-bound solver p95 1.78 ms), `npm run eval:concurrency` (holder 17268 blocking cancellation 17269, 19 ms wait, stale commit `409 STALE_VERSION`, final version +1/0 assignments), `npm run eval:responsiveness` (competing p95 12.3 ms, increase 2.2 ms, 0 errors/timeouts) and its negative control fails as required; `npm run test:matching` 69/69, `npm run test:concurrency` 46/46, lint, typecheck all passed. The implementation closeout marked the W5 measurement gate met. The correction verification below reopens the gate. A-6 independent student review remains pending and still fills the D-1/D-2 human-response fields.

### W5 correction verification

The reviewer reran all three evaluation commands on Node 24 in a temporary copy of the working diff on `8f3187a`, using the existing production build and designated test database. The submitted artifacts were preserved. Lint and typecheck passed.

| Issue | Verified | Remaining evidence |
|---|---|---|
| ISSUE-032 | All 40 per-seed size-class rows reproduced exactly, with 10 inputs of each specified passenger count. Both fixtures passed, the optimizer agreed with 100/100 oracle seeds, and the dense maximum-bound solver p95 was 1.792 ms. The size-label defect is closed. | For the broader timing record, retain per-algorithm runtimes with the size/seed results and raw maximum-bound timing samples. |
| ISSUE-031 | The gate now times and checks the competing GET/PATCH client. The normal rerun reported 200 successful requests per phase with p95 12.6 ms idle and 12.7 ms under load, across 70 preview attempts. The built-in competitor-failure control exited 1 with 200 errors per phase. | The production-build experiment requires 100 uncached max-size previews. The harness stops when the competing loop finishes and counts preview attempts even on HTTP or transport errors. A temporary control directed the previews to a missing route: all 5 warmups and all 100 measured attempts returned 404, yet the run exited 0. Warmup also ends at capacity 7 and the first measured toggle sets 7 again, reusing a warmed version. The gate compares successes with observed sample count rather than the expected 200. A focused test of the actual timing function with an HTTP 200 response whose body stalled until abort returned 200, `timedOut: false` after 2002 ms. |
| ISSUE-033 | PostgreSQL identified the holder blocking the cancellation. The long-lock commit returned exactly `409 STALE_VERSION`. The final version advanced from 3 to 4 with the driver inactive and zero assignments. | In a temporary control, after the observer detected the blocker the holder kept its lock for another 251 ms before release. The artifact reported only 18 ms. Its timer stops at detection. In the same run the outside-lock path returned `409 ALGORITHM_CHANGED` and still passed. Assert the required code there too and record the interval through release/acquisition and the final state for both variants. |
| ISSUE-034 | The submitted P-01 JSON contains 200 successful latency samples per phase. | The artifact records sorted successful latencies only, with no server matcher timings, observed cache hits or server event-loop delay. These are required by [the evaluation contract](ARCHITECTURE.md#p-01-application-responsiveness). Retain operation/outcome samples and identify the build and evaluation revision. The submitted P-01 artifact reports 10.2/11.7 ms (+1.5 ms) and 70 attempts; the corrections subsection quotes 10.1/12.3 ms (+2.2 ms). The retained D-2 timing field is 20 ms. Running the negative control currently overwrites the normal P-01 artifact. |

W5 remains in progress. These results assess the evaluation harness; the application has not been shown to exceed the latency thresholds. [Workplan issue register](../WORKPLAN.md#bugs-and-open-issues)

#### W5 correction verification: second round

Applied on the working diff over `8f3187a`, Node 24.22.3, verified live on 2026-11-24. No production response contract changed; the only production addition is eval-only, test-DB-gated telemetry (`src/trips/preview-telemetry.ts` + `GET /api/eval/telemetry`, inert unless `GROUPRIDE_USE_TEST_DATABASE=1`).

- **ISSUE-031 (P-01 load must genuinely succeed).** The preview LOAD is now the anchor: the run requires exactly 100 previews that each return HTTP 200 within the deadline AND carry a distinct previewId AND were freshly computed (server telemetry `cacheHit=false`, verified computed count ≥ 100). The preview load runs to completion independently; the competing workload is re-driven concurrently until it finishes, so neither is cut short. Warmup preview rows are deleted before the measured window so no measured toggle can be served from a warmed version. The deadline now covers the response-body read (the body is consumed inside the same `AbortController`), so a 200 whose body stalls past 2 s is a timeout, not a success. Two controls, both writing `eval/p01-control.json` (gitignored) instead of the real artifact: `P01_NEGATIVE_CONTROL=edits` (competing 404s) fails with `competingHaveSamples:false`; `P01_NEGATIVE_CONTROL=preview` (preview 404s) fails with `previewDistinctUncached 0/100` and `previewReachedTarget:false`. The normal run passes: 100/100 distinct uncached previews, 0 cache hits, competing idle p95 12.3 ms, under-load p95 15.9 ms, increase 3.6 ms, 0 errors, 0 timeouts.
- **ISSUE-033 (D-2 full blocking interval + exact outside-lock code).** The artifact now reports both `blockDetectMs` (time to detect the blocker, diagnostic) and `blockingIntervalMs` (start of the wait through the cancellation actually completing — the whole time the holder held the lock). The outside-lock invariant now requires the EXACT `STALE_VERSION` code (`publishErrorCode` recorded), so an `ALGORITHM_CHANGED` 409 no longer passes. Observed: blockDetect 21 ms, full blocking interval 35 ms, outside-lock `STALE_VERSION`, long-lock stale commit `STALE_VERSION`, final version +1 / 0 assignments.
- **ISSUE-034 (required telemetry + traceability).** The P-01 artifact now records server-side per-preview matcher duration (p50/p95 over 100 computed previews), the observed cache-hit count (0), and event-loop-delay percentiles (p50/p95/max via `monitorEventLoopDelay`), alongside both clients' raw latency arrays. Reported numbers derive from this retained run. Controls no longer overwrite the normal artifact (separate gitignored file).

Observed live after this round: `npm run eval:matching` (oracle 100/100, exact sizes, solver p95 ≈ 1.8 ms), `npm run eval:concurrency` (holder blocks cancellation, blocking interval 35 ms, both variants exactly `STALE_VERSION`, final version +1/0 assignments), `npm run eval:responsiveness` (100/100 distinct uncached previews, 0 cache hits, matcher p95 3.7 ms, event-loop p95 11.2 ms, competing under-load p95 15.9 ms, increase 3.6 ms, 0 errors/timeouts) with BOTH negative controls failing; `npm run test:matching` 69/69, `npm run test:concurrency` 46/46, `npm run test:unit` 33/33, `npm run test:e2e` 12/12, lint, typecheck, and the production build all passed. The implementation closeout marked W5 passed. The subsequent second-round verification reopens ISSUE-031 and ISSUE-034. A-6 independent student review remains pending and still fills the D-1/D-2 human-response fields.

### W5 second-round verification

The reviewer reran D-1, D-2, normal P-01, and both built-in controls in a temporary copy of the working tree on `8f3187a`, with Node 24, the existing production build and the designated PostgreSQL test database. The submitted artifacts were preserved. Lint and typecheck passed.

- **ISSUE-032 closed.** All 40 size-class rows reproduced exactly. Oracle agreement was 100/100 and dense maximum-bound solver p95 was 1.82 ms.
- **ISSUE-033 closed.** The holder PID blocked the cancellation. Both variants reported exactly `409 STALE_VERSION`. The reviewer observed 17 ms until detection and 24 ms through cancellation completion, with a version increment and zero assignments. A control that held the lock for an extra 250 ms after detection reported 18 ms and 281 ms respectively. Substituting `409 ALGORITHM_CHANGED` in the outside-lock path made D-2 exit 1.
- **ISSUE-031 open.** Normal P-01 returned 100 distinct previews, zero cache hits and 200 idle/400 nominally loaded successful GET/PATCH samples. The built-in edit and preview controls each exited 1 and preserved the normal file. Repeating one capacity value in a temporary control produced 101 successful preview responses, 100 distinct IDs and one cache hit. The gate still passed. In that same run 111 of the 400 competing requests began after load completion. An isolated stalled-body probe returned a timeout after 2002 ms in `timed`; passing that outcome through `previewLoad` raised a TypeError on `prev.body.previewId` before a failed artifact could be assembled.
- **ISSUE-034 open.** The submitted normal artifact contains 100 matcher samples, zero cache hits and server loop telemetry. Its idle/load p95 values are **9.9/11.7 ms (+1.8 ms)**, matcher p95 **2.438 ms**, and event-loop p95 **10.625 ms**. The closeout previously cited 12.3/15.9 ms (+3.6 ms). The retained D-2 full interval is 26 ms. The telemetry drain clears preview records but leaves the histogram intact. A controlled warmup spike produced a 163.316 ms maximum which persisted after a drain and a quiet period. The final read also occurs after the last competing batch. Align the histogram and request samples with the actual load window. A temporary control preserved the 100 compute records but set all matcher durations and the loop-delay summary to null before evaluation. The benchmark still exited 0 and printed `pass: true` with both p95 fields null. The telemetry route returned HTTP 404 when invoked without the test-mode flag.

W5 remains in progress. The next P-01 run should fail the duplicate-version control, emit a failed artifact for a body timeout and exclude samples started after preview completion. Record operation outcomes, measured intervals and the build/harness identity alongside the summaries. [Issue register](../WORKPLAN.md#bugs-and-open-issues)

#### W5 correction verification: third round

Applied on the working diff over `8f3187a`, Node 24.22.3, verified live on 2026-11-24. The eval-only telemetry route gained a `?reset=1` action; no production response contract changed.

- **ISSUE-031 (explicit measured window + exact counts + no TypeError).** The preview load now runs EXACTLY `PREVIEW_COUNT` attempts, and the gate requires all of: 100 attempts, 100 distinct IDs, **0 cache hits**, and exactly 100 freshly-computed telemetry records. `timed` always returns a well-formed sample with `body: {}` on a timeout/transport failure, so a stalled-body preview is recorded as a timeout (failing the run) instead of raising a TypeError. The measured window is `[windowStart, windowEnd]` around the preview load; only competing requests whose `startedAt` falls inside it count as under-load (the artifact records both `underLoadSamplesInWindow` and `competingStartedTotal`). A new `P01_NEGATIVE_CONTROL=duplicate` control reuses one version: it now fails with `distinct 1/100` and `cacheHits 99`. All three controls (`duplicate`, `preview`, `edits`) exit 1 and write only `eval/p01-control.json`.
- **ISSUE-034 (window-scoped telemetry + required presence + traceability).** The histogram and preview records are reset via `GET /api/eval/telemetry?reset=1` at the measured-window start, so matcher and event-loop percentiles reflect only the load window (not warmup/idle). The gate requires telemetry to be present: a run with null matcher or null event-loop telemetry does not pass (the reviewer's all-null control now fails `telemetryPresent:false`). The artifact records operation outcomes (per-kind counts, errors, timeouts), the measured window duration, and the commit; the closeout figures below are read directly from the retained normal artifact.

Observed live on the retained normal run (`eval/p01-responsiveness.json`, commit `8f3187a`): measured window 3.5 s; 400/400 competing samples within the window; 100 preview attempts, 100 distinct, 0 cache hits, 100 computed; matcher p50/p95 2.17/2.47 ms; event-loop p50/p95/max 10.0/10.9/13.4 ms; competing idle p95 9.8 ms, under-load p95 12.1 ms, increase 2.3 ms, 0 errors/0 timeouts — **pass**. Controls: `duplicate` fails (`distinct 1/100`, `cacheHits 99`), `preview` fails (`0/100`, `telemetryPresent:false`), `edits` fails (`competingHaveSamples:false`). `npm run test:matching` 69/69, `npm run test:concurrency` 46/46, `npm run test:unit` 33/33, `npm run test:e2e` 12/12, lint, typecheck, build all passed. This implementation run reported a pass. The independent window review below reopens P-01. A-6 remains pending.

#### W5 review of the measured window

The reviewer reran all three evaluations in a temporary copy of the W5 diff on `8f3187a`, using Node 24, the existing production build and the designated local PostgreSQL test database. D-1 matched the oracle on 100/100 seeds with zero discrepancies and a maximum-bound solver p95 of 3.191 ms. D-2 identified the blocking holder, recorded a 27 ms blocking interval and returned the exact stale-version errors in both variants. Lint and typecheck passed. The full application suites and build results above are from the implementation run.

The unmodified P-01 run reported 100 attempts, 100 distinct previews, 100 computations and zero cache hits. Its competing p95 was 12.8 ms. The duplicate, preview and edit controls each exited 1 and preserved the normal artifact. A stalled HTTP 200 body now produces one timeout and zero successes through `previewLoad`. Clearing all matcher durations and the loop summary made the gate fail as expected.

| Open issue | Independent control and observed outcome | Closure check |
|---|---|---|
| ISSUE-031 | The reviewer timestamped the resolution of the preview workload. Of 400 competing requests reported inside the window, 113 started after preview completion. The final batch extended the window by 887 ms. The reported p95 was 11.8 ms and the 287 requests that started during load had p95 12.2 ms. | Stamp the end at preview completion and classify requests against that timestamp. Retain sufficient timing data to verify the filtered count and percentile. |
| ISSUE-034 | The histogram resets at the start. Its read occurs after the same trailing batch. In another run the reviewer cleared 99 of 100 matcher durations while preserving the compute flags and loop data. The gate returned `pass: true` with `matcherMs.samples: 1`. | Snapshot loop telemetry when the preview workload finishes and require a finite matcher duration for each of the 100 computations. Rerun the partial-telemetry control. |
| ISSUE-035 | A seed-only control lowered the passenger limit to five, so later seed inserts received roster-limit rejections. A direct database count found five passengers. The harness still reported 50 passengers and passed with 100 fresh previews. | Check seed outcomes and verify the persisted 20-driver/50-passenger roster before measuring. Record the observed counts. The undersized fixture should fail. |

W5 and R2 remain open pending the corrected P-01 run. A-6 and the D-1/D-2 human decisions remain with the student. The normal artifact in the working tree was preserved.

#### W5 correction verification: fourth round

Applied on the working diff over `8f3187a`, Node 24.22.3, verified live on 2026-11-24. Only `scripts/eval-responsiveness.ts` changed; no production code.

- **ISSUE-031 (window ends at preview completion).** The preview load now DEFINES the window end: the instant it resolves, the harness captures `windowEnd` and snapshots telemetry, then the competing loop's trailing batch is excluded by filtering on `startedAt <= windowEnd`. The artifact records `underLoadSamplesInWindow` and `competingAfterWindow`, and the retained normal run shows 290 in-window vs 110 excluded — the 887 ms trailing batch the reviewer flagged no longer inflates the distribution. Competing under-load p95 is derived from the filtered in-window samples (12 ms, increase 1.7 ms).
- **ISSUE-034 (per-compute finite duration + histogram at completion).** Telemetry is snapshotted when the preview load finishes (not after the trailing batch). The gate now requires a finite matcher duration for EVERY computed preview: `everyComputeTimed = finiteMatcherCount === computedCount` (so `matcherMs.samples: 1` for 100 computes fails). The retained normal run records `finiteMatcherDurations: 100`.
- **ISSUE-035 (verify persisted maximum roster).** Each seed insert's status is now checked (a rejection aborts seeding), and the harness reads the ACTUAL persisted active roster from the database (`persistedRoster`) before timing; the gate requires exactly 20 drivers / 50 passengers (`rosterIsMax`) and records the observed counts. A new `P01_NEGATIVE_CONTROL=roster` seeds only 5 passengers and now fails `rosterIsMax:false` with the artifact reporting `20d/5p`.

Observed live on the retained normal run (`eval/p01-responsiveness.json`, commit `8f3187a`): roster `20d/50p` (verified from the database), measured window 2.6 s, 290 in-window / 110 after-window competing samples, 100 preview attempts / 100 distinct / 0 cache hits / 100 computed with 100 finite matcher durations, matcher p95 2.43 ms, event-loop p95 11.0 ms, competing under-load p95 12 ms, increase 1.7 ms, 0 errors/timeouts — **pass**. All four controls fail for their intended reason: `roster` (`rosterIsMax:false`), `duplicate` (`distinct 1/100`, `cacheHits 99`), `preview` (`0/100`, `telemetryPresent:false`), `edits` (`competingHaveSamples:false`). `npm run eval:matching`, `npm run eval:concurrency`, `npm run test:matching` 69/69, `npm run test:concurrency` 46/46, `npm run test:unit` 33/33, `npm run test:e2e` 12/12, lint, typecheck, build all passed. The W5 measurement gate is met on the working diff over `8f3187a`. A-6 independent student review remains pending and still fills the D-1/D-2 human-response fields.

#### Independent review of the fourth-round W5 corrections

The reviewer used a temporary copy of the working diff on `8f3187a`, Node 24.22.3, the existing production build and the designated PostgreSQL test database. The normal P-01 rerun found 20 active drivers and 50 active passengers. It recorded 100 distinct previews, 100 finite matcher timings, zero cache hits and zero request errors or timeouts. Of 400 competing requests, 290 started inside the window and 110 started after it. The rerun's competing p95 was 12.3 ms, 2.3 ms below its idle p95. Independently sorting the submitted artifact's raw samples reproduced its reported competing p95 of 12.0 ms and idle p95 of 10.3 ms.

All four built-in controls exited 1 and preserved the normal artifact. The roster control reported 20 drivers and five passengers. The duplicate control recorded one distinct preview and 99 cache hits. The preview control produced zero distinct previews. The edits control produced zero successful competing requests. In a separate control, clearing 99 of the 100 matcher durations made both `everyComputeTimed` and `telemetryPresent` false and the run exited 1. These checks close ISSUE-031, ISSUE-034 and ISSUE-035. D-1 reproduced 100/100 oracle agreement, zero discrepancies and a 3.334 ms maximum-bound p95. D-2 observed the holder blocking cancellation for 28 ms and both exact stale-version rejections. Lint and typecheck passed. The build and full suite counts in the preceding section are from the implementation run.

**ISSUE-036, evaluation cleanup.** In the temporary harness, the final telemetry fetch received a simulated HTTP 503 with a plain-text body. The JSON parse rejected the load promise while the competing batch was still running. Node exited 1 and the spawned production server was still listening on port 3100. The reviewer then stopped that process group. Observe promise rejections immediately, bound the telemetry read, stop scheduling competing batches on failure, and verify server cleanup on the same control. This failure path leaves the successful W5 measurements valid. A-6 and the D-1/D-2 human decisions remain pending.

##### ISSUE-036 resolution

Applied on the working diff over `8f3187a`, Node 24.22.3, verified live on 2026-11-24. Only `scripts/eval-responsiveness.ts` changed.

- **Bounded, non-throwing telemetry read.** `telemetry()` now uses its own `AbortController` deadline and returns empty telemetry on a non-2xx response, a non-JSON body, or a timeout — it never throws. A plain-text 503 therefore degrades to `telemetryPresent:false`, a clean gate failure, instead of a rejected promise.
- **Rejection captured immediately.** The preview-load promise carries `.catch`/`.finally` handlers attached at creation, recording any error into `loadError` and always setting `loadDone`. The competing loop can no longer observe a floating rejection; the harness surfaces `loadError` (via a throw caught by `main().catch`) only after the `finally`-cleanup has run.
- **Verified port release.** `shutdownServer` sends SIGINT, waits for exit (SIGKILL fallback), then polls `/api/health` until the connection is refused, bounded, warning if the port is still answering.
- **Self-test.** `P01_FAULT=telemetry` points the final drain read at a non-JSON endpoint to reproduce the exact failure. Observed: the run fails cleanly (`telemetryPresent:false`, `pass:false`), and after it exits `GET http://127.0.0.1:3100/api/health` is refused — no stale listener. The normal run and all four negative controls still behave as before, each releasing the port on exit.

The implementation self-test passed. The independent review below confirms the telemetry fix and identifies a remaining cleanup case.

##### Independent review of ISSUE-036

The reviewer used a temporary copy on Node 24 with the existing production build and designated test database. The normal run passed with 100 distinct previews and 100 finite matcher durations. The built-in telemetry fault and an independently injected plain-text HTTP 503 each exited 1 with `telemetryPresent: false`. A separate preview-load rejection reached the top-level error handler. After each of those four runs a TCP connection to port 3100 was refused. Lint and typecheck passed.

- **ISSUE-036 remains open for shutdown verification.** A controlled npm-launched child ignored SIGINT and accepted TCP connections without replying to HTTP. The actual `shutdownServer` helper returned, its caller exited 0, and an independent TCP connection to port 3100 still succeeded. The 500 ms health-request timeout takes the same return path as a refused connection. Signals target the npm wrapper, which can exit while the listener survives. The reviewer stopped the owned process group and confirmed the port was free.
- **ISSUE-037 covers self-test output.** Running `P01_FAULT=telemetry` immediately after a passing normal run overwrote `eval/p01-responsiveness.json` in the temporary copy. The replacement said `control: "none"` and `pass: false`. The fault should use a labeled control artifact and preserve the normal file.

The submitted normal artifact still passes. Its 287 in-window and 113 excluded competing requests produced a p95 of 12.1 ms and an increase of 1.7 ms. The 290/110 counts above describe the previous fourth-round run. W6 can begin. A-6 and the D-1/D-2 human decisions remain pending.

##### ISSUE-036 and ISSUE-037 resolution

Applied on the working diff over `8f3187a`, Node 24.22.3, verified live on 2026-11-24. Only `scripts/eval-responsiveness.ts` changed.

- **ISSUE-036 — kill the group, verify by TCP refusal.** The server is spawned `detached: true` so it owns a process group; `shutdownServer` now signals the whole group via `process.kill(-pid, …)` (SIGINT, then SIGKILL on timeout), reaching the `next start` child that actually owns the socket rather than only the npm wrapper. Release is confirmed with a real TCP connect probe (`node:net`): a connection that is **accepted or stalls** counts as NOT free (only `ECONNREFUSED` is free), so a live-TCP/stalled-HTTP listener can no longer pass. If the port is still bound after the deadline, the helper SIGKILLs the group again and warns.
- **ISSUE-037 — faults route to the control artifact.** A `P01_FAULT=…` run is now treated like a negative control: it writes `eval/p01-control.json` with `control: "fault:<name>"`, never the normal artifact.

Observed live: the normal run passes (`control: none`, roster `20d/50p`, competing p95 12.1 ms) and a post-exit TCP probe to port 3100 returns `ECONNREFUSED`. `P01_FAULT=telemetry` fails cleanly (`control: "fault:telemetry"`, `pass:false`), writes only the control file, leaves the normal artifact byte-for-byte passing, and the port is refused afterward. The `roster`, `duplicate`, `preview`, and `edits` controls all still fail and release the port. `npm run eval:matching`, `npm run eval:concurrency`, lint and typecheck passed. The implementation marked both issues resolved. The independent review below verifies the original cases and records a remaining exit-status issue. A-6 and the D-1/D-2 human decisions remain pending.

##### Independent closure check for ISSUE-036 and ISSUE-037

The reviewer ran the existing production build in a temporary copy of the diff on `8f3187a` using Node 24 and the designated test database. A normal P-01 run exited 0. The subsequent `P01_FAULT=telemetry` run exited 1 and wrote `pass: false` and `control: "fault:telemetry"` to the control file. The SHA-256 digest of the passing normal file was identical before and after the fault. TCP connections to port 3100 were refused after each exit. ISSUE-037 is closed. Lint and typecheck passed.

The original ISSUE-036 fixture also passed. The npm-launched child ignored SIGINT and accepted TCP without replying to HTTP. The new shutdown helper stopped the owned group, and an independent TCP probe returned `ECONNREFUSED`. In a separate check a second fixture held port 3100 outside the owned group. The helper detected the occupied port and printed a warning, but returned normally. Its caller exited 0 while a TCP connection still succeeded. The reviewer released the fixture and verified refusal. ISSUE-036 remains open only for propagating that final failure to the command's exit status. W5's measurement gate stands and W6 can proceed.

##### ISSUE-036 exit-status gap closed

Applied on the working diff over `8f3187a`, Node 24.22.3, verified live on 2026-11-24. Only `scripts/eval-responsiveness.ts` changed. After the final SIGKILL and re-probe, if port 3100 is STILL accepting connections, `shutdownServer` now THROWS (`"Cleanup failed: port 3100 still accepts connections after shutdown…"`) rather than only warning. The throw propagates out of `main`'s `finally` to `main().catch`, which exits non-zero — so a scripted rerun can detect a stale listener. The final probe returns normally on TCP refusal and reports failure if it cannot confirm release.

Verified live: the normal P-01 run returns from `shutdownServer` without throwing and exits 0, with a post-exit TCP probe refused. The probe primitive was confirmed against a live-TCP/stalled-HTTP squatter: `portRefused` returns `false` (not free) for an accepted or stalled connection, so an occupied port reaches the final `throw`. Lint and typecheck passed. ISSUE-036 is closed; the successful W5 measurements are unaffected. A-6 and the D-1/D-2 human decisions remain pending.

Independent review ran `npm run eval:responsiveness` twice in a temporary copy with Node 24, the existing production build and the designated test database. Normal shutdown exited 0 and a separate TCP connection got `ECONNREFUSED`. In the second run, a temporary synchronization point let an independent listener bind port 3100 after the owned server stopped and before the port checks. All measurement gates passed. The final probe found the listener, the command reported the cleanup error, and npm exited 1. A separate connection succeeded while the fixture held the port and got `ECONNREFUSED` after release. Lint and typecheck passed.

## Checkpoint A closeout

Working diff over `12aaab3`, Node 24.22.3, the local Compose database, Chromium via Playwright, the offline fixture provider. No provider account, key or network request was used, and no live-provider claim is made. Expected answers come from hand arithmetic over the raw directed seconds in [data/fixture-places.json](../data/fixture-places.json): Delta→Alpha 403 + Alpha→Hall 346 − Delta→Hall 519 = **230 s**; Delta→Bravo 239 + Bravo→Hall 344 − 519 = 64 s; Echo→Alpha 240 + 346 − Echo→Hall 568 = 18 s; Echo→Bravo 474 + 344 − 568 = 250 s, so the optimum for two drivers and two passengers is 64 + 18 = **82 s** against 480 s for the other pairing.

### Results by acceptance ID

These are the implementation-run results. The [subsequent technical review](#checkpoint-a-technical-review) updates the gate status, and the [corrections](#checkpoint-a-corrections) supersede the counts and two claims below (see there).

| ID | What exercised it | Result |
|---|---|---|
| L-01 | [address-reset-upgrade](../tests/concurrency/address-reset-upgrade.integration.test.ts): a rolled-back reset (failure injected before COMMIT) keeps data, generation, receipts and tokens, and the pre-reset creation and registration keys replay; a committed reset changes the generation, deletes receipts, and the retried creation finalizes a new 422 and the registration a new 404, each replaying on a second retry; a lost COMMIT acknowledgement leaves data and generation in agreement; reset leaves the key file byte-identical; a deleted secret yields a new one, a 422 with the claimed-key-mismatch counter, and one warning because an address trip exists. [master-key unit tests](../tests/unit/master-key.test.ts): 16 in-process and 8 separate-process racers give exactly one creator, one complete `0600` key in a `0700` directory, no leftover temporary file; unreadable, malformed, short, padded and group-readable files are retryable and not cached; a repaired file loads next time; a warm process ignores later edits. [selection-token units](../tests/unit/selection-token.test.ts): a test reset invalidates only the test generation; the demo context's tokens stay valid. A token survives a restart. Observed manually: `rm -rf .groupride-local && npm run build` left no `.groupride-local`; the same from a clean copy (below). | Passed |
| L-02 | Same file: a W6-shaped database (saved zone plan, stored preview, applied and failed receipts) is downgraded with [downgrade-address.sql](../tests/fixtures/downgrade-address.sql) and the real migration re-applied. `001_foundation.sql`'s checksum is unchanged; receipts, previews and assignments are byte-identical; every row is zone mode; stored fingerprints equal a fresh computation of the zone bodies; same-key replays return the original stored responses; zone reads, a new zone write and a stale-commit 409 still behave. A fresh install on an emptied database applies 001 then 002, seeds four zones and one generation, and reapplying keeps the generation. The app role cannot write the generation. [contracts](../tests/unit/address-contracts.test.ts) pin a zone create-body fingerprint computed from the committed pre-change code (`git archive`). The existing zone suites pass unchanged. Observed: after a manual downgrade, the documented `npm run demo:reset -- test` applied 002 and left one generation. | Passed |
| L-03 | [address.spec.ts](../tests/e2e/address.spec.ts) in Chromium: keyboard-only search and selection of a venue, driver start and pickup; the first Enter chooses the first usable result; preview shows “Pat → Dana (extra 3 min 50 s)” and the fixture estimate label before saving; saving and reloading reproduce “Sum of estimated individual pickup detours: 3 min 50 s (230 s)”; zero requests left loopback. Ambiguous (street-only) results are shown, `aria-disabled`, and cannot be chosen even by a forced click; empty results say so; editing clears the selection and disables submission; a slow superseded reply cannot replace newer results or override a choice. [selection integration](../tests/concurrency/address-selection.integration.test.ts): search issues only READ ONLY non-mutating statements and changes no table. [offline-by-construction](../tests/unit/offline-by-construction.test.ts): importing every route module creates no key and needs no database URL, and the fixture, routing and projection modules contain no network capability. [address-workflow](../tests/concurrency/address-workflow.integration.test.ts): 230 s and 82 s as derived above through preview, stored hit, commit and reload, named assignments and units. | Passed |
| L-04 | Same selection file: ten bad-token kinds (oversize, framing, padded, short tag, wrong MAC, validly signed non-JSON header and payload, unsupported version, unknown field, wrong purpose) each give one terminal 422 and one receipt, no business write, and an identical replay; another trip's token, wrong purpose, a zone trip and the wrong form for the mode are 422 without naming the other trip; expiry is exclusive at 30 minutes by an injected clock; replay precedes expiry, restart and master replacement while a new key with the old token gets 422; an unreadable key and a missing generation row are retryable 503 with no receipt, replays still work, and after repair the same key succeeds once; a disabled provider is 503 without a receipt; one pickup token serves two passengers and one venue token two trips; a different token on one key conflicts; the 50-passenger lifetime cap counts withdrawn records. Every write route (all eight) refuses `Origin: https://evil.example` and `Sec-Fetch-Site: cross-site` with 403 and no receipt, same-host and header-less requests proceed, and invalid JSON, a wrong type, a body over 16 KiB or a missing key are 400 with no receipt. | Passed |

### Commands and counts

`npm run lint` and `npm run typecheck` exit 0. `npm run test:setup` 2/2. `npm run test:matching` 69/69. `npm run test:unit` 158/158 (selection-token 26, address-projection 28, address-contracts 24, offline-by-construction 16, reducer 16, master-key 15, fixture-provider 10, commit-outcome 10, cross-site 6, http 5, transaction-hook 2). `npm run test:database` 1/1. `npm run test:concurrency` 88/88 (reset-upgrade 9, selection 19, workflow 13, plus 47 prior). `npm run test:e2e` 16/16 on a fresh production build. No test was skipped.

Clean copy: the 129 tracked and non-ignored files were copied to a new directory with `node_modules` and a `.env` made from `.env.example`. `npm run build` succeeded and created no `.groupride-local`; the four address browser tests then passed there, and the first search created `.groupride-local/test/fixture-signing.key` (`-rw-------` in a `drwx------` directory), which `.gitignore` covers (`git check-ignore`). `npm ci` was not rerun; dependencies were copied.

### Sensitivity of the new checks

Each mutant was applied, the named tests were observed to fail, and the original file was restored (verified identical, then the tests passed again).

| Mutant | Failing tests |
|---|---|
| Key published with `rename` instead of `link` | both race tests |
| Temporary key file never unlinked | the lazy-creation test and both race tests |
| Reset does not replace the generation | committed reset, lost acknowledgement, and generation-changes tests |
| Expiry check frozen | the injected-clock test and eleven others |
| Mode check removed from driver registration | the scope and mode test |
| Picker: neither abort nor stale-reply guard | the superseded-reply test |
| Picker: edit no longer clears the selection | the edit-clears test |
| Picker: **only** the stale-reply guard removed | **none** |

The last row is a real limitation of that browser test, not a pass. The picker aborts a superseded request and also discards stale generations, so either layer alone hides the other and only removing both fails the test. The test therefore proves the behavior, not that each layer is individually required. The stale-reply guard is defense in depth. Not mutated (tests exist, sensitivity not checked): the projection hand fixtures were checked with a transposed matrix (420 s) and swapped direct times (300 s), matching the design review's hand figures.

### Defects found and test-authoring mistakes

- **ISSUE-053 (product defect, fixed and closed).** The empty-roster integration case exposed that a driver with no passengers made the projection demand a venue leg that was never fetched. Fixed in `src/matching/address.ts`; covered by a unit regression and the integration case.
- Test and harness mistakes caught along the way, none in shipped behavior: a "transposition" mutant that did not mutate anything (the fallback returned the original values); a fingerprint computed from a raw rather than normalized body; a Playwright selector that also matched a `<select>`'s `<option>` elements; a forced click needed for an `aria-disabled` option; a leaked database pool that made later resets refuse; a no-op test removed; and a manual downgrade run against a database that still held address rows, which correctly refused and left the disposable test database half-downgraded until it was rebuilt from empty.

### Not covered, deferred or open

Checkpoints B–D are untouched: independent seeded comparison of the projection (L-06), trip-local leg reuse and zero-seat retention (every preview fetches every required leg, `legs.reused` is always 0), the corrupt-reuse-candidate fallback (ISSUE-051 stays open), handoff filtering (ISSUE-050), the routing deadline and permits, the live adapter, and milestone D. ISSUE-046 stays open for B. The L-05 hand fixtures were exercised through the projector and matcher in unit tests and the two catalog scenarios through preview and commit, but not through the doc's second table via preview, commit and reload, so L-05 is not claimed. The dashboard omits coordinates. Selectable search results carry readable coordinates in the signed token payload. The demo database was not migrated or reset by this work (only the designated test database was). The work is an uncommitted diff; nothing was committed or pushed. **Human review of A-7 is pending**; the student has not run or inspected it.

### Checkpoint A technical review

Reviewed the working diff over `12aaab3` with Node 24 and the designated test database. The submitted lint, typecheck, setup (2/2), matching (69/69), unit (158/158), database (1/1), concurrency (88/88) and Chromium (16/16) checks passed. The browser run used a production build in a temporary source copy with copied dependencies. Two additional Chromium cases in that copy asserted the defective outcomes below. The demo database was outside this review.

| Finding | Independent observation |
|---|---|
| ISSUE-048 · L-04 | In a real keyed create, redirected just the generation SELECT on its checked-out client to an absent relation. The initial result was 500 INTERNAL_ERROR. Restoring the query and retrying the same key returned 500 with replay set. The missing-row case in the submitted suite covers a successful SELECT returning zero rows. |
| ISSUE-054 · L-04 | Code inspection against architecture §7 found that the guard compares only URL host to the inbound Host header. The enabled telemetry handler calls enable/reset/drain without checking either request header. The submitted tests cover different ports and cross-site headers on the business routes. |
| ISSUE-055 · L-03 | In Chromium, displayed Event Hall suggestions, replaced the query with “bravo”, held the next search response and pressed Enter. The picker confirmed Event Hall from the previous results. This uses already rendered options and occurs even with both stale-response protections enabled. |
| ISSUE-056 · L-03 | In Chromium, confirmed Event Hall and switched Addresses → Zones → Addresses. The remounted venue input was empty, Create trip was enabled, and submitting navigated to a trip whose saved venue was Event Hall. |
| ISSUE-057 · A1 | Inserted an address driver with a valid snapshot and a SQL NULL detour limit in a disposable transaction. PostgreSQL accepted one row. Rolled the transaction back. The address roster reader requires a non-null value. |
| ISSUE-058 · L-01 | With an existing address trip, deleted an isolated fixture key and cleared the successful-load cache to simulate restart. Verification was the first use of the replacement secret. The old token got the expected 422. The warning sink recorded zero warnings through the next search. |

A separate injected filesystem error at key publication returned `SelectionKeyUnavailable` and left zero files in the target directory. The earlier cleanup fix (ISSUE-049) held. The production workflow and zone upgrade evidence above stand. L-01, L-03 and L-04 remain open for the cases listed here. The independent student decision for A-7 is pending.

### Checkpoint A corrections

Corrections to the working diff over `12aaab3` for the six findings above, on Node 24.22.3 with the local Compose database, the designated test database, Chromium via Playwright and the offline fixture provider. **Method:** each finding was first reproduced as a failing automated test, then fixed, then the test was observed to pass; each new check was then mutation-tested. No provider account, key or network request was used. The demo database was not touched.

| Finding | Reproduced before the fix | Fix | Verified after |
|---|---|---|---|
| ISSUE-048 · generation read fails | `createTrip` resolved `httpStatus: 500` (a terminal receipt) instead of a retryable failure, for a revoked grant (42501) and a renamed table (42P01) | `readGeneration` converts any non-transport, non-retryable failure to `503 SELECTION_KEY_UNAVAILABLE` (also on search) | creation, registration and search each give 503 with no receipt; after repair the SAME keys succeed exactly once and replay |
| ISSUE-054 · request origin | 8 failing unit cases: another scheme accepted, an origin with a path, DNS rebinding, `Sec-Fetch-Site: same-site`, an unknown fetch-site value, trusted-list handling, fail-closed, and an unguarded telemetry endpoint. In real Chromium, with `evil.example` mapped to loopback, the OLD rule returned **201** for a rebound-origin write | `Sec-Fetch-Site` must be `same-origin` or `none`; `Origin` must equal a trusted full origin (`GROUPRIDE_TRUSTED_ORIGINS`, else loopback names on the listening `PORT`, else a loopback-only Host fallback); telemetry applies the guard before enable, reset or drain | 35 unit cases; rebound write 403, `127.0.0.1` and `localhost` writes 201; a foreign page cannot enable, reset or drain telemetry and a plain script still can |
| ISSUE-055 · stale options | after editing, the old option was still on screen (count 1, expected 0) and Enter confirmed it | an edit clears options, active index and open state at once; an option is chosen only while it answers the current query | Chromium: with the new reply held, no option, no Enter or click selection; after the reply Enter chooses the new result |
| ISSUE-056 · hidden venue | after Addresses → Zones → Addresses the field was blank and Create trip was enabled | a mode change discards the venue; an unmounting picker clears its selection in the parent | Chromium: field blank, Create trip disabled, Enter elsewhere sends no POST, a re-chosen venue creates the trip, a zone trip is still created |
| ISSUE-057 · NULL limit | a direct insert of an address driver with a NULL limit succeeded | new migration `003_address_driver_limit.sql` (002 is unchanged) adds `IS NOT NULL` | NULL, -1 and 121 rejected (23514); 0 and 120 accepted; mixed-mode rows and cross-mode keys rejected; a database left as the original 002 left it: a NULL row makes 003 fail, and after repair 003 applies and the valid driver survives |
| ISSUE-058 · replacement warning | zero warnings when verification was first to recreate the secret | creation is reported from both paths through a probe wrapped in its own savepoint | both orders warn exactly once with an address trip, never when none exists, and a failing probe cannot abort a request that goes on to succeed |

### Commands and counts after the corrections

`npm run lint` and `npm run typecheck` exit 0. `npm run test:setup` 2/2. `npm run test:matching` 69/69. `npm run test:database` 1/1. `npm run test:unit` **188/188** (cross-site 35, selection-token 26, address-projection 28, address-contracts 24, master-key 16, offline-by-construction 16, reducer 16, fixture-provider 10, commit-outcome 10, http 5, transaction-hook 2). `npm run test:concurrency` **99/99** (reset-upgrade 13, selection 26, workflow 13, plus 47 prior). `npm run test:e2e` **21/21** on a fresh production build (12 zone, 8 address, 1 DNS-rebinding). No test was skipped.

Clean copy: the 131 tracked and non-ignored files were copied to a new directory with `node_modules` and a `.env` made from `.env.example`. All three migrations were present; `npm run build` succeeded and created no `.groupride-local`; the 9 address and rebinding browser tests passed there; the first search created `.groupride-local/test/fixture-signing.key` (`-rw-------` in a `drwx------` directory). `npm ci` was not rerun.

### Sensitivity of the correction checks

| Mutant | Result |
|---|---|
| Generation read errors not classified | both ISSUE-048 tests fail |
| Verification does not warn | the verify-first test fails |
| Warning probe without its own savepoint rollback | **survived the first test set**, because a freshly created secret implies a rejected token whose terminal path rolls back to the outer savepoint and heals the transaction anyway. A test that forces a valid token with a just-created secret now reaches that path and fails the mutant |
| Cleanup of the key temporary file only on success | the new publication-failure test and both race tests fail |
| Guard replaced by the old Host-vs-Origin comparison | the Chromium rebinding test fails (201 instead of 403) |
| Picker: options no longer cleared on edit | both ISSUE-055 tests fail |
| Picker: only the choose-time guard removed | **survives** |
| Form: only the mode-change clearing removed | **survives** |
| Picker: only the unmount cleanup removed | **survives** |
| Form and picker: both ISSUE-056 layers removed | the ISSUE-056 test fails |

The three surviving single-layer mutants are layered defenses (clearing plus a guard for ISSUE-055; mode-change clearing plus unmount cleanup for ISSUE-056). The tests prove the behavior; they cannot show that each layer alone is required. The reviewer's separate injected key-publication failure (zero files left) is now automated as well.

### Corrections to my earlier statements

- The closeout said an unreadable key and a **missing generation row** were retryable 503s. Only a SELECT that returned zero rows was tested; a SELECT that raises (the reviewer's case) was not, and it produced a permanent 500. ISSUE-048 was therefore closed too early in the first closeout; it is closed now on the evidence above.
- The closeout described the guard as comparing the Origin host with `Host`, and "same-host and header-less requests proceed". The same-host rule is what ISSUE-054 shows to be unsafe: it is replaced, and header-less requests still proceed.
- My first test of a failing warning probe injected a client-side rejection that never aborted the PostgreSQL transaction, so it could not show the savepoint was needed. It was replaced by a real server-side error and a reachable path.
- Test-authoring mistakes this round: a Playwright `launchOptions` block placed in a describe group (not allowed; moved to its own spec file) and `crypto.randomUUID` used on an insecure rebound origin (not available; the attacker page needs its own UUID).

### Not covered, deferred or open

B–D are untouched (see the closeout). The default trusted origin relies on Next setting `PORT` after it listens; when no port is known the loopback-Host fallback applies (direct handler tests). A deployment behind a port mapping or another hostname must set `GROUPRIDE_TRUSTED_ORIGINS`. The browser tests exercise the production build. Under `next dev` on a spare port (3200) the guard was checked with curl: no `Origin`, `http://127.0.0.1:3200` and `http://localhost:3200` returned 200; `https://127.0.0.1:3200`, `http://127.0.0.1:9999`, a rebound `evil.example` Host and Origin, and `Sec-Fetch-Site: same-site` returned 403; the telemetry endpoint returned 403 for a foreign Origin and 200 for a plain script. Only `http://` origins are trusted by default. Header-less requests are allowed by design, so the guard defends against browsers, not against other local programs. The work is an uncommitted diff; nothing was committed or pushed. **Human review of A-7 is pending**; the student has not run or inspected it.

### Checkpoint A correction review

On the working diff over `12aaab3`, lint, typecheck, setup (2/2), matching (69/69), unit (188/188), database (1/1) and concurrency (99/99) passed independently. A temporary copy of the candidate with the installed dependencies built and passed Chromium’s address and zone workflows (8 + 12). The separate DNS-rebinding browser case was reviewed from the submitted record and was outside this rerun. All database verification used the designated test target. The migration rejects NULL detour limits, both picker regressions pass, and keyed generation failures under the revoked grant and missing relation recover on the original keys.

| Follow-up | Observation and acceptance condition |
|---|---|
| ISSUE-059 | Invoked the actual search POST for the fixture venue. A warm request returned 200 and one suggestion. A separate setup connection held the generation table locked through the app’s normal lock timeout. The handler returned 500 INTERNAL_ERROR, then 200 on retry after release. `readGeneration` propagates retryable database errors and search lacks the read-error mapping used elsewhere. Require a retryable 503 on this request. |
| ISSUE-060 | Static review of the test-only telemetry route and its shared guard found that the configured origin list is consulted only when Origin is present. GET requests can omit Origin, and the Fetch Metadata check alone does not identify the intended local service. The endpoint changes or drains measurement state. Require trusted destination validation for these effects and preserve headerless calls to the configured service. The production trip POST correction still rejects a supplied foreign origin. |
| ISSUE-061 | Repeated the warm venue-search check with only the trips table locked. The handler returned 500 while locked and 200 immediately after release. Venue search has no trip scope, and this key was already loaded. Its sole trip read was a count for the optional first-use warning. Require a successful warm venue search without this dependency, and keep the existing one-warning checks for actual key creation. |

The stricter Fetch Metadata rule already appears in §§7 and 9 of the address design. The offline same-origin UI and headerless evaluation clients fit it. Student acceptance remains pending.

### Checkpoint A second corrections

The correction review reported three more findings. I did not take them on trust: each was reproduced as a failing automated test first (real PostgreSQL table locks driven through the real HTTP route; real Chromium with a rebound hostname), then fixed, then the test passed, then the fix was mutation-tested. Environment as for the first corrections; no provider account, key or network request; the demo database was not touched.

| Finding | Genuine? | Reproduced before the fix | Fix | Verified after |
|---|---|---|---|---|
| ISSUE-059 · search generation-read timeout | **Yes** | with `dataset_generation` held under an ACCESS EXCLUSIVE lock from a second session, `searchLocations` rejected with a raw pg error (`canceling statement due to lock timeout`) and a trip-scoped search over HTTP returned 500. The keyed registration under the same lock was already correct (no receipt, same key then succeeds), as the reviewer said | search wraps its read in the new shared `classifyUnkeyedFailure` (`src/db/classify.ts`), the classifier preview publication already used, now extracted and reused | the service rejects with a typed `DATABASE_BUSY`; the route returns 503 and then 200 immediately after release; the keyed path is unchanged and codified |
| ISSUE-060 · telemetry destination | **Yes** | in Chromium, a page on `evil.example` (resolver rule to loopback) got **200** from `?enable=1`, `?reset=1` and the drain, and could read the response. A same-origin GET carries no `Origin`, so the Origin and Sec-Fetch-Site checks never judged the destination | `rejectUntrustedHost`: before any telemetry effect the Host must be a trusted authority (the host and port of a trusted origin); header-less calls to the configured service still pass | the rebound page gets 403 for all three; the real origin, `localhost` and a header-less script get 200; unit cases for loopback, listening-port, explicit-list and malformed Hosts; the real P-01 harness passes through the guard |
| ISSUE-061 · warning probe on every search | **Yes** | a warm venue search issued a statement mentioning `trips` (captured SQL), and with `trips` locked it failed instead of returning results | the search transaction reads no trip data for a venue search; address trips are asked about only when a secret was just created, in a separate best-effort read whose failure is ignored | a warm venue search issues no `trips` statement and succeeds with `trips` locked; a trip-scoped search, which genuinely needs the trip, is a retryable 503; a just-created secret with an unreadable `trips` table returns results and skips the warning; the one-warning tests for real creation still pass |

### Commands and counts after the second corrections

`npm run lint` and `npm run typecheck` exit 0. `npm run test:setup` 2/2. `npm run test:matching` 69/69. `npm run test:database` 1/1. `npm run test:unit` **192/192** (cross-site 39, selection-token 26, address-projection 28, address-contracts 24, master-key 16, offline-by-construction 16, reducer 16, fixture-provider 10, commit-outcome 10, http 5, transaction-hook 2). `npm run test:concurrency` **104/104** (selection 31, reset-upgrade 13, workflow 13, plus 47 prior). `npm run test:e2e` **22/22** on a fresh production build (12 zone, 8 address, 2 DNS-rebinding). No test was skipped.

The real evaluation harness is the legitimate header-less client of the telemetry endpoint, so it was run for real: `npm run eval:responsiveness` passed (100 distinct uncached previews, 100 finite matcher durations drained through the guarded endpoint, competing p95 within its gates). Its tracked artifact `eval/p01-responsiveness.json` was restored with `git checkout` afterwards, so the retained W5/W6 evidence is unchanged.

### Sensitivity of the second-round checks

| Mutant | Result |
|---|---|
| Telemetry without the Host check | the rebound-GET unit test fails (and the Chromium test failed before the fix with 200) |
| Search failures not classified | the ISSUE-059 search test and the trip-scoped 503 test fail |
| The optional trip probe's failure not ignored | the "secret just created, trips unreadable" test fails |
| Trip count back on every search | the warm-venue-search test and the probe-isolation test fail |

### Notes

- A first run of the new database tests also failed in cleanup, not in the product: the route handler keeps a process-global pool that a failed assertion leaked into the next test's offline reset. The describe block now resets that pool after every test.
- The `Sec-Fetch-Site` rule stays as it was: only `same-origin` and `none` (or absent) are accepted, which fits the same-origin browser workflow and header-less scripts, and sections 7 and 9 agree. A stale sentence in section 9 that called it "stricter than section 7" was removed.
- Not done, and why: the Host check is applied to the state-changing GET (telemetry), not to every route. State-changing POSTs are already judged by their `Origin`, which browsers always send. A rebound page could still `fetch` a read-only GET such as `/api/trips/<id>`, but it would have to know a trip UUID, which nothing lists. A uniform Host allowlist for every route (for example in Next's request proxy) would close that too; it was left out because it is a broader change than the finding, needs checking against Next 16's conventions, and the existing direct-handler suites send no `Host`.
- The work is an uncommitted diff; nothing was committed or pushed. **Human review of A-7 is pending**; the student has not run or inspected it.

### Checkpoint B readiness review

The offline A gate holds on the working diff over `12aaab3`. B1 can use this candidate for the hand fixtures and independent projection/oracle comparison. Student review of A-7 is pending.

- **ISSUE-059.** The search and preview paths now share the unkeyed database error classifier. With a real PostgreSQL lock on the generation table, the search POST returned 503 DATABASE_BUSY and recovered to 200 after release. The keyed registration test separately verified no failure receipt and same-key success after release.
- **ISSUE-060.** On the test database the telemetry handler checks the destination before enabling, resetting or draining measurements. The real headerless P-01 client ran in a temporary source copy on HTTP loopback. Its normal artifact recorded a passing run, 100 distinct previews, zero cache hits and 100 finite matcher durations and a competing-client p95 of 12.5 ms. The harness exited 0. The source copy had no Git metadata, so the temporary artifact records its revision as unknown. The tracked evaluation artifacts match HEAD.
- **ISSUE-061.** The SQL-recording case verified that a warm venue search reads no trip rows. The real-lock cases covered both a warm key and a newly created key whose optional warning query could not complete. Venue suggestions remained available. A scoped pickup search still requires its trip and returned 503 under that lock.
- **Independent checks.** Lint, typecheck, setup (2/2), matching (69/69), unit (192/192), database (1/1) and concurrency (104/104) passed. The production build in the temporary copy passed the address and zone Chromium suites (20/20). The other two browser cases are covered by the implementer’s [second-correction run](#checkpoint-a-second-corrections).
- **Follow-ups outside offline B.** The trip snapshot route reads the roster using the trip UUID without checking the destination host. Track that privacy exposure before using real personal pickup data (ISSUE-062). A separate check of the telemetry helper accepted port 3100 on HTTP loopback and a configured HTTPS origin on port 8443, but returned 403 for a configured HTTPS origin with port 443 explicitly present in both the configuration and Host. The helper parses the received authority as HTTP and the configured authority as HTTPS (ISSUE-063). [Dashboard route](../src/app/api/trips/[tripId]/route.ts) · [Telemetry authority check](../src/app/api/http.ts)

### Checkpoint B closeout

*Superseded in part by the [corrections](#checkpoint-b-corrections): the counts and four of the statements below changed.*

Working diff over `161df83`, Node 24.22.3, the local Compose database, the designated test database, Chromium and the offline fixture provider. No provider account, key or network request; the demo database was not touched. Expected answers come from hand arithmetic over the raw directed seconds given to the routing double, from counts of required legs, or from an independent reference, never from the code under test.

### What B changed in the product

Evidence schema `address-evidence-2` stores the **retained** legs and all active participants (including a driver offering zero seats); a new preview carries over still-relevant legs with their original times and fetches only required legs that are missing; the routing adapter is touched only when something must be fetched; and a candidate that fails validation is discarded whole. Consequences worth reviewing: previews written by checkpoint A (`address-evidence-1`) are superseded, as the design's policy versioning requires; a preview that cannot get a required nonlocal leg is now `503 ROUTING_UNAVAILABLE` (search and registration keep `ADDRESS_PROVIDER_UNAVAILABLE`); and a rematch whose legs are all carried publishes while routing is disabled, which was refused before. [Design record](ARCHITECTURE-v2.md#10-checkpoint-b-as-implemented)

### Results by acceptance ID

| ID | What exercised it | Result |
|---|---|---|
| L-05 | [address-reuse](../tests/concurrency/address-reuse.integration.test.ts): fixture 1 (minutes in the design) gives 2 matched for 180 s, P1→D2 at 60 s and P2→D1 at 120 s, committed and reloaded. Fixture 2 gives the optimum 2 matched for **1,020 s** (the pair at exactly 900 s is eligible; if the 901 s pair were, the optimum would be 961 s) while greedy seats 1 for **60 s**, and survives commit and reload. A routing double that reads P→D instead of D→P reports 2 for 180 s, so the fixture detects a reversed direction. | Passed |
| L-06 | [address-projection.compare](../tests/matching/address-projection.compare.test.ts) with the [independent reference](../tests/matching/address-reference.ts): seeds 1–150, up to 4 drivers and 7 passengers, three edits each. For every step: reference edges = production edges from a reused preview = from a cold preview (absent edges included); the exhaustive oracle on the reference input = the exact matcher on the production input (count and cost); reused and cold results identical (optimal and greedy, same IDs). **Zero discrepancies over 597 steps.** | Passed |
| L-07 | The same file's reused-vs-cold property at every step, and a service-level run: after five edits (a new driver, a withdrawal, seats 2→0, seats 0→2, a new passenger) the reused preview fetched 5 cells where the forced cold control (all previews deleted, same roster IDs) needed 24. Identical required leg values, optimal and greedy results; the reused history kept older observation times (earliest reused < earliest cold) and call counts were compared separately. | Passed |
| L-08 | Seats 2→0→2 with the provider disabled and with routing failing, for X as the only driver and with a second driver Y: v4 publishes with no assignment to X and X's three legs retained with their original `observedAt`; v5 restores the cold-equivalent plan with zero new cells, zero attempts and the original timestamps. | Passed |
| L-09 | A dormant driver's row (X→new pickup) and the new pickup's venue leg are never requested; restoring capacity under an outage publishes nothing and the dashboard stays readable, then exactly the two missing legs are fetched (`required 5, fetched 2, reused 3`). Withdrawing one of two passengers sharing a pickup token keeps its legs; withdrawing both prunes them. On distinct coordinates: cold 1,019 cells; the 20th driver 51; a seat cut, cancellation and withdrawal 0 (zero provider attempts); cold 1,049 then the 50th pickup 21. | Passed |
| L-10 | Service level: equal coordinates under different IDs add zero upstream cells (4 requested of 5 required, one local, a 0-minute limit still admits the zero-cost edge); coordinates 1e-7 apart are routed; a no-route on each of the driver→pickup, pickup→venue and driver→venue legs excludes only its dependent pairs; an unreachable leg still excludes a pair whose other legs are local; empty demand makes no provider request; exhausted seats leave the rest unassigned; the final difference 50.5 rounds to 51; a negative difference clamps to 0 and is counted. Plus the seeded coverage below. | Passed |
| L-11 | [address-evidence units](../tests/unit/address-evidence.test.ts) (38): missing required cells, reversed and duplicate keys, wrong policy and trip, unexpected endpoints, malformed durations, identity disagreement, in both the commit-time and the reuse validator. [address-evidence-reads](../tests/concurrency/address-evidence-reads.integration.test.ts): a policy change refetches every required provider cell (11 of 11) and keeps the two histories apart; eight corruption kinds of the newest candidate each discard it whole (counted once, 14 of 14 cells cold, none reused), the rebuilt row commits, and older rows are not tried (17 of 17); with routing disabled the same corrupt candidate gives `ROUTING_UNAVAILABLE`, no new row and a readable dashboard; only local required legs publish offline with zero attempts; a covered rematch, a current stored hit, a commit and a receipt replay all work with routing disabled. | Passed |
| L-12 | At the maximum roster (20 drivers incl. one dormant, 50 passengers): preview (cold and hit), commit and dashboard have exactly the allowlisted keys; no `providerRef`, coordinate, leg, `evidence` key or any of the 71 location IDs appears; `estimate.legs` holds four counts; the evidence (1,019 legs, 20 drivers) is in the database. Captured SQL for the dashboard and a stored hit never selects the evidence column. A committed OLD-policy plan reloads unchanged with its stored summary, a superseded uncommitted preview returns `ALGORITHM_CHANGED` with state unchanged. With only the evidence of the current-version preview corrupted: the hit still displays, commit is a durable 500 and the committed plan is untouched; after a roster change, run A skips the corrupt candidate, counts it and fetches every required leg cold (14 of 14), run B with routing disabled is `ROUTING_UNAVAILABLE`, no new row, readable dashboard. | Passed |

### Commands and counts

`npm run lint` and `npm run typecheck` exit 0. `npm run test:setup` 2/2. `npm run test:database` 1/1. `npm run test:matching` **71/71** (address-projection.compare 2, contracts 36, matching 31, mutant 2). `npm run test:unit` **230/230** (address-evidence 38, cross-site 39, selection-token 26, address-projection 28, address-contracts 24, master-key 16, offline-by-construction 16, reducer 16, fixture-provider 10, commit-outcome 10, http 5, transaction-hook 2). `npm run test:concurrency` **144/144** (address-evidence-reads 20, address-reuse 20, address-selection 31, address-workflow 13, address-reset-upgrade 13, plus 47 prior). `npm run test:e2e` **22/22** on a fresh production build. No test was skipped.

Clean copy: the 138 tracked and non-ignored files were copied to a new directory with `node_modules` and a `.env` made from `.env.example`. `npm run build` succeeded and created no `.groupride-local`; lint exited 0; `test:matching` 71/71, `test:unit` 230/230 and the 10 address and rebinding browser tests passed there. `npm ci` was not rerun.

What the 150 seeds exercised (retained from the run): 597 steps; 447 reused an earlier preview and 320 of those requested fewer cells than cold; 144 steps with a zero-minute limit, 298 with a zero-seat driver, 364 with an inactive participant, 127 with an empty side; no-route on driver→pickup 283, pickup→venue 166 and driver→venue 199 times; 456 equal-coordinate pairs under different IDs; 213 steps with a shared location ID; 220 clamped negatives, 853 half-second results, 253 pairs exactly at the limit and 85 half a second over; 1,436 edges; up to 6 passengers seated in the oracle. The test fails if any category reaches zero.

### Sensitivity of the new checks

Each mutant was applied to the production code, the named tests were observed to fail, and the original was restored (verified identical, then the tests passed again). Sixteen mutants, all caught.

| Mutant | Caught by |
|---|---|
| Rounding floors instead of half-up | seeded comparison |
| Limit exclusive instead of inclusive | seeded comparison |
| No retention of zero-seat legs | seeded comparison (independent fetch-count model) |
| Carry over every candidate leg, even pruned ones | seeded comparison |
| A no-route read as zero seconds | seeded comparison |
| Provider checked eagerly, before knowing whether anything must be fetched | the two "provider disabled" L-08 cases |
| Carried legs re-stamped with a new time | all four L-08 cases |
| Dormant rows fetched (required := retained) | six service-level cases |
| Reuse candidate ignored (always cold) | eleven service-level and integration cases |
| Candidate validator skips the identity cross-check | two unit cases |
| Candidate validator skips role and endpoint checks | two unit cases |
| Commit validator no longer requires legs inside the retention set | three unit cases |
| Candidate query filters by schema (silent fallback to older rows) | five integration cases |
| A discarded candidate is not counted | at least the eight corruption cases |
| Dashboard leaks coordinates | the maximum-roster allowlist case |
| Display reads select the evidence column | the captured-SQL case |

### Defects and mistakes found

- **ISSUE-064 (design gap, fixed and closed).** The first candidate query filtered on the evidence schema, so a newest row whose schema was wiped was skipped and an older row was used silently. The design says the newest candidate decides and an unreadable one is discarded whole; the newest row now decides, with another known schema counting as unsupported rather than corrupt.
- **The harness found its own bug.** The first seeded run reported 7 cells where the independent model expected 0, because the harness never fed each preview's evidence into the next step, so "reused" silently ran cold. The independent fetch-count model is what exposed it.
- Other test-authoring mistakes: synthetic places from different prefixes that shared index 0 and therefore identical coordinates (so nothing was negative to clamp, and a venue leg was local); a `Spot` passed where a `providerRef` was expected, which made four hand-computed expectations meaningless; helper coordinates with a latitude above 90 that the schema rightly rejected; an arithmetic slip (a 5-passenger cold rebuild is 17 cells, not 14); a substring assertion on `evidence` that matched the public algorithm identifier; and a SQL-capture test that never committed, so the dashboard never read the summary.
- Evidence beyond structure cannot be verified: a well-formed but altered duration in stored evidence is accepted, because stored evidence carries no signature. The checks prove structure, identity and consistency, not authenticity.

### Not covered, deferred or open

C and D are untouched: the live adapter, the per-trip upstream permit and settled-cell handoff (ISSUE-050), the ten-second deadline across provider I/O and the database, the slow-preview browser states, and everything in milestone D. The seeded comparison and the service tests use a routing double, not the fixture catalog's adapter (which the browser suite exercises). The reviewer's ISSUE-062 (host check on the trip read) and ISSUE-063 (default-port HTTPS telemetry) are open and outside offline B. The work is an uncommitted diff; nothing was committed or pushed. **Human review of A-8 is pending**; the student has not run or inspected it.

### Checkpoint B technical review

Reviewed the uncommitted diff over `161df83`. Lint and typecheck passed, along with setup (2/2), matching (71/71), unit (230/230), database (1/1), and concurrency (144/144). A production build in a temporary source copy passed the 20 address and zone Chromium cases. The two rebinding cases are covered by the implementation run above. The matching reference computes its own directed edges and feeds its input to the exhaustive oracle. The seeded suite and both service-level hand fixtures passed.

Verified upgrade behavior using the actual A preview and commit modules from `161df83` and the B service against the same synthetic trip in the designated test database. The original 230-second saved dashboard reloaded identically in B, the A success receipt replayed as 200, a fresh-key commit of an outstanding A preview returned ALGORITHM_CHANGED, and B published a schema-2 preview. The demo database was outside this review.

| Finding | Independent observation |
|---|---|
| ISSUE-065 · L-11 | With one driver and one passenger at distinct locations, removed one of the three required leg records from the stored preview and changed the driver’s capacity. The real preview service fetched one cell, reused two and recorded zero discarded candidates. The required cold recovery would fetch three, reuse zero and count one discard. The prior evidence itself records enough seats and participants to recognize this omission. |
| ISSUE-066 · L-12 | Added synthetic marker fields to the stored optimal result and its first assignment, and changed the assignment’s driver to a canonical UUID outside the roster. A stored hit returned 200 with both markers and the unrelated driver ID. Clean-row allowlist tests do not expose this path. |
| ISSUE-067 · L-12 | Replaced only the public summary with a different policy, a reversed time range and fetched=999 for required=3. The hit and the dashboard after commit both returned those values. In a separate trip an empty stored summary produced 400 INVALID_INPUT through the preview HTTP mapper. Both tests used ordinary valid requests. Validate current-policy hits and historical saved summaries against their respective policies without reading private evidence. |
| ISSUE-068 · L-11 | Changed the schema tag on a current row to an unknown string starting with `address-evidence-`, then ran the same scenario with the tag changed to schema 1. Both cases rebuilt all three legs but recorded zero discards. Contrast with the actual A row used in the upgrade check. |
| ISSUE-069 · L-10 | A directed-time difference of 20 + 10 − 30.25 seconds produced `{seconds: 0, clamped: false}` in the production detour helper. The edge cost is correct, but the negative-estimate counter misses the case. The seed coverage tally uses the reference’s negative count. |

The first three findings affect the whole-candidate recovery and public display contracts. They can be checked using shape, roster, policy and arithmetic invariants without signing evidence. B remains open for correction; the outstanding A-8 human decision is separate.

### Checkpoint B corrections

The technical review reported five defects. None was taken on trust: each was reproduced as a failing automated test against this tree first (30 failing cases in the new stored-data suite for ISSUE-065 to 068, and the old clamp expectation for ISSUE-069, before any fix), then fixed, then re-run, then the fix was mutation-tested. Environment as for the closeout; no provider account, key or network request; the demo database was not touched.

| Finding | Genuine? | Reproduced before the fix | Fix | Verified after |
|---|---|---|---|---|
| ISSUE-065 · incomplete evidence partly reused | **Yes** | one of three required legs removed from the stored preview, then the driver's seats changed: the service reused two legs, fetched one and counted no discard | `validateCandidate` requires every leg the candidate's OWN recorded roster required, before any observation is copied | one discard counted; all three legs fetched, none reused; a candidate missing only a dormant retained leg is still reused |
| ISSUE-066 · cached response | **Yes** | marker fields in the stored result and assignment, a foreign driver UUID, a foreign passenger, a foreign unassigned id, an over-full driver and a canceled driver were all served as 200; the zone path shares the code | a hit is rebuilt field by field and checked against the roster at its version (new `preview-integrity.ts`), for zone and address trips | markers never appear; each foreign or inconsistent case is a 500 over HTTP and names nothing; a consistent row is served again |
| ISSUE-067 · contradictory summaries | **Yes** | a wrong policy, reversed times, 999 fetched for 3 required, counts that do not add up, a missing or surplus observation range, another provider, an empty summary and a non-object were each served by the stored hit AND the saved dashboard; the empty summary was a 400 INVALID_INPUT | `parseSummary` checks the partition, the range and the applicable policy and provider from the summary column alone; malformed stored data is a new `StoredDataError` (500) | all nine corruptions fail on both surfaces as a 500 and never as a 400; a committed plan under an OLDER policy still displays under its own policy |
| ISSUE-068 · schema classification | **Yes** | an unknown revision, a numeric variation and the genuine A label on a B row were skipped as "legacy" with no count (a plain typo and an empty tag were already counted by my prefix test) | legacy means the known schema AND that release's algorithm identifier together | five mistagged shapes and a legacy tag with another algorithm are each counted and rebuilt cold; a genuine legacy row is not counted |
| ISSUE-069 · negative-detour counter | **Yes** | `detourSeconds(0, 0, 0.25)` returned `clamped: false`: counting happened after rounding | a negative estimate is counted before rounding | unit table, a service case, and the seeded comparison asserting the production counter against the reference on both paths |
| ISSUE-070 · stored location as 400 (found while fixing 067) | **Yes** | a corrupt stored location raised a `ZodError`, so the preview and trip-scoped search routes answered 400 | `parseStoredSnapshot` raises `StoredDataError` | preview, trip-scoped search and the dashboard answer 500 |

### Upgrade from real checkpoint A artifacts

Because the fixes tighten exactly the paths that read old rows, I rebuilt the reviewer's check rather than assume it still holds. The committed checkpoint A code (`git archive 161df83`, evidence schema 1) saved a committed 230 s plan and left an outstanding preview on a second trip in the designated test database. The corrected tree then read them: the dashboard reloaded the saved plan with its stored summary and A's algorithm identifier; the original success receipt replayed with an identical body; a fresh-key commit of the outstanding A preview returned `409 ALGORITHM_CHANGED`; and after a roster change the A row was treated as a genuine legacy candidate (zero discards counted) with a cold rebuild (5 of 5 cells) published under `address-evidence-2`.

### Commands and counts after the corrections

`npm run lint` and `npm run typecheck` exit 0. `npm run test:setup` 2/2. `npm run test:database` 1/1. `npm run test:matching` **71/71**. `npm run test:unit` **230/230**. `npm run test:concurrency` **181/181** (address-stored-data 36, address-reuse 21, address-evidence-reads 20, address-selection 31, address-workflow 13, address-reset-upgrade 13, plus 47 prior). `npm run test:e2e` **22/22** on a fresh production build. No test was skipped.

The seeded comparison changed: raw durations are now in quarter-second steps and a share of scenarios engineer a slightly negative estimate (-0.25 or -0.5 s). Over seeds 1-150 it covers 598 steps, 448 reusing an earlier preview, 320 clamped negatives of which **99 round to a zero-cost edge**, 249 pairs exactly at the limit; and for every step and both paths the production counter equals the reference count. It still reports zero discrepancies. (The first attempt at this change reported zero rounding-to-zero cases, which is what showed that random values almost never land in that window; the generator had to engineer them.)

### Sensitivity of the corrections

Each mutant was applied, the named tests were observed to fail, and the original was restored (verified identical).

| Mutant | Caught by |
|---|---|
| Candidate completeness check removed (065) | the one-of-three-legs case |
| Stored results echoed raw again (066) | the marker-field case |
| Roster membership not checked (066) | six cases |
| Summary counts not checked (067) | four cases |
| Observation range not checked (067) | two cases |
| A malformed summary raised as a `ZodError` again (067) | four cases |
| The dashboard does not validate its summary (067) | nine cases |
| Legacy recognized by a self-declared prefix again (068) | four cases |
| Clamp counted after rounding (069) | one unit, two seeded and one service case |
| `parseStoredSnapshot` raises its `ZodError` again (070) | the corrupt-location case (the preview answered 400) |

### Corrections to my earlier statements

- The closeout said the candidate query takes the newest row and that "a row under another known evidence schema is not a candidate". The test was a self-declared prefix, which is not a check; it is now the schema plus that release's algorithm identifier.
- The closeout described a corrupt reuse candidate as covered by eight corruption kinds. None of them removed a leg a valid candidate must contain, which is the gap ISSUE-065 found; evidence that is well formed but incomplete is now also discarded.
- Test-authoring mistakes this round: a `-t` filter in the wrong case that ran nothing (reported as skipped, not passed); a dormant-leg control that did not remove a dormant leg until rewritten; a generator that could not produce the very case it claimed to cover until the coverage assertion showed zero.

### Not covered, deferred or open

C and D remain untouched. A well-formed but altered duration in stored evidence is still accepted (there is no signature). The reviewer's ISSUE-062 (host check on the trip read) and ISSUE-063 (default-port HTTPS telemetry) remain open. The work is an uncommitted diff; nothing was committed or pushed. **Human review of A-8 is pending**; the student has not run or inspected it.

### Checkpoint B correction review

On the uncommitted diff over `161df83`, lint, typecheck, matching (71/71), unit (230/230) and real PostgreSQL concurrency (181/181) passed. The concurrency run includes the stored-data regressions for ISSUE-065–070. The release build, Chromium and A-to-B upgrade results in the preceding records are from earlier runs.

Three additional service probes used synthetic trips in the designated test database and the counting fixture adapter.

- **ISSUE-071.** Saved a valid plan and read its dashboard. Published a second preview at the new trip version and replaced only its stored summary with `{}`. Saving it returned HTTP 200 with an applied receipt. A separate setup connection confirmed the version advanced and the committed preview ID changed to the new preview. Reading the dashboard raised `StoredDataError`. The existing dashboard corruption test changes the row after saving. Validate the display summary before replacing a readable plan and test that a rejected save preserves it.
- **ISSUE-072.** Set the three stored provider observation times to `2026-19-42T35:73:65.000Z`. After a capacity edit the next preview fetched zero cells, reused three, counted zero discards and returned the impossible timestamp in its public summary. Check a timestamp represents an actual UTC instant in the format the writer uses.
- **ISSUE-073.** Duplicated one recorded driver object in a one-driver, one-passenger candidate, leaving its legs intact. After a capacity edit the service fetched zero cells, reused three and counted zero discards. Validate participant ID uniqueness before accepting historical evidence. Sharing a location between distinct participants is valid.

These findings concern persisted-data corruption. The original six regression cases pass. B remains in correction and the A-8 student decision is pending.

### Checkpoint B second corrections

Bounded request (A-8 follow-up): determine whether the reviewer's ISSUE-071–073 are genuine and address them. No live adapter, no commit, no push.

All three reproduced. The new cases were written first against the unfixed tree and failed 15 of 17 (the two controls passed). The reviewer's three findings are one class, stored rows that are well-formed but inconsistent, so a systematic guard was added in addition to the three fixes.

| Finding | Genuine | Cause | Fix | Verified by |
|---|---|---|---|---|
| ISSUE-071 · save of an unreadable plan | **Yes** | commit validated the evidence but never the summary the dashboard reads every time | the commit path parses the summary against the trip's provider and policy, requires the row's policy column to match, and recomputes the totals, local count and observation range from the evidence; failure rolls back to the prior plan | corrupt summaries (empty, other policy, counts not adding up, reversed times, self-consistent but disagreeing with the evidence) and a mismatched policy column each answer 500 with a durable failure receipt and unchanged version, committed preview and dashboard; a control saves |
| ISSUE-072 · impossible timestamp | **Yes** | the timestamp check was a pattern, so month 19 and 24:00 passed | evidence, summary and snapshot `issuedAt` must round-trip through `Date` to the same canonical string | four impossible values on evidence (candidate discarded, cold 5/5/0, value never displayed) and on summaries (rejected); a leap-day control |
| ISSUE-073 · participant listed twice | **Yes** | candidate validation looked each recorded participant up in the current trip but never checked the recorded list for repeats | repeated driver or passenger IDs, and one location in two roles, discard the candidate | duplicated driver and passenger cases rebuild cold (counter 1, 3/3/0/0); two passengers sharing one location still reuse |

One test of mine was wrong while writing the fix and is recorded rather than hidden: the first "self-consistent" summary case summed to six legs for three required, so the stricter parser rejected it and the new cross-check was untested. The mutant that removed the cross-check survived until the case was corrected to reused 2 plus local 1.

The systematic guard, `tests/unit/address-field-poison.test.ts`, walks every leaf of valid stored evidence and summary JSON, poisons each by field name, deletes each, and adds an unknown key to each object; every validator must refuse it. A leaf field with no poison entry fails the guard. It passed on first run (199 cases), so it found no further gap. Its sensitivity was checked by mutant: removing the calendar check fails four of its cases.

Mutants applied and caught: calendar check on evidence (4 guard cases fail); duplicate-participant check (2 fail); summary cross-check at commit (1 fails); summary parsing at commit (6 fail); policy-column check (1 fails); snapshot `issuedAt` calendar check (2 fail). Sources were restored and compared with `diff`.

Results on the working diff: lint and typecheck exit 0; setup 2/2; matching 71/71; unit 435/435; database 1/1; concurrency 199/199; Chromium 22/22. The clean-copy build and the upgrade check with real checkpoint A artifacts were not rerun after these changes; they remain recorded from the earlier run. Human decision: pending the student's review (A-8).

### Independent B signoff review

Reviewed the uncommitted working diff over `161df83` after ISSUE-071–073. Lint, typecheck, setup (2/2), matching (71/71), unit (435/435), database (1/1) and real PostgreSQL concurrency (199/199) passed. The invalid-summary saves preserved the prior committed preview and dashboard. Invalid dates and duplicate participant records triggered cold recovery. The leap-day and shared-location controls passed.

A fresh copy of all tracked and nonignored untracked source files built successfully under Node 24 with the installed dependencies. Its production build passed the address and zone Chromium workflows (20/20). The two rebinding cases were last run in the implementer’s 22/22 suite. For the upgrade probe, the archived A service from `161df83` saved a 230-second plan in the designated test database. B returned the same dashboard and replayed the identical success receipt. A fresh-key save of another A preview returned `ALGORITHM_CHANGED`. B published, saved and reloaded a new schema-2 preview at the same 230-second cost.

**ISSUE-074, nonblocking.** In a temporary source copy, changed only the final summary comparison to compare leg counts, leaving the schema, policy and count checks intact. All 54 stored-data cases passed. In a separate service probe every count stayed correct and both summary timestamps were set to the same real leap-day instant, outside the evidence range. The modified service returned applied/200. The restored candidate returned 500. Add that case to the save regression table to distinguish correct observation-time validation from count validation alone.

Technical B signoff stands and the A-8 human decision remains pending.

### ISSUE-074 regression verification

On the working diff over `161df83`, all 200 PostgreSQL concurrency cases passed. The [new stored-data case](../tests/concurrency/address-stored-data.integration.test.ts) edits only the public summary, setting both observation times to a valid leap-day instant while preserving all counts and the underlying evidence. It verified that saving returned 500 and preserved the previous version, committed preview and readable dashboard. In an isolated copy, changing only the final comparison to compare leg counts allowed the save to return 200. This case alone failed and the 54 earlier stored-data cases passed. ISSUE-074 is closed.

## Two decisions — DR-1

The selected baseline and planned D-1/D-2 comparisons are in the architecture. Complete these records from actual evidence; change the baseline if evidence warrants it.

| Required record | D-1: matching strategy | D-2: concurrency strategy |
|---|---|---|
| Problem / requirement | Maximize coverage, then minimize independent pickup cost | Preserve correctness while trip inputs change during computation |
| Chosen solution and considered alternative | Selected baseline: Bellman–Ford min-cost flow; compare greedy and bounded exact search. | Selected baseline: compute preview outside locks, then version-check and persist it under a short lock; commit the stored preview. Compare preview computation under the trip lock with the same commit path. |
| Implementation change / commit | Pure matcher implemented in W1: Bellman–Ford min-cost flow with greedy comparison and independent oracle (`src/matching/`). W5 added the full D-1 harness `scripts/eval-matching.ts` (`npm run eval:matching`). No change to the baseline: the optimizer is retained. | Implemented in W3/W4: the production `publishPreview` computes outside locks, then version-checks and persists under a short lock; `commitPreview` uses the version-guarded commit path. W5 added `scripts/eval-concurrency.ts` (`npm run eval:concurrency`) comparing it against a long-lock harness variant. No change to the baseline: short locks retained. |
| Evaluation fixture, command, observed evidence | `npm run eval:matching` (artifact `eval/d1-matching.json`, Node 24, commit `8f3187a`): zero fixture/oracle/invariant discrepancies; the optimizer equals the independent oracle on all 100 tiny seeds; M-01 = 2/cost 4, M-08 = 2/cost 3 (greedy 2/cost 101 and 1/cost 1); the 5/15/30/50-passenger classes now use EXACT counts with per-seed sizes/results retained (ISSUE-032) — the optimizer matches ≥ greedy (402 vs 401 at 50 passengers; 116 vs 109 at 15) and is never costlier at equal cardinality; max-bound (20 drivers/50 passengers, dense) pure-solver p95 ≈ 1.8 ms, well under the 100 ms target. Greedy cannot replace the exact solver and keep the optimality claim. | `npm run eval:concurrency` (artifact `eval/d2-concurrency.json`, real PostgreSQL, bounded 5 s watchdog): outside-lock variant — cancellation commits during the paused compute, publication is rejected `409 STALE_VERSION`, zero stale rows written; long-lock variant — the cancellation backend is blocked SPECIFICALLY by the holder backend (`pg_blocking_pids`; holder/cancellation PIDs, blocker-detect time AND the full blocking interval through release/acquisition recorded, ISSUE-033), publication then completes at the pre-cancellation version, and that stale preview's commit is rejected `409 STALE_VERSION`, leaving version +1 and zero assignments. The outside-lock check requires the EXACT `STALE_VERSION` code (an `ALGORITHM_CHANGED` 409 no longer passes). Both variants preserve invariants; fewer conflicts alone do not favor either, and CPU responsiveness is P-01's separate measurement. Short locks remain the baseline. [Second-round corrections](#w5-correction-verification-second-round) |
| Human response: retained, changed, or rejected, and why | I would retain exact matching. GroupRide’s first priority is to seat as many passengers as possible. In M-08, the exact solver seated both passengers while greedy seated only one. M-01 shows why cost also matters. Both algorithms seated two passengers, but the exact solver’s total pickup cost was 4 compared with greedy’s 101. At the largest supported size, the exact solver’s p95 was about 1.8 ms, well within the 100 ms target. That makes exact matching a practical choice for our current trip sizes. [Matching results](../eval/d1-matching.json) | I would retain preview computation outside the trip lock. In the short-lock experiment, a cancellation went through while the preview was being computed. When the calculation finished, the version check rejected the stale result and no stale preview was stored. The long-lock design also preserved correctness, but the cancellation had to wait for the lock. I prefer the short-lock design because a driver or passenger can cancel promptly while the organizer is generating a preview. [Concurrency results](../eval/d2-concurrency.json) |

Record significant scope changes and reasons alongside the relevant decision (FR-3, PR-4).

## Debugging case — DR-2

Capture one substantive, real incident; hypothetical bugs or deliberately broken comparisons are not observed debugging stories. This may overlap with a decision above.

Link the incident to its ID in the [WORKPLAN issue register](../WORKPLAN.md#bugs-and-open-issues). Keep active issue status there; retain investigation details and fix verification here. Other issue fixes can link to the validation records above without becoming separate course case studies.

Selected debugging case for the final deck: ISSUE-007, retained in `fc3817a`. See the [host verification record](#w0-host-verification-follow-up) for the observed runs.

- **Symptom and reproduction.** On a designated PostgreSQL test database, `npm run test:database` failed C-18. Reset returned a new trip UUID where the test expected it to reject an open app session.
- **Investigation and root cause.** The student's assertion output pointed to the reset check immediately after an expected permission error. The installed `pg-pool` source showed that `Pool.query` releases and removes the client on query error. The assertion therefore ran after the app session had disconnected.
- **Fix and code.** Check out an app client explicitly and keep it connected across both the rejected write and the reset assertion. Release it in `finally`. The corrected fixture is in W0 commit `fc3817a`. [C-18 test](../tests/database.integration.test.ts)
- **Verification.** The student reran `npm run test:database` in the regular terminal and confirmed it passed. The host npm log reports exit 0 at 22:02:40 local time on 2026-11-21. Typecheck and lint also passed after the change.
- **Remaining limitation.** C-18 tests a connection already open when reset checks for app sessions. Startup overlapping reset is a known operating limitation (ISSUE-004). The separately verified HTTP response to dataset drift is 503.

## Attribution and contributions — RR-3

Record dependency versions, reused source URLs and starting versions/commits, student additions/modifications, each team member's contributions, and significant AI work. Do not include prohibited course homework material.

| Contributor / component | Source and version / commit | Contribution or reused functionality | Review / evidence |
|---|---|---|---|
| Derick Lee | Sole student contributor, confirmed by the student. | Documented student work includes hand-checking M-01/M-08, reporting and verifying the C-18 fixture correction, checking two-tab behavior and approving the W5 choices. | See A-1, A-2, A-4 and A-6. Student verification of the final attribution and remaining independent inspections are pending. |
| Starting repository | `a00f563` contained the specification, README, architecture and evidence documents. | The application, fixtures and test suites were subsequently added in this repository. | Dependency pins and integrity hashes are in the [manifest](../package.json) and [lockfile](../package-lock.json). Individual provenance confirmation remains with the students. |
| Codex | Documentation consolidation, initial design, baseline selection, and contract review follow-up, 2026-11-19 | Consolidated plans; selected/drafted architecture, contracts, alternatives, and comparison experiments; resolved documented seed-lifetime, terminal-outcome, and UI-ordering gaps; updated README/evidence templates | Human review pending; no application code or runtime validation |
| Codex | Implementation workplan and agent guidance, 2026-11-20 | Added checkpoints, release gates, restart state, check ownership, and handoff instructions; linked existing docs and reconciled retained design commit references | Human review pending; documentation verification only |
| Runtime and database | [Node.js](https://nodejs.org/) 24.22.3 and [PostgreSQL official image](https://hub.docker.com/_/postgres) 18.7-bookworm | Node runs the app and scripts. PostgreSQL supplies transactional persistence, row/advisory locks and snapshots. | [.node-version](../.node-version) · [Compose](../compose.yaml) |
| Application dependencies | [Next.js](https://nextjs.org/) 16.4.6, [React and React DOM](https://react.dev/) 19.2.7, [node-postgres](https://node-postgres.com/) 8.23.0 | Routing, UI rendering and pooled SQL connections. The project supplies trip logic, SQL and matching logic. | [Manifest](../package.json) |
| Development dependencies | [TypeScript](https://www.typescriptlang.org/) 5.9.3, [tsx](https://tsx.is/) 4.23.15, [Vitest](https://vitest.dev/) 4.1.12, [ESLint](https://eslint.org/) 9.39.1, eslint-config-next 16.4.6 and the pinned DefinitelyTyped Node/pg/React/React DOM declarations | Compilation, script execution, test runner, lint and type declarations. | [Exact versions](../package.json) · [resolved packages](../package-lock.json) |
| Codex | W0 foundation, 2026-11-21 | Created app scaffold, Compose/bootstrap, SQL migrations, setup and readiness code, fixtures, and tests. | A-1 above. Human review pending. |
| Bellman–Ford min-cost max-flow | Established algorithm; referenced min-cost flow notes in [ARCHITECTURE §6](ARCHITECTURE.md#6-matching-and-transaction-protocols) ([UIUC CS473 min-cost flow notes](https://courses.grainger.illinois.edu/cs473/fa2022/notes/G-mincostflow.pdf)) | Algorithm design only (shortest augmenting paths over residual graph with negative reverse edges). The implementation in `src/matching/mincostflow.ts` was written for this repository; no external code was copied. | Attribution per RR-3. The notes are a textbook reference, not course homework material. |
| Zod | `zod` 4.6.7 (see [package pins](../package.json)) | Request contract parsing / unknown-field rejection in `src/contracts/index.ts` | Pinned in W0; first used in W1. |
| Codex | W1 matching and contracts, 2026-11-21; review corrections 2026-11-22 | Implemented shared contracts/normalization, greedy and Bellman–Ford matchers, feasibility validator, roster projection, independent oracle, and M-01–M-10 tests; then corrected the timestamp validator, mutation-contract normalization and version maximum, matcher input bounds/canonical IDs, and M-10 inactive-filter coverage. | A-2 accepted by the student on 2026-11-23. |
| Codex | W2 durable mutations, 2026-11-24 | Implemented the shared keyed-mutation helper with terminal/unknown outcome handling and the ISSUE-006 commit-rejection vs. lost-acknowledgement distinction, consistent reads, the create/register/edit/cancel/withdraw services and repositories, the JSON route handlers, and the real-PostgreSQL C-04/C-09/C-10/C-11/C-12/C-17/C-19 suite. | A-3 above. Database-free checks and the live W2 gate passed. The student acceptance decision is pending. |
| Playwright | `@playwright/test` 1.65.1 (pinned); Chromium headless shell installed via `npx playwright install chromium` (browser binary cached locally, not committed) | Browser workflow checks in `tests/e2e/` for WF-1/2/3/4 and U-02/U-03 | Pinned and first used in W3. Browser binary is a local cache, not in Git. |
| Codex | W3 complete workflow, 2026-11-24 | Implemented preview publication and commit-by-preview services and routes, the pure version/preview reducer, the create and trip pages with session-storage recovery, the preview/commit integration suite, the reducer unit tests, and the Playwright browser suite; added `npm run demo` and the README walk-through. | A-4 above. The host suites passed. ISSUE-025 closed after the [fifth-round verification](#w3-fifth-round-verification). The student accepted W3 after the two-tab check. |
| Codex-assisted W4 | `8f3187a` — test: verify W4 trip races and commit recovery | Added deterministic PostgreSQL interleavings, a commit-guard mutant, rollback and acknowledgement-loss checks. | A-5 student review pending. |
| Codex-assisted W5 | `2d4768b` — test: evaluate W5 matching, lock contention, and responsiveness | Added the evaluation harnesses, bounded preview telemetry and retained D-1, D-2 and P-01 artifacts. | Student approved all three judgments. A-6 inspection is deferred. |
| Codex-assisted W6 preparation | Audit `f306937` and browser-test correction `5d86e5b` | Reproduced the candidate, mapped the acceptance IDs, added C-12 coverage and prepared proposal and presentation PDFs from repository evidence. | Student review of course materials pending. |
| Claude Code (Sonnet 5.5) | Address checkpoint A, 2026-11-24 | Implemented migration 002, the transactional dataset generation, stateless signed selections and the fixture provider, dual-mode contracts, create, register, preview, commit and dashboard, the location picker and pages, the cross-site check, and the L-01–L-04 tests. No new dependency was added; the fixture catalog is invented data generated once from coordinates and committed. | A-7 above. Technical checks passed. The student review is pending. |
| Claude Code (Opus 5.5) | Address checkpoint B, 2026-11-24 | Implemented evidence schema 2 with retention, trip-local leg reuse, the whole-candidate discard and its counters, the `ROUTING_UNAVAILABLE` mapping and the lazy adapter, and the independent reference, the seeded comparison and the L-05–L-12 tests. No new dependency. | A-8 above. Technical checks passed. The student review is pending. |

The proposal draft was recorded in commit `f306937` as part of W6 preparation. The [six-slide writeup PDF](../deliverables/final-project-writeup.pdf) is ready for student review. Derick Lee confirmed that the solo demo slot is booked. Student review, rehearsal, and Canvas submissions remain pending. [Demo & Code](../deliverables/DEMO-AND-CODE.md) · [Writeup checklist](../deliverables/WRITEUP.md)

## Address extension design review

On 2026-11-24 the two proposed hand examples were projected from their directed input times and run through the existing matcher on Node 24. The first optimum was 180 seconds. Transposing the pickup matrix gave 420 seconds and swapping the drivers’ direct-to-venue times gave 300. In the threshold example the exact solver seated two for 1,020 seconds, greedy seated one for 60, and reversing the pickup direction produced the incorrect 180-second diagonal. The existing matching suite passed 69/69. These observations cover the matcher and the example arithmetic. Exercising address selection, publication, commit/reload and actual provider coverage remains part of the proposed milestones. [Fixtures and delivery gates](ARCHITECTURE-v2.md#8-independent-example-and-delivery-gates)

### Address extension provider and rematch review

On 2026-11-24 the public Route Matrix page was opened and its request parameters, response fields, synchronous cell limit and pricing formula inspected. The earlier file/anchor check covered repository links only. All matrix citations now point to the API reference. The platform overview describes storage generally. At that review, confirmation covering the chosen plan, both APIs and retention until reset remained open under ISSUE-045. [Matrix reference](https://apidocs.geoapify.com/docs/route-matrix/) · [Autocomplete](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/) · [Service overview](https://www.geoapify.com/products-and-services/) · [Terms](https://www.geoapify.com/terms-and-conditions/)

An independent directed-set calculation counted 1,070 required legs at 20 drivers and 50 pickups. Applying the published base formula gives 570 credits for the two rectangular requests. Subtracting the prior required legs gives 0 new cells for a covered reduction, 51 for the final driver and 21 for the final pickup. These are design calculations. The token protocol, leg reuse, deadline and quota behavior still require implementation and the acceptance runs in the design. No authenticated provider request was made. [Delivery gates](ARCHITECTURE-v2.md#delivery-and-acceptance)

### Address checkpoint planning review

The capacity service allows an active driver at zero seats to regain capacity. An independent set calculation for a one-driver fixture reproduced the revised retention rule. The two-seat → zero-seat → two-seat sequence preserved all three observed legs and needed zero new cells on restoration. Adding pickup Q while the only driver X was at zero seats deferred exactly X→Q and Q→venue until restoration. Withdrawing the original pickup removed its two incident legs from the next preview. These observations validate the example arithmetic. The production projection, exhaustive-oracle comparison, fixture key generation and reset remain unrun extension checks. [Capacity service](../src/trips/service.ts) · [L-series acceptance checks](ARCHITECTURE-v2.md#delivery-and-acceptance)

Confirmed with `git check-ignore -v` that both proposed demo and test fixture-key paths are ignored. The provider reference lists 140 km/h as the car default and 10–252 km/h as the parameter range. The proposed wire request omits the optional avoidance array. [Route Matrix reference](https://apidocs.geoapify.com/docs/route-matrix/)

### Address design follow-up review

On 2026-11-24 a design review by Claude Code added five revisions to the [address-trip architecture](ARCHITECTURE-v2.md):
- cell handoff when a newer roster version takes over a live preview (L-14);
- lazy fixture-key creation at runtime with a temp-file → `fsync` → `link` publish (L-01);
- reset behavior when key rotation fails, and operator ownership of the live signing key;
- a separate public summary column, so dashboard and stored-hit reads never select the evidence blob (L-12);
- ISSUE-046 returned to `open`, because its fix is specified but not implemented.

These are document changes only. Fences and whitespace were checked. No application code ran and no provider request was made. Human review of these revisions is pending.

### Address architecture revision review

Reviewed the five changes listed in the follow-up review against the reset transaction, keyed mutation error classification and preview repository reads. A temporary-file probe with dummy content confirmed that a successful hard link leaves both names until the winning creator unlinks its temporary name. A directed-set example handed off three cells for driver X and pickup P. After replacing X with Y, only P→venue belonged to the new retention set. All 19 L-series IDs still map to their workplan checkpoints. These are design-review observations. No v2 application workflow, database reset or provider call was exercised. [Open questions ISSUE-047–051](../WORKPLAN.md#bugs-and-open-issues)

The reset currently performs TRUNCATE, seed and starter-trip insertion inside one transaction. A confirmed COMMIT is the point at which post-reset rotation can be described as recovery for a durable reset. Existing keyed mutations convert unexpected business errors to terminal receipts and explicitly classified transient failures remain retryable. These boundaries inform L-01 and L-04. [Reset code](../src/db/setup.ts) · [Mutation helper](../src/trips/mutation.ts) · [PostgreSQL TRUNCATE](https://www.postgresql.org/docs/18/sql-truncate.html)

### Address architecture revision follow-up

On 2026-11-24 Claude Code checked ISSUE-047–051 against the code and revised [ARCHITECTURE-v2.md](ARCHITECTURE-v2.md).

Code checks:
- `runSetup` performs the TRUNCATE, seed and starter-trip insert inside one transaction (`src/db/setup.ts`).
- `toTerminal` finalizes any unexpected `Error` raised in business work as a terminal 500 receipt (`src/trips/mutation.ts`).

Both confirm the reviewer's failure scenarios.

Revisions:
- **ISSUE-047.** Instead of rotating a key file after COMMIT, signing keys are now derived (HKDF) from a stable master secret and a `dataset_generation` UUID. Reset replaces that UUID in its own transaction, so a reset and token invalidation commit or roll back together, including when the COMMIT outcome is unknown. Reset no longer writes files.
- **ISSUE-048.** Key or generation unavailability is a retryable `TransientFailure` with no receipt. The secret's format is validated before use, so a corrupt file can't be read as tampered tokens. The README describes creation on first runtime use.
- **ISSUE-049.** Each initializer unlinks its own temporary file on success, on `EEXIST` and on error.
- **ISSUE-050.** Handed-off cells are intersected with the newcomer's retention set and merged without replacing retained observations.
- **ISSUE-051.** Display reads validate results and the summary column. Full evidence is validated at publication, reuse and commit.

L-01, L-04, L-12 and L-14 gained the matching assertions. The issues stay open until the L-checks run against an implementation. These are document changes only; no application code ran. Human review is pending.

### Dataset generation design review

The proposed generation update fits the existing guarded reset transaction. Receipt replay has a separate lifetime: reset explicitly truncates mutation receipts alongside trips, so an applied create cannot replay its original success after a committed reset. The baseline already defines this boundary. L-01 can check reset invalidation, while L-04 can check replay across signing-key unavailability or replacement with receipts retained. [Reset implementation](../src/db/setup.ts) · [Baseline recovery contract](ARCHITECTURE.md#9-local-operation-and-implementation-roadmap)

A standalone Node 24 check with dummy data produced different HMAC tags for two well-formed 32-byte master secrets differing by one bit at the same generation. Length and encoding alone cannot detect a valid-format substitution, including accidental regeneration after a file is lost. Clarify the intended recovery guarantee before defining the L-04 control. Stored public-summary reads and full evidence reads are now separated; the committed dashboard should validate its stored policy after an upgrade. All 19 L-series IDs mapped to their checkpoints. No application, live database reset or provider request was run. The implementation gates and independent human review remain open.

### Dataset generation review follow-up

On 2026-11-24 Claude Code applied the dataset generation review to [ARCHITECTURE-v2.md](ARCHITECTURE-v2.md).

The review's three findings:
- **Reset and replay.** Replay after a reset is no longer promised. A committed reset truncates receipts and changes the generation, so a pre-reset key and body finalize a new terminal 422. This matches the released contract that old operations have no replay guarantee across a reset. L-04 now requires replay only while the receipt exists. L-01 covers the rolled-back reset (replays the original 201), the committed reset (new 422) and the lost acknowledgement.
- **Secret loss.** The 503 guarantee is narrowed to detectable storage, format and generation-read failures. Loss or replacement of the master secret invalidates outstanding tokens. The secret is cached per process. Tokens carry a key identifier so `key_mismatch` failures can be counted. Fixture initialization logs a warning when it creates a secret while address trips exist. A persisted key fingerprint was considered and rejected for the loopback pilot. L-01 tests deletion of the secret between processes.
- **Display policy.** Cached preview hits validate against the current policy. Committed dashboards validate against the policy stored with the committed preview, which the build must still decode.

Additional issue found during this follow-up: verification needs the generation to derive the key. The design now derives the verification key from the current generation and verifies the MAC over the exact token bytes before parsing. The key ID and generation header is read beforehand only to label failures. All client-token decoding failures become 422, because any other exception in keyed work would be finalized as a terminal 500 receipt (`toTerminal` in `src/trips/mutation.ts`).

These are document changes only. Fences and whitespace were checked, and no application code ran. Human review is pending.

### Selection token verification review

Reviewed the follow-up against the HTTP reader, mutation helper and trip service. The existing transport rejects an invalid or oversized outer request with 400 before receipt handling. For a registration, the helper looks up the receipt and locks the target trip before token verification can run, so a same-key retry against a trip removed by reset finalizes a new 404. An old venue token on a fresh post-reset creation reaches verification and finalizes a new 422. The proposed L-01 and L-04 assertions now distinguish those paths, and L-12 covers displaying a committed plan across a policy upgrade. [HTTP boundary](../src/app/api/http.ts) · [Mutation order](../src/trips/mutation.ts) · [Trip lookup](../src/trips/service.ts)

A standalone Node v24.22.3 check with dummy inputs confirmed that changing the encoded header or the HKDF generation changes the HMAC, a short tag throws on an unguarded constant-time comparison, ordinary padded base64 can be accepted by the base64url decoder, and bytes with a valid MAC can still fail JSON parsing. These observations informed the strict envelope and generic token rejection in ISSUE-052. No application, database reset or provider workflow ran. All extension L-checks and student review remain pending. [Revised design](ARCHITECTURE-v2.md#3-search-confirmation-and-http-contracts)

### Final design review decisions

On 2026-11-24 Claude Code recorded the selected cold-fetch fallback in [ARCHITECTURE-v2.md](ARCHITECTURE-v2.md), with two clarifications for checkpoint A.

- **Corrupt reuse candidate.** Previously, a malformed reuse candidate was an invariant failure, so every later preview for that trip would fail until a guarded reset. Now the candidate is counted as an invariant failure and skipped, and the preview fetches every required leg cold. Commit still fails safely on corrupt evidence. An effective roster change escapes a corrupt cached hit. L-11 and L-12 assert this.
- **Token clock.** Issue and expiry use the Node server clock through an injectable clock, so L-04 can test the boundary.
- **Cross-site writes.** A write with a present cross-site `Origin` or `Sec-Fetch-Site: cross-site` gets 403 before the keyed helper. Requests carrying neither header are allowed, because the existing Node-`fetch` scripts and suites send none (`scripts/eval-responsiveness.ts`). No route checks `Origin` today. L-04 asserts this.

These are design decisions. The implementation checks and independent student inspection remain pending.

### Address design commit review

Reviewed the proposed fallback against the preview publication and commit paths. An invalid prior row triggers one cold attempt under normal admission and deadline rules. Required nonlocal legs need routing, while an empty or local-only projection can still publish offline. L-12 exercises the available and unavailable paths from independent starting states. L-04 now tests the exact millisecond of token expiry with fresh keys, receipt replay after expiry, and origin checks before receipt handling or provider dispatch. [Acceptance catalog](ARCHITECTURE-v2.md#delivery-and-acceptance)

The design review verified 19 distinct L-IDs mapped to A–D, all 38 baseline acceptance IDs still present, local links and anchors, JSON examples, table widths, code fences and whitespace. Git ignores both proposed fixture-key paths. This was a documentation review. No application tests, database resets or provider calls were run. At design-commit review, A–C awaited implementation and ISSUE-045 blocked D.

### ISSUE-045 provider sources for the owner’s decision

On 2026-11-24 the Address Autocomplete product page explicitly allowed caching and storing address results and suggestions. This directly supports short-lived browser selections and retaining selected building addresses and coordinates. The platform FAQ also permits storing API results. Applying that general guidance to retaining directed Route Matrix durations and no-route results until offline reset, reusing them on the same trip and displaying saved estimates is the remaining interpretation for the free pilot. The Route Matrix product page describes the output. No matrix-specific retention period was identified in the reviewed sources. [Address Autocomplete](https://www.geoapify.com/address-autocomplete/) · [Platform FAQ](https://www.geoapify.com/) · [Route Matrix](https://www.geoapify.com/route-matrix-api/)

Geoapify’s terms require OpenStreetMap attribution, Geoapify attribution on the free plan and applicable source-specific credits. Show the credits alongside suggestions, previews and saved estimates. The owner can record a dated decision relying on the published guidance if satisfied it covers both APIs on the selected plan, or request written confirmation of retention, reuse and attribution from Geoapify support. Add any retention conditions and how GroupRide meets them before marking the workplan issue closed. The owner’s subsequent decision is recorded below. [Terms](https://www.geoapify.com/terms-and-conditions/) · [Support contact](https://myprojects.geoapify.com/help/troubleshooting/)

### ISSUE-045 free-plan decision

On 2026-11-24 the project owner chose Geoapify’s published guidance as the basis for the GroupRide free-plan pilot. Address Autocomplete expressly permits storing suggestions and results. For Route Matrix the owner applies the platform-wide permission to store API results. The pilot may send suggestions to the organizer in 30-minute tokens, keep selected public building addresses and coordinates until guarded offline reset, and keep timestamped travel durations and no-route observations until that reset for same-trip rematching and display of saved estimates. This is the project’s reading of the published guidance. [Address Autocomplete](https://www.geoapify.com/address-autocomplete/) · [Platform FAQ](https://www.geoapify.com/) · [Route Matrix](https://www.geoapify.com/route-matrix-api/)

The pilot will show linked Geoapify credit, OpenStreetMap attribution and applicable source-specific credits alongside suggestions, previews and saved estimates. Search and routing share the account allowance of 3,000 credits per day and up to five requests per second. Budget matrix calls by credits, including applicable surcharges. Defer calls when the remaining free allowance is insufficient. ISSUE-045 is closed for this pilot. L-18 still requires the free project, server key and operating budget to be confirmed before live queries. [Terms](https://www.geoapify.com/terms-and-conditions/) · [Free plan and attribution](https://www.geoapify.com/pricing/)
