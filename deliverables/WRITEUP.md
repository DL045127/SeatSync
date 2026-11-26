# Final Project — Writeup

**GroupRide is a solo project by Derick Lee (UT EID `dl37642`).** The [completed six-slide PDF](final-project-writeup.pdf) includes this credit and describes the student and agent contributions. Review the exported slides before submitting.

Submit a short slide deck as a **PDF** to the Canvas **Writeup** assignment. Use the same slides to support the [live demo](DEMO-AND-CODE.md). For a pair, one partner submits and both names appear on the slides. The deck is the writeup. There is no separate written or Markdown report to submit.

## Prepare the slides

- [ ] Read the **Final project guide** under **Slide decks organized by topic** in the Homework section of the course site.
- [ ] Sign in to Google and make your own copy of the Google Slides template. You can preview it first. Share your copy with your partner if applicable.
- [ ] Replace the prompts with your own project evidence. The template suggests six slides. You can use your own layout, combine slides, or add slides when that makes the explanation clearer.

| Suggested topic | Include |
|---|---|
| **1. What you built** | Project title, team names and UT EIDs, repository URL, and the exact commit the slides describe. Explain who the software is for, why you built it, and what the demo will show. |
| **2. What you contributed** | Name the starting commit, including any code you wrote before the project. Link starting code and libraries with their versions or commits. Explain the main components, what you reused, what you added or changed, each partner’s role, joint work, and agent assistance. Show a case the starting point gets wrong or cannot handle and a check that fails there and passes on your version. |
| **3. Decision 1** | Explain the design or evaluation choice, an alternative, and the evidence for the choice. Include what you asked an agent to change where relevant, what you checked, the actual result, and what you did next. Link the code or evidence. |
| **4. Decision 2** | Explain another consequential choice using the same structure. The two decisions can be design choices, evaluation choices, or one of each. Evaluation choices can concern cases, comparisons, or measurements that test a claim. A performance benchmark is optional. |
| **5. Debugging story** | Describe a real symptom, how you narrowed down the cause, what changed, how you checked the fix, and what happened. Explain the agent’s role where relevant. For an unresolved bug, distinguish established facts from suspicions and name the next diagnostic check. Combine this with a decision slide if both describe the same episode. |
| **6. What remains** | Name a specific limitation or unsupported case, explain what your checks do not establish, and say what you would try next. |

## Verify the PDF and evidence

- [ ] Use short text, figures, or actual output and link to repository evidence. Put important claims and results in the PDF itself so they are visible without speaker notes.
- [ ] Check that **every cited or linked file is committed at the revision named in the slides**. Include the script behind each number and the log or output shown. A local-only file or an untracked file under an ignored directory is unavailable to the grader.
- [ ] For a large generated artifact, commit the generator and give the exact rebuild command and seed.
- [ ] Run `git ls-files --error-unmatch -- PATH` for each cited repository path. This checks the current index. To also verify the cited commit, run `git cat-file -e COMMIT:PATH` with the commit and repository-relative path from the slides.
- [ ] Keep setup and demo/check commands in the [repository README](../README.md).
- [ ] Download the completed slides as a PDF. Read the exported PDF, check that its links resolve to the evidence, and take responsibility for every claim.

## Submit and present

- [ ] Upload the PDF to **Writeup** by the Canvas due date shared with **Demo & Code**. The repository URL goes to Demo & Code.
- [ ] Check the Canvas **available until** date. You may resubmit the PDF until that edit close, including to add a result or clarification requested during the demo. The last PDF submitted by then is graded.
- [ ] Center the demo on the working software. Use the slides to introduce it, explain decisions, and answer questions. Slide order is flexible.

The grading criteria exclude visual polish, line counts, token counts, and human-versus-agent percentages.
