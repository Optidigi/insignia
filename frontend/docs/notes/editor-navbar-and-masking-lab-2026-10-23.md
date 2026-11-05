# Editor actions and isolated foreground experiment

23 October 2026. Current checkout: `insignia`. Experimental copy: sibling `masking-editor-lab` at the same starting commit plus the current frontend working state. No production APIs, renderer, contracts or dependencies are changed by the experiment.

## Current editor

- Keep Save draft (secondary) and Publish (primary) adjacent and visible. Save draft remains present after publication; it is disabled when clean.
- Move Preview to the canvas toolbar. It changes sample artwork, so it belongs near the canvas rather than competing with product release actions. It toggles back through Exit preview and does not automatically expand/scroll the phone canvas.
- Ctrl/Cmd+S in the outer host targets the explicit Save draft action. Previously it targeted the page primary action, which became Publish. Inner form shortcuts and modal guards remain.
- Rename the phone overflow to Editor actions.
- Group customer options at the bottom of the placement inspector. Keep the existing artwork-later control and show a disabled Allow custom placement switch with a visible explanation. It describes customer movement within this area. There is no enabled promise, stored flag or production behavior yet.

These remain local frontend previews. Publish is still the existing browser-tab draft/published simulation, not Shopify publication.

## Evidence and checks

Ten independent Luna xhigh research reviews covered action hierarchy, custom placement, Konva libraries, competitor occlusion, model risks, photo-editor UX, scope, alternative libraries, mask interaction and an independent scope skeptic. Their conclusions were checked against the code and actual browser observations; proposals to add unrelated editing tools were declined.

Read-only Shopify observations: native theme-editor Save and actual product-media editor for product 15468416336256. The latter uses a focused file editor with Information, Crop and transform, Resize, Draw, Color background and Generate. Draw exposes a brush-size slider in a tool panel. No Shopify data was saved or uploaded.

Current checks: scoped admin TypeScript and Biome pass. Three focused browser workflows pass: header alignment, draft/publication lifecycle, and explicit save/preview separation at desktop/390/320. Polaris App Home v2.0 validation artifact `artifact-9151404c-48d7-419e-9c74-74d6de62dcad`, revision 2, passed.

## Why the photo experiment stays separate

The actual foundation is Konva, not Canva.js. The strongest match is an optional, non-destructive foreground mask on a view: original garment photo below customer artwork, masked source-photo details above it. No photo pixels are destroyed. The lab introduces no full photo-editor dependency and changes no production print output.

[Teeinblue's merchant mockup workflow](https://support.teeinblue.com/en/article/add-multiple-image-layers-to-mockup-jp618q/) uses transparent foreground layers above print areas for fingers and similar occlusion. [Shopify's media editor](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/media-editor) already covers general crop/resize/orientation work. These are different jobs; introducing a full photo app for cords would burden the common workflow.

The separate copy contains a cited library comparison and runnable brush prototype. Main checkout contains none of its mask modules or model extensions. See sibling `masking-editor-lab/docs/delivery/notes/masking-lab-runbook-2026-10-23.md` for use, checks and limits. The lab is an evaluation copy, not a decision to ship masking.
