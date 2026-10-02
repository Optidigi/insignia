**Verdict: no unresolved material finding.** One nonblocking documentation issue remains.

Reviewed `Optidigi/insignia` at:

- Base/effective merge base: `25e6c487741e1685637d351137d9671033f3c53d`
- Head: `d0544cd8f2e72b5bb79410057121cd455db92f1a`
- Tree: `05d58d32f8dd0d2e7ae7fd8c7412642546c3e946`

Read-only Git inspection confirmed the PR39 merge’s ordered parents and reviewed tree. The checkout remained clean at the requested head throughout.

**Spec/correctness assessment**

| Requirement | Source assessment |
|---|---|
| Fresh profile | Fixed canonical directory and app/client/shop/domain/installation/development identity; exactly the three required capabilities, with additional well-formed grants permitted and retained. |
| Predecessor resolution | Fixed original marker/start; retained ownership predicate and publication fields; complete pagination required. Absence permits continuation. One owned, unpublished predecessor requires archived readback before creation. Ambiguity and malformed/error responses stop. |
| Archival restriction | One status-only archival attempt, separately budgeted. ACK alone cannot enable creation; exact owned/unpublished ARCHIVED readback is required. |
| Reservation/failure behavior | Actual HTTP serialized; reservations persisted before dispatch. Predecessor archival freshness is checked again after reservation; expiry records `NOT_SENT`. Unknown writes prevent subsequent writes and finalization. |
| Durable recovery | Predecessor state is derived again from retained events when reopening; substituted request digests and forged resolution are refused. |
| Offline gate | Binds source, tree, fixed base, operator/source/build hashes, offline receipt, two distinct review sessions/settings, and ten exact-head CI results. Credential loading follows gate verification and register checks. |
| Native release/consent | Separate one-use release/request/approval history, ordered dependencies, and ambiguity stops. Sole-operator plan specifies unchanged configuration except the two optional reads and requests only those two new scopes. |
| Fixture/matrix/finalization | One unique DRAFT fixture after predecessor resolution; unchanged real production-adapter matrix, persisted/reloaded holds, UNLISTED catalog behavior, drift conflict without overwrite, and settled owned/unpublished archival finalization. |
| Scope/handback | Production packages and historical M5-004/M5-009 evidence have no diff. Live receipts and completed-change review/CI remain pending, explicitly `NOT_RUN`; no activation, RELEASE_BOUND, successor, or launch authority is claimed. |

The public qualification tests exercise `qualifySynthetic`, the real shared operator, and built availability/catalog adapters with synthetic fetch at the external HTTP boundary. Their literal behavioral expectations cover successful recovery, recovery failures, budgets, serialization, unknown writes, hold reloads, and drift refusal.

**Nonblocking finding — P3:** [state.md:83](/home/serveradmin/insignia-m5-010-worktree/docs/delivery/state.md:83) still names M5-009 in “Next review,” while the current row and AGENTS name M5-010. Reproduce by reading that row. Update it during the authorized delivery-state handback; it does not weaken the executable gate. No blocking standards violation or material scope creep found.

**Actual reading inventory**

- Complete AGENTS, decision ledger, delivery state, operating model, M5-010 prompt/research/report, PR-039 review, issue-tracker mapping, and all three M5-010 evidence JSON files.
- Relevant implementation-plan publication, availability, atomicity, failure, gate, release, and M5 sections.
- Complete pinned code-review, TDD, tests, mocking, diagnosing-bugs, writing-for-agents, and handoff skills.
- Complete every file in `scripts/m5-004`, `scripts/m5-009`, and `scripts/m5-010`, including tests.
- Complete changed workflow and root `package.json`.
- Complete Shopify availability/catalog adapters and Admin deadline helper; application availability, activation, and recovery seams; catalog and application recovery tests.
- Assigned native operator plan; relevant root-green log excerpts; retained public M5-009 register. Also inspected tooling-register guidance and review-packet template.

**Executed versus inspected:** I executed only local read-only inspection commands, including the requested three-dot diff, log, status, and ref checks. I ran no tests. The root log shows the normal 136/136 operator run; offline-progress records 100/100 stress with no retries and the passed renderer negative control, plus the disclosed writer stdio adaptation. These are inspected evidence, not reviewer-executed results.

Launch instructions expose read-only filesystem controls, restricted network, and approval policy `never`. This session does not expose trusted effective model/effort metadata to me; `gpt-6.1-sol/high` requires the coordinator’s same-launch settings attestation.

No credential-file metadata/content reads, provider/browser/network/auth calls, edits, or subagents occurred. This report grants no principal approval or live qualification result.