# GroupRide

Carpool coordination for organization events: create a trip, register drivers and passengers, preview assignments, commit them, and recover when availability changes.

**The W6 release candidate builds and runs from a clean checkout.** The production build, browser workflow, concurrency tests and evaluations passed on fresh demo/test databases. All 38 acceptance checks have passing evidence on `1a831f1`. Student review and course submissions remain open. [Verification results](docs/EVIDENCE.md#w6-review-corrections) · [Current handoff](WORKPLAN.md)

## Documentation

- [Workplan and current handoff](WORKPLAN.md): start here for the next task, implementation checkpoints, release gates, and progress tracking.
- [Agent instructions](AGENTS.md): repository conventions, verification, evidence, and handoff requirements for coding agents.
- [Selected initial architecture](docs/ARCHITECTURE.md): component choices, contracts, alternatives and tradeoffs, acceptance checks, comparison experiments, and implementation roadmap.
- [Searchable U.S. pickups design](docs/ARCHITECTURE-v2.md) covers the proposed extension for venue, driver and passenger addresses.
- [Project evidence](docs/EVIDENCE.md): required validation results, agent/human work records, two decisions, debugging case, and attribution. Fill these during development.
- [Course specification](PROJECT_SPEC.md): supplied requirements and final acceptance checklist.

The selected design is one Next.js application with PostgreSQL, explicit SQL transactions, and bounded min-cost flow matching. The browser supports trip creation, registration, server-generated previews, version-checked saves and same-key retry after an uncertain outcome.

## Setup and demonstration

Use Node `24.22.3` (see `.node-version`), npm, and a running Docker engine with Compose. On a Mac with Homebrew `node@24`, select it for the current shell with `export PATH="$(brew --prefix node@24)/bin:$PATH"`. Copy `.env.example` to `.env` if the file does not exist. The checked-in credentials are for disposable local demo and test databases on port 55432.

From a fresh checkout, install the locked dependencies before running the setup and matching checks:

```sh
npm ci
npm run test:setup
npm run test:matching
docker compose config --quiet
```

Continue in the same checkout with Docker running and the designated demo and test databases free:

```sh
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

Stop any app using `groupride_test`, then run `npm run test:unit` and `npm run test:concurrency -- --reporter=verbose`. The concurrency suite uses the two test URLs in `.env` and resets the designated test database before each case. It covers shared transaction and receipt behavior, routing races, and a guest registration that invalidates a competing organizer save. [Concurrency verification](docs/EVIDENCE.md#regression-audit-follow-up)

For W3, run the preview/commit integration cases (part of `npm run test:concurrency`) and the browser workflow checks. Install Chromium once with `npx playwright install chromium`. With the database running and `groupride_test` free, run `npm run test:e2e`. It builds a production server on loopback port 3100, resets the test database, and drives Chromium through the zone and address workflows, including a rematch after a late guest joins. Reducer ordering (U-01, U-04) is covered database-free by `npm run test:unit`.

For W5 evaluation, `npm run eval:matching` runs the exact-size classes and 100 oracle seeds. On the dense 20-driver, 50-passenger fixture it checks each measured plan against the expected 50 matches at cost 113. The output in `eval/d1-matching.json` retains 100 timings per solver in acquisition order under `maxBoundTiming`. The median and p95 are the 50th and 95th values after sorting each array. With the designated `groupride_test` database free, `npm run eval:concurrency` runs D-2. After `npm run build`, `npm run eval:responsiveness` starts the production server on port 3100 and writes `eval/p01-responsiveness.json`. Both database experiments reset `groupride_test`. P-01 verifies the persisted 20-driver/50-passenger roster before timing, ends the measured window the instant the preview load finishes (classifying competing requests by start time against that boundary), requires 100 distinct freshly-computed previews each with a finite matcher duration, and records competing GET/PATCH latency, matcher duration, cache hits and event-loop delay. The `roster`, `duplicate`, `preview`, and `edits` values of `P01_NEGATIVE_CONTROL` each produce a failing run and write `eval/p01-control.json`. Observed on this host (Node 24, commit `8f3187a`): D-1 oracle 100/100, solver p95 ≈ 1.8 ms; D-2 both variants `STALE_VERSION` with the full blocking interval; P-01 roster `20d/50p`, 100 fresh previews, competing under-load p95 ≈ 12 ms, increase ≈ 2 ms.

To open the app against your demo database, run `npm start` after building or use `npm run dev`, then visit `http://127.0.0.1:3000`.

`npm run demo:reset` replaces all data in the designated demo database and prints its new starter trip ID. Stop the app before running it and wait for reset to finish before restarting. A startup read overlapping reset may briefly report `DATASET_MISMATCH` (ISSUE-004). `npm run test:database` replaces data only in the designated test database. Both databases are bootstrapped on first start with an empty Compose volume. For a clean rehearsal, use a fresh Compose project with port 55432 available.

### Share a trip invitation

Run `npm run db:migrate` to add invitations to an existing local database. On the trip dashboard select **Copy invite link** and share that link with participants. Guests open it, choose **Passenger** or **Driver**, and submit their details. A driver also enters available seats and, for an address trip, a detour limit. An open, visible organizer dashboard refreshes automatically to show new registrations and departures.

After registering through an invite, save the **Private registration link** on the confirmation screen. Open that link to check whether you are waiting for a plan, assigned, or have already left. Click **Leave trip** to remove your own active registration. Guests who joined before this link was added can ask the organizer to remove them.

If you switch links before the registration confirmation appears, return to the shared invite in the same tab and click **Retry registration** to recover your confirmation and private link.

Keep the organizer dashboard URL private. The invite link shows trip details and accepts registrations from anyone holding it. The local server URL is reachable only on the host machine. To share across devices, serve GroupRide at a reachable HTTPS origin, configure `GROUPRIDE_TRUSTED_ORIGINS` for that origin, and open the organizer dashboard at that address before copying its invite link. The existing [trip data privacy issue](WORKPLAN.md#bugs-and-open-issues) remains relevant before using personal pickup data.

### Run the invitation demo

Use Node 24. With the database running, start a production app in one terminal. If a development server is already using port 3000, stop it first.

```sh
npm run build
GROUPRIDE_ADDRESS_PROVIDER=fixture npm start
```

Leave the app running and start the walkthrough in a second terminal:

```sh
npm run demo:invites
```

If Chromium is missing, install it once with `npx playwright install chromium`. Use `npm run demo:invites -- --headed` to watch the browser. The script brings the saved plan to the front and waits for Enter when run from a terminal. Add `--port 3001` if GroupRide is listening on a different local port.

The script creates one address trip at the fictional Event Hall and opens the real invitation link in five separate guest sessions. It simulates delivery in the browser instead of sending email or text messages. It previews, saves, and reloads a plan with two drivers, three passengers, and two matches with a total estimated pickup detour of 1 minute 22 seconds. It prints both the private organizer URL and guest link. Each run creates one additional trip and preserves existing trips. The script checks that fixture mode is active before searching. It uses zero Geoapify credits.

### Address trips with the offline fixture (checkpoint A, verified)

Address trips let an organizer search for a venue, driver start addresses and passenger pickup addresses, then preview, save and reload a plan whose costs are estimated extra driving time. This checkpoint runs entirely offline against a shipped catalog of **fictional** places and driving times ([data/fixture-places.json](data/fixture-places.json)): no account, API key, network or geocoder. Checkpoint C exercises the routing adapter on loopback. The live provider pilot belongs to D.

1. Follow the standard setup above. No copied secret and no provider credentials are needed.
2. Upgrade an existing database with `npm run db:migrate` (add `-- test` for the test database). It is additive: saved zone trips, plans, previews and receipts are unchanged. `npm run demo:reset` and `npm run demo` also apply it first.
3. Select the provider in the server environment, for example `GROUPRIDE_ADDRESS_PROVIDER=fixture npm run demo`, or put that line in `.env` (see `.env.example`). The default is `off`: zone trips work as before, and address search reports that it is disabled.
4. In the browser choose **Trip type → Addresses**, search for `event hall`, and select a result with the keyboard (arrow keys, Enter). Then register a driver and a passenger on the trip page, preview, save and reload. Results labelled “street only” or “city” are shown but cannot be chosen.

Browser writes are accepted only from the app's own loopback origin on its listening port (`http://127.0.0.1:<port>` or `http://localhost:<port>`); a foreign origin gets 403. If you reach the app through another host name or a port mapping, set `GROUPRIDE_TRUSTED_ORIGINS` to the full origin (see `.env.example`). Scripts and `curl` send no `Origin` header and are unaffected.

The first search creates an owner-only (`0700`/`0600`) signing secret at `.groupride-local/<demo|test>/fixture-signing.key`, which Git ignores. Starting the server or running `next build` creates nothing. A guarded reset (`npm run demo:reset`) replaces the database’s dataset generation in the same transaction as the data, which invalidates every earlier search result, and never rewrites the secret. Deleting the secret invalidates earlier search results too; search again.

For the verified expectations, try Event Hall (venue), a driver starting at *Driver Start Delta* and a passenger at *Pickup Alpha*: Delta→Alpha 403 s + Alpha→Hall 346 s − Delta→Hall 519 s = **230 s**, shown as “3 min 50 s”. Costs on an address trip are estimated extra driving seconds, labelled as the sum of individual pickup detours; zone trips keep their synthetic cost units.

After the first preview, later previews of the same trip **reuse the earlier driving times** and fetch only the legs still missing (the estimate reports how many were `fetched`, `reused` and `local`). A cancellation, withdrawal or seat change usually needs nothing new, and a driver who offers no seats keeps their earlier observations in case capacity returns. If a preview needs a leg it does not have while routing is unavailable, it returns `503 ROUTING_UNAVAILABLE` and publishes nothing; a preview whose legs are all known still works. Saved plans, stored previews and commits never need routing.

Verified commands for this checkpoint (Node 24, the local test database): `npm run lint`, `npm run typecheck`, `npm run test:matching`, `npm run test:unit`, `npm run test:concurrency`, `npm run test:e2e`. [L-01–L-04 evidence](docs/EVIDENCE.md#checkpoint-a-closeout) · [L-05–L-12 evidence](docs/EVIDENCE.md#checkpoint-b-closeout)

### Address preview checks on loopback (checkpoint C)

With Node 24, PostgreSQL running and the designated `groupride_test` database free, run `npm run test:concurrency -- geoapify.integration` for the matrix adapter, concurrent previews and publication deadlines. The tests start their own counting HTTP stub with fictional coordinates and a dummy key. The ISSUE-076–081 cases cover successive edits, both publication orders for overlapping zero-seat previews, seat restoration with routing disabled, and recovery from a malformed provider retry date. `npm run test:e2e` builds the production app and exercises the organizer’s waiting, Retry and Save controls in Chromium.

After the production build, `npm run eval:responsiveness -- --address` resets the designated test database and measures a separate trip’s GET/PATCH latency during 100 address previews. It writes [the L-17 results](eval/l17-responsiveness.json). For the interactive address demo, continue to select `fixture`. Live search and pilot setup are in checkpoint D.

### Checkpoint D pilot rehearsal

With Node 24 and the designated PostgreSQL test database free, run `npm run test:concurrency -- live-search` for the offline rehearsal. It checks signed and stored addresses for fractional, hyphenated and grid numbers, trailing apartments, competing addresses with city and state, and numeric venue names. The ambiguity cases add and remove an exact venue while keeping two unrelated buildings in the reply. They check that only a building with both the requested number and street can be selected. The same suite saves single highway addresses, including `24 N TX-35 Frontage Road` and `24 N OR-99 Frontage Road`, and asks for clarification before dispatch when a comma and “or” join two addresses. It also saves searches with an attached city or ZIP and checks that conflicting provider records cannot supply the missing locality. The Miami cases distinguish `FL 33101` from a floor and verify the saved building when the query ends in a state, ZIP or US country label. They include replies that supply only a state name or only a code. The search rehearsal also checks suite-like city names, contradictory provider state fields, and city-plus-ZIP searches where the city is also a state name. Run `npm run test:unit -- location-query` for the paired-address and postal-alias regression tables. The live-search rehearsal also covers the five-second deadline across pool and provider waits, cancellation, and the seat reduction, rematch, save, replay and reload workflow. Run `npm run test:concurrency -- provider-privacy` to check synthetic markers against Next.js fetch tracing and full-URL development logs for both provider operations. The L-18 case in `npm run test:e2e` checks the pre-entry routing disclosure and attribution on suggestions, previews and saved plans. The ISSUE-084 Chromium case checks that a user can clarify the building and select again.

Search for a venue such as `Studio 54 Theater` or `7-Eleven` by name. If the picker asks whether you meant a venue whose name also looks like a numbered street, put the exact venue name in double quotes. Any city and state follow the closing quote, as in `"F45 Training", Austin, TX`.

For the live pilot the server uses `GROUPRIDE_ADDRESS_PROVIDER=geoapify`, `GEOAPIFY_API_KEY`, and an independent `GROUPRIDE_SELECTION_SECRET` containing at least 32 random bytes encoded as unpadded base64url. Keep secrets in the ignored server environment. Confirm the free project, available credits and approved budget before enabling live queries. [Pilot status and results](docs/EVIDENCE.md#checkpoint-d-pilot-preparation)

The small Austin and Seattle pilots have saved plans on this checkout’s local demo database. Start the production server with `GROUPRIDE_ADDRESS_PROVIDER=off npm start` to revisit them offline. Open `/trips/1a4dfde7-f2eb-48aa-aca3-d2e1429f825f` for Austin or `/trips/b0ff7968-6258-44aa-92d1-75a2d031c3b1` for Seattle. A demo reset removes these runs. [Live pilot evidence](docs/EVIDENCE.md#austin-and-seattle-live-pilot)

## Demonstration (W3 workflow)

With the database running and the app stopped, build then start the demo:

```sh
npm run build
npm run demo
```

`npm run demo` resets the demo database, prints a fresh starter trip ID, and starts the production server on `http://127.0.0.1:3000`. The WF-4 directional-cost walk-through:

1. Open `http://127.0.0.1:3000` and create a trip with a name and destination. Under **Departure**, choose a date, time, and time zone. The form converts your selection to UTC. You land on `/trips/<id>`.
2. Under **Register participants**, add a driver in zone `north` with 1 seat, then a passenger in zone `east`.
3. Click **Preview** to review the passenger rows under each driver’s name. Unassigned passengers appear below the cards. Use **Discard preview** to dismiss the preview. The fixture’s expected result is 1 match at cost 7, visible in the status line after saving.
4. Click **Save plan**. The status line shows `Plan saved`, `Matched: 1`, `Total cost: 7`.
5. Reload the page to see the saved plan again. To remove its assignments and keep the roster, use **Clear plan** in the saved plan section and confirm.
6. Click **Edit driver** or **Edit passenger** next to a participant to update the registration. In address mode, use **Change address** to select a replacement. If the trip changes while you edit, review the current registration and choose **Keep draft** to re-enable saving. Changes clear the saved plan so you can preview and save a new one.
7. Under **Edit driver**, change **Seats available** from 1 to 0 and save. The status becomes **Needs a new plan**. Preview and save again to rematch.

**Cancel** and **Withdraw** remove inactive participants from the dashboard roster. Their registrations remain in the database and are excluded from matching.

To rehearse the three automated workflow scenarios against this running demo, run `npm run test:demo` in a second terminal. Chromium creates trips in the local demo database on port 3000 and exercises save/reload, rematch, and stale save. Stop the demo server when finished.

Open the same `/trips/<id>` URL in a second browser profile to see the stale-commit flow: if one tab commits, the other tab's commit is rejected with a review/refresh prompt rather than silently overwriting the saved plan.

## Course deliverables

GroupRide is a solo final project by Derick Lee. The [contribution record](docs/EVIDENCE.md#attribution-and-contributions--rr-3) documents student and AI-agent work.

The final assignments require a runnable GitHub repository accessible to staff, a final slide deck PDF, and a live demonstration. Submit the repository URL to [Demo & Code](deliverables/DEMO-AND-CODE.md) and the final slide PDF to [Writeup](deliverables/WRITEUP.md) by the shared Canvas due date. Reserve one slot per team on the demo sign-up sheet. The final deck serves as the writeup.

The [six-slide writeup PDF](deliverables/final-project-writeup.pdf) follows the Canvas template and describes the current invitation demo. Review it before uploading to Canvas. The [W6 checklist](WORKPLAN.md#w6--clean-reproduction-and-submission) tracks the remaining course actions.
