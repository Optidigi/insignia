READY_FOR_SINGLE_PERMITTED_EXCHANGE_AND_READ

No remaining actionable findings in the authorized sources.

- Exclusive durable `wx` guard precedes register read; both operations are reserved before credential loading or dispatch.
- One fixed-target `client_credentials` exchange and one fixed read-only Admin query; no retries or redirects.
- Each request has a 12-second deadline and 128 KiB response bound. Failed and oversized bodies are cancelled; `finally` aborts every request.
- Exact app, client, shop, domain, installation and development-store identity are checked. Success requires `write_products`, without historical nine-grant substitution.
- No secret, bearer, raw auth body or raw provider error is persisted or printed.
- Loader extraction matches the existing protected route byte-for-byte. Provenance hashes match, including the extraction’s terminal newline.

Source review only; no helper execution, credential access, network, browser, Shopify CLI, delegation or writes. This is not principal approval.