# Product decisions — standing locks

The text below is carried forward from the full 8 October 2026 handoff. For any discrepancy the live ledger and explicit user decisions control. This document is a *reference*, not permission to reopen settled economics or deployment gates.

---

# Locked decisions

This is a compact successor reference. Owner decisions override older candidate assumptions.

## Product / topology

- Greenfield public Shopify app. No migration/import of legacy app data.
- Legacy repo/storefront is visual/reference material only.
- Modular monolith, not microservices.
- One active ProductConfig per Shopify product.
- Draft mutable; published revisions immutable; accepted quotes/orders retain historical meaning.

## Stack

- TypeScript strict mode
- Node.js 24 LTS
- pnpm workspaces
- Astro 7 Node SSR
- Preact for admin/storefront interactive UI
- Polaris Web Components
- storefront/custom UI through Custom Element + Shadow DOM
- direct Konva renderer; no React/react-konva
- Zod 4
- PostgreSQL 18 + pg/Kysely
- dbmate
- pg-boss
- private R2
- Sharp/libvips
- Pino + prom-client
- Vitest / Playwright / dependency-cruiser / GitHub Actions
- Shopify JS SDK isolated adapter-side; pure domain/application logic does not depend on Shopify SDK.

## Product/config semantics

- Different customization/design = different ProductConfig/cart customization group/line as appropriate.
- Compatible size/color variants can aggregate into one customization group when they share production design/revision.
- Different designs are separate groups.
- Setup/unit pricing can be configured at general, decoration method, placement and related dimensions.
- General setup fee stacks with scoped setup/unit pricing.
- Setup fee once per customization group.
- Quantity tiers generally use total customized physical quantity order-wide; plain merchandise excluded.
- Allocation must be deterministic.

## Checkout economics

- Real Shopify variants only; avoid synthetic/customer-visible fee products/lines.
- Accepted customized merchandise price is pre-discount.
- Shopify discounts apply after Insignia price materialization.
- Normal Shopify tax behavior.
- Contextual garment prices.
- Customization priced in shop currency with FX/overrides, accepted presentment frozen at quote acceptance.
- Accepted quote immutable.
- Plus path: lineUpdate.
- non-Plus intended path: same-real-variant one-child lineExpand, gated by qualification.

## Whole-quote authorization

Version v2 is locked:
- installation-scoped Ed25519
- compact binary envelope/member carrier
- complete-set offline verification
- 3 shop-local days
- deterministic
- domain `Insignia\0WholeQuoteAuthorization\0v2\0`
- magic `ISG2`, version2, flags0
- 92-byte header, 22-byte member
- line properties `_insignia_quote_v2` and `_insignia_member_v2`
- engineering guards currently 32 buckets / 200 lines / 10,000 physical qty / 16,000 output; these are not merchant-plan capacity promises.

## Publication / availability

- App Proxy remains storefront/backend transport for config/quotes/uploads/etc.
- Required-product policy trusts only correctly published/access-controlled app-owned policy + Function inputs; buyer markers are not authority.
- Availability Hold v3 is accepted.
- v1/v2 exact history remains supported.
- FIRST_PUBLICATION and MODE_CHANGE use v3; SAME_MODE no hold.
- v3 holds exact currently-effective Publication IDs/direct anchors.
- DRAFT safe hold = zero effective visibility + original anchors still include product.
- restore must match exact original effective semantics; ambiguous restore never blindly compensates.

## Artwork

- private exact SVG/PNG/JPEG originals
- safe PNG/WebP previews
- no arbitrary inline SVG
- append-only replacements
- state path `PENDING_ARTWORK → READY → ARTWORK_LOCKED`

## Billing

- three feature-differentiated plans
- subscription + per-order usage + allowances
- one qualifying paid order produces one usage event
- 14-day chosen-plan trial
- inactive entitlement stops new issue/renew but honors accepted work
- downgrade incompatible configs stop quoting
- actual commercial plan values/prices/handles/features remain owner decisions until explicitly set.

## Retention

- identifying/buyer artwork max six months
- abandoned shorter
- reuse does not reset retention
- pseudonymized audit may persist
- privacy/uninstall erases payloads/derivatives while preserving necessary economics/audit facts.

## Canonical production identity

- `Insignia`
- `https://insignia-app.optidigi.nl`
- App Home `https://insignia-app.optidigi.nl/admin/products`
- server `APP_URL=https://insignia-app.optidigi.nl`
- existing app/client identity retained
- `.com` decision is superseded
- Stitchs and Superfunny are unrelated legacy apps.
