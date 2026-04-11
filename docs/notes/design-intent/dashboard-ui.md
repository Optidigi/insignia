 ---
 status: notes
 tier: 3
 source: figma
 purpose: "Visual + UX reference only. Not implementation guidance."
 do_not_use_for_architecture: true
 do_not_infer_api_contracts: true
 last_reviewed: 2026-02-03
 ---
 
 # Insignia UI Design Intent
 
 ## Overview
 
 -   Enables merchants to configure complex print-on-demand products with multiple views and printable areas.
 -   Provides a centralized dashboard for managing decoration methods (print, embroidery) and pricing rules.
 -   Allows admins to visually define "Canvas" areas on product images where end-users can place designs.
 -   Offers a consolidated view of incoming custom orders with access to production files.
 -   Facilitates a consistent, native Shopify Admin experience for seamless workflow integration.
 
 ## Navigation map
 
 -   **Dashboard Root** (App Entry)
     -   **Products Tab**: Manage product configurations.
         -   **List View**: Overview of all configs.
         -   **Editor**: Create/Edit specific configuration details.
     -   **Settings Tab**: Global app configuration.
         -   **Methods**: Manage printing/stitching types.
         -   **Placements**: Define physical locations (Left Chest, Back).
         -   **Rules**: Set quantity constraints and discounts.
         -   **Uploads**: Configure file restrictions.
     -   **Orders Tab**: View and manage customer orders.
 
 ## Core screens
 
 ### Products Tab (List View)
 
 -   **Purpose**: Overview of all customizable product configurations.
 -   **Primary actions**:
     -   "Create configuration" (Primary button).
     -   Bulk delete (Promoted action on selection).
 -   **Key sections**:
     -   **Filter/Search Bar** (implied standard behavior).
     -   **Data Table**:
         -   Name (Bold).
         -   Status (Badge: Active/Draft).
         -   Targeting (Manual selection count or Tag matches).
         -   Views (Count).
         -   Methods (Badges).
         -   Actions (Kebab menu).
 -   **Important UI states**:
     -   **Loading**: Skeleton or loading spinner.
     -   **Empty**: "Create your first configuration" call-to-action.
     -   **Selection**: Checkboxes enable bulk action bar.
 -   **Success feedback**: Toast notification upon deletion ("Products deleted").
 
 ### Product Editor (Create/Edit)
 
 -   **Purpose**: Detailed configuration of a single product's customization logic.
 -   **Primary actions**:
     -   "Save" (Primary, sticky header).
     -   "Back" (Breadcrumb).
 -   **Key sections**:
     -   **Tabs**: General, Colors, Canvas, Methods.
     -   **General Panel**: Name input, Status selector, Product/Tag selection (ResourceList or Tag input).
     -   **Colors Panel**: Grid of detected colors with Hex code inputs/pickers.
     -   **Canvas Panel**:
         -   **View List**: Sidebar of defined views (Front, Back).
         -   **Visual Editor**: Interactive image area to draw/resize viewports.
         -   **Properties Sidebar**: Viewport name, zoom limits, price adjustments.
     -   **Methods Panel**: Grid of selectable decoration methods.
 -   **Validation & constraints**:
     -   Name is required.
     -   At least one view is recommended.
     -   Canvas areas must be within image bounds.
 -   **Success feedback**: Toast notification ("Configuration saved").
 
 ### Settings Tab
 
 -   **Purpose**: Define global constraints and pricing models shared across products.
 -   **Primary actions**:
     -   "Add Method" / "Add Placement" (Contextual buttons).
 -   **Key sections**:
     -   **Sub-navigation**: Tabs for Methods, Placements, Rules, Uploads.
     -   **Methods/Placements Tables**: List of options with Edit/Delete actions.
     -   **Rules Form**: Min/Max quantity inputs, Volume discount range sliders.
     -   **Uploads Form**: Checkbox list for file types, dropdown for max size.
 -   **Important UI states**:
     -   **Modals**: Used for creating/editing Methods and Placements.
 -   **Success feedback**: Toast notifications for all save/delete actions.
 
 ### Orders Tab
 
 -   **Purpose**: Review and manage incoming custom orders.
 -   **Primary actions**:
     -   "Export" / "Approve" (Bulk actions).
 -   **Key sections**:
     -   **Order List**: Table displaying Order ID, Customer, Status, and Thumbnails of custom designs.
     -   **Status Filters**: Tabs for "To Review", "Production", "Shipped".
 -   **Important UI states**:
     -   **Empty**: "No orders found".
 
 ## Storefront customizer modal flow
 
 (Inferred from Admin Configuration)
 
 1.  **Opening**: User clicks "Customize" on a product detail page.
 2.  **View Selection**: User sees thumbnails of configured views (Front/Back).
 3.  **Upload/Design**:
     -   User uploads an image file (drag & drop).
     -   **Guardrails**: File type/size checked against "Uploads" settings.
 4.  **Positioning**:
     -   User drags/scales image within the "Canvas Area" defined in Admin.
    -   **Guardrails**: Image cannot leave viewport bounds if restricted.
 5.  **Configuration**:
     -   User selects "Decoration Method" (if multiple allowed).
     -   User selects "Placement" (if applicable).
 6.  **Preview**: Real-time visualization using the "Mask" layer (multiply mode).
 7.  **Completion**: "Add to Cart" saves the generated composite info.
 
 ## Reusable UI components (conceptual)
 
 -   **Polaris Page Layout**: Standard container with Title, Primary Action, and Back Action.
 -   **Resource Index Table**:
     -   **Purpose**: Display collection data (Products, Methods, Orders).
     -   **Variants**: Mobile (Card list) vs Desktop (Table).
     -   **States**: Loading (Spinner), Empty (Illustration), Selected (Bulk Actions).
 -   **Kebab Action Menu**:
     -   **Purpose**: Secondary actions for table rows (Edit, Delete).
     -   **Visual**: Three horizontal dots, revealing a Popover list.
 -   **Status Badge**:
     -   **Purpose**: Quick status recognition.
     -   **Semantics**: Green (Active/Recommended), Grey (Draft/Subdued).
 -   **Canvas Visualizer**:
     -   **Purpose**: Admin tool for defining print areas.
     -   **Interactions**: Drag to move, handles to resize, scroll to zoom.
    -   **Visuals**: Dashed borders for areas.
 
 ## Visual style rules
 
 -   **Spacing Rhythm**:
     -   Follows Polaris 4px grid.
     -   Common gaps: `400` (16px) for cards/sections, `200` (8px) for related items.
     -   "Tight" packing for data tables, "Loose" for page layouts.
 -   **Typography Hierarchy**:
     -   **Page Titles**: HeadingLg / HeadingXl.
     -   **Section Headers**: HeadingMd (Card titles).
     -   **Body**: BodyMd (Standard text).
     -   **Meta/Caption**: BodySm + Tone: Subdued (Secondary info).
 -   **Color Semantics**:
     -   **Primary**: Shopify Green (Action buttons, Active states).
     -   **Critical**: Red (Delete actions, Error tones).
     -   **Subdued**: Greys (Secondary text, inactive badges).
     -   **Surface**: White cards on light grey background.
 -   **Interaction Affordances**:
     -   Buttons use standard Polaris hover states.
     -   Table rows highlight on hover.
     -   Interactive Canvas elements show cursor changes (move/resize).
 
 ## Content & microcopy
 
 -   **Actions**: "Create", "Save", "Delete", "Edit", "Cancel".
 -   **Empty States**:
     -   "No views defined": Prompt to add a view.
     -   "No methods found": Prompt to configure settings.
 -   **Labels**:
     -   "Internal Name": Clarifies this is for Admin use.
     -   "Targeting": Manual vs Tag selection.
     -   "Perspective": Front/Back/Side/Detail.
 
 ## Accessibility intent
 
 -   **Keyboard Navigation**:
     -   All form inputs and buttons must be focusable.
     -   Tab order should follow logical flow (Top->Bottom, Left->Right).
     -   Modals must trap focus.
 -   **Focus Behavior**: Standard browser focus rings (or Polaris custom rings) must be visible on active elements.
 -   **Contrast**:
     -   Text must meet WCAG AA standards against backgrounds.
     -   Badges should use high-contrast text colors (e.g., dark text on light backgrounds).
 
 ## Open questions / ambiguous areas
 
 -   **Storefront Mobile Experience**: Specific gestures for the Canvas Editor on mobile touchscreens are not fully defined in the Admin UI.
 -   **Production File Generation**: How the "Views" and "Viewports" translate to the final high-res print file output is backend logic, not visible in UI.
 -   **Currency Handling**: Multi-currency support for "Surcharges" and "Base Costs" is not explicitly visualized.
 -   **Inventory Sync**: How "Product Linking" affects Shopify inventory counts during customization.
 
 This document describes UI intent only. Engineering must define data models, API contracts, and architecture.
 If this doc implies an implementation approach (e.g., how pricing is calculated), ignore it and defer to canonical backend/reference docs.
