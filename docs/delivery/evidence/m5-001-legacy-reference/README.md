# M5-001 bounded legacy visual reference

## Verified source

Read-only shallow clone of public `Optidigi/insignia-legacy` resolved commit
`1a2d94bedb7e8a01f1ce65b748deaddce9dd83c3` on 30 September 2026.
The following paths and lines were inspected at that exact commit:

- `app/components/storefront/CustomizationModal.tsx` lines 124, 271–311,
  361–382, 1371–1450: upload → placement → size → review wizard, selected
  placement zoom, product image metadata, and preview composition.
- `app/components/storefront/PreviewCanvas.tsx` lines 150–185:
  per-view percent geometry, selected size scale factor, and variant view data.
- `app/components/storefront/NativeCanvas.tsx` lines 171–190, 343–382:
  percent center/max-width/max-height over a contained garment image,
  scaled by the placement's size step and fitted to the logo's aspect ratio.
- `app/components/storefront/storefront-modal.css` lines 1–100,
  2205–2291, 2394–2423: mobile-first custom storefront modal, tokens,
  desktop split layout, and reduced-motion branches.
- `docs/storefront/modal-spec.md` and
  `docs/storefront/rendering-pipeline.md`: written legacy behavior and
  the percent-to-pixel reconstruction rules.

The legacy modal is buyer-facing; M5-001 is a merchant Admin editor. Visual
references here inform the preview geometry and state coverage only. Legacy
pricing, cart, upload, and backend behavior do not enter M5.

## Source-derived reconstruction

`synthetic-reference.svg` depicts four bounded, non-identifying states:
initial view, placement selected, method and size step, and quantity/review.
It is a **synthetic schematic**, not a screenshot or visual parity proof.
The shirt outline, labels, positions, and colors are invented; the state
sequence and the percent-center/size-step relationship are source-derived.
No customer data, artwork, credentials, or remote storefront content are
included. The earlier restricted writer's failed DNS read is an isolated
writer-session limitation; the integrator later verified the commit and files
above through a read-only clone.
