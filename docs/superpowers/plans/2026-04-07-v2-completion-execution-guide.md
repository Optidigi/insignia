# V2 Completion — Execution Guide

> **STATUS: REFERENCE.** Methodology for executing the gap closure plan. The methodology spec it referenced has been consolidated.
>
> Use the three-subagent loop (research → implement → verify) for each task in the gap closure plan.
>
> **Task source:** `docs/superpowers/plans/2026-04-07-v2-completion.md` — 46 tasks, 11 phases.
>
> **Gap source (reviewer context):** `memory/gap_report_definitive.md` + `memory/project_dashboard_backlog.md`

**Goal:** Execute all 46 tasks in `2026-04-07-v2-completion.md` using a fool-proof three-subagent loop that prevents the V2 failure mode: tasks marked done because code exists, not because the design is matched.

**Architecture:** Fresh subagent per task (implementer) → independent design-anchored spec reviewer → independent code quality reviewer → phase gate before next phase → final integration review → branch completion.

**Tech Stack:** React Router 7 + Polaris v13 + Prisma + PostgreSQL + Shopify Admin GraphQL 2026-04 + Konva + R2 + TypeScript strict

---

## Pre-Flight Setup

### Step 1: Read the methodology spec

Before touching any code, read `docs/superpowers/specs/2026-04-07-v2-completion-execution-methodology.md` in full. Understand the root cause of V2's failure and why every element of this guide exists.

### Step 2: Create isolated worktree

Use `superpowers:using-git-worktrees` to create an isolated workspace:

```bash
git worktree add ../insignia-v2-completion -b feat/v2-completion
cd ../insignia-v2-completion
npm install
```

All 46 tasks commit to `feat/v2-completion`. Main branch is not touched until `finishing-a-development-branch`.

### Step 3: Verify baseline

Before any changes:

```bash
npm run typecheck    # must pass (note any pre-existing errors — these are baseline, not regressions)
npm run lint         # must pass
npm run build        # must pass
```

Record any pre-existing errors. New errors introduced by any task are regressions — must be fixed before that task is marked done.

### Step 4: Create TodoWrite with all 46 tasks

Extract every task header from `2026-04-07-v2-completion.md` into a TodoWrite list before starting. This is your progress tracker throughout execution.

---

## The Three-Subagent Loop (apply to EVERY task)

Do not deviate from this. "Simple" tasks are where laziness entered in V2.

```
[1] IMPLEMENTER SUBAGENT
[2] SPEC-COMPLIANCE REVIEWER SUBAGENT  ← must see design context, not just task text
[3] CODE-QUALITY REVIEWER SUBAGENT
```

### Constructing the Implementer Prompt

Brief the implementer with all of the following — do not make them read the plan file themselves:

```
You are implementing [Task X.X: Title] for the Insignia Shopify app.

CONTEXT — Why this task exists:
[Paste the gap description verbatim from memory/gap_report_definitive.md or 
memory/project_dashboard_backlog.md for this specific gap]

TASK STEPS:
[Paste the full task checklist from 2026-04-07-v2-completion.md]

PROOF OF COMPLETION REQUIRED:
[Paste the relevant row from the proof requirements table in the methodology spec]

RULES:
- Ask all questions BEFORE writing any code. Do not make assumptions.
- Read actual files before editing them — never assume what they contain.
- After implementing, run the verification command and paste the full output.
- Self-review: re-read the gap description. Does your implementation close it?
- Commit with: git add <specific files> && git commit -m "fix: [description]"
- Report status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED

CODEBASE RULES (from CLAUDE.md):
- Admin routes (app.*): Polaris components only — no custom HTML for things Polaris provides
- Shopify GraphQL: always validate against shopify-dev-mcp before writing queries
- Screenshots: JPG format only
- npm run typecheck && npm run lint must pass after your changes
```

### Constructing the Spec-Compliance Reviewer Prompt

This is the key innovation. The reviewer sees design intent, not just task text.

```
You are a SPEC-COMPLIANCE REVIEWER for the Insignia Shopify app.

YOUR ONLY JOB: Confirm that the implementation matches the DESIGN INTENT of the gap 
it was meant to close. Not "does code exist" — "does the code do what the design required."

GAP THAT WAS BEING CLOSED:
[Paste the gap description verbatim — the specific user-visible behaviour that was 
wrong or missing]

DESIGN INTENT:
[Describe what the .pen design screen shows for this feature — labels, buttons, 
wording, layout, behaviour. For backend tasks: describe the contract from the docs.]

TASK THAT WAS IMPLEMENTED:
[Paste the full task checklist]

PROOF SUBMITTED BY IMPLEMENTER:
[Paste the implementer's verification output — screenshot path, typecheck output, 
grep results, curl response, etc.]

GIT DIFF TO REVIEW:
[Paste: git diff HEAD~1..HEAD or the relevant commits]

YOUR CHECKLIST (complete every item):
1. Read the actual changed files using file reading tools — do not trust the diff summary
2. For UI tasks: does the screenshot show the correct labels/layout matching design intent?
3. For label sweeps: run the grep yourself fresh and confirm zero occurrences remain
4. For backend tasks: does the implementation match the contract specified in gap description?
5. For typecheck/lint: is the output exit 0? Count errors yourself — do not trust "it passed"
6. Does the implementation do EXACTLY what was asked — no more, no less?

REPORT FORMAT:
✅ COMPLIANT — [brief reason, pointing to specific evidence]
OR
❌ GAPS — [specific file:line for each gap, what was expected vs what was found]

ANTI-CORNER-CUTTING RULE: If the gap said "no pagination" and the implementation 
added a Pagination component import but did not wire prev/next to URL params — that 
is a GAP. Code existing ≠ feature working.
```

