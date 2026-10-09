# CI PostgreSQL mirror identity research

The smallest correction changes only the PostgreSQL service image and one provenance comment in `.github/workflows/m3-database.yml` and `.github/workflows/m3-runtime.yml`. Both now use:

`public.ecr.aws/docker/library/postgres@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336`

The reference is the successful Docker Hub `postgres:18` pull in runtime run **37988027764**, at 2026-10-09T20:35:58.5704860Z. That entire runtime run later failed its HTTP test; this is pull identity evidence only. The parent preserved R3 database/runtime runs **37991234250 / 37991234225**, which failed before checkout on Docker Hub anonymous pull limits. Their failed attempts remain unchanged.

Docker states that its Official Images are automatically published to ECR Public following Docker Hub updates. AWS identifies Docker as the publisher and documents the public registry URI structure. These establish publisher/repository provenance, not tag or byte equivalence. [Docker announcement](https://www.docker.com/blog/news-from-aws-reinvent-docker-official-images-on-amazon-ecr-public/) · [AWS announcement](https://aws.amazon.com/blogs/containers/docker-official-images-now-available-on-amazon-elastic-container-registry-public/) · [PostgreSQL gallery](https://gallery.ecr.aws/docker/library/postgres) · [AWS URI documentation](https://docs.aws.amazon.com/AmazonECR/latest/public/public-registries.html)

The separately authorized bounded registry diagnostic made exactly **four GET attempts**: index 401, anonymous token 200, authenticated index 200, exact Linux amd64 manifest 200. The anonymous token remained in memory and was never printed or persisted. Each response was bounded to 1 MiB with a 10-second request timeout, verified TLS, no redirects and a hard 60-second process deadline.

The ECR index response was **10,229 bytes** and its raw SHA256 exactly matched the historical Docker Hub pull digest. Its single Linux amd64 descriptor selects `sha256:885953109528ad3dfc90362b1a6f50a78620b5315be19f187753d267e484dc5b`; that response was **3,439 bytes** and independently matched the descriptor digest. The child manifest binds config `sha256:29754c7520f4b9654cf8ff98e19ac73b88e255c3a53f6236ebe9d52249bb6df3` and **13 ordered layer digests**, recorded in the receipt. Thus the immutable historical index, selected amd64 manifest and config/layer identities match. This does not rely on tag names.

The first probe failed on an assertion requiring the optional `Docker-Content-Digest` header. Its source and sanitized failure remain preserved. The four-read ECR diagnostic observed that header absent; verification instead required exact raw-body SHA256 equality to each requested immutable digest. The first trace alone did not identify the failing registry, so its precise cause is not retroactively claimed.

No fresh Docker Hub comparison, config/layer blob download, Docker daemon, container execution or native host/provider access occurred. Source-only checks verified exact image/comment substitutions and `git diff --check`; production source, service configuration, test assertions and timeouts remain unchanged. This is **local identity qualification**, not new service/runtime/CI PASS. The parent owns fresh independent reviews and exact-head CI.

ECR still has anonymous quotas, including documented unauthenticated pull and bandwidth limits; this correction makes no unlimited or future availability claim. [AWS ECR Public quotas](https://docs.aws.amazon.com/AmazonECR/latest/public/public-service-quotas.html)

Public receipts and probe sources are retained beside this report in the parent handoff directory; no token body or authorization header is present. `artifact-size-registry-public-research-receipt.json` binds workflow and probe source hashes, prior pull evidence, the preserved first failure, exact manifest URLs/digests, limits and source-only checks.
