**CHANGES_REQUIRED — ROUND1, Spec/correctness**

Verified base `d9de0932d1bd41cf0fab1368f88d3a434b17d105`, HEAD `087660e2c77a3443dad5e36622e1ccd17c62951e`, tree `cc1f48a6fc87c1e4d86e21f2e9db1959809187b8`. All ten source-manifest hashes match.

**P1 — Native producer leaves Docker routing uncontrolled.** [private-operator.mjs:30](/home/serveradmin/insignia-m5-private-native-inventory-worktree/scripts/m5-native-inventory/private-operator.mjs:30) sends bare `docker inspect` through the remote shell. Clearing the local SSH process environment does not clear the remote shell’s environment or Docker configuration.

The allocation requires **“Existing canonical VPS container exact SHOPIFY_CLIENT_SECRET”** ([allocation:10](/home/serveradmin/insignia-m5-private-native-inventory-worktree/docs/delivery/evidence/m5-private-native-inventory/owner-token-inventory-allocation-20261010.json:10)). Concrete counterexample: the remote account has `DOCKER_HOST` or a selected Docker context targeting another daemon. That daemon contains the same container name, image, client ID and APP_URL. The producer exports its credential, passes the public identity checks and proceeds to OAuth. SSH host pinning does not establish which Docker daemon supplied that credential. The unauthorized read happens before any subsequent rejection.

**Smallest fix:** execute an absolute Docker binary under a cleared remote environment, explicitly selecting `unix:///var/run/docker.sock` and neutralizing Docker configuration/context selection. Preserve the exact projection and existing reservation. Add a local control with hostile remote Docker routing/configuration defaults. The interacting host collector already fixes these boundaries.

The operational addendum’s distinction between supported owner-allocated issuance and an UNKNOWN universal lifecycle guarantee is sound within the recorded authority; this finding requires a source correction, not additional hypothetical-risk approval.

Static local review only: inspected complete source/tests, interacting collector/original CLI, host/phase boundaries and required packet. No edits, tests, builds, services, delegation, network, SSH, credentials or private captures accessed. Filesystem restrictions do not prove credential/network isolation. This verdict establishes no native qualification, principal approval or M5/G7 completion.