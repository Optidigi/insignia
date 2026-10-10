**CHANGES_REQUESTED — Standards/security.** Two blocking findings.

1. **[P2] Log-retention failure can still qualify PASS.** At [image-runtime.test.mjs:334](/home/serveradmin/insignia-m5-worker-image-control-worktree/scripts/m5-024/image-runtime.test.mjs:334), failed `docker logs` collection only assigns `receipt.logFailure`. The previously assigned PASS survives, and the final assertion ignores that field. Successful resource removal then destroys the unavailable fixture logs while CI remains green. This violates the required complete log-retention contract. **Smallest fix:** retain each collection failure, mark qualification FAIL, finish owned cleanup, and include log collection in the final assertion.

2. **[P2] Database waits can prevent timeout cleanup and receipt persistence.** At [image-runtime.test.mjs:194](/home/serveradmin/insignia-m5-worker-image-control-worktree/scripts/m5-024/image-runtime.test.mjs:194), the installer runs directly without a deadline; subsequent pools also omit connection/query timeouts. The installed pg defaults permit unlimited waits. The 420-second `node:test` timeout cancels the test but does not unwind an awaited promise, and this callback consumes no cancellation signal. An unresponsive fixture can therefore prevent entry into `finally`, leaving owned resources and the final receipt unfinished until runner teardown. **Smallest fix:** bound installer execution and database waits, and ensure timeout cancellation reaches independently bounded cleanup.

Personally completed the read-only review of all 21 changed files and affected packaging, inventory, roles, queue, runtime, health and recovery sources. Bound to:

- Base: `659f118ddc9bdc8b5d33141f6395182ba6ba9bcb`
- Head: `e35fac12ca8b9b9c9c582da14557d35c011fb2cc`
- Tree: `51f84203e1b75966ecc12f2bbfc35413ef11f9a5`

Actually performed: three pure controls passed in-process, zero skips; diff whitespace check passed; all ten changed JSON files parsed; all 17 manifest hashes matched; active relative links resolved; archived state matched base bytes exactly. Permitted parent logs matched their recorded hashes and 222 database/31 worker/2 queue-crash passing counts; cleanup recorded stop exit0.

Both findings are source-inspection findings; native reproductions were **NOT_RUN**. Docker is unavailable here, and exact-head CI remains pending. Selected-web receipts preserve HTTP-count, continuous-Active/ABA, destination and privacy limitations. No delegation, modifications, credential access or network operations occurred. Actual model/effort provenance remains for parent verification.