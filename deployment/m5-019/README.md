# M5-019 deployment configuration

This is the isolated designated-development-store rewrite web deployment, not a
legacy replacement, merchant activation or Shopify release. Read the
[slice](../../docs/delivery/prompts/M5-019-HOST-READINESS-UNRELEASED-VERSION.md)
and [report](../../docs/delivery/M5-019-REPORT.md) before execution.

The package recipe verifies all accepted source/build hashes, copies frozen
production dependencies offline and preserves every compiled web byte. Astro's
flattened server chunk imports the Shopify SDK from the package root; the recipe
exposes the existing pinned production SDK15.0.0 there. It does not modify the
application manifests, lockfile, adapters or Functions. The initial unexposed-SDK
failure and qualified standalone HTTP control are retained in slice evidence.

Use a fresh package destination:

```
python3 deployment/m5-019/package-runtime.py <rewrite-worktree> <new-runtime-directory>
```

Build context contains only that runtime, this Dockerfile and the pinned
dbmate2.36.0 Linux/x64 binary as `tools/dbmate`. Never include runtime.env,
database.env, SSH keys or the retained owner credential file. Bind the archive
hash, resulting image ID, Node24.21.0 and PostgreSQL18.6 immutable image manifests
in the deployment receipt. This application uses the already reviewed fifteen
new-application migrations in a fresh isolated database; legacy databases are
not targets.

Current owned VPS is `serveradmin@65.109.22.104:22`, verified through the
owner-supplied ED25519 fingerprint. Deploy under a new owner-private directory,
with a distinct Compose project, container names and database volume. The
existing proxy network is shared only by the web service; the database has no
published port and uses a private internal network. The web process runs as
`node` with a read-only filesystem and a bounded temporary directory.

Create private mode0600 `runtime.env` and `database.env` through the retained
approved untracked-environment mechanism. Verify owner/private file modes and
the exact public client before reading the app secret as data. Transfer it only
over the fingerprint-verified SSH channel; record presence, never its value or
hash. Generate a new database password for this dedicated database. The legacy
app's client/secret/database are unrelated and must remain unchanged.
Use the database owner only for migration and provisioning. Create a separate
`insignia_runtime` login with its own generated password, apply
`runtime-grants.sql` after migration, and bind the web DATABASE_URL to that
non-superuser role. Verify it cannot create tables or roles.

Route exposure defaults to false. After reviewed source/configuration and
local package proof, stage the isolated service without public routing, apply
the unchanged migrations with pinned dbmate, and verify health, valid
unauthenticated API401s, reviewed bootstrap/public client and actual assets.
Check the service's restart with its same image and private configuration before
exposure. Pin `INSIGNIA_WEB_IMAGE` to its verified image ID and set
`INSIGNIA_ROUTE_ENABLED=true` only after those checks settle.

The router requires the exact candidate host and explicit path boundaries. It
does not match `/`, `/auth/*`, legacy `/app/*`, other `/api/admin/*`, or similarly
prefixed paths such as `/admin/products-extra`. The deployed legacy route table
and static directories must be checked before enabling it. Existing legacy
router/configuration/images are not changed or restarted.

Rollback disables or removes only the new web router/service, returning those
paths to the existing legacy catch-all. Keep the new database volume and its
private configuration; rollback never deletes or restores legacy data. Bind
the preserved legacy image/container/router and their before/after equality.
Prove public root/login equality, new bootstrap/assets/API behavior, internal
health/restart and rollback route semantics in the host receipt. Liveness is
not proof of grants, commercial readiness, Function enablement or activation.

After the complete host/source/build/config/review/CI gate is frozen, the
separate exact-app operator may create at most one unreleased Shopify version.
`package-app-version.py` materializes the separately captured exact-app config
and only the two accepted Function binaries. Its fixed local UIDs are proposed
new identities, not claims about an existing provider registration. Query and
Wasm hashes must match `extension-bindings.json`. The deployment copies use
`command = "exit 1"`; the pinned CLI must use `--no-build --no-release`, making
an accidentally enabled rebuild fail locally. Original source/config/binaries
remain unchanged. Exclude the theme extension and preserve empty required and
the exact three optional scopes. Inspect provider UID/module identity and
active-version equality after the single no-release attempt.
This directory does not release an app or Function, create a fixture, mutate
availability/publications, change scopes or authorize M6/M7/launch.
