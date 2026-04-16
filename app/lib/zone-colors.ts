/**
 * Shared zone color definitions and assignment logic.
 * Used by both ZonePricingPanel (dot colors) and PlacementGeometryEditor (canvas colors).
 */

export const ZONE_COLORS = [
  { hex: "#2563EB", fill: "rgba(37, 99, 235, 0.25)", stroke: "#2563EB" },
  { hex: "#10B981", fill: "rgba(16, 185, 129, 0.25)", stroke: "#10B981" },
  { hex: "#F59E0B", fill: "rgba(245, 158, 11, 0.25)", stroke: "#F59E0B" },
  { hex: "#8B5CF6", fill: "rgba(139, 92, 246, 0.25)", stroke: "#8B5CF6" },
  { hex: "#EC4899", fill: "rgba(236, 72, 153, 0.25)", stroke: "#EC4899" },
];

/** Returns a stable color index based on a string ID hash. */
export function stableColorIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % ZONE_COLORS.length;
}

/** Get the zone color object for a placement ID. */
export function getZoneColor(id: string) {
  return ZONE_COLORS[stableColorIndex(id)];
}
