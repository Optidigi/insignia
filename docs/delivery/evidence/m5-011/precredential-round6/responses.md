# Response to precredential round6

The gate stayed closed. No credentials or authenticated Shopify calls occurred. Spec reproduced a malformed-scope readback mismatch; security reported no independent source finding. Both full reports remain preserved.

Adapter-read scope entries are now validated for object/string-handle shape before grant checks dereference them. Malformed entries enter the existing response-selection fallback, delivering the original bounded response to the unchanged production parser. Well-formed required-grant loss and baseline grant drift still stop before mutation.

Four new direct-versus-wrapped cases cover a null scope entry initially, a null entry after acknowledged DRAFT, a null handle after DRAFT, and a primitive scope entry initially. Failure kinds and adapter-read counts match the direct production port; malformed post-DRAFT reads return provider_shape with no cleanup. Current focused45/45 including100 serial synthetic cases pass. Fresh full-source reviews, root checks and exact-source CI are still required before credentials.
