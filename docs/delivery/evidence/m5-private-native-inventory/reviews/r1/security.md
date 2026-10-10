**CHANGES_REQUIRED — ROUND1**

Verified base `d9de0932d1bd41cf0fab1368f88d3a434b17d105`, HEAD `087660e2c77a3443dad5e36622e1ccd17c62951e`, tree `cc1f48a6fc87c1e4d86e21f2e9db1959809187b8`. The range contains one commit; all ten source-manifest hashes match.

**P2 — Spec/Standards-security: the native producer does not pin its Docker endpoint.** [private-operator.mjs:30](/home/serveradmin/insignia-m5-private-native-inventory-worktree/scripts/m5-native-inventory/private-operator.mjs:30) sends plain `docker inspect` through the remote shell. Clearing the local SSH process environment does not clear the remote shell’s environment or Docker configuration.

Concrete counterexample: remote `DOCKER_HOST=tcp://other-daemon:2375`, or a selected remote Docker context, redirects inspection outside the allocated canonical VPS container. That contact and credential projection occur before image/client validation can reject the result. Existing [host_inventory.py:125](/home/serveradmin/insignia-m5-private-native-inventory-worktree/scripts/m5-host-inventory/host_inventory.py:125) explicitly fixes the socket and configuration.

**Smallest fix:** retain the exact projection, but invoke `/usr/bin/docker` through a cleared remote environment, with `--host unix:///var/run/docker.sock --config /nonexistent`. Add a local control showing hostile Docker environment/context settings cannot redirect the producer.

No other actionable finding identified in the complete new implementation/tests, collector/original CLI, allocation/history controls, interacting host/phase boundaries and required evidence packet. The operational addendum preserves UNKNOWN lifecycle guarantees without inventing owner risk acceptance.

Static inspection only: no edits, tests, builds, services, delegation, network, SSH/provider/browser, environment or credential access. The counterexample was not executed. This verdict establishes no native evidence, principal approval or M5/G7 completion; filesystem restrictions alone do not prove credential/network isolation.