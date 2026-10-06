# Responses to precredential round5 and integrator metadata probe

No credentials or authenticated Shopify calls occurred. Spec reported no material source finding; security reproduced a pending-event-zero escape at the exported seam. Neither report opened the gate.

Security: the shared allowlist guard now requires pending === null, so quarantined event0 cannot admit or clear a second request. The new first-event regression proves only one dispatch, auth1/read0/update0 and persistent pending0.

Integrator: unauthenticated primary [Shopify product-publishing examples](https://shopify.dev/docs/apps/build/sales-channels/product-publishing) show AppCatalog, MarketCatalog and CompanyLocationCatalog GIDs, matching their concrete __typename. The previous generic Catalog prefix falsely rejected valid metadata. Validation now requires the enumerated concrete typename and matching numeric GID. Three complete fixed adjudications with concrete catalog metadata pass; a typename/prefix mismatch stops before writes. The fixed GraphQL documents and selected fields are unchanged.

Current focused41/41 including100 serial synthetic runs pass. Full root, fresh complete-source reviews and exact-source CI remain required before credentials. All prior round3/4 findings remain closed by retained regressions; none are ignored.
