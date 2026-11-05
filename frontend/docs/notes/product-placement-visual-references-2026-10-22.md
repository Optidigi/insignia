# Product placement UI references

Official help-center references collected on 22 October 2026. The competitor researcher inspected the two garment configuration captures. Shopify references below are public help recordings and developer examples, not a new logged-in admin DOM audit. Root browser discovery reports local browser use disabled in Work settings.

## Shopify: native editor selection and responsive panels

![Shopify theme editor with preview and contextual settings](https://cdn.shopify.com/shopifycloud/help-center/manual/themes/theme-editor/theme-editor-images/double-sidebar-v2.gif)

- Article: [Theme editor features overview](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/features-overview).
- Wide recording: <https://cdn.shopify.com/shopifycloud/help-center/manual/themes/theme-editor/theme-editor-images/double-sidebar-v2.gif>.
- Narrower-layout recording: <https://cdn.shopify.com/shopifycloud/help-center/manual/themes/theme-editor/theme-editor-images/single-sidebar-v2.gif>.
- Selection recording: <https://cdn.shopify.com/shopifycloud/help-center/manual/themes/theme-editor/theme-editor-images/preview-inspector-hover-v2.gif>.
- Borrow: selection in the preview and the corresponding property panel represent one active object. Give the preview most of the workspace and adapt the property panel as available width changes.
- Limits: this is Shopify's first-party theme editor, not a public drop-in placement component. Its full shell and resizable panel implementation are not implied to be available to embedded apps. The narrower-layout recording is not proof of an actual phone layout.

## Shopify: product setup overview and public implementation example

- [Details pattern with live preview and JSX/HTML](https://shopify.dev/docs/api/app-home/latest/patterns/templates/details).
- [Official two-column visual-editor layout image](https://shopify-assets.shopifycdn.com/shopifycloud/shopify-dev/production/assets/assets/images/app-design-guidelines/layout/visual-editor-two-columns-layout-ADG-CeqavVzP.png), linked from [Layout](https://shopify.dev/docs/apps/design/layout).
- Borrow: editable resource content in the main column, supporting status in the aside, section actions/counts in headers, contextual Save Bar and a breadcrumb back to the list. The Details page's expanded preview/source is a reproducible implementation reference for public controls.
- Limits: the visual-editor layout image is an official schematic, not a production-app screenshot. The old v2.0-rc details URL currently redirects to latest v2.0; these references do not authorize changing the project's pinned runtime.

## DecoNetwork: placement and method eligibility together

![DecoNetwork Manage Product View dialog showing a garment preview, selected print area, allowed processes, and dimensions](https://help.deconetwork.com/hc/article_attachments/14276569590939)

- Article: [Configuring Product Views & Assigning Decoration Areas for Products](https://help.deconetwork.com/hc/en-us/articles/235607368-Configuring-Product-Views-Assigning-Decoration-Areas-for-Products)
- Image URL: <https://help.deconetwork.com/hc/article_attachments/14276569590939>
- Borrow: keep the garment image, active location outline, allowed-method checkboxes, and physical width/height visible in one location editor. The area list remains available beside the selected location, and methods are scoped to each area.
- Source limits: the screenshot shows a setup dialog from a production-management suite; its extra production controls are not requirements for Insignia.

## InkSoft: customer-named regions and physical dimensions

![InkSoft Print Regions tab showing region name, width, height, draw action, and additional-region control](https://help.inksoft.com/hc/article_attachments/46719059589531)

- Article: [Add New Product (Manually)](https://help.inksoft.com/hc/en-us/articles/46724094169371-Add-New-Product-Manually)
- Image URL: <https://help.inksoft.com/hc/article_attachments/46719059589531>
- Borrow: name a placement in customer language, collect its width and height, and offer a direct Draw Region action from the same row. A clear add-region control makes multiple locations discoverable.
- Source limits: the screenshot is a tab within InkSoft's broader product editor; it does not show the product image or method eligibility in the same capture.
