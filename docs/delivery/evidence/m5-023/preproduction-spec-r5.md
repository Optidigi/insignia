CHANGES_REQUESTED

Bound to PR54 head `95517ae89702f41cf7f273ca56ab6e70522f502d`.

**P1 — Deployment can invalidate the qualified uninstall prerequisite.** [host-operator.py:78](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/host-operator.py:78) checks the resolved image, origin and router, but leaves the candidate `DATABASE_URL` and webhook secret unbound. Lifecycle qualification inspects the currently running container; deployment subsequently consumes the on-disk `runtime.env`.

Concrete counterexample: `runtime.env` points to another database while the running web and worker retain the qualified database URL. Lifecycle passes, provisioning proceeds, and Compose deploys the candidate because its four checked fields match. `/live` returns 200 independently of database readiness, so deployment can settle successfully while new install/uninstall records target a database the qualified worker never consumes. This violates the required same-durable-database ingress prerequisite and unchanged deployment configuration.

Smallest correction: privately qualify the resolved candidate database role/route and webhook configuration **before backup/provisioning**, bind the effective configuration digest to the prerequisite receipt, and reject drift before `up`. Add a negative control changing only `DATABASE_URL` or webhook secret while the existing four checks remain valid; assert zero mutations.

Static coverage included full interacting tenant/transaction/migration, authentication/SDK/HTTP, uninstall/credential/M3 consumers, readiness/trusted-release, historical v1/v2/v3 activation/recovery, packaging and operator paths, including prior host references and test assertions. I assessed both preserved reports/settings from every earlier round, their responses and the reproduced unique-wait objection; the described prior corrections are supported by current source.

Parent execution evidence—86 web tests, PG197, concurrency, signed SDK/HTTP, runtime, filesystem and privilege controls—is supplied evidence, distinct from my Git/file-only inspection. I ran no tests, builds or project code.

Exact-head CI remains pending; live processor qualification and readiness remain unproven. This grants neither principal approval nor production readiness.