---
name: architect
description: "Planning and delegation logic for the architect agent. Loaded at the start of every /build session."
---

## Planning format

Every plan written to `plan.md` must follow this structure:

```
# Plan: <task title>

## Context
<1-2 sentences on what this achieves and why>

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Steps
1. [researcher] Explore <specific files or patterns>
2. [implementer] <specific change in specific file>
3. [tester] Run incremental suite
4. [reviewer] Review <specific files>
5. ...

## Risk assessment
- Risk: <X> | Mitigation: <Y>
```

## Complexity thresholds

| Signal | Classification | Action |
|---|---|---|
| 1-2 files, no new abstractions | Small | Skip planning, dispatch directly |
| New module, API, or feature | Medium | Write plan, dispatch sequentially |
| New service, schema change, cross-cutting refactor | Large | Escalate to opus-decision first |
| Security change, auth, payments, data migration | High-risk | Always escalate regardless of size |

## Plugin integration

Check for installed plugins by looking for their config files or commands:
- Superpowers: check for `.superpowers/` dir or `sp:` commands in PATH
- Context7: check MCP config for `context7` server
- Sequential Thinking: check MCP config for `sequential-thinking` server
- Language servers: check `package.json` devDependencies or pyproject.toml

If Superpowers is installed:
- Replace the planning step with `/sp:plan`
- Replace TDD steps with `/sp:tdd`
- Replace the debugging loop with `/sp:debug`
- Keep native skills for project-specific conventions

## Pre-flight checks

Before writing `plan.md`, verify:

```bash
[ -f scripts/test-changed.sh ] && [ -f scripts/test-all.sh ]
```

If either script is missing, run `/init` first. Do not proceed with the build
until both scripts exist — incremental testing is required for every step.

## Handoff budget

When spawning a sub-agent via `Task`, keep the handoff message under 300 tokens.
Include: current plan step, relevant file paths, and any constraints.
Do not include: full file contents, raw test output, or unrelated context.

## Loop termination

A step is complete when:
1. `tester` returns all-green on the incremental suite, AND
2. `reviewer` returns LGTM or only SUGGESTIONs.

A build is complete when all steps are complete AND:
1. `tester` returns all-green on the full suite, AND
2. `reviewer` returns LGTM on the complete diff.

## Reviewer dispatch threshold

Before dispatching `reviewer` after a step, check the diff size:

```bash
git diff --shortstat HEAD
```

- If changed lines < 20 AND no files touch security-sensitive paths
  (`auth/`, `payments/`, `middleware/`, `migrations/`, `*.env`) →
  **skip reviewer** for this step. Mark complete on tester green alone.
- Otherwise → dispatch reviewer as normal.

Security-sensitive paths always trigger reviewer regardless of diff size.

## Context checkpointing

After every 4 completed steps, write a checkpoint to `plan-progress.md`:

```
# Progress checkpoint — Step N of M

## Completed steps
- Step 1: [implementer] <what changed> — DONE
- Step 2: [implementer] <what changed> — DONE
...

## Remaining steps
- Step 5: ...

## Key decisions made
- <any architectural choices locked in during this build>

## Files modified so far
- src/auth/session.ts, prisma/schema.prisma, ...
```

After writing, treat `plan-progress.md` as the authoritative context summary
for the remaining steps. Handoffs after a checkpoint reference
`plan-progress.md` instead of reconstructing state from memory.

## Opus hand-back protocol

When `opus-decision` returns a decision document, the architect MUST:
1. Parse the "Implementation sequence" section from the document.
2. Insert those steps into `plan.md` at the current position, replacing
   any placeholder steps, preserving existing step numbering.
3. Append a one-line decision summary to the `## Risk assessment` section.
4. Resume the build loop from the next unstarted step — do not wait for
   user input unless the document contains an explicit "requires human
   decision" flag.
