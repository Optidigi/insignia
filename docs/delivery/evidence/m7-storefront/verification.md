# M7 verification ledger

Base: `31b92db714fc1bb90f4f2b417361c58c0deb2cf4`. Completed-source review candidate: `2ca51d5b5d1772aeda7982f999bcc771ed9d7f2b`, tree `656d78bb5743ba38613b2c45d88b4fc9123dce2b`. Correction source head `476180c10409d209ed6ac710964db119263a0d3c`, tree `7f54f0d301322e4a67ba76124f2f9db1600e02d5`, is independently impact-reviewed. Final-head CI is recorded separately; unchanged core evidence is inherited with this scope.

| Actual local check | Result and limitation |
| --- | --- |
| Full workspace build | PASS; packages then applications, Astro SSR and lazy storefront assets |
| PostgreSQL18 schema25 durable suite | 249 PASS,4 SKIP; fresh owned synthetic_m7 DB on loopback58197; skipped environment controls not native proof |
| Domain/contracts/visualizer/application/Shopify/observability unit | 26/6/13/228/375/19 PASS |
| Cart authorization/storage | 9/5 PASS |
| Worker local tests | 39 PASS,19 SKIP; native/role-specific prerequisites not inferred |
| Full web browser/HTTP/PG | First188 PASS,1 SSR startup FAIL; isolated SSR rerun1 PASS; complete rerun189 PASS. Random-port startup failure cause unconfirmed, preserved rather than characterized as fixed product defect |
| Style | PASS,432files,no errors; existing warnings/infos not rewritten |
| Boundaries | PASS,including database public API and domain-effects negative probes |
| Frozen protocol vectors and M5 operator regression | 1/7 PASS; no v2 or Function source change |
| Secrets | PASS,171production sources,139test/fixture sources,24generated/retained browser artifacts,2explicit synthetic seeds; negative unused-lazy-chunk regression PASS |

The web suite includes eight actual PostgreSQL buyer-flow cases plus buyer HTTP/factory/bootstrap boundaries. Required runtime CI now explicitly runs these buyer cases with PostgreSQL; foundation browser checks alone may skip database-dependent cases. CI results belong to the actual final head, never an earlier passing SHA.

Raw local logs: `/tmp/insignia-m7-candidate-{build,pg,unit,browser,web-recheck,ssr-recheck,style,boundaries,secrets}.log`. Initial browser failure retained. External providers in local integrated UI demonstrations are explicit doubles; actual DB, browser, HMAC/Ed25519 and request composition are real. No native Shopify/S3 acceptance claimed.

## Corrected-source checks

Full workspace build and style PASS at correction476180c. Full storefront40PASS with actual PostgreSQL and regenerated local demo image; includes all eight mounted buyer tests and actual HTTP/PG/HMAC/Ed25519 integration. Independent reviewers inspected the four new regressions; root executed the final full suite. Typecheck and diff checks PASS.

TDD correction evidence: external-edit regression initially lacked the required repair message; repeated-renewal UUID assertion initially found the same completed key; compatible-republish revision assertions initially retained historical hashes instead of each product’s current revision. Corrected suite is GREEN. Incompatible logo-later publication rejects before proposal and retains every choice.

Logs `/tmp/insignia-m7-renewal-ui-review-fixes.log` (8PASS), `/tmp/insignia-m7-corrected-{build,style,storefront,boundaries,secrets}.log`. Final CI binds the documentation commit inheriting unchanged reviewed source; no blanket review restart is implied.

Corrected-source boundaries PASS and secrets PASS:25 browser artifacts scanned, including preserved old hashed chunks. Owned local PostgreSQL58197 stopped after all tests; pg_ctl confirmed shutdown and ss showed no listener. Synthetic qualification data retained; unrelated57961 cluster untouched. Test servers/browser processes close through their suite cleanup. No native cleanup or deadline discharge is inferred.
