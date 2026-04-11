---
name: platform-change
description: "For infrastructure, Docker, CI/CD, and database migration changes. Enforces a review-heavy, staged process."
arguments:
  description: "Summary of the infrastructure or migration change."
---

Load the `infra` skill before proceeding.

1. **Research** — Spawn `researcher` to examine existing infra files and
   summarise current state (Terraform, Docker, CI config, schema).

2. **Assess** — Does this change span multiple services, involve schema
   migrations, or affect production deployment? If yes, escalate to
   `opus-decision` for the migration/architecture plan before proceeding.

3. **Plan** — Write a step-by-step change plan. For schema migrations,
   include rollback steps explicitly.

4. **Implement** — Spawn `implementer`. The `pre-write-risky-paths` hook
   will block direct writes to `infra/` and `migrations/` outside this
   command — that is by design.

5. **Validate** — Spawn `tester` with dry-run commands appropriate to the
   stack (e.g. `terraform validate`, `kubectl apply --dry-run`, Prisma
   `migrate --dry-run`).

6. **Review** — Spawn `reviewer`. For high-risk changes, also spawn
   `opus-decision` to audit the plan before any deployment.

7. **Deploy** — Follow the `infra` skill's staged deployment procedure:
   branch → staging → monitor → production.
