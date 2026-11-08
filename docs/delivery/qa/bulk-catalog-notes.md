# Bulk catalog preparation

On 8 November the owner clarified that manual testing applies to Insignia, not Shopify catalog entry. The five existing QA drafts were backed up with a native selected-products export. A single CSV import updated those five and created the missing unisex T-shirt. No source-store mutation occurred.

The first preview counted 261 products because product-level Title, Status and Published were repeated on each variant row. It was cancelled before import. Moving those values to the first row of each handle produced the correct preview of six products, 261 SKUs and 29 images. The import was then dispatched once with handle overwrite enabled and publish-to-all-channels disabled.

A fresh native export of the six selected products confirmed all exact tuples, prices, untracked inventory, Draft status, unpublished flags, image counts and variant-image assignments. The original rich fixture was outside the CSV allowlist. The store count changed from 15 to 16.

Private local custody for the QA-only backups is `/tmp/insignia-qa-five-products-before.csv` and `/tmp/insignia-qa-six-products-after.csv`. The manifests record hashes. Keep copies of these files if work moves to another machine.

The initial `shopify store auth list` showed a saved Superfunny connection but no direct rewrite-dev connection. After the owner requested CLI authentication, `shopify store auth --store insignia-rewrite-dev.myshopify.com --scopes read_products,write_products` succeeded through the existing Shopify session. A fresh auth list confirmed rewrite-dev connected on 8 November. The catalog import had already completed through the native CSV importer. Authentication did not mutate products.
