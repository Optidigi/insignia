# M0-012 — real draft contract and bounded no-charge metering

Issued: 28 September 2026. Outcome: ONE integrated implementation/evidence PR. Read `PRINCIPAL-DISPOSITION.md` for the explicitly approved prototype policy; execute only after the owner sends the accompanying launch. No preceding PR needs another merge.

## 1. Start with the existing contract, not another setup exercise

Fetch current `Optidigi/insignia` main, last checked at `e77e4e42f8858662889f9814eeb7d0c4ed3713ab`, and branch. Preserve legitimate newer work. Read AGENTS, operating model, v1.2 ledger, relevant billing plan sections and M0-010/011 contracts. Use the installed research, implement, tdd and code-review skills where useful. Do not rebuild general preflight or scaffold the full app.

Exact designated resources:
- App `gid://shopify/App/429028933633`; public client `1443cf6d03d39edae7c101a943c5c684`.
- Optidigi Partner `4697030`; Dev organization `200969036`.
- `insignia-rewrite-dev.myshopify.com`; shop `gid://shopify/Shop/105501393179`.
- Last observed installation `gid://shopify/AppInstallation/1054356963611`.
- Private draft handle `insignia-dev-zero-20260928`; event/meter handle `customized_order_paid`.
- Reported subscription GID `gid://shopify/AppSubscription/38085427483`.

Read the actual local handoff files:
`/home/serveradmin/insignia-pr16-review-handoff/NOMINAL-USAGE-AND-EFFECTIVE-ZERO-CONTRACT-2026-09-28.md`
and `PARTNER-ACTIVE-AFTER-DRAFT-APPROVAL-2026-09-28.json` in the same directory. Import sanitized query variables, response, timestamps and approval provenance into this PR's evidence. Preserve originals; check for secrets/personal data before tracking anything. Do not manufacture a JSON receipt from the chat summary.

Identify the exact field carrying the reported subscription GID. If it is legacySubscriptionId or an approval ID, keep that provenance; do not invent a top-level schema field, require a native ID the API does not expose, or infer migration history from the field name. Bind all fields the provider actually returns, including app/shop and observed contract terms.

Use approved protected new-app and Partner credential files only. Existing registration, English listing language, app/store/plan/meter/subscription are setup facts to verify, not tasks to repeat. Read exact identity/eligibility and draft restriction; unexpected consumers, replacements or nonzero effective terms stop the send branch. No new subscriber is authorized.

**Done:** actual sanitized fixture and current exact-resource baseline are available, or a specific evidence/access mismatch is recorded while independent local tests continue.

## 2. Implement the narrow real-contract profile

Use `spikes/m0-012` or an equally small separate entry point. Reuse existing bounded transport, canonical time, exact decimal and event-encoding logic where sound; export small helpers if necessary. Preserve the historical target/tariff/token guard defaults and all frozen fixtures. No generic provider framework or production billing engine.

Separate contract presence, catalog-price active metadata, effective tariff, usage observations and application entitlement. Do not classify `price.active:false` alone as canceled/unpaid, and do not rewrite it to true. The exact false value is permissible in this designated development profile. Missing/nonboolean active metadata still rejects as a malformed contract. Record the cause of false as unestablished unless actual evidence resolves it.

The new send guard must validate the exact app, shop/domain, plan item and meter by unique handle/type, not item-array position. Use the actual two-item response if that is what the fixture shows; unknown extras, duplicates and absent required items reject. Accept the observed one-tier VOLUME representation, all its effective monetary fields exactly zero in USD, and a tier boundary covering the full experiment. For finite bounds, prove baseline quantity plus the maximum distinct units fits; do not assume null or infinite boundaries from the summary. Keep nominal USD 0.01 in the plan evidence separate from effective zero in the contract.

