# PostgreSQL adapter

`migrations/` is the ordered application schema source, applied only through dbmate. Kysely provides typed queries and transactions. Applied migration identities and bytes are immutable; corrections use forward migrations. pg-boss owns its separately installed schema. Migration rollback drops data and is qualified only in disposable environments, never as a production recovery procedure.

Tenant and installation-generation keys, concurrent draft-version checks, publication/effective-state guards, immutable accepted quotes/revisions/purchase facts and erasure fences are database responsibilities. The domain and application define the product decisions; the PostgreSQL adapter enforces their durable integrity under concurrent writers and restricted runtime roles. Keep necessary SQL/PLpgSQL rather than replacing cross-row guards with application-only checks.

Production composition uses `createDurableCore` through the package export. Repositories retain current historical readers and narrow privileged cleanup routines; they do not grant callers arbitrary table access. Runtime grants are separate reviewed owner operations under `scripts/database`, `scripts/worker`, `scripts/privacy`, `deployment/lifecycle` and `deployment/m8-journey`. Applying schema migrations does not provision deployment credentials or apply every runtime role grant.

For the secret-free local loop, install PostgreSQL18 server/client tools (`initdb`, `pg_ctl`, `createdb`, `psql`, `pg_dump`, `pg_restore`) and use the pinned Node/pnpm prerequisites in the root README. Run as a non-root local user:

```sh
corepack pnpm build
node scripts/database/isolated.mts
```

The launcher ignores ambient libpq selectors and `DATABASE_URL`, creates an owned temporary cluster with a private Unix socket and TCP disabled, runs `corepack pnpm check:database` (migration twice plus database regression), then stops and removes that cluster. It never selects a native database. On a system where binaries are outside PATH, set `INSIGNIA_PG_BIN` to their installed directory. `INSIGNIA_PG_SHARE` optionally selects that installation's PostgreSQL18 share directory; no private server-specific path is required. Normal dynamic-library prerequisites remain those of the installation. Shutdown failure retains the fixture and prints its path for diagnosis.

A focused command may run inside the same isolated fixture; migrate first if it needs the schema:

```sh
node scripts/database/isolated.mts -- corepack pnpm check:database
```

For an already owned disposable target, `DATABASE_URL=... corepack pnpm check:database` remains available. Never reuse a native/production endpoint. PostgreSQL-role, real queue/process, and populated dump/restore controls have additional explicit fixture admissions; their skips in the ordinary suite are not passes. CI retains those separate boundaries. The local SQL fixture and object-store doubles do not prove production object recovery, real uninstall/privacy delivery or rollout eligibility.
