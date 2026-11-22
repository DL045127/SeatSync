# GroupRide

Carpool coordination for organization events: create a trip, register drivers and passengers, preview assignments, commit them, and recover when availability changes.

**Status:** W0 setup is verified. The scaffold builds, C-18 passes on PostgreSQL, and production and development readiness checks pass. W1 is next.

## Documentation

- [Workplan and current handoff](WORKPLAN.md): start here for the next task, implementation checkpoints, release gates, and progress tracking.
- [Agent instructions](AGENTS.md): repository conventions, verification, evidence, and handoff requirements for coding agents.
- [Selected initial architecture](docs/ARCHITECTURE.md): component choices, contracts, alternatives and tradeoffs, acceptance checks, comparison experiments, and implementation roadmap.
- [Project evidence](docs/EVIDENCE.md): required validation results, agent/human work records, two decisions, debugging case, and attribution. Fill these during development.
- [Course specification](PROJECT_SPEC.md): supplied requirements and final acceptance checklist.

The selected design is one Next.js application with PostgreSQL, explicit SQL transactions, and bounded min-cost flow matching. W0 provides the scaffold, database setup, and readiness checks. W1 adds matching. Later checkpoints add the trip workflow, stored previews, versioned commit, and browser recovery.

## Setup and demonstration

Use Node `24.22.3` (see `.node-version`), npm, and a running Docker engine with Compose. On a Mac with Homebrew `node@24`, select it for the current shell with `export PATH="$(brew --prefix node@24)/bin:$PATH"`. Copy `.env.example` to `.env` if the file does not exist. The checked-in credentials are for disposable local demo and test databases on port 55432.

Verified in the workspace with Node 24:

```sh
npm run test:setup
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

To open the scaffold against your demo database, run `npm start` after building or use `npm run dev`, then visit `http://127.0.0.1:3000`.

`npm run demo:reset` replaces all data in the designated demo database and prints its new starter trip ID. Stop the app before running it. `npm run test:database` replaces data only in the designated test database. Both databases are bootstrapped on first start with an empty Compose volume. For a clean rehearsal, use a fresh Compose project with port 55432 available.

## Course deliverables

The course requires a runnable GitHub repository accessible to staff, a short proposal PDF, a final slide deck PDF, and a live demonstration. Submit the required URL/PDFs and reserve a demo slot through Canvas by its deadlines. The final deck is the writeup; no separate written report is required.

Proposal inputs are covered by the architecture (workflow, validation, dependencies, risks/fallback) and evidence plan (human/agent responsibilities). The required proposal PDF still needs to be prepared and submitted; a separate Markdown draft or duplicate course checklist is not required.