Require current monthly cycle, no trial, no pending change and no scheduled cancellation for this run; compare canonical instants, not raw date spelling. Fresh successful Partner reads must establish the same recorded contract/terms before each submission and after acquiring its token. A null contract, GraphQL error, changed identity/cycle/terms, nonzero amount or malformed value stops the send. Zero accumulated cost alone never establishes a free tariff. Observe cost independently; any numeric nonzero cost stops subsequent sends.

Preserve null/missing usage as unknown/no observation, not zero. An optional null usage object before the first event need not negate independently verified zero prices, but it cannot support a numerical delta claim. Obtain an actual numeric meter quantity for any count assertion. No silent mapping of this free developer plan into one of the three commercial entitlement plans.

**Done:** real response parses without changing its economics or flags; public-seam tests reject wrong identity, nonzero/malformed amounts, incomplete/extraneous tiers/items, changed dates and transitions on BOTH initial and final contract reads.

## 3. Implement the explicit immediate-use token route

This prototype exception replaces mandatory top-level scope/expiry metadata ONLY for this new isolated run, not the existing strict `getToken()` default.

Acquire directly at `https://api.shopify.com/auth/access_token` with this app's existing client ID/secret and documented client_credentials body. Use verified TLS, no redirects, bounded body/timeout, a syntactically valid nonempty token and explicit Bearer token_type. Missing token/type, non-Bearer type, an error payload, malformed supplied expiry, or a supplied scope that excludes write_global_api_app_events reject. Missing scope/expiry remains explicitly unknown, with documented default permission as the rationale for testing, not as claimed observed metadata.

The bearer stays in memory inside the trusted acquisition-to-send boundary and is consumable for at most ONE event HTTP request. Discard after that attempt, success or failure. No pasted/file-token shortcut, cross-request cache, JWT-derived permission or expiry, new introspection/JWKS endpoint, or secret-bearing fixture/log. Missing expiry is not replaced by a fabricated expiresAt. Use a separate client-use deadline of 30 seconds from acquisition request start (monotonic elapsed time), and a tighter reported expiry bound when present. Stop rather than extend it. This makes no promise of token validity; 401/403 is a safe unsuccessful test result.

Do not fetch tokens merely to investigate the same known omission again. Acquire only as part of an otherwise ready, reserved event attempt, up to six acquisitions total. Nonsecret endpoint/status/metadata-presence observations are sufficient.

Pin one event endpoint before the first POST: prefer 2026-07 only when current official version information supports it; the currently documented `https://api.shopify.com/app/unstable/events` is explicitly permitted for this PROTOTYPE if needed. Record the selected URL/source and test its encoder. No endpoint/version fallback once the live run starts. A failed documentation fetch does not prove API unavailability. Partner reads remain 2026-07; old encoded evidence stays unchanged.

**Done:** integrated synthetic tests prove provenance-only access, missing metadata handling, contradictory-value rejection, no cache/reuse, use-deadline enforcement and abort/redirect/failure behavior without secrets in outputs.

## 4. Whole-package limits before remote sending

One remote operator, one run ID and a durable operator-owned register outside disposable worktrees. Total budget: THREE distinct value:1 synthetic events; SIX event POST attempts INCLUDING deliberate duplicate, retries and uncertain requests; SIX token acquisitions. These are independent ceilings, not targets to exhaust. Older permissions do not add to them.

Initialize the register once under this authorization after verifying no previous sends for this run; preserve its locator across processes/worktrees. Reserve payload identity and each attempt durably before acquisition/submission. Separate reservations from actual dispatches; uncertain dispatch consumes budget. Missing/corrupt existing register, alternate run/journal path, new run ID or concurrent process must not silently reset the budget. Use an operator-held run receipt/locator plus the persistent register to detect a lost file; no new distributed accounting service is needed. Tests must demonstrate restart and duplicate behavior. Once history is ambiguous, stop live sending.

Store original event key, exact payload hash/bytes, occurrence time, selected endpoint and source/build hash. Events are SYNTHETIC transport probes, not purchase facts for real orders. Use only the designated shop, event handle and attributes `{value:1}`. One event per request. Retries/duplicate reuse the EXACT key, body and timestamp. Never introduce a new key to fix uncertainty, move an event into a different cycle or send negative correction usage.

