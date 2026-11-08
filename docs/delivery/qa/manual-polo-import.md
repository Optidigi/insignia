# Manual Polo catalog draft

Date: 2026-11-08

## Destination record

Created one new product through Shopify Admin in the `insignia-rewrite-dev` development store. The saved record is [QA legacy import — Superfunny polo](https://admin.shopify.com/store/insignia-rewrite-dev/products/10590396350747) (product ID `10590396350747`). It remains **Draft**.

The product title is `QA legacy import — Superfunny polo`. Shopify’s suggested category `Polos in Clothing Tops` appeared during entry and is present after reload. No product description or media was added. The product type is unset; the vendor field retained the dev-store default.

## Variant data

Used the source record `gid://shopify/Product/15468473450880` from `legacy-inventory.json`. The exact option order and values were entered as:

- `Kleur`: `Zwart`, `Grijs`, `Navy`, `Rood`, `Blauw`, `Wit`
- `Maat`: `XS`, `S`, `M`, `L`, `XL`, `XXL`, `3XL`, `4XL`, `5XL`, `6XL`, `7XL`

Shopify generated 66 combinations (six colors × eleven sizes). Before saving, I expanded all six color groups and checked the 66 individual rows: each had a price of **$11.95 USD** and quantity **0**. After saving and reloading the product page, the Admin UI showed six groups of 11 variants, each group at **$11.95** and **0 available**.

The USD amount is the authorized numeric QA example in the dev store. It is not a currency conversion or a commercial price-parity claim. The source inventory lists EUR 11.95 and all 66 variants as available; this draft has zero stock, so availability parity remains unresolved. Do not treat this record as a complete or sales-ready legacy import.

No source-store changes, uploads, product configuration, publishing, or writes to other destination products were made.

## Evidence

- [Draft title and status after reload](../evidence/frontend-qa-2026-11-08/qa-legacy-polo-draft.jpg)
- [Option values and six variant groups after reload](../evidence/frontend-qa-2026-11-08/qa-legacy-polo-variants.jpg)
