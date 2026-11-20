# CS 378AC — Final Project Requirements Specification

## 1. Project Overview

### 1.1 Objective

Design, implement, test, and demonstrate a functional software project that addresses a clearly defined use case.

The project should prioritize a complete, verifiable user workflow over the number of implemented features. Students must demonstrate their understanding of the system, justify important technical decisions, and provide evidence supporting its correctness.

### 1.2 Scope

- Projects may be completed individually or in teams of two.
- Projects should be scoped for approximately two weeks of development and testing.
- Originality is not required. Existing applications, libraries, tutorials, frameworks, and prior projects may be reused.
- All reused components must be properly attributed.
- Material from this course's homework is prohibited, including starter code, solutions, tests, data, and handouts.
- Students must distinguish their own contributions from reused components and AI-agent-generated work.

## 2. Functional Requirements

### FR-1: Core Functionality

The project must implement at least one complete, working user workflow.

The workflow must:

- Serve a clearly identified user or use case.
- Begin from a known, reproducible initial state.
- Accept defined inputs or user interactions.
- Execute the project's central functionality.
- Produce an observable, meaningful result.

The project must identify one consequential claim about what the system does and demonstrate that the implementation satisfies that claim.

### FR-2: Demonstrable Behavior

The system must support a reproducible demonstration of its primary functionality.

The demonstration must include:

- A successful execution of the core workflow.
- A clearly observable output or state change.
- A meaningful edge case, failure case, or invariant.
- A specific limitation that the system cannot currently handle.

The system should not depend exclusively on unpredictable external services for its demonstration.

### FR-3: Defined Scope and Limitations

The project must distinguish between:

- **Core requirements:** Functionality necessary to demonstrate the project's main purpose.
- **Optional functionality:** Enhancements that can be omitted without compromising the core demonstration.
- **Known limitations:** Inputs, environments, or conditions the system does not support.

If the original scope becomes infeasible, the team must document the changes and preserve a smaller, complete implementation.

## 3. Testing and Validation Requirements

### VR-1: Functional Testing

The project must include tests or checks that verify its intended behavior.

At minimum, validation must cover:

1. The primary successful workflow.
2. A meaningful edge case or failure condition.
3. A plausible incorrect implementation that the chosen test would detect.

Tests should verify observable behavior rather than merely confirm that the program executes without errors.

### VR-2: Independent Validation

The project must include at least one check whose expected result is established independently of the implementation being evaluated.

Suitable validation methods include:

- Comparing results against an established reference implementation or known answer.
- Testing independently constructed input/output examples.
- Differential testing against another implementation.
- Fault injection.
- Testing invariants.
- Replaying a previously recorded user interaction.

Tests generated using the same assumptions as the implementation do not necessarily constitute independent evidence.

### VR-3: Reproducibility

Validation evidence must be reproducible by course staff.

For each significant claim, the repository should identify:

- The test input or starting state.
- The command or interaction necessary to execute the test.
- The expected result and how it was determined.
- The actual observed result.
- The relevant code, test, or commit.

Testing instructions and supporting artifacts must be retained in the repository.

## 4. AI-Agent Usage and Human Oversight

### AR-1: Human Responsibility

Students remain responsible for the final project's design, correctness, and quality, regardless of how much code is produced with AI assistance.

Students must identify consequential decisions they made regarding system design, implementation, validation, and scope.

### AR-2: Agent Task Documentation

AI-agent assistance must be documented, including what tasks were delegated and how the resulting work was evaluated.

A documented agent-work episode should capture:

1. **Request:** The specific, bounded task given to the agent.
2. **Change:** The resulting implementation diff or commit.
3. **Observation:** The tests, measurements, or manual checks performed.
4. **Human decision:** Whether the resulting changes were accepted, corrected, rejected, or redesigned.

The implementation plan should preserve at least two traceable agent-work episodes, including an example of consequential human correction, rejection, or redesign, consistent with the deck's more detailed milestone guidance.

### AR-3: Independent Acceptance

AI-generated code must not be accepted solely because the agent reports that it works.

Students must independently inspect, execute, or otherwise validate important agent-generated changes.

## 5. Technical Decision Requirements

### DR-1: Two Design or Evaluation Decisions

The final project must document two consequential design or evaluation decisions.

For each decision, students must explain:

- The problem or requirement being addressed.
- The chosen solution or evaluation strategy.
- At least one alternative that was considered.
- The implementation changes associated with the choice.
- The evidence used to evaluate the decision.
- What was retained, changed, or rejected based on the evidence.

The two decisions may be design choices, evaluation choices, or one of each.

### DR-2: Debugging Case Study

The final documentation must include at least one substantive debugging story that describes:

1. **Symptom:** What was not working correctly?
2. **Cause:** How was the underlying issue identified?
3. **Fix:** What implementation change resolved the issue?
4. **Verification:** What test or observation confirmed the fix?

The debugging case may overlap with one of the two required design or evaluation decisions.

## 6. Repository and Documentation Requirements

### RR-1: GitHub Repository

Each team must maintain one GitHub repository under a student's own account.

- Team partners must be added as collaborators.
- Public repositories are permitted.
- Private repositories must grant instructor and TA access before submission.
- Course homework material must not appear anywhere in the repository or its history.
- The repository URL must be submitted through Canvas.

### RR-2: Setup Documentation

