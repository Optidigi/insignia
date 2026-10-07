No unresolved **material** finding at the pinned HEAD. One nonblocking test cleanup remains.

## Standards

**P3 — copied, unreachable fixture logic** at [availability-hold-v3.test.ts:98](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/test/availability-hold-v3.test.ts:98).

The ACK schedule injection duplicates the lifecycle helper, but this test declares `writes` as a number and has no `options` or `other` binding. Consequently, `writes.length === 1/2/3` is always false and the injected branch never runs; short-circuiting hides the undeclared references.

This is a **Duplicated Code judgment call**, under the pinned skill’s “same logic shape appears in more than one hunk or file” heuristic, rather than a material contract violation. Remove the copied spread from this diagnostic timestamp test. Preserve its assertions and the separate acquire/restore/compensation ACK schedule regressions.

## Spec

**No unresolved material finding.** Full-source inspection supports the four round-one corrections and related identity/grant poisoning correction:

- Web activation integrations now supply v3 evidence.
- ACK schedules block success while settled audit evidence remains preservable.
- Native dispatch rechecks freshness and request/mode deadlines after gate, accounting and fsync work.
- Conservative pre-request wall and private monotonic origins prevent stale authority renewal.
- Reported identity/grant contradictions poison subsequent requests despite malformed projections or HTTP/error envelopes.

I also inspected direct anchor inclusion, acquire/observe/restore, one-shot compensation, crash/replay claims, SQL audit immutability, trusted recovery, tenant fences, budgets, fresh-process resume, cleanup authority and transport escape guards. Historical v1/v2 contract/adapter/migration files and M5-016 operator files have no diff against BASE; recovery retains explicit version dispatch.

## Inspection and execution

Inspected the required authority documents, historical reports, complete changed implementation/migration/test/harness source, relevant interaction source, original review reports/settings, encoded red receipts and neutral failure/green logs.

Executed only local read-only file and Git inspection. **No tests, builds, mutations, credentials, network/provider/browser operations or delegation.**

Fixed comparison:

```text
git diff 4bba14fb4415815557ffa5f1e600427a62128489...2dde06d0f553508346153ebbcb8139937cc74e6f
```

Verified HEAD/tree match the supplied refs and the working tree is clean. Actual subjects:

- `12c422b feat(m5-017): version availability holds with direct effective anchors and one-shot rehold`
- `2dde06d fix(m5-017): close review findings before live source freeze`

The original reds, first root-check failure and original runtime CI failure remain failures. Inspected green logs report harness23, adapters208, focused SQL2 and web integrations2 passing; these are supplied execution evidence, not checks I executed or live qualification.

Exact-head checks/CI remain pending under the supplied checkpoint. Source/build are not frozen. Live is **NOT_RUN**, and the canonical run directory is absent. Principal approval remains external and ungranted.

**Totals: Standards—1 P3, nonblocking; Spec—0 material findings.**