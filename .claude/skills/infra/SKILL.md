---
name: infra
description: "Infrastructure and migration change procedures. Enforces plan-validate-stage-deploy discipline. Loaded by /platform-change."
---

## Guiding principle

Infrastructure changes are asymmetric — they are easy to break and hard to
recover. Every infra change follows a written plan and a staged deployment,
regardless of how small it appears.

## Protected paths

The `pre-write-risky-paths` hook blocks direct writes to:
- `infra/`, `terraform/`, `tf/`
- `migrations/`, `db/migrations/`
- `.github/workflows/`
- `docker/`, `Dockerfile*`
- `*.env`, `.env*`

These paths are only writable via the `/platform-change` command, which
loads this skill and enforces the process below.

## Change process

### 1. Analyse current state

Before proposing any change, understand what exists:
- For Terraform: `terraform show` or read `.tfstate`
- For Docker: read `docker-compose.yml` and related `Dockerfile`s
- For CI: read the relevant workflow file in full
- For migrations: read existing migration files in chronological order

### 2. Classify the change

| Class | Examples | Required approver |
|---|---|---|
| Additive | New env var, new CI step, new container | Sonnet reviewer |
| Modifying | Changing resource sizes, updating base image | Sonnet reviewer |
| Destructive | Dropping a column, removing a service, scaling to zero | opus-decision |
| Breaking | Changing auth, altering a public API contract | opus-decision |

Destructive and Breaking changes require a decision document from
`opus-decision` before any implementation begins.

### 3. Validate before applying

Run dry-runs before any real change:

```bash
# Terraform
terraform plan -out=tfplan
terraform validate

# Docker
docker build --no-cache -f Dockerfile .
docker-compose config  # validates compose file

# Kubernetes
kubectl apply --dry-run=client -f manifest.yaml

# Database (Prisma)
npx prisma migrate dev --create-only  # creates file without applying
# Database (Alembic)
alembic upgrade --sql head  # prints SQL without running it
# Database (Flyway)
flyway validate
```

### 4. Migration-specific rules

- Never hand-write raw SQL for a migration unless the ORM cannot express it.
- Every migration must be reversible. Write the `down` migration.
- Never combine schema changes with data migrations in one file.
- Test migration up AND down locally before committing.
- For large tables (>1M rows), use online schema change tools — document which.

### 5. Staged deployment

```
feature branch → staging deploy → monitor (15 min) → production deploy
```

- Never deploy directly to production from a branch without staging validation.
- For database migrations: deploy migration first, then application code.
  This ensures backwards compatibility during the rollout window.
- For breaking changes: use feature flags to decouple deploy from release.

### 6. Rollback plan

Every infra change plan must include a rollback procedure:
- Terraform: `terraform apply` of the previous state
- Migrations: run the down migration
- Docker: pin to the previous image tag
- CI: revert the workflow file commit
