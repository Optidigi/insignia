# M8 completed-source Spec/correctness review

Independent native reviewer `/root/m8_spec_review`, fixed candidate `8acd574537f131af58d9eae86e1a5faec176cea0`, base `3ae4b8505d4c383fbb874694ef870454b6a074ef`. Read-only instruction; filesystem/connector isolation not enforced. No source edits, credentials or native mutations.

Three P2 findings:

1. `purchase.ts` returns raw request despite validating canonical normalized groups. Split/reordered identical designs can create duplicate production groups and wrong attachment indexes. Return the validated historical request; actual PG aggregation regression required.
2. `service.ts` uses only `erasedAt` as an attachment barrier, while DB reads already mask expired asset/placement/group before physical cleanup. This can present the original as current after a replacement expired. Treat null ATTACH identity as the same conservative barrier; HTTP regression required.
3. Refund records lose processing status before UI and quantities are labelled “refunded”. A pending/failed Refund is not proof of returned money. Preserve/display processing evidence, or clearly label records and unverified settlement. First-paid arithmetic correctly filters successful transactions. Official pinned source: https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Refund.

Cumulative architecture: no material unauthorized drift. Domain/platform boundaries, signed exact economics, historical key/issuance/installation windows, distinct purchases, append-only CAS artwork, original retention and durable recovery preserved. No commerce mutation, refund split, protocol change or M9 charging. Findings need correction before engineering qualification. Production checkout-context proof, queue-role privileges and historical image availability remain actual limitations; carried M5–M7 obligations remain open.

Root correction and independent impact verdict recorded separately; this original review is not rewritten as a clean verdict.
