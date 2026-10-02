Two actionable findings prevent readiness:

- **P1 — Reservation is not exclusive.** [grant-helper.mjs:81](/home/serveradmin/insignia-m5-008s-run-ak9r6qiw/grant-helper.mjs:81) reads the register, checks zero counters, then replaces it. Concurrent invocations can both pass and each dispatch an exchange/read pair. Acquire an exclusive durable reservation before reading/checking the register; refuse subsequent invocations.

- **P2 — Failed responses are not cancelled.** [grant-helper.mjs:77](/home/serveradmin/insignia-m5-008s-run-ak9r6qiw/grant-helper.mjs:77) releases the reader after exceeding the body limit, while the outer `finally` clears the deadline without aborting the request. Non-OK responses similarly leave their bodies unconsumed. Cancel the reader/body and abort the controller on every failure so unfinished transfers remain bounded.

Verified from source: helper and provenance hashes match; the extracted credential loader exactly matches the existing protected route. Requests use fixed targets, API `2026-07`, redirect rejection, and no retry loop. The sole Admin document is read-only; identity checks cover app/client/shop/domain/installation/development status. Success requires `write_products`, without substituting the historical nine-grant set. Persisted evidence excludes secrets, bearers, and raw auth bodies.

No helper execution, credential reads, network access, delegation, or writes occurred. This is narrow source review, not principal approval.