The repository must provide sufficient instructions for course staff to reproduce the working system.

Documentation must explain:

- Required dependencies and environment setup.
- Installation and build commands.
- How to start and interact with the application.
- How to reproduce the core demonstration.
- How to execute relevant validation checks.
- Any required test data, fixtures, or configuration.

### RR-3: Attribution and Contributions

The project must document:

- External libraries, frameworks, and source repositories.
- Versions or commits of reused starting code.
- Functionality added, modified, or integrated by the students.
- Contributions made by each team member.
- Significant contributions made by AI agents.

### RR-4: Evidence Preservation

Claims in the final presentation should be traceable to corresponding repository artifacts.

Evidence may include commits, code diffs, test scripts, input fixtures, recorded outputs, or measurement results.

## 7. Project Proposal Requirements

A short PDF proposal must be submitted by the deadline listed in Canvas.

The proposal must address four primary areas.

### PR-1: Proposed Artifact and Workflow

Define:

- What the team intends to build.
- Who the intended user is.
- The core user workflow.
- Why the project is relevant or interesting.
- The observable result the system will produce.

### PR-2: Demonstration and Validation

Describe:

- How the team intends to demonstrate the project.
- The expected result of the primary workflow.
- At least one acceptance check capable of exposing an incorrect result.
- How the expected result will be determined independently.

### PR-3: Human and Agent Responsibilities

Identify:

- Important decisions that students will make themselves.
- Tasks that may be delegated to AI agents.
- How agent-produced changes will be inspected and validated.
- How human oversight will be documented.

### PR-4: Dependencies, Risks, and Fallback

Identify:

- Planned libraries, services, data sources, and reused projects.
- External dependencies and potential technical obstacles.
- The project's highest-risk functionality.
- A smaller viable implementation if the initial scope cannot be completed.

The proposal may change during development, but significant scope changes should be recorded and justified.

## 8. Final Deliverables

### DEL-1: Working Project

Submit a runnable implementation of the proposed functionality in the team's GitHub repository.

The final implementation must include sufficient setup instructions and evidence to allow course staff to inspect and reproduce the claimed functionality.

### DEL-2: Live Demonstration

The team must demonstrate the working system.

The demonstration should:

1. Establish a known initial state.
2. Execute the project's primary workflow.
3. Display its observable result.
4. Demonstrate a meaningful edge case or failure.
5. Explain at least one independently established expected result.
6. Discuss two consequential technical or evaluation decisions.
7. Identify reused components and an important limitation.

Both team members, if applicable, must be prepared to explain the work.

### DEL-3: Final Presentation

Submit a short slide deck as a PDF.

The slide deck serves as the final project writeup. A separate written report is not required.

The recommended structure is approximately six slides:

| Slide | Required content |
|---|---|
| 1. Project Overview | What was built, intended users, motivation, and demo |
| 2. Contributions | Starting point, changes, architecture, and human/agent roles |
| 3. Decision 1 | Choice, alternative, implementation, evidence, and response |
| 4. Decision 2 | Choice, alternative, implementation, evidence, and response |
| 5. Debugging Story | Symptom, root cause, fix, and verification |
| 6. Limitations | Known shortcomings, what testing does not establish, and next steps |

Start with the six-slide template provided in Canvas and adapt it to the project.

## 9. Suggested Implementation Milestones

The following sequence translates the guide's evidence-building approach into four concrete checkpoints.

| Milestone | Required outcome |
|---|---|
| E0 — Contract | Finalize the core claim, reproducible setup, and initial acceptance check |
| E1 — Behavior | Implement the core workflow and demonstrate a meaningful edge case or invariant |
| E2 — Control | Document agent-assisted changes, human review, and consequential corrections |
| E3 — Defense | Complete independent validation, reproducible demo instructions, and known limitations |

Each checkpoint should leave reviewable evidence in the repository. These are development checkpoints; actual due dates should be taken from Canvas.

## 10. Submission Requirements

Before final submission, the team must:

- Confirm the instructor and TA can access the repository.
- Verify that the project can be executed from a clean setup.
- Ensure documented validation inputs, commands, and results are present.
- Submit the repository URL and final slide deck PDF together.
- Reserve a demonstration slot through Canvas.
- Complete all changes before Canvas's available-until deadline.

The available-until date determines the default-branch code and final writeup version used for grading.

## 11. Final Acceptance Criteria

A project is ready for submission when the following conditions are satisfied:

- [ ] A clearly defined user and complete core workflow exist.
- [ ] The core workflow runs from a reproducible initial state.
- [ ] The system produces an observable, meaningful result.
- [ ] At least one test can identify a plausible implementation defect.
- [ ] At least one expected result is established independently.
- [ ] A meaningful edge case or failure is demonstrated.
- [ ] A specific system limitation is documented.
- [ ] Two consequential design or evaluation decisions are explained with evidence.
- [ ] One debugging story includes a cause, correction, and verification.
- [ ] Reused work, student contributions, and AI-agent assistance are attributed.
- [ ] Setup and test instructions work from a clean checkout.
- [ ] The repository is accessible to course staff.
- [ ] The final slide deck and repository URL are submitted.
- [ ] A demonstration slot has been scheduled.

**Guiding principle:** The project should demonstrate one complete, meaningful capability with strong, reproducible evidence. Additional features are secondary to correctness, validation, and the students' ability to explain and defend their work.
