// design-fees: single source for the env-flag check. ALL design-fees code
// imports from here; nothing else in the app reads DESIGN_FEES_ENABLED.
//
// When this returns false, the entire subsystem is dormant:
//  - Admin UI sections do not render
//  - /apps/insignia/config returns designFees: null
//  - /apps/insignia/price returns priceResult.designFees: []
//  - /apps/insignia/prepare returns pendingDesignFeeLines: []
//  - GC cron no-ops
//  - No DB writes to DesignFee* tables
//
// Public `insignia` deployment ships with this unset/false. Only the private
// `insignia-custom` instance (Stitchs) sets DESIGN_FEES_ENABLED=true.

export function designFeesEnabled(): boolean {
  return process.env.DESIGN_FEES_ENABLED === "true";
}
