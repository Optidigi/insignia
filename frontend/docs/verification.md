# UI handoff checks — 5 November 2026

The delivered UI is under `frontend/`. Existing `apps/`, `packages/`, `extensions/`, `crates/`, `deployment/` and runtime code match the upstream base. No frontend/backend mapping is included.

Checks on this package:

- All four UI packages build; the customer library also emits JS, CSS and declarations.
- Strict admin example types and customer source/test types pass.
- 12 admin state/read-model tests, 17 customer runtime/separation tests and 74 configuration/quantity tests pass.
- The isolated admin example starts and serves Home, the selected product editor and Methods.
- Maintained-source coverage reports no untyped or unchecked source.
- Independent Sol source review found no backend service imports or missing demo resources in the revised package.

These checks cover local UI/examples, not Shopify authentication, persistence, quote authorization or real cart operations. The backend developer owns integration and its tests. Historical design reviews under `notes/` refer to earlier working checkouts.
