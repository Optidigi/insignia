# Manual QA catalog draft — Superfunny trui

## Scope

This record covers a catalog-only QA draft created in the Insignia DEV Shopify Admin UI. It is not a configured Insignia product: no customizer views, methods, placements, artwork, media, or app configuration were added.

- Source: Superfunny public product “Ontwerp je eigen Superfunny trui”, product GID `gid://shopify/Product/15468463686016`, source config `9bdb8dd1-8776-4b00-824d-08b20adb5008`.
- Destination store: `insignia-rewrite-dev` (Shopify Admin route `https://admin.shopify.com/store/insignia-rewrite-dev/products`). The store settings were not changed.
- Destination product title: `QA legacy import — Superfunny trui`.
- Destination product ID: `10590397694235` (`gid://shopify/Product/10590397694235`).
- Destination handle shown in search preview: `qa-legacy-import-superfunny-trui`.
- Destination route after save and fresh reload: `https://admin.shopify.com/store/insignia-rewrite-dev/products/10590397694235`.
- Status: Draft.

## Exact source options and destination tuples

Options were entered from `legacy-inventory.json` without inferred values:

- `Kleur`: `Zwart`, `Grijs`, `Navy`, `Rood`, `Blauw`, `Wit`.
- `Maat`: `XS`, `S`, `M`, `L`, `XL`, `XXL`, `3XL`, `4XL`, `5XL`, `6XL`, `7XL`.
- Shopify Admin reported 66 variants after creation and after a fresh reload. The variant table showed six color groups, each with 11 variants.

## Price and stock

- Source variant base price: EUR 24.95; source config reports all variants available.
- Destination QA example price: USD 24.95 for each of the six color groups. This is the same numeric amount for testing only; it is not an FX conversion or a commercial price-parity claim.
- After reload, each color group displayed 11 variants, `$24.95`, and `0` available. The table reported `Total inventory at Shop location: 0 available`.
- Zero destination stock is a Draft-preparation difference from the source's `available=true`; no inventory was added.

## Manual UI path and verification

1. Opened a new Chrome tab at `https://admin.shopify.com/store/insignia-rewrite-dev/products` and verified the store slug and `/products` path in the visible Shopify Admin UI before selecting **Add product**.
2. Entered the exact QA title and the numeric USD example price, then added the exact source option labels and values from the source inventory.
3. Confirmed Shopify generated 66 variants, six groups of 11, all groups at `$24.95`, and inventory at zero. Set Status to Draft and left the product Uncategorized because the source recipe does not establish a Shopify product category. No product media or description was added.
4. Selected **Save** once. Shopify displayed “Product created” and navigated to `/products/10590397694235`.
5. Reloaded that exact product route. The fresh Shopify UI showed the exact title, Draft status, both option labels and all option values, `Select all 66 on page`, six 11-variant color groups, and `$24.95` in every group. Each group showed zero available.

The parent requested stopping further catalog UI actions after the save had already succeeded. No edits, deletion, publishing, media uploads, Insignia configuration, cart, checkout, or source-store actions followed.

## Screenshot evidence

A post-reload screenshot was captured from the active Shopify Admin tab through CUA and emitted inline in the task output. The visible frame shows the Draft title, both exact option axes and their values, and the first visible color groups and prices; the accompanying fresh accessibility snapshot listed all six group prices and zero quantities. CUA exposed screenshot bytes inline but no supported workspace-file save operation. The separate Chrome DevTools/Playwright screenshot connectors could not attach to the already-running Chrome profile, so no screenshot file is claimed here.

## Provenance

- Source recipe and public source URLs: [legacy-inventory.json](legacy-inventory.json), `fullyVerifiedProducts` entry `ontwerp-je-eigen-superfunny-trui`.
- All product creation and readback above were through Shopify Admin UI. No Admin API, CSV import/export, file picker, OS app, or source Admin interaction was used.
- This is a catalog QA draft only. Do not report it as a complete Insignia customizer import.
