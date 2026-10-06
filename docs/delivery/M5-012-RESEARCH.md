# M5-012 fixed publication-intent surfaces

Historical qualification, checked 6 October 2026 before the original credential access. The eight frozen pre-correction GraphQL documents at source0f8b7d7d53732cf7d0038eb4d366fe2e6179b01f validated with Shopify Dev MCP v1.15.4 against Admin 2026-07. The invalid-field control failed. ShopPlan.displayName is deprecated but remains valid; identity fields and grants are unchanged.

[Publication](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Publication) documents `includedProducts` as inclusion independent of effective publication and accepts an exact-ID search. [Products](https://shopify.dev/docs/api/admin-graphql/2026-07/queries/products) documents channel-ID and channel-app-ID `-intended`, the exact `id` filter, and `publication_ids` association. Each connection uses first:2, exact constants and complete pageInfo. No fallback listing or alternate search is permitted.

[Product](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Product) provides the exact `publishedOnPublication` boolean. Its updatedAt is a broad last-modified timestamp, not a documented atomic CAS token. The M5-011 one-second mismatch remains conflict evidence. This harness conservatively stops if the fresh DRAFT version differs from the last observed value or any subsequent anchor differs, and retains exact acknowledgement/readback equality for cleanup. It does not add tolerance or redefine production v1 semantics.

[Search syntax](https://shopify.dev/docs/api/usage/search-syntax) defines implicit AND and numeric equality. Invalid search fields may be ignored; the documented debug header requests parser metadata, and any returned warning stops before cleanup. Schema validation alone does not prove runtime search interpretation.

Historical frozen implementation counted association alongside inclusion and both intended searches, yielding INCONSISTENT on the live records. Principal review rejects that fourth predicate as unqualified; the local correction below supersedes this interpretation without changing raw execution output. Effective-publication and cleanup settlement guards remain unchanged. M5-011 empty V2 views remain their original evidence; this correction does not reread or reinterpret V2.

## Principal association adjudication — M5-012C

The [owner-forwarded PR #42 correction](PR-042-principal-review.md) identifies the unquoted numeric publication_ids predicate as unqualified. Future local source uses `publication_ids:'339456917787'` exactly; retained historical debug shape/no-warning does not prove the old parsed predicate. Configured-intent consensus now uses the three explicit inclusion/intended surfaces only. Association is separate diagnostic evidence.

The supplied package cites [Shopify staff's phrase-quoting explanation](https://community.shopify.dev/t/filtering-products-by-querying-publication-status-to-a-sales-channel-app-does-not-work/9702) and a [community DRAFT-product follow-up](https://community.shopify.dev/t/publications-are-empty-for-draft-products/17037/4). The latter is supporting community evidence, not a guaranteed published-only contract. These citations are principal-supplied research; M5-012C performs no new Shopify/browser/schema operation. No corrected live query or transition-invariance claim is made.
