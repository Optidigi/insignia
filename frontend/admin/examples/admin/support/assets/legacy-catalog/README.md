# Public legacy product fixtures

Retrieved 20 October 2026 using read-only public storefront requests. These are local demonstration fixtures, with no production writes, checkout, artwork upload, customer information, orders, sessions or credentials. Product photographs remain third-party imagery; inclusion does not claim ownership or a new license.

The fixture catalog is `../../legacy-catalog.json`. It contains these actual customizable Superfunny products:

| Product | Public product page | Selected public variant | Color |
| --- | --- | --- | --- |
| Hoodie | https://superfunny.nl/products/ontwerp-je-eigen-superfunny-hoodie | 56991766053248 | Zwart |
| Polo | https://superfunny.nl/products/ontwerp-je-eigen-superfunny-polo | 56992114442624 | Blauw |
| T-shirt | https://superfunny.nl/products/ontwerp-je-eigen-superfunny-t-shirt | 56980145176960 | Zwart |

Each product's `configUrl` records the public Shopify app-proxy request, with its actual product and variant GIDs. Product identity was checked against each public `/products/<handle>.js` response. All 11 size variants are the exact same-color variants returned by that config, including original size labels and prices. `methods` and global `placements` preserve the public configuration fields and step factors. The catalog intentionally excludes unrelated shop settings, fee products, placeholder logos, translations and product-media lists.

Each JPG without a `-preview` suffix is the original, unmodified byte sequence served by that config's `views[].imageUrl`, rather than a generic catalog photo. The JSON records the source URL with its temporary delivery signature query removed, full image dimensions, and SHA-256. The unsigned asset path identifies provenance; it may require a freshly issued public storefront delivery URL to download again. The photographs were inspected together at thumbnail size. The hoodie and T-shirt are black in all four views. The polo is blue in all four views. The initially inspected black polo config supplied a blue back photo. Selecting its actual blue variant produced consistent front, back and side photos, so the fixture uses that real blue config throughout. No photograph was recolored or substituted.

The `-preview.jpg` derivatives use Sharp 0.35.5, JPEG quality 85, and an uncropped proportional resize inside 1200 by 1200 pixels without enlargement. They total 538,919 bytes across all 12 views. The JSON records `previewFilename`, `previewWidth`, `previewHeight` and `previewSha256` separately. Original `width` and `height` remain the measured original dimensions, which range from 1000 to 6000 pixels per side. `reportedWidth` and `reportedHeight` are null because the public config response did not report image dimensions. Browser fixtures should serve the preview files with their preview dimensions. These derivatives preserve the complete source canvas and therefore preserve the percentage geometry.

## Geometry

`placements[].geometryByViewId[viewId]` is the exact legacy value. A null entry means the placement does not belong to that view. `views[].placements` is a convenient projection containing only that view's non-null geometry, with the original placement ID and name. Numeric precision is preserved.

The four raw fields are percentages of the complete source image:

- `centerXPercent` and `centerYPercent` are the rectangle center.
- `maxWidthPercent` and `maxHeightPercent` are the full rectangle extent.
- Each original placement step's `scaleFactor` multiplies both extents uniformly. The artwork is then fitted within those bounds while preserving its aspect ratio.

For the current center-based geometry contract, divide each of those four percentages by 100. Map `scaleFactor` to both step width and height fractions. Do not treat centers as upper-left coordinates, apply image cropping, derive geometry from garment silhouettes, or replace these bounds with generic T-shirt zones. Original view names, perspectives, placement labels and `calibrationPxPerCm` are retained. Calibration is historical public configuration data; it is not an independently measured garment dimension.

This mapping agrees with the local sibling legacy sources `docs/core/storefront-config.md`, `app/lib/services/storefront-config.server.ts` and `app/components/storefront/NativeCanvas.tsx`. The public response already resolves its selected variant overrides. It does not expose the underlying admin configuration hierarchy, so the fixture makes no claim about the unpublished default settings.
