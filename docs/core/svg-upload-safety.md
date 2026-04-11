# SVG upload safety (canonical)

SVG uploads are allowed for buyer-provided logos, but SVG must be treated as untrusted input.

This document defines the safety policy for accepting, storing, and serving SVG files.

## Rules (MUST enforce)

### 1) Accept only expected inputs

- SVG MUST be <= 5MB.
- Backend MUST reject SVGs that contain external references (remote URLs) after parsing.

### 2) Sanitize server-side

- Backend MUST sanitize SVG server-side before storing it as a “safe SVG”.
- Sanitization MUST remove scripts, event handlers, and unsafe elements/attributes.
- Sanitization MUST be performed with a maintained sanitizer.

Recommended baseline implementation (Node): DOMPurify running server-side on an up-to-date jsdom DOM.

### 3) Storage policy (final)

- Backend MUST NOT store or serve an unsanitized SVG.
- Backend stores:
  - Sanitized SVG (for production download), and
  - A raster PNG preview (for Konva rendering).

### 4) Rendering policy (final)

- Storefront Konva rendering MUST use the raster preview PNG.
- Dashboard Konva rendering SHOULD also use raster previews.

### 5) Safe serving (final)

- Sanitized SVG MUST NOT be served as a publicly navigable inline document.
- If a merchant needs the vector, serve it only via an authenticated admin download endpoint and force download (e.g., `Content-Disposition: attachment`).

## References

- DOMPurify server-side guidance recommends using jsdom and keeping it up to date.
- Avoid minimal “strip <script> tags only” sanitizers; some have known bypasses.
