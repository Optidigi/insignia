# R2 upload completion and quarantine retention

Observed 2026-10-12T19:29:42.640031+00:00. Account Optidigi `97984dbfba2fd91f42a4c3fb90fcad09`, existing private bucket `insignia-demo`. This task read configuration only: no CORS/lifecycle changes, object writes, token creation or other-account access.

## Actual bucket configuration

Authenticated Cloudflare MCP execute made these exact reads:

- `GET /accounts/97984dbfba2fd91f42a4c3fb90fcad09/r2/buckets/insignia-demo/cors`: Cloudflare API error **10059, The CORS configuration does not exist.** Browser direct upload and canvas-image access require an explicit qualified origin/method/header policy; the server-side MCP object probe does not establish browser success.
- `GET /accounts/97984dbfba2fd91f42a4c3fb90fcad09/r2/buckets/insignia-demo/lifecycle`: **200, success true**. Only rule: `Default Multipart Abort Rule`, enabled, conditions `{}`, `abortMultipartUploadsTransition.condition.type=Age`, `maxAge=604800` seconds. No completed-object expiration rule exists. This default cannot clean completed single-part quarantine PUTs.

The MCP token remains in protected local credential storage and was read in memory. No credential or presigned URL was emitted. These two reads stay within the owner qualification allocation of at most 500 requests and 100 MiB synthetic data; this task transmitted no artwork objects.

## What expiration establishes

[Cloudflare R2 presigned URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) establishes a specific operation/key and finite authorization duration, with reusable bearer URLs and signature-pinned content type. It does **not** state that every accepted PUT must finish before its signature expires, nor give a maximum in-flight upload duration. The local application's 30-second server fetch timeout applies to its own storage requests; it does not control a browser's independent connection to R2.

[Amazon S3's primary documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) says signature expiration is evaluated at HTTP request time and gives a download that continues beyond expiry as its example. This supports treating signature expiry and transfer completion as different events. It is not empirical proof of R2 PUT semantics. [R2 limits](https://developers.cloudflare.com/r2/platform/limits/) publish size and operation-rate limits but no direct-PUT wall-clock ceiling. A maximum upload size does not establish minimum throughput.

Therefore **a pre-expiry PUT completing after a delete is a live hypothesis, not an excluded behavior**. Slow-start/pre-expiry streaming PUT, delayed completion beyond expiry, and delete-before-completion require bounded native qualification with synthetic bytes once S3 credentials exist. Such a finite observation can establish observed behavior, not a universal provider upper bound. No delayed native PUT was performed here.

## Smallest useful durable correction

Immediate exact-key deletion after inspection remains useful, and immutable promotion remains safe because original bytes are copied from the inspected buffer to a separately signed immutable key. A resurrected quarantine object cannot change that promoted original or make itself USABLE.

For cleanup, retain the known opaque quarantine key as a durable deletion obligation. Retry exact-key DELETE after errors, periodically resweep settled/expired upload keys, and do not interpret a single successful DELETE or missing read as proof that no in-flight write can later complete. The USABLE path must remain sweepable after `uploadUntil`; setting a once-only cleaned flag there closes the obligation too early under this hypothesis. Selection should use known rows/keys and bounded batches, never a broad account/bucket listing.

The current proposed tombstone sweep stops at `expiresAt + 360-second worker lease + 30-second provider call`. That bounds cooperating inspection/promotion jobs, **not direct PUT duration**. A fixed terminal horizon needs an independently justified provider completion bound or an explicitly recorded residual cleanup limitation. Presigned expiry must not silently supply that bound. Durable periodic sweeps are the smallest application correction: treat the cleaned field as a last-attempt timestamp and reselect USABLE rows on a cooldown after upload expiry, through their original asset expiry; then retain bounded tombstone resweeps. Permanent completion cannot be proved from expiry alone.

As an additional backstop, an age-one-day lifecycle completed-object expiration rule restricted to the application's exact owned quarantine prefix would remove objects even after application interruption and late recreation. Preserve existing rules, use a unique namespace, avoid touching other contents, and read back the merged policy after an authorized mutation. [Cloudflare object lifecycle documentation](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) supports prefix filters and age/date expiration, but describes removal as typically within 24 hours and allows longer delays. Age rules also start from the object upload, not the application's original collection timestamp. Consequently this is an eventual orphan backstop, **not proof of the exact six-calendar-month collection cap**. No policy was changed here.

A hard finite no-resurrection guarantee requires a qualified provider request-duration contract, or controlled upload ingress with enforced duration/cancellation and durable reconciliation. Introducing an ingress route is an architectural choice to review against direct-quarantine-upload intent, not a hidden change to this research task. Current external authorization covers synthetic qualification only; live buyer artwork upload/rollout is not authorized. Full buyer-retention qualification therefore remains separate. Until then, keep the native behavior and hard-deadline residual explicit; never restamp collected/expiry timestamps or treat lifecycle cleanup as acceptance evidence.
