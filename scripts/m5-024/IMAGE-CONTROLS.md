# Disposable worker image qualification

The existing M3 runtime pull-request/main workflow runs `image-runtime.test.mjs` after the frozen portable worker build. It builds the reviewed Dockerfile locally on the disposable Ubuntu runner, records the actual image ID, and never pushes an image or accesses production. The package, pinned base digest, Node version and application command stay unchanged.

The one launcher correction is `ENTRYPOINT []`: the [official Node Dockerfile](https://raw.githubusercontent.com/nodejs/docker-node/main/24/bookworm-slim/Dockerfile) declares an inherited `docker-entrypoint.sh`. Source inspection identifies the risk; only actual CI image inspection qualifies the pinned resulting configuration. The local launcher control rejects that wrapper before accepting the explicit direct Node configuration. Historical M5-024 reports and NOT_RUN evidence are unchanged.

The runtime control owns a new PG18 container, internal IPv4 bridge, synthetic database and restricted consume login. Existing dbmate migrations, `install-queue.mjs` and `queue-roles.sql` provision the fixture separately from worker startup. The fixture DB has one ephemeral loopback host port for owner provisioning; the worker has no published ports or executable mounts. It must pass actual readiness/liveness, full resolved executable inventory and Node hash equality, `/proc/1` argv/UID/GID/capability/no-new-privileges observations, EROFS write denial, SIGTERM exit0 and fresh-process restart. Negative qualification controls are supplied observations, not native image proof.

Networking checks require exactly the internal network, IPv6 disabled, no IPv4 default route and failed TCP to documentation-only `192.0.2.1:443`. [Docker's internal network contract](https://docs.docker.com/reference/cli/docker/network/create/#network-internal-mode---internal) still permits host-gateway communication. These observations do not establish DNS filtering, arbitrary host topology or a production egress policy; no provider endpoint is contacted. No queue acknowledgement is treated as uninstall/privacy completion.

Every Docker command retains raw stdout/stderr and exit status. Source commit/tree, Dockerfile hash, image configuration, inventories, native observations, result and cleanup receipts are uploaded with the natural workflow run/attempt for 30 days. Fixture logs are collected before removing owned containers and their anonymous volumes, the internal network and the temporary local image tag. Parent integration must retain required receipts durably before artifact expiry. Registry digest and exported image-tar hash, production topology/secret parity, deployment, native backup/rollback, provider behavior and uninstall/privacy effects remain NOT_RUN.

Local qualification on the authoring host: the writable-root and frozen-inventory/OS controls, inherited-wrapper control and IPv6-boundary control each failed before their enforcement and passed afterward; three final tests, zero skips. `image-runtime.test.mjs` failed immediately because Docker was unavailable (`spawn docker ENOENT`), retaining a NOT_RUN receipt and raw failure log. No image/OS runtime PASS is claimed locally.

Next execution is the existing naturally applicable CI workflow after the reviewed candidate is pushed. No manual workflow trigger is needed. On a disposable Docker-ready host with the already-built frozen package, the exact command is:

```sh
M5_WORKER_PACKAGE_ENTRY=/tmp/insignia-m5-024-worker/dist/main.js \
M5_IMAGE_EVIDENCE_DIR=/tmp/insignia-m5-024-image-evidence \
node --test scripts/m5-024/image-observations.test.mjs scripts/m5-024/image-runtime.test.mjs
```

The evidence directory must be new. A missing Docker daemon, package or failed native assertion fails qualification; no conditional skip supplies a green result.
