# Project skills and task references

Select project skills under `.agents/skills` explicitly when account skills have the same name. Load only the skill and reference needed for the current task. The [operating model](../../docs/delivery/operating-model.md) owns priorities, workflow, UI state guidance and resource permissions; skill recipes adapt to it.

## Select a skill

| Task | Guidance |
| --- | --- |
| Reproduce a bug or regression | [diagnosing-bugs](diagnosing-bugs/SKILL.md) |
| Implement or change behavior | [tdd](tdd/SKILL.md), at the smallest meaningful public seam |
| Review an implementation | [code-review](code-review/SKILL.md), with scope/depth proportional to impact |
| Edit agent instructions | [writing-for-agents](writing-for-agents/SKILL.md) |
| Build or substantially refine a screen | [Insignia UI delivery](../../frontend/skills/insignia-ui-delivery/SKILL.md); keep isolated fixes proportionate |
| Review storefront-language wording | [Insignia translation review](../../frontend/skills/insignia-translation-review/SKILL.md) |

Apply the operating model's KISS/DRY rules during ordinary work. Add other skills only when their technique is needed; generic lifecycle lists are not a mandatory sequence. Planning interviews, architecture redesign, security audits and repeated independent reviews need a task-specific reason.

## Load references by affected boundary

- Setup/build commands and toolchain pins: [README](../../README.md) and actual package scripts.
- Selected UI ownership: [frontend guide](../../frontend/README.md). Integration, theme placement, frame lifecycle or native UI quirks: [UI reference](PROJECT-UI.md).
- Server concurrency, publication recovery, artwork inspection or release collection: [runtime reference](PROJECT-RUNTIME.md).
- CI routing, browser/database test setup, boundary probes or native release staging: [qualification reference](PROJECT-QUALIFICATION.md).
- Delivery-state edits: run `node --test scripts/ci/status-docs.test.mts`; its bounded link policy is described in the qualification reference.

Read the relevant paragraphs, not every reference. Check current code/tests when a retained incident lesson may be stale.

## Provenance

Matt Pocock's MIT-licensed source was inspected at commit c55ee46073ed923f86ce59a5eb3b6d895095d1b7. Retained support files and [license](LICENSE.mattpocock) preserve provenance. Earlier project adaptations remain in Git history. No skill expands native permissions.
