**CHANGES_REQUIRED — Standards/security**

**P2 — Quarantined receipts can starve transport recovery.** At [handlers.ts:39](/home/serveradmin/insignia-m5-uninstall-authority-quarantine-worktree/apps/worker/src/handlers.ts:39), successful quarantine leaves the inbox pending. Recovery at line 60 repeatedly selects the oldest 100 pending receipts using [shopify-webhooks.ts:446](/home/serveradmin/insignia-m5-uninstall-authority-quarantine-worktree/packages/database/src/repositories/shopify-webhooks.ts:446), including receipts whose queue jobs already completed.

Concrete counterexample: 100 older quarantined receipts have completed jobs and valid seven-day payload deadlines. Receipt 101 commits, then ingress dies before enqueue. Every recovery cycle rechecks the same completed jobs; receipt 101 receives no recovery attempt until older receipts expire. Captured-body submissions with new unsigned delivery IDs can fill this batch across tenants.

This breaks the slice’s requirement to preserve queue-handoff recovery and plan §11’s durable recovery contract. Smallest fix: make bounded recovery advance fairly across eligible receipts, independently of business completion. Preserve pending quarantine, deadlines, exhaustion and one-shot send reservations. Add a real PostgreSQL/queue control with 100 settled quarantines preceding a committed receipt without a job.

Verified refs:

- Base/effective merge-base: `5ce5911d124bf2727e8e5d390f53086d6e578d78`
- HEAD: `72a83a716cadb3fc351528f0468b3b29c422d02b`
- Tree: `91d2d544670fa7724abd38368a9db12bbeee8848`

Worktree clean; requested three-dot diff and commit log inspected. Manifest hashes and both historical document archives match. Cached `origin/main` equals base; no remote freshness claim.

Static local review only: no edits, project execution, tests, builds, services, network, private captures or delegation. Parent-run results and native facts are not independently attested. Actual model/effort needs parent verification; credential/network isolation is not established.

After correction, both fresh reviews and natural exact-head attempt-1 CI remain required. No native, deployment or milestone verdict is granted.