### Constructing the Code-Quality Reviewer Prompt

Standard code quality review — use the template from `superpowers:requesting-code-review`. Brief additions:

```
You are a CODE-QUALITY REVIEWER for the Insignia Shopify app.

SPEC COMPLIANCE: Already confirmed ✅ by a separate reviewer. Your job is code quality only.

CODEBASE CONVENTIONS (from CLAUDE.md):
- Admin routes: Polaris components — no custom HTML/CSS for things Polaris provides
- Storefront routes: custom CSS/components, NO Polaris
- *.server.ts = server-only, *.client.ts = browser-only
- Zod for runtime validation at system boundaries
- AppError from lib/errors.server.ts for backend errors
- Shopify mutations must check userErrors
- Fee products must always be UNLISTED status

GIT DIFF TO REVIEW:
[Paste the diff]

REPORT FORMAT:
✅ APPROVED — [brief summary]
OR  
❌ ISSUES — [severity: Critical/Important/Minor] [file:line] [what's wrong] [how to fix]

Only report Critical and Important issues. Minor issues are informational — implementer 
may fix at discretion.
```

---

## Phase Gate Protocol

After all tasks within a phase complete (all three subagents passed), run a phase gate before starting the next phase.

### Phase Gate Reviewer Prompt

```
You are a PHASE GATE REVIEWER for the Insignia Shopify app V2 completion project.

COMPLETED PHASE: Phase [N] — [Phase Name]
NEXT PHASE: Phase [N+1] — [Phase Name]

DEPENDENCY NOTE (from 2026-04-07-v2-completion.md):
[Paste the phase dependency description — what Phase N+1 depends on Phase N having built]

TASKS COMPLETED IN THIS PHASE:
[List each task, its gap description, and a one-line summary of what was implemented]

GIT LOG FOR THIS PHASE:
[Paste: git log --oneline since phase start]

YOUR JOB:
1. Does each task's implementation actually deliver what Phase N+1 depends on?
2. Do the tasks in this phase work TOGETHER — or did each pass individually but 
   fail to integrate?
3. Are there any edge cases or integration gaps that no individual task covered?

REPORT FORMAT:
✅ PHASE GATE PASSED — safe to start Phase [N+1]
OR
❌ GAPS IDENTIFIED — [specific description of each gap, which tasks are affected]
   These become new tasks inserted at the start of Phase [N+1].

DO NOT FIX — identify only. Fixes become new tasks.
```

---

## Phase-by-Phase Execution

Execute phases sequentially. Do not start Phase N+1 until Phase N gate passes.

### Phase 0: Schema — Production Workflow State
**Tasks:** 0.1 (add productionStatus enum + field + migration)
**Phase gate dependency for Phase 1:** The DB migration has run and `productionStatus` field exists. No route files need to be read for this gate — just confirm `npx prisma validate` passes and the migration file exists in `prisma/migrations/`.

### Phase 1: Quick Wins — Labels, Bugs, CORS
**Tasks:** 1.1 (terminology sweep), 1.2 (resource picker filter), 1.3 (methods optimistic UI), 1.4 (CORS fix), 1.5 (delete test endpoint), 1.6 (attach-artwork per-placement), 1.7 (CORS strict allowlist)
**Phase gate dependency for Phase 2:** All user-facing "Configuration" strings are gone (verify with grep). The test endpoint is deleted. typecheck + lint pass.
**Note for 1.1:** This is the task V2 marked done and never actually did. The spec reviewer MUST run `grep -rn "onfiguration" app/routes/ app/components/` fresh and confirm zero user-facing occurrences. Do not trust the implementer's grep.

### Phase 2: Methods Detail Simplification
**Tasks:** 2.1, 2.2
**Phase gate dependency for Phase 3:** Storefront `/config` endpoint still returns method descriptions (verify with curl). Methods form shows 2+1 fields only (screenshot).

### Phase 3: Products — Create Modal + Duplicate + Add View UX
**Tasks:** 3.1, 3.2, 3.3, 3.4
**Phase gate dependency for Phase 4:** A merchant can complete the full "create product setup" flow (multi-step modal → duplicate → add view with custom name) end-to-end in the dev server. Playwright walkthrough required.

### Phase 4: Orders List — Search, Filter, Export, Pagination
**Tasks:** 4.1, 4.2, 4.3
**Phase gate dependency for Phase 5:** Orders list correctly pages (page=2 returns different results than page=1 with 25+ orders in test data). Export CSV returns a valid CSV file with correct headers.

