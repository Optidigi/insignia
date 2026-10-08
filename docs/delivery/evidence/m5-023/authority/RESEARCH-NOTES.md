# Current Shopify contract notes — checked 8 October 2026

Shopify managed installation:
- Shopify installs the app and updates scopes without calling the app.
- CLI apps use managed installation by default when legacy install flow is false.

Embedded authentication:
- embedded apps use App Bridge ID tokens and token exchange rather than a redirect OAuth install callback.
- backend validates the ID token and exchanges it for access tokens.

Access-token roles:
- online tokens are tied to a staff member/session and are appropriate for per-user authorization.
- offline tokens persist beyond a session and are appropriate for background jobs/webhooks/scheduled work.
- new public apps use expiring offline tokens; token exchange can return access+refresh tokens.

Consequences for Insignia:
- durable M3 tenant/install bootstrap is an application responsibility after exact provider identity is established.
- a one-off SQL seed is not a complete public-app install lifecycle.
- staff-sensitive embedded admin continues to require online authorization.
- background credential needs should use the existing encrypted expiring-offline lifecycle.

References:
https://shopify.dev/docs/apps/build/authentication-authorization
https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node
https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration
