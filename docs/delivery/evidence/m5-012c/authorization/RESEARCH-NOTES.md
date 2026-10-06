# Research notes

Official Shopify ProductConnection documentation says `publication_ids` filters publication IDs associated with a product, while `{channel/app}-intended` means added to a channel but not yet published. Publication.includedProducts is explicitly products included but not necessarily published; Product.publishedOnPublication is the effective publication boolean.

Shopify staff documented an exact search-parser requirement for `publication_ids`: numeric publication IDs should be phrase-quoted; unquoted values are parsed differently and can give unexpected results.

Reference: https://community.shopify.dev/t/filtering-products-by-querying-publication-status-to-a-sales-channel-app-does-not-work/9702

A separate Shopify developer-community follow-up on DRAFT products reports that publication_ids behaves like published-only membership there. This is supporting community evidence, not an authoritative contract guarantee.

Reference: https://community.shopify.dev/t/publications-are-empty-for-draft-products/17037/4
