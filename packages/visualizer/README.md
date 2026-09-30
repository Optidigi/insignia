# @insignia/visualizer

The package has a pure `m5-geometry-v1` sidecar and a client-only direct Konva renderer. `geometry.ts` can run in a browser or server preview worker without a DOM or Konva. `renderer.ts` imports Konva only inside `createVisualizer()`.

## M2 bridge

M2 `PublishedConfig` (`m2-published-config-v1`) has stable placement and allowed-step IDs but no geometry. Persist the sidecar alongside a versioned draft/revision through the owning application; call `validateGeometry()` and `validateGeometryBridge(sidecar, publishedConfig)` before publication. The bridge requires matching placement IDs and geometry for every allowed step. It does not change M2 economics, quote identity, or publication authority. The integrator owns the actual draft/revision schema and persistence wiring.

Each view owns a default image revision and optional variant/color image revisions. Image dimensions are intrinsic pixels; placement rectangles are normalized image coordinates. A placement can override its normalized rectangle for a variant. Step width/height are fractions of the placement's maximum rectangle, then raster artwork aspect ratio is contained within that step. Optional `physicalMm` is display calibration only, not manufacturing precision. Invalid rectangles are rejected, including extents outside the image. A view without an image, a missing selected placement, and a valid empty placement list project to distinct scene states.

No image URL is saved in the geometry sidecar. `projectScene(state, viewport, imageUrls)` adds transient safe preview URLs to the render scene; a missing URL yields a renderer fallback. Preview raster URLs must refer to safe derivatives, not original artwork. The renderer accepts HTTPS, blob, and PNG/JPEG/WebP data URLs; it never accepts inline SVG markup. M6 supplies real artwork authority and inspection.

## Owner-state flow

The application owns `EditorState`, calls `projectScene()` and `visualizer.update()`, and handles `onCommand` with `applyGeometryCommand()` (or its equivalent validated application reducer). `baseVersion` rejects stale commands. Canvas drag/resize emits a normalized `set-placement-rect` command; selection emits `select-placement`. Controls use the same command reducer for view, variant, placement, and step. Konva node positions are restored from the latest scene after each event. `resize()` derives the new fit from the last owner scene rather than accumulating transformed node positions.

The package uses an exact `konva: 10.7.0` manifest pin. The integrator owns the root lockfile and workspace boundary rules. Local test invocation: `pnpm --filter @insignia/visualizer test`; build/typecheck use the package scripts once dependencies are installed.
