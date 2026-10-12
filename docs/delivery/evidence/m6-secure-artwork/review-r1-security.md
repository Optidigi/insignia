# Independent security review — round 1

Candidate 08c7ab26a4699484fb38e33a2bcd195eaa4981da; base 36945927e3fedc72c44247ec8357eb669186c0c6; tree b1c27c8496fc7d91a6ec85a20b7a975b9a9640d0.

T3 task: node:delegated-task:command%3Amcp%3A4401786b-22ba-44c0-b2a7-f99cf55028ef%3Adelegate-task%3Ainsignia-m6-security-r1-08c7ab26

Five Standards/security findings against `08c7ab2` (tree verified):

1. **P1 — Unauthenticated oversized guest requests hang.** [guest.ts:71](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/web/src/server/artwork/guest.ts:71) clones the request, then awaits cancellation at line 80 when its body exceeds 2 KiB. Cancellation waits for the unread original branch; verification cannot return to consume it. This happens before capability or App Proxy verification. Locally, 2,048 bytes returned denial; 2,049 and 10,000 bytes remained pending. Parse once or cancel both branches without this dependency, and enforce a read deadline.

2. **P1 — One missing upload blocks inspection across tenants.** A guest can begin and complete without uploading bytes. `NOT_FOUND` becomes retryable at [artwork.ts:283](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/application/src/artwork/artwork.ts:283); [artwork-runner.ts:112](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/worker/src/artwork-runner.ts:112) then aborts the entire pass. [artwork repository:293](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/database/src/repositories/artwork.ts:293) repeatedly selects that oldest row, with no per-asset retry schedule. QUEUED rows escape the 24-hour incomplete-upload cleanup, so blockage can last seven days. Local reproduction attempted only the missing asset across consecutive passes and left readiness false. Isolate failures and bound missing-object retries.

3. **P1 — Presigned uploads bypass byte quotas.** [storage/index.ts:169](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/storage/src/index.ts:169) signs only MIME and host; its interface receives no declared length. A guest can declare one byte while uploading substantially more than 5 MiB, repeatedly within URL validity. Database quotas count declared bytes; bounded worker reads reject oversized content only after storage ingress. Bind length at ingress through qualified storage enforcement or a bounded upload gateway. Generated signed headers confirmed `content-type;host`.

4. **P2 — One cleanup failure blocks unrelated retention deletions.** [artwork.ts:300](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/application/src/artwork/artwork.ts:300) processes quarantine sweeps before expired assets, without per-row error isolation. One failed DELETE prevents even selecting expired originals and derivatives; failures within expired cleanup similarly stop later rows. Reproduction confirmed repeated quarantine failure never reached expired deletion. Preserve each failed obligation while continuing independent deletions.

5. **P2 — Quarantine resweep ordering can starve newer obligations.** [artwork repository:342](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/database/src/repositories/artwork.ts:342) orders by immutable upload deadline while making cleaned rows eligible again every 60 seconds. With sufficient backlog and bounded batches, older rows repeatedly consume capacity while newer rows remain unswept. Order by last-attempt time with never-attempted rows first, or use durable fair scheduling.

These concern security and intersect the specification’s abuse limits, processing availability and retention requirements. No material drift was observed in the SDK-only adapter, pure-domain, renderer or database-facade boundaries.

Eight web artwork tests and eight runner tests passed; the reproductions above expose uncovered cases. No edits, credential reads, browser, MCP or external API calls were made.

Known limitations remain separate: native S3 presigned/CORS/delayed-upload qualification is **NOT_RUN**; MCP byte-probe evidence does not establish it. Lifecycle expiration does not prove exact collection-deadline erasure. M5 native authentication/G7, privacy/uninstall and verifier obligations remain open.

Disposition: material findings remain open. No publication or merge acceptance.

