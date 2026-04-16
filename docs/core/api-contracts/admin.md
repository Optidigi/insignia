# Admin API contract (canonical)

This file is the canonical reference for backend `/admin/*` endpoints consumed by the embedded dashboard.

If an admin endpoint is used by the dashboard, it must be documented here.

## Authentication

All `/admin/*` endpoints:

- MUST require `Authorization: Bearer <shopify_session_token>`.
- MUST validate the token and authorize the shop on **every request** (do NOT cache token validation).

### Session token validation requirements

Session tokens from App Bridge are **short-lived (1 minute)** and auto-refreshed per request. Devs commonly mistake them for persistent session tokens.

**Validation pattern (REQUIRED):**

1. Extract token from `Authorization: Bearer <token>` header.
2. Verify the JWT signature against Shopify's public key.
3. Reject tokens issued more than 2 minutes ago (handle clock skew).
4. Return 401 on signature mismatch or expiration (App Bridge will retry with fresh token).
5. Decode the JWT payload to get the shop domain and user ID.

**Implementation checklist:**

- [ ] Validate JWT signature on every request (not cached validation).
- [ ] Reject tokens older than 2 minutes.
- [ ] Handle 401 gracefully in frontend (App Bridge will retry).
- [ ] Never store session tokens in database or cache.
- [ ] Use Shopify's `@shopify/shopify-app-express` middleware if available (handles validation automatically).
- [ ] Include the shop domain in authorization decisions (verify resolved shop matches request context).

**Anti-pattern (will cause intermittent 401 errors):**

```js
let cachedTokenValid = false;

app.use((req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (cachedTokenValid) {
    // ❌ WRONG—token expires after 1 minute
    res.locals.authorized = true;
    return next();
  }
  // ... validate and cache result
});
```

**Correct pattern:**

```js
app.use((req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }
  // Validate fresh token on EVERY request
  try {
    const decoded = jwt.verify(token, SHOPIFY_PUBLIC_KEY);
    // Confirm issued within last 2 minutes
    if (Date.now() - decoded.iat * 1000 > 120000) {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.locals.shop = decoded.dest;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});
```

External reference:

- Session tokens: https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens

## Product configs

Minimum required resources:

- `ProductConfig` (see [`../data-schemas.md`](../data-schemas.md)).

Endpoints:

- `GET /admin/product-configs`
- `POST /admin/product-configs`
- `GET /admin/product-configs/:id`
- `PUT /admin/product-configs/:id`
- `DELETE /admin/product-configs/:id`

## Merchant settings

Shop-level settings.

### Placeholder logo (Logo later)

The merchant MAY upload a placeholder logo image used when a buyer chooses "Logo later".

If not configured, the storefront falls back to a bold `LOGO` text placeholder.

Endpoints:

- `GET /admin/settings`
- `PUT /admin/settings`

Canonical references:

- `../storefront-config.md` (placeholderLogo)
- `../svg-upload-safety.md`

## Decoration methods

Methods define the available decoration options (e.g., Embroidery, DTG) and map to variant pools.

Endpoints:

- `GET /admin/methods`
- `POST /admin/methods`
- `PUT /admin/methods/:id`
- `DELETE /admin/methods/:id`

Canonical references:

- `../data-schemas.md` (DecorationMethod)

## View images (manual per-color, MVP)

In MVP, merchants provide per-color view images manually.

Endpoints (suggested):

- `GET /admin/product-configs/:configId/views`
- `POST /admin/product-configs/:configId/views` (create a view perspective)
- `PUT /admin/product-configs/:configId/views/:viewId` (rename/reorder metadata)

### Per-variant image assignment

- `PUT /admin/product-configs/:configId/views/:viewId/variants/:variantId/image`

This endpoint sets/updates the `imageUrl` for a given view+variant combination.

## Placement editor (Konva)

Dashboard persists placement definitions and per-view geometry.

Canonical saved output contract:

- `../placement-editor.md`

Endpoints (suggested):

- `GET /admin/product-configs/:configId/placements`
- `POST /admin/product-configs/:configId/placements`
- `PUT /admin/product-configs/:configId/placements/:placementId`
- `DELETE /admin/product-configs/:configId/placements/:placementId`

- `GET /admin/product-configs/:configId/view-configurations?variantId=<gid>`
- `PUT /admin/product-configs/:configId/view-configurations?variantId=<gid>`

### Duplicate view configuration

- `POST /admin/product-configs/:configId/view-configurations/duplicate`

This copies geometry + step schedules from a source variant to a target variant, and leaves images to be swapped.

### Reorder placements

- Intent: `reorder-placements` on view editor route
- Payload: `order` (JSON array of placement IDs in desired order)
- Validation: array of non-empty strings, no duplicates
- Updates `displayOrder` for each placement with shopId ownership check

### Reorder steps

- Intent: `reorder-steps` on view editor route
- Payload: `placementId` + `order` (JSON array of step IDs in desired order)
- Validation: array of non-empty strings, no duplicates
- Updates `displayOrder` for each step with 3-level ownership check (placement → view → config → shop)

## Orders (Logo later)

Dashboard must list order customizations and show `artworkStatus` per customized line item.

Endpoints:

- `GET /admin/orders?state=open|closed`
- `GET /admin/orders/:id` (order detail; includes preview rendering data + secure download links)
- `POST /admin/orders/:id/lines/:lineId/artwork` (upload/attach artwork, transitions `artworkStatus` to `PROVIDED`)

### Secure asset downloads

Because embedded admin requests must be authorized, the dashboard should download assets by fetching bytes with Authorization.

Endpoints (recommended):

- `GET /admin/logo-assets/:logoAssetId/download?format=svg|png`

Notes:

- Response MUST set `Content-Disposition: attachment; filename="..."` and require Authorization validation.
- All image URLs in the order detail response MUST be signed with short-lived TTL (10 minutes).
- Do not expose public storage keys; use backend streaming or short-lived signed URLs.
- Never store secrets in line item properties (visible in Shopify Admin); use only IDs/hashes.

Implementation guide:

- `../../admin/order-detail-rendering.md`

Canonical references:

- `../data-schemas.md` (artworkStatus, OrderLineCustomization, LogoAsset)
- `../../admin/orders-workflow.md`
- `./webhooks.md`
- `../variant-pool/implementation.md`
