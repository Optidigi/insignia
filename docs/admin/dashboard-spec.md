# Insignia Admin Dashboard - Embedded App Documentation

> **Last updated**: 2026-04-10 (terminology fixes, legacy notes cleaned up)
> **Original version**: 3.1.5 (January 29, 2026)
> **Status**: Reference spec. Some sections predate V2 implementation — canonical schemas are in `docs/core/data-schemas.md`.
> **Audience**: Backend Developers & Systems Integrators

---

## TABLE OF CONTENTS

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Data Schemas & The "Contract"](#data-schemas--the-contract)
4. [Feature Behavior Guide](#feature-behavior-guide)
5. [Mobile & Responsiveness Standards](#mobile--responsiveness-standards)
6. [Performance & UX Standards](#performance--ux-standards)
7. [Integration Points (What must exist)](#integration-points-what-must-exist)
8. [Backend integration checklist](#backend-integration-checklist)
9. [Setup Notes](#setup-notes)
10. [Protected Files](#protected-files)

---

## EXECUTIVE SUMMARY

The **Insignia Admin Dashboard** is a Shopify Embedded App designed to manage product customization configurations and operational workflows inside Shopify Admin (via App Bridge). 

**Critical Goal**: This frontend is the UI layer; a backend is required for persistence, Shopify API communication, and any secure operations.

**Current Status**: The core tabs (`Home`, `Decoration methods`, `Products`, `Orders`, `Settings`) are responsive and follow Shopify Admin visual patterns.

---

## ARCHITECTURE OVERVIEW

### 2.1 The "Embedded" Model (Shopify Admin)

- **Shell**: The outer frame (Sidebar, TopBar) is provided by Shopify Admin.
- **Navigation**: `<NavMenu>` from `@shopify/app-bridge-react` injects links into the Shopify Admin sidebar.
- **Routing**: `react-router-dom` (`MemoryRouter`) handles in-app navigation without full reloads.
- **UI Library**: Polaris v13 for UI consistency.

### 2.2 Authentication & Security (Admin)

- **Session tokens (JWT)**: The dashboard uses Shopify App Bridge session tokens.
- **Backend verification**: Admin requests to the backend include `Authorization: Bearer <token>` and must be verified by the backend.
- **No cookie auth**: Avoid relying on cookies for embedded admin auth.

---

## DATA SCHEMAS & THE "CONTRACT"

Canonical schema definitions live in:

- [`../core/data-schemas.md`](../core/data-schemas.md)

This dashboard spec should not redefine shared schemas. Any contract changes belong in the canonical schemas file.

### Legacy schema notes (non-canonical)

Earlier drafts of this dashboard spec referenced fields not present in the canonical schemas:

- `ProductConfig.allowedMethodIds`
- `ProductView.imageUrl`, `viewports`
- `Viewport.x`, `Viewport.y`, `Viewport.width`, `Viewport.height`, `Viewport.priceAdjustment`

Treat these as historical notes until reconciled into canonical schemas.

---

## FEATURE BEHAVIOR GUIDE

### 4.1 Product configuration editor (Products tab)

What the dashboard must support:

- Merchants can create/update/delete product customization configurations.
- Merchants can associate configurations with one or more Shopify products.
- Merchants can define print areas (placements) for each product view with positioning on a Konva canvas and pricing via size tiers.

What the backend must provide (implementation-agnostic):

- A secure way to store and serve configuration JSON and related assets.
- Validation and persistence for configurations, including auditability as needed.

**Note**: Placement geometry is stored per-view (shared across variants by default) with optional per-variant overrides via `VariantViewConfiguration`. See `docs/core/data-schemas.md`.

### 4.2 "Logo Later" workflow (Orders tab)

- **Scenario**: Customer skips logo upload at checkout (`_logo_status: 'pending'`).
- **Dashboard behavior**: Orders show a "Missing Logo" state and the merchant can trigger the reminder workflow.

**Current MVP Behavior (Manual Email) — UX REQUIREMENT (exempt from de-prescribing):**

- The UI must include a location to manage the reminder email template (subject/body, variables).
- The "Send logo reminder email" button must be disabled (greyed out) and show a small, Shopify-aligned help/popup explaining: automated sending is "Coming soon" and merchants should send the reminder manually for now.
- The UI should still offer a "Copy template" / "Copy customer email + link" flow so merchants can do the right thing quickly.

---

## MOBILE & RESPONSIVENESS STANDARDS

- **Mandate**: The app must not require horizontal scrolling for core content.
- **Tables**: On mobile breakpoints, table-like data must remain usable (for example, card-based layouts).
- **Touch**: Interactive controls should be comfortably tappable.

---

## PERFORMANCE & UX STANDARDS

- Use Polaris components and design tokens.
- Avoid layouts that shift heavily while loading (skeletons/placeholders are acceptable).

---

## INTEGRATION POINTS (WHAT MUST EXIST)

| Area | Dashboard expectation | Backend responsibility (high-level) |
| :--- | :--- | :--- |
| Shopify product selection | Merchant can link configs to Shopify products | Provide a way to search/select products and validate product IDs |
| Order visibility | Merchant can view relevant orders/customization status | Provide an order listing endpoint backed by Shopify data + app data |
| Auth | Dashboard calls are authenticated | Verify App Bridge session tokens on every admin call |

---

## BACKEND INTEGRATION CHECKLIST

- All admin endpoints are protected by Shopify session token verification.
- Theme-editor link provided for merchants to enable the storefront App Embed Block (opens in new tab).

---

## SETUP NOTES

1. Install dependencies: `npm install`
2. Run dev server: `npm run dev` (starts Shopify tunnel + theme extension)
3. See `docs/RUN_APP_TEST_STORE.md` for full setup instructions.