Local pinned tests, fresh Spec/security review and a fixed clean implementation commit precede any live send. These are execution prerequisites inside this authorized package, not an additional principal handoff. Changes affecting the send path after a live run need tests/review and their own source binding; do not relabel old observations as final-head execution.

## 5. Run the conditional experiment, then inspect outcomes

Reconfirm the existing effective-zero contract and meter baseline with scoped Partner reads. Retain the native no-charge approval evidence. Keep plan/subscription/publication configuration unchanged throughout.

Sequence:
1. Submit synthetic E1 once. Record HTTP/body status and safe request ID. Inspect ordinary supported Dev Dashboard App Billing Event logs and Partner meter quantity/cost. Human-assisted inspection is acceptable; do not build a private-log scraper.
2. Once E1 is demonstrably processed as BILLING usage, replay E1 once with the identical key/body/time and a fresh single-attempt bearer. Record whether the meter remains unchanged. A replay header is useful only if actually present.
3. If results remain coherent and zero-cost, submit E2 and E3 as separate synthetic occurrences, recording each unchanged payload before sending. Read back aggregate quantity/cost and corresponding billing processing observations.

Expected observed result: three distinct units counted once; duplicate adds none; effective tariff and usage cost stay zero; draft stage and contract remain. Report separately RECEIVED, BILLING_PROCESSED, and METER_COUNT_OBSERVED. HTTP 202 alone is never a pass. A general custom-event log alone is not proof of billing-meter routing. This tests immediate duplicate behavior, not a lifetime proof of permanent deduplication.

Use a bounded observation loop, at most twelve scheduled read/poll rounds total with backoff and Retry-After honored; each may pair a fixed contract read and supported log observation. Do not resend merely because logs/aggregates lag. Unavailable or delayed evidence returns INCOMPLETE/PROCESSING_UNKNOWN, not a fabricated result. Read-after-write visibility is an observation, not assumed synchronous.

An auth/permission error, unsupported endpoint, economic/identity mismatch, demonstrated processing failure, unexpected meter count, cost, contract change or exhausted/ambiguous run history stops subsequent sends. For a transient transport ambiguity, 409, 429 or 5xx, only bounded exact-key retries within the original budget are permitted; resolve E1 before sending distinct later events. A failed prototype is an acceptable outcome.

No subscription cancellation/plan edit is part of normal completion. Retain the verified zero-price subscription and meter for later reviewed lifecycle testing. If unexpected payable terms appear, send no more usage and report; do not uninstall, edit prices, grant permissions or manufacture a refund. No public Enable/Switch/Publish, migrations, listing submission, app preview/deploy, Functions, buyer orders, payment/stock/theme changes, credential creation or changes to legacy/staging history are authorized.

## 6. One integrated handoff

Use actual gpt-6-sol/high with bounded restricted workers as useful: at most two non-overlapping writers including the orchestrator, one integrator, fresh Spec/security reviews and one provider operator. Orchestrator may implement one lane itself. No provider-private model attestation or general tooling project.

Return ONE implementation/evidence PR including the actual imported fixture, new profile, secure immediate-use token path, run-accounting tests, final CI, exact live source binding and sanitized results. Preserve v1.2 plan/ledger and previous negative evidence. Update current operational state without rewriting historical observations. The issued prototype disposition is an explicit record, not silent production adoption.

No merge, full G8 pass, production billing/entitlement claim, three-plan/trial/allowance completion, v2 authorization adoption, M1 or subsequent package follows automatically. Principal retains architecture, gate adjudication and review of the entire PR. Stop at that review boundary.

## References

Use the sources in PRINCIPAL-DISPOSITION.md. Current official draft-testing instructions specifically include sending usage events BEFORE final App Pricing enablement. Price.active and activeSubscription are different fields. OAuth missing metadata and first-party outbound bearer handling do not authorize trusting arbitrary inbound JWTs.
