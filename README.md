# GroupRide

Carpool coordination for organization events: create a trip, register drivers and passengers, preview assignments, commit them, and recover when availability changes.

**Status:** Planning only. There is no runnable application, dependency manifest, or verified setup/test command yet.

## Documentation

- [Selected initial architecture](docs/ARCHITECTURE.md): component choices, contracts, alternatives and tradeoffs, acceptance checks, comparison experiments, and implementation roadmap.
- [Project evidence](docs/EVIDENCE.md): required validation results, agent/human work records, two decisions, debugging case, and attribution. Fill these during development.
- [Course specification](PROJECT_SPEC.md): supplied requirements and final acceptance checklist.

The selected baseline is one Next.js application with PostgreSQL, explicit SQL transactions, and bounded min-cost flow matching. It stores server-generated previews and commits the reviewed plan by ID; roster changes invalidate the complete saved plan. Alternatives have explicit evaluation criteria and adoption triggers. Implementation and runtime validation are still pending.

## Setup and demonstration

As implementation becomes runnable, add verified instructions here for dependencies and configuration, installation/build, database setup and fixtures, starting/interacting with the app, demo reset, and validation commands (RR-2). The planned demo and independent expected results are in the architecture; record actual results in the evidence file.

## Course deliverables

The course requires a runnable GitHub repository accessible to staff, a short proposal PDF, a final slide deck PDF, and a live demonstration. Submit the required URL/PDFs and reserve a demo slot through Canvas by its deadlines. The final deck is the writeup; no separate written report is required.

Proposal inputs are covered by the architecture (workflow, validation, dependencies, risks/fallback) and evidence plan (human/agent responsibilities). The required proposal PDF still needs to be prepared and submitted; a separate Markdown draft or duplicate course checklist is not required.
