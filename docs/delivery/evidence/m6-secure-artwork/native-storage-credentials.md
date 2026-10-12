# Native S3 credential prerequisite

The existing Cloudflare MCP is authenticated and root separately verified private `insignia-demo` API-object PUT/read/delete with cleanup. That does not establish the production adapter's SigV4/presigned S3 path.

This bounded probe used the existing OAuth connection in memory, scoped account selection to Optidigi `97984dbfba2fd91f42a4c3fb90fcad09`, and emitted no credentials. Four token/permission read APIs returned Cloudflare error 9109, Unauthorized. Current OAuth scopes include R2 object operations but no token management. See [machine receipt](native-storage-credentials.json).

The current MCP OpenAPI spec exposes temporary R2 credentials with required `parentAccessKeyId`, bucket, permission and TTL, and optional object/prefix restrictions. [Cloudflare's temporary-credential documentation](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/) describes the parent credential boundary. A designated parent access key is unavailable here; no token mutation was attempted. [Cloudflare's R2 token documentation](https://developers.cloudflare.com/r2/api/tokens/) provides the bucket-specific Object Read & Write route.

Native S3 remains **NOT_RUN_MISSING_BUCKET_SCOPED_S3_CREDENTIALS**. The precise remaining input is secure S3 access-key/secret credentials limited to `insignia-demo` with finite expiry, or a token-management-capable connection permitting such scoped issuance. Do not reuse legacy `insignia-assets` credentials or broaden to administrator access. Continue local application/worker/UI work independently.

This probe created no objects or credentials. Root's API-object probe retains its separate exact-key cleanup receipt. Storage adapter local verification remains 11 tests, TypeScript build and Biome checks passing; actual R2 conditional PUT, presigned upload/expiry/download and canvas CORS are still native observations to perform.
