# PR61 SCRAM CI diagnosis — source unchanged

Allocated synthetic-only PostgreSQL18 cluster: loopback port55448. No native/production credentials, other clusters, repository writes, auth weakening or timeout changes. Inspected diagnosing-bugs skill and built real RED/minimized differential probes. Private allocation URL was read in memory and never printed; test logs substitute URL/password if present.

## Executed evidence

1. Unchanged public worker test `node --test --test-name-pattern="restricted consumer" apps/worker/test/webhook-retention.test.mjs` reproduces the exact 30000ms test timeout. Log01 retains RED; outer diagnostic process bound42sec is not a test-timeout increase. The original source could not finish normally within that outer bound.
2. Independent unchanged cleanup ACK-loss control, same test file/name filter, owner SCRAM connection: **1/1 PASS, 1.25sec**, zero cancelled/skipped. Log02. No genuine cleanup-job lock or shutdown failure reproduced independently.
3. Real owned LOGIN role, no password: pg8.23.0 rejects in4.8ms with SCRAM missing-client-password category. Failed pool has total/idle/waiting counts0; Pool.end resolves in0.05ms. Set a random disposable synthetic password on that same role and URL: authenticated current_user matches. Probe03/private JSON. This is real authentication, not mocked authority.
4. Real separate owned database, same bad role connection: after error and successful Pool.end, captured failed client's authentication socket is still undestroyed. DROP DATABASE remains pending at1.2sec with wait_event_type=IPC, wait_event=ProcSignalBarrier, zero pg_blocking_pids. Closing ONLY that throwaway probe's captured failed socket releases DROP; completion ~57ms later. Probe04/private JSON. This explicit socket close is diagnostic cleanup, not a production runtime change.
5. Scoped end scan finds zero remaining fixture databases, roles or active sessions; probe05. Parent cluster remains running, under parent ownership. No historical closed cluster was reopened.

## Cause and smallest correction

The consumer and producer retention fixtures create `LOGIN` roles without PASSWORD, then clear URL.password. Local trust accepted this fixture; CI SCRAM cannot. The immediate authentication rejection is masked by fixture database cleanup: a failed authentication socket outlives Pool.end and PostgreSQL waits for its process-signal barrier. This is not an SQL job-row lock, and a longer test timeout or weaker server auth would conceal the problem.

Give BOTH disposable roles fresh nonempty random synthetic passwords in CREATE ROLE and their corresponding URLs, following the already reviewed scripts/m5-024/queue-privileges.test.mjs pattern. Validate restricted current_user before queue use. Preserve existing real SQL privilege-denial assertions, durable handoff, real queue and 30000ms test bounds. No production pg-boss/worker shutdown correction is justified by this diagnosis. If malformed authentication itself needs a lifecycle regression, make that a separate minimized pg connection control, not a business retention change.

The CI report25PASS/3cancelled is consistent with the first restricted fixture's unresolved cleanup contaminating later serial tests, including otherwise passing ACK-loss; this local run did NOT claim to rerun the whole exact CI invocation. Producer source has the same missing-password defect; corrected fixture/full worker suite should be requalified under SCRAM after parent authorization. Exact-head CI and independent reviews remain parent-owned.

Source was read-only throughout. Current observed writer HEAD after probes was e20c3e904fc5940b41892265d788ed1046b8160c, with clean git status; parent advanced its candidate during this task. Bindings describe observed current source bytes, not a invented source freeze or proof of downloaded CI bytes. Existing RED/uninstall/privacy limitations remain untouched.
