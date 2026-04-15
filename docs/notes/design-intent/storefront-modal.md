 ---
 status: notes
 tier: 3
 source: figma
 scope: storefront-modal
 purpose: "Visual + UX reference only. Not implementation guidance."
 do_not_use_for_architecture: true
 do_not_infer_api_contracts: true
 last_reviewed: 2026-02-03
 ---

> **Note (2026-04-16):** This document predates the v0.6.0 storefront modal v2 redesign. The canonical storefront spec is `docs/storefront/modal-spec.md`. Key changes: 4-state conditional size step, B2B per-size quantities, method badge, redesigned method cards, gradient total bar, swipe-to-dismiss preview sheet.

 # Insignia Storefront Modal Design Intent
 
 ## 1) Entry points
 
 *   **Trigger**: A prominent "Customize" or "Add Logo" call-to-action button on the Product Detail Page.
 *   **Preconditions**: The user must be viewing an eligible product.
 
 ## 2) Modal layout anatomy
 
 *   **Header**: 
     *   Left-aligned title corresponding to the current step (e.g., "Upload your artwork").
     *   Right-aligned "Close" icon button.
     *   Below the title row: A horizontal step indicator (tabs) showing progress (Upload > Placement > Size > Preview > Review). Current step is highlighted; completed steps are interactive (allow navigation back).
 *   **Body**: 
     *   Occupies the majority of the modal height.
     *   Scrollable vertically if content exceeds viewport height.
     *   On desktop: Centered content layout with distinct input areas vs. preview areas.
     *   On mobile: Full-screen takeover with stackable elements.
 *   **Footer**: 
     *   Pinned to the bottom (sticky).
     *   Contains price summary (Estimated Unit Price) on the left (if applicable).
     *   Contains primary navigation actions (Back, Next/Add to Cart) on the right.
 
 ## 3) Step-by-step flow
 
 ### Step 1: Logo Upload
 *   **Purpose**: Capture the user's artwork file or declare intent to provide it later.
 *   **User Actions**:
     *   Drag and drop a file into the drop zone.
     *   Click the drop zone to open the system file picker.
     *   Select "I'll provide artwork later" to skip upload.
     *   Remove an uploaded file to select a different one.
 *   **Required Inputs**: One valid image file OR an explicit "Logo Later" selection.
 *   **Validation**:
     *   File type must be an image format (supported formats listed).
     *   File size must not exceed the defined maximum.
 *   **Error States**:
     *   Invalid file type alert.
     *   File too large alert.
 *   **Success Feedback**:
     *   Drop zone changes appearance (e.g., green border).
     *   File name is displayed.
     *   Success message (e.g., "Upload successful").
 *   **Navigation**: "Next Step" button becomes enabled only after valid input.
 
 ### Step 2: Placement Selection
 *   **Purpose**: Choose where the logo will be applied on the garment.
 *   **User Actions**:
     *   Toggle placement options on/off via clickable tiles.
     *   View "Recommended" vs "Other" categories.
 *   **Required Inputs**: At least one placement must be selected.
 *   **Validation**: "Next" button is disabled if selection count is zero.
 *   **Feedback**:
     *   Selected tiles show a distinct active state (border color change, checkmark).
     *   Price summary updates dynamically as selections are added/removed.
 
 ### Step 3: Size Selection
 *   **Purpose**: Adjust the scale of the logo for each selected placement.
 *   **User Actions**:
     *   Adjust a slider control to scale the logo from "Very Small" to "Very Big".
     *   Cycle through multiple selected placements (if applicable) to adjust them individually.
 *   **Required Inputs**: A size value for every selected placement (defaults provided).
 *   **Feedback**:
     *   Visual preview updates in real-time to reflect the slider value.
     *   Price modifier text (e.g., "+$1.00") updates next to the size label.
     *   Pagination indicator shows progress through multiple placements (e.g., "Position 1 of 2").
 
 ### Step 4: Preview
 *   **Purpose**: Verify the customization on different product views (Front, Back, Side).
 *   **User Actions**:
     *   Navigate through a carousel of product images.
     *   Observe the logo placed on the correct view (e.g., Back placement only visible on Back view).
 *   **Interaction**: Carousel arrows and pagination dots.
 
 ### Step 5: Review & Quantity
 *   **Purpose**: Input order quantities per garment size and finalize the request.
 *   **User Actions**:
     *   Input integer values for desired garment sizes (XS, S, M, etc.).
     *   Review a text summary of the product and selected customizations.
     *   View the final total price breakdown.
 *   **Required Inputs**: Total quantity across all sizes must be greater than zero.
 *   **Validation**: "Add to Cart" button is disabled if total quantity is zero.
 *   **Feedback**:
     *   Total Item count updates instantly.
     *   Total Price updates instantly.
     *   Success message/toast upon clicking "Add to Cart".
 
 ## 4) State inventory
 
 ### Normal States
 *   **Initial Upload**: Clean drop zone, disabled "Next" button.
 *   **File Selected**: Populated drop zone with "Remove" option, enabled "Next" button.
 *   **Selection Active**: Placement tiles highlighted.
 *   **Review Summary**: Full breakdown of costs visible.
 
 ### Loading States
 *   **Canvas/Preview Loading**: When switching steps or views, the preview area may show a spinner overlay while the product and logo images are composited.
 
 ### Empty States
 *   **No File**: Default state of Step 1.
 *   **No Placements**: Default state of Step 2 (if no pre-selection).
 *   **Zero Quantity**: Default state of Step 5.
 
 ### Error States
 *   **Upload Error**: Immediate alert or inline error message if file validation fails.
 
 ### Disabled/Blocked States
 *   **Navigation Block**: "Next" actions are grayed out/non-interactive until step requirements are met.
 
 ## 5) Microcopy & labels
 
 *   **Buttons**: "Next Step", "Back", "Next Position", "Continue with Placeholder", "Add to Cart".
 *   **Upload**: "Upload your artwork", "We'll apply it to your products instantly", "Or", "I'll provide artwork later".
 *   **Placements**: "Recommended", "Other Locations", "Est. Unit Price".
 *   **Sizes**: "Very Small", "Small", "Normal", "Big", "Very Big".
 *   **Review**: "Order Summary", "Product", "Customizations", "Size Breakdown", "Total Items".
 *   **Warnings**: "Are you sure you want to close? Your customization progress will be lost."
 
 ## 6) Accessibility intent
 
 *   **Keyboard Navigation**: 
     *   The user must be able to Tab through all interactive elements (inputs, buttons, tiles).
     *   The "Close" button must be reachable via keyboard.
     *   `Esc` key should trigger the close confirmation.
 *   **Focus**: 
     *   Focus should be trapped within the modal when open.
     *   When changing steps, focus should logically reset to the top of the new content area or the first input.
 *   **Readability**: 
     *   Text contrast must meet WCAG AA standards.
     *   Price additions (e.g., "+$5.00") must be clearly associated with their parent option.
 
 ## 7) Visual style rules
 
 *   **Typography**: 
     *   Headers: Bold, larger size, dark text.
     *   Body: Regular weight, readable gray for secondary text.
     *   Labels: Uppercase, tracking-wide for section dividers (e.g., "RECOMMENDED").
 *   **Spacing**: 
     *   Generous padding inside the modal body.
     *   Consistent gap between form elements.
 *   **Color Semantics**:
     *   **Action Blue**: Primary buttons, active borders, active slider tracks.
     *   **Success Green**: Upload success state, positive feedback icons.
     *   **Neutral Gray**: Borders, secondary text, disabled states.
 *   **Interaction Cues**: 
     *   Hover effects on all clickable tiles and buttons.
     *   Cursor change to pointer for interactive elements.
 
 ## 8) Open questions / ambiguous areas
 
 *   **Mobile Behavior**: Is the "Close" button positioning different on mobile (e.g., bottom sheet handle vs top right icon)?
 *   **Preview fidelity**: Should the logo multiply/blend with the fabric texture, or just sit on top?
 *   **Long Filenames**: How should extremely long filenames be truncated in the upload success view?
 *   **Step Navigation**: Can the user jump to Step 4 from Step 1 if they have already visited it, or must they go linear every time?
 *   **Currency**: Does the modal need to support multiple currency symbols or formats?
 
 This document is UI intent only. Implementation details (data, APIs, architecture) must be defined elsewhere.
 This document describes UI intent only. Engineering must define data models, API contracts, and architecture.
