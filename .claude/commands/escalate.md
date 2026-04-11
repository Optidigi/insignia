---
name: escalate
description: "Manually invoke opus-decision for a specific architectural, debugging, or migration decision. Use when the architect's autonomous escalation has not fired but you know Opus is needed."
arguments:
  type:
    description: "Decision type."
    enum:
      - architecture
      - debug
      - migration
      - audit
  context: "Concise summary of the problem and what has already been attempted. Keep under 500 tokens."
---

Before invoking, confirm:
- [ ] The problem has been attempted with Sonnet-tier agents.
- [ ] The context summary is concise and includes relevant file paths.
- [ ] The decision type is correctly classified.

Invoke `opus-decision` with:
- Type: $type
- Context: $context

After receiving the decision document, the architect MUST act automatically:

**For `architecture` or `migration`:**
1. Parse the "Implementation sequence" section from the decision document.
2. Insert those steps into `plan.md` at the current position, replacing any
   placeholder steps. Preserve existing step numbering.
3. Append a one-line summary of the decision to the `## Risk assessment` section.
4. Resume the build loop from the next unstarted step — do not surface the
   opus output to the user unless the document contains an explicit
   "requires human decision" flag.

**For `debug`:**
1. Extract the proposed fix (file, line, change) from the diagnosis.
2. Pass it directly to `implementer` as the next step.
3. Invoke `tester` after the fix is applied.

**For `audit`:**
1. List all BLOCKERs found.
2. Create a plan step for each BLOCKER, assigned to `implementer`.
3. Do not proceed past the audit step until all BLOCKERs are resolved.

Escalate sparingly. Each Opus invocation costs roughly 10-20× a Sonnet call.
