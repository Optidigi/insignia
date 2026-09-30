# M4-002 candidate currency exponent provenance

The candidate matrix is in `packages/cart-authorization/fixtures/currency-matrix-v1.json` and is checked against both the TypeScript and Rust implementations. It is a finite authorization admission list, not a claim that all Shopify `CurrencyCode` values are safe or that every ISO code is supported.

The primary ISO 4217 maintenance agency, [SIX Financial Information](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html), publishes [current List One XML](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml). The XML read on 30 September 2026 reported `Pblshd="2026-09-17"`, 47,491 bytes and SHA-256 `33139b438657d1cee116ba737807ea71d19d6de4b90f799a09c56f0cc6a1b0ff`. All admitted codes were compared to the XML `CcyMnrUnts` field. The selected matrix contains known 0-, 2- and 3-minor-unit currencies; it excludes values with unclear commerce semantics, including MGA and MRU, and non-currency/digital values such as `XXX`, `USDC` and `BTC`.

`BGN` is historical after Bulgaria's 2026 euro change and is excluded even though Shopify's broader enum may still contain it. A newly encountered currency fails quote issuance and Function verification until an explicitly reviewed matrix version supports it. The [Shopify Shop API](https://shopify.dev/docs/api/admin-graphql/latest/objects/Shop) provides `currencyCode`; that provider enum is an input shape, not the authorization matrix.

No currency value in this list implies a live Shopify Markets, FX or merchant-capacity acceptance result.
