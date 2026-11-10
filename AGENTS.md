# Working on Insignia

Start with the [active assignment](docs/delivery/state.md#active-assignment), not the delivery history. Verify checkout, branch, HEAD and dirty changes; preserve existing work. Use [README](README.md) for setup and package scripts for executable commands.

Inspect the affected code, tests and running behavior to establish what exists. The [specification](docs/architecture/implementation-plan.md) owns intended product behavior; read only affected sections. Report discrepancies rather than treating a bug as the intended contract.

## Read by task

- Engineering priorities, workflow or external effects: [operating model](docs/delivery/operating-model.md).
- UI: [frontend ownership map](frontend/README.md) and [UI state guidance](docs/delivery/operating-model.md#ui-state-and-effects).
- Signed cart authorization: [exact wire contract](docs/architecture/CART-LINE-V3.md).
- Diagnosis, tests, review or instruction edits: [project skill selection](.agents/skills/PROJECT-ADAPTATIONS.md); load only applicable skills and references.

Keep current status in the assignment document, workflow in the operating model and requirements in the specification. Historical evidence is consulted for a specific question, not replayed as session instructions. Resource permissions and protected installations remain in the operating model.
