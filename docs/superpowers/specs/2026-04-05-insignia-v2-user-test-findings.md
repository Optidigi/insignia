# Insignia V2 — User Test Findings

> **Date:** 2026-04-05
> **Method:** 5 simulated cognitive walkthroughs with distinct personas within target audience
> **Personas:** Sarah (small shop), Mike (mid-size ops), Ana (marketing manager), James (B2B buyer desktop), Priya (mobile logo-later customer)

---

## Critical Issues (Would cause abandonment or major confusion)

### C1. Quantity stepper unusable for bulk orders
**Found by:** James (50 shirts), Priya (12 shirts)
**Issue:** +/- stepper requires 49 or 11 individual taps. No direct number input.
**Fix:** Replace stepper with a tappable number that opens a numeric keypad on mobile, or add a text input field alongside the +/- buttons.
**Design impact:** Update Review screen (mobile + desktop) — replace stepper with input field.

### C2. "Logo later" gives zero post-tap reassurance
**Found by:** Priya (primary), Sarah (secondary)
**Issue:** After tapping "Add my logo later", there's no explanation of HOW or WHEN the customer will provide their logo. No mention of email, order status page, or deadline. Customer commits money without knowing the mechanism.
**Fix:** After tapping logo later, show inline confirmation: "You'll be able to upload your logo from your order status page after checkout. No deadline." Also surface this on the Review screen as "Logo: Will be uploaded after purchase."
**Design impact:** Update Screen 1 (logo-later selected state) + Screen 4 (review summary).

### C3. Product Detail page contradicts itself on completeness
**Found by:** Sarah
**Issue:** Right sidebar shows "Setup progress: Complete" with 5 green checks, but the setup guide banner above says "2 of 3 steps complete." These are different things (sidebar = config completeness, banner = onboarding progress) but they visually contradict.
**Fix:** Remove the "Complete" badge from setup progress when the onboarding guide is still showing. Or: make the setup progress card match the 3-step onboarding (not the 5-point config checklist).
**Design impact:** Update Product Setup Success frame — align messaging.

### C4. "Pending artwork" doesn't explain whose action it is
**Found by:** Sarah
**Issue:** Dashboard says "4 Pending artwork" but doesn't clarify: is the CUSTOMER supposed to upload, or is the MERCHANT supposed to do something? Sarah thought SHE might need to create mockups.
**Fix:** Change "Pending artwork" to "Awaiting customer logos" or "4 customers haven't uploaded their logo yet." Make the action clear.
**Design impact:** Update Dashboard Activity stat card label + needs-attention section.

---

## Major Issues (Cause confusion or friction but user can proceed)

### M1. Placement fee vs method fee confusion
**Found by:** James
**Issue:** On placement screen, "Front Chest +$8.00" looks like a SECOND charge on top of the Embroidery +$8.00 from Step 1. Are they the same $8? Different charges? The total doesn't change, which suggests they're the same, but visually it reads as double-charging.
**Fix:** On placement cards, show the ADDITIONAL cost only. If the placement is included in the method fee, show "Included" (which we already fixed for the first placement). For additional placements, show "+$6.00 extra."
**Design impact:** Already partially fixed (first placement says "Included"). Verify other placements say "+$X extra" not just "+$X."

### M2. Color matching has no preview of generated variants
**Found by:** Ana
**Issue:** Merchant configures hex colors but can't see what the tinted product images will look like until they check the live storefront. No in-admin preview of the multiply-blend result.
**Fix:** Add a preview row below the color mapping table showing small thumbnails of each generated variant (base image × color).
**Design impact:** Update View Detail — Color Matching frame.

### M3. Size step only shows selected size's dimensions
**Found by:** James
**Issue:** Slider shows "Medium — 3.5 inches +$2.00" but doesn't show what Small, Large, or XL are in inches or price. Customer can't compare without sliding through each.
**Fix:** Show all size options as a list or legend below the slider: S: 2" ($0) / M: 3.5" (+$2) / L: 5" (+$4) / XL: 6.5" (+$6).
**Design impact:** Update Size screen (mobile + desktop).

### M4. Translations page — unclear what empty fields mean
**Found by:** Ana
**Issue:** If merchant selects French and leaves fields empty, does the customer see English fallback or blank labels? No indication. "Reset all to defaults" has no confirmation and scope is unclear.
**Fix:** Add helper text: "Empty fields will show the English default." Add confirmation dialog to Reset.
**Design impact:** Update Settings Translations frame.

### M5. No customer email visible on Order Detail
**Found by:** Mike
**Issue:** Order detail shows "Copy email template" but merchant can't see the customer's email address. They have to cross-reference with Shopify admin.
**Fix:** Show customer name + email on the order detail header.
**Design impact:** Update Order Detail frame.

### M6. Quick Start doesn't explain what template does
**Found by:** Sarah
**Issue:** Template dropdown says "T-Shirt" but merchant has no idea what selecting it commits them to. No preview of zones, no explanation.
**Fix:** When a template is selected, show a small preview image of the template silhouette with zones labeled (e.g., "Front: 3 zones, Back: 2 zones").
**Design impact:** Update Quick Start frame.

---

## Minor Issues (Polish improvements)

### m1. Desktop Step 4 still shows dark total bar (if not already fixed)
Check: desktop Review screen may still have the redundant total bar. Mobile was fixed but desktop needs the same treatment.

### m2. Analytics missing conversion rate metric
**Found by:** Ana
"How many people opened the customizer vs completed?" — the most important metric for a marketing manager.

### m3. "Preview" button should be hidden in logo-later flow
**Found by:** Priya
If customer has no logo, Preview shows a blank product. Button should hide or show "Preview not available — no logo uploaded."

### m4. Review screen doesn't show logo-later status
**Found by:** Priya
Summary card shows customization details but doesn't indicate "Logo: pending upload." Should be visible for reassurance.

### m5. Order detail variant shows raw GID, not human-readable name
**Found by:** Mike
Shows variant ID number instead of "Navy / L."

### m6. No link from Order Detail to Shopify order page
**Found by:** Mike
Merchant can't quickly cross-reference with Shopify native order.

### m7. "per item" not labeled on Review pricing
**Found by:** Priya
Footer shows "$60.00 base + $10.00 customization" but doesn't say "per item." When quantity > 1, this is confusing.

---

## Summary Matrix

| ID | Issue | Severity | Users Affected | Design Change Needed |
|----|-------|----------|---------------|---------------------|
| C1 | Quantity stepper unusable for bulk | Critical | James, Priya | Yes — input field |
| C2 | Logo-later no reassurance | Critical | Priya, Sarah | Yes — confirmation copy |
| C3 | Completeness contradiction | Critical | Sarah | Yes — align messaging |
| C4 | "Pending artwork" unclear actor | Critical | Sarah | Yes — relabel |
| M1 | Placement vs method fee confusion | Major | James | Partially done |
| M2 | Color matching no preview | Major | Ana | Yes — add preview row |
| M3 | Size options not all visible | Major | James | Yes — add legend |
| M4 | Empty translation fields unclear | Major | Ana | Yes — add helper text |
| M5 | No customer email on order detail | Major | Mike | Yes — add to header |
| M6 | Template not explained | Major | Sarah | Yes — add preview |
