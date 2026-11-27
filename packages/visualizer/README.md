# @insignia/visualizer

This package owns the pure `m5-geometry-v1` sidecar. `geometry.ts` can run in a browser or server preview worker. The browser renderer is in [@insignia/ui-visualizer](../../frontend/visualizer/README.md).

## M2 bridge

M2 `PublishedConfig` (`m2-published-config-v1`) has stable placement and allowed-step IDs but no geometry. Persist the sidecar alongside a versioned draft/revision through the owning application; call `validateGeometry()` and `validateGeometryBridge(sidecar, publishedConfig)` before publication. The bridge requires matching placement IDs and geometry for every allowed step. It does not change M2 economics, quote identity, or publication authority. The integrator owns the actual draft/revision schema and persistence wiring.

Each view owns a default image revision and optional variant/color image revisions. Image dimensions are intrinsic pixels; placement rectangles are normalized image coordinates. A placement can override its normalized rectangle for a variant. Step width/height are fractions of the placement's maximum rectangle, then raster artwork aspect ratio is contained within that step. Optional `physicalMm` is display calibration only, not manufacturing precision. Invalid rectangles are rejected, including extents outside the image. A view without an image, a missing selected placement, and a valid empty placement list project to distinct scene states.

No image URL is saved in the geometry sidecar. `projectScene(state, viewport, imageUrls)` adds transient safe preview URLs to the render scene; a missing URL yields a renderer fallback. Preview raster URLs must refer to safe derivatives, not original artwork. The renderer accepts HTTPS, blob, and PNG/JPEG/WebP data URLs; it never accepts inline SVG markup. M6 supplies real artwork authority and inspection.
