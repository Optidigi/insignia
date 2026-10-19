# Delivery state

Observed 19 October 2026. **Canonical-app completion in progress; merchant visual acceptance reopened by owner.** PR216–218 are merged and must not be repeated. Typed implementation/native smoke from those changes remains useful evidence; it did not establish that all merchant page compositions were accepted.

Latest integration: [PR218](https://github.com/Optidigi/insignia/pull/218), merge `9989d7d3af85efe771c6332f9e886099f25f60e5`.

## Working shape and current qualification

The [full plan §14](../architecture/implementation-plan.md#1421-current-acceptance-map--five-owner-approved-outcomes) owns five outcomes: Lean per-garment pricing; recurring-only subscription/access; purchase/original/history; storefront/admin/privacy/recovery; reproducible operations/public-app readiness. Implementation uses typed application/tests/operations, pure-domain boundaries, exact money/whole-quote v2, PostgreSQL security and actual pinned Polaris components. Deferred tier/setup/FX/Plus/express/usage features remain excluded from new actions, with necessary actual history retained.

PR216 integrated the typed cleanup at `7175908041cc9ebd7e8e667fc535ac6741b1998d`. PR217 corrected the cold packaged API dependency at `8b5eb58a2212892bde5b6cc3a3c3bf8cb0ea7ec2`; PR218 completed current deployment instructions. Their required checks passed. [Technical report](evidence/technical-merchant-completion/REPORT.md), [reviews](evidence/technical-merchant-completion/REVIEWS.json) and [native receipts](evidence/technical-merchant-completion/NATIVE.json) preserve precise tests, failures, rollback and bounded native observations.

The last qualified development artifacts are web `sha256:40e5c06abb018923a2b9db714ae5c140e6b3d1958ef9c5d8bfde2adc537ac8f5`, worker `sha256:fae3bfac3f671174711b63a4e10f546d27510ddb87f613f9df4e8ac261e60f45` and verifier `sha256:6ff86f4f01da369f67256bc57d28624a04ee0bf31d5c250a9815f4c1b7b84322`, plus the separately qualified immutable host inspector. Native sections/editor and authenticated reads/canvas established development smoke, not production eligibility or owner composition acceptance. No new candidate image is implied by local edits.

## Current defects and next work

Complete the canonical-app assignment: consistent project/thread/skill starting point and fresh-session proof; retire obsolete discoverable config/helpers and broken instructions; simplify measured duplicate CI while retaining distinct roles/process/browser/Functions; assess effective database routines; correct and visually review every merchant screen and applicable states; exercise a secret-free fresh clone and integrate the reviewed candidate normally. In-progress source and local captures do not yet establish completed integration, deployment or native acceptance.

Current UI defect is app-wide hierarchy/composition rejected on `insignia-rewrite-dev` → `insignia-1`; genuine component loading does not close it. The earlier transient503/authentication-unavailable read is retained in the native record; a stricter later read sweep succeeded. Its cause is unconfirmed, so that recovery is not a proven authentication code fix.

## Owner gates and live obligations

The [final owner gates](authority/final-production-gates-2026-10-18.json) retain buyer-storefront visual review; genuine lifecycle/privacy; production storage/credential cutover; full object recovery/RPO/RTO; installed monitoring and alert authentication; applicable commercial/public-app/general-merchant qualification and rollout. Merchant composition will be returned for owner visual judgment after engineering review. Missing actual access or a human-verification challenge gates that route only; continue independent work.

**VAT998524223812 remains UNRESOLVED_NO_RETRY.** Preserve installation, receivers/worker, immutable generation authority and protected rewrite-dev; no retry/reinstall or invented settlement. No unallocated provider mutation or production rollout follows from this assignment.

Remaining private copies/backups/journals are due20October; originals/designs retain21/22/24October deadlines. Preserve permanent verifier/inspector/configuration custody and unresolved authority. Local schema45 web/worker/inspector SQL credential cutover, pool drain/reconnect and rollback are qualified on an isolated SCRAM fixture. Actual deployed consumer/configuration/storage/provider credential cutover and scoped fixture/test-gateway cleanup remain owner-held and unqualified; refresh their inventory and grant before effects. Never run or relax the historical18-migration helper. [Runtime procedure](../../deployment/m5-runtime/README.md) records the concrete cutover/recovery boundary. No future/background cleanup is claimed.
