# M8 verification ledger

Entry/base `3ae4b8505d4c383fbb874694ef870454b6a074ef`, tree `931cd3fb3d7809feeb0d2043646c1fe7642124f2`. Completed-source reviewed candidate `8acd574537f131af58d9eae86e1a5faec176cea0`, tree `556c2b47073ca4c23831cfcd2341d013aaec07eb`. Independently impact-reviewed correction source `237e1d0454b903a1702891ea19632c2cb351cfb4`, tree `80f144aeabf583e82607e8e8a072bbbd0fd55c55`. Later evidence-only head inherits this reviewed source; exact final CI/integration recorded separately.

| Actual check | Result / scope |
| --- | --- |
| Frozen pnpm install | PASS; pinned dependencies reused, workspace links added for existing cart-authorization helper |
| Full workspace build | Initial and corrected PASS; package/application/worker/Astro/storefront build |
| PostgreSQL18 durable regression | Initial schema29:261 PASS,4 SKIP. Corrected schema30:264 PASS,4 SKIP; current synthetic_m8, no native migration |
| Isolated DB review corrections | 14 actual PG purchase tests PASS, including normalized grouping, max1 connection attachment/lock, test-order immutability/drift/unknown; author reported executions, root broad suite independently includes them |
| Root purchase HTTP/PG | 3 PASS on independent synthetic_m8_http; real issuance, HMAC/resource authority/Ed25519, database/HTTP; external order/context/storage/online actor doubles explicit |
| Merchant Chromium | 6 PASS with explicit backend/provider doubles; upload/attach/lock, CAS, permission loss, retention tombstone, same-version immediate private-link removal, refund-record/test-status wording |
| Pure package units | Domain26/contracts6/visualizer13/cart-authorization9/application263/Shopify387/observability5/storage19 PASS; unchanged pure source results inherited across final DB/UI corrections |
| Worker unit environment |42 PASS,21 SKIP without PG; not a native/role claim. Full PG worker result below supersedes relevant skips |
| Protocol vectors / M5 operator regression |1/7 PASS; v2/Rust Functions unchanged |
| Corrected style |PASS461 files;168 existing warnings/189 infos, no errors |
| Corrected boundaries |PASS including negative browser/source probes, domain effects and narrow DB public API |
| Corrected secrets |PASS across source/test/browser artifacts, provenance and negative probes; exact summary below |

Root local logs: `/tmp/insignia-m8-{build-final,database-final,browser-final,unit-final,unit-rerun,worker-pg-final,boundaries-final,secrets-final,vectors-final,operator-final}.log`; corrected build/style/database/browser/boundaries/secrets/worker-PG logs use `/tmp/insignia-m8-corrected-*.log`. Original failures preserved.

## Failures and corrections

Independent completed-change reviews found normalized groups discarded, nested transactional reads exhausting the same pool, and expired masked ATTACH selection falling back to original. Actual RED/GREEN PG/HTTP regressions close these; original review attribution remains intact. Additional immutable provider test-status retention closes the future non-test-evidence concern without billing. Merchant refund records now explicitly do not prove settlement.

First full unit run had386 Shopify PASS/1 FAIL: historical availability success fixture's100ms budget expired under simultaneous CPU/browser work (167ms observation). Only the success fixture default was raised to1000ms; explicit100ms timeout cases and production timeout remain unchanged. Full unit rerun387 Shopify PASS. This is test scheduling tolerance, not a production guard relaxation.

First full web run found a stale private preview still visible when the new erased-selection text rendered. Correction uses exact current selection/deadline render guards and rejects late responses; the Chromium regression observes DOM mutation before passive effects. Final broad browser result recorded below.

Initial shared-DB purchase proposal acceptance failed once while another buyer test could perform global future-clock cleanup. Concurrency cause was not conclusively proved; independent HTTP DB was adopted and sequential/isolation checks passed. No product defect was invented from that failure. Worker028 cursor table had been manually applied without dbmate version metadata: root compared every column/default/constraint/index with source-applied HTTP reference, matched exactly, registered only known-applied028 and applied029/030 normally. HTTP/review databases applied all30 through dbmate from empty. No skipped drift or rollback of qualification data.

Root erasure-projection RED found original UUID where null was expected, then GREEN3/3 after null ATTACH barrier. UI render/privacy/refund corrections and test-order evidence have meaningful failing-to-passing regressions. Test fixture/method/path errors during integration are not claimed as production defects.

T3 collaborative browser status initially had no tab; preview_open succeeded on public pinned Order docs with automation ownership. That confirms public browser access, not a Shopify authenticated owner session or native M8 observation. Owned public tab closed. Local Playwright follows the explicitly authorized repository workflow; no login/verification retries occurred.

All local test servers/browser processes close through suite teardown. Owned loopback58197 shutdown and preserved synthetic/native-retention status belong to the final handback receipt. Environment-dependent skips, local cleanup, mocks and CI never establish G1–G7/native S3/store/order/payment/refund acceptance.

## Final corrected-source regression

Full web199PASS/no skips, storefront40PASS/no skips; worker62PASS/1SKIP with real PostgreSQL, including actual durable hint/cursor/role controls. The skipped worker check requires the separately frozen historical owner-lifecycle allocation and remains explicit. Corrected secrets190production sources/150test-fixture files/23browser artifacts/2synthetic seedsPASS. Corrected boundaries include18domain-effect controlsPASS. Full build/style and schema30 durable264PASS/4SKIP qualify correction237e1d0. No further behavioral source change followed.

Full source review and correction impact verdicts are separate; final PR/head CI and actual normal integration receipt supersede pending fields after completion. No native migrations/grants/store/storage operations occurred.