### Phase 5: Orders Detail — Full Production View
**Tasks:** 5.1 (workflow DB), 5.2 (customer info), 5.3 (artwork metadata), 5.4 (Konva canvas), 5.5 (reminder + template)
**Phase gate dependency for Phase 6:** "Mark in production" button advances productionStatus in DB (verify with Prisma Studio or direct DB query). Customer section renders. Download link works.
**Note for 5.1:** Requires Phase 0 (productionStatus field). Confirm migration ran before starting.

### Phase 6: Dashboard — Activity Tab + Analytics + Export + Preview
**Tasks:** 6.1, 6.2, 6.3
**Phase gate dependency for Phase 7:** Dashboard shows real numbers (not zeroes or placeholders) from test data. Activity tab shows events. Analytics shows method breakdown.

### Phase 7: Settings — Translations Tab + i18n Expansion
**Tasks:** 7.1, 7.2, 7.3
**Phase gate dependency for Phase 8:** Translations tab renders. Saving a translation writes to DB (verify with Prisma query). Storefront modal uses the saved override (verify with curl to `/config`).

### Phase 8: View Editor — Quick Start Presets
**Tasks:** 8.1
**Phase gate dependency for Phase 9:** Clicking "Left Chest" preset adds a placement zone with correct geometry to the view editor canvas (screenshot required).

### Phase 9: Image Manager — Import from Shopify
**Tasks:** 9.1
**Phase gate dependency for Phase 10:** Import button appears when Shopify images exist. Clicking it adds images to the tray (screenshot).

### Phase 10: Customer Upload Page
**Tasks:** 10.1
**Phase gate dependency for Phase 11:** GET request to the customer upload URL renders the upload form. POST request with a test file creates a LogoAsset and updates artworkStatus. Copy-link button in order detail produces a valid signed URL.

### Phase 11: Remaining Partial Completions
**Tasks:** 11.1 (last-tier guard), 11.2 (image tray pagination), 11.3 (undo/redo + nudge), 11.4 (rate limiting)
**No further phase gate — proceed to final integration review.**

---

## Final Integration Review

After all 46 tasks complete all three-subagent loops and all phase gates pass:

### Final Integration Reviewer Prompt

```
You are the FINAL INTEGRATION REVIEWER for the Insignia V2 Completion project.

YOUR JOB: Confirm every gap in the definitive gap report is closed. This is a 
line-by-line checklist — not a "tests pass" check.

GAP REPORT TO CHECK AGAINST:
[Paste the full contents of memory/gap_report_definitive.md]

FOR EACH GAP IN THE REPORT:
1. Find the task that was meant to close it (cross-reference 2026-04-07-v2-completion.md)
2. Confirm that task completed the three-subagent loop (all ✅)
3. Spot-check: read the actual file that was changed and confirm the gap is gone

ALSO VERIFY:
- npm run typecheck: run it and paste the full output
- npm run lint: run it and paste the full output  
- npm run build: run it and paste the full output
- All three must exit 0

REPORT FORMAT:
For each gap: [Gap description] → [Task that closed it] → [File:line evidence] → ✅ CLOSED / ❌ STILL OPEN

Final verdict:
✅ ALL GAPS CLOSED — safe to run finishing-a-development-branch
OR
❌ OPEN GAPS — [list] — these become new tasks before branch completion
```

---

## Branch Completion

Once the final integration reviewer gives ✅:

Use `superpowers:finishing-a-development-branch`.

The skill will:
1. Run the test suite
2. Present four options: merge locally / create PR / keep as-is / discard
3. Clean up the worktree

Recommended choice: **Option 2 (Create PR)** — so the changes can be reviewed as a whole before merging to main.

---

## If a Task Gets BLOCKED

Never force the same subagent to retry without changes. Handle by severity:

| Blocker type | Response |
|---|---|
| Missing context | Provide the specific context and re-dispatch implementer |
| Task too large | Split into two tasks, insert both into TodoWrite |
| Plan is wrong | Escalate to human — do not guess |
| Tech constraint (library missing, API changed) | Research the constraint, update the task text, re-dispatch |
| Reviewer found issue implementer can't fix | Escalate to human with specific file:line and description |

---

## Common Failure Patterns to Watch For

These are the specific patterns that caused V2's gaps. If you see any of these, stop and fix:

1. **Implementer says "I changed the label" without showing grep output proving old string is gone** — demand the grep before passing to spec reviewer.

2. **Spec reviewer says "looks compliant" without having read the actual file** — demand file reading tool output before accepting ✅.

3. **Task involves a UI component and no screenshot is provided** — no screenshot = no spec compliance pass, regardless of how confident the implementer sounds.

4. **The task checklist is complete but the gap description behaviour is still wrong** — the spec reviewer must re-read the gap description, not just tick checklist items.

5. **"TypeScript passes" claimed without pasting the command output** — the verification-before-completion rule applies. No output = no claim.

6. **Phase gate skipped because "all tasks look good"** — phase gates are mandatory. Run them.

7. **Two tasks in the same phase both touch the same file and the second one reverts the first** — check for this in phase gates by reading the final state of shared files.
