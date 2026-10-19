# Unattended lifecycle runtime

Source enrollment runs at verified merchant authentication and independently in
worker reconciliation, one current tenant per pass. Worker and web require the
same canonical HTTPS `APP_URL`, client ID and client secret. Use the qualified immutable
runtime artifact and schema-owner migration/grant workflow; this document does
not authorize a release, scope change, deployment or store uninstall.

Before native qualification, verify that access, request, proxy and exception
logs exclude `/api/webhooks/uninstall/*` destination values. Treat a leaked
destination as a credential incident. Never expose subscription URIs through
merchant DTOs, telemetry, support output or public evidence. Only its digest is
stored locally; the provider subscription necessarily retains the private URI.

The ordinary web overlay `deployment/m5-runtime/compose.yaml` adds an exclusive
canonical-host `/api/webhooks/uninstall/` router with priority1100, the existing
web service/TLS resolver, and access logs/tracing disabled for that router.
The base canonical router and global proxy settings remain unchanged. Apply and
verify the rendered overlay, then prove suppression with a non-secret sentinel
on the actual route before registering any private destination. A parsed Compose
PASS does not prove the native proxy or upstream logging configuration.

Use `runtime-grants.sql` with explicit existing role identifiers. The web role
receives authenticated webhook bytes and binds immutable destination authority;
the worker performs expected-generation deactivation and bounded erasure
recovery. Neither role can rewrite destination identity, authority or decisions.
Existing tenant/credential/inbox grants remain necessary and are not widened by
this template. Verify actual effective roles before native use.

Registration records dispatch before IO. A lost response is reconciled by exact
topic/URI readback; it is never recreated blindly. A genuine HMAC callback on the
exclusive dispatched destination can qualify that generation even before create
acknowledgment, without inventing a provider subscription ID. A definitive
no-effect rejection can retry; confirmed missing/drifted registration gets a
new capability while retaining the old immutable binding. Failed provider reads
never establish uninstall.

An authoritative callback affects its exact generation. A newer installation
survives delayed callbacks. Actual shop-privacy receipts can obtain separate
recovery decisions for independently inactive generations; an original BLOCKED
decision is never rewritten. Customer/privacy cleanup and physical object
deletion retain their existing isolated workers and deadlines.

Generic callbacks cannot identify an installation. Their accounting freezes a
trusted local generation ceiling and can record **generation-private cleanup
staged** only after every generation through that ceiling is independently
inactive and has an actual immutable privacy fence. This does not verify that
generic event's purpose, establish physical deletion, or claim erasure of shared
merchant defaults belonging to a newer installation. Expired/unbound legacy
evidence stays an explicit HOLD. The current global subscription is not removed
by source implementation; any app configuration release remains separately
authorized and qualified.

Qualify native registration, delivery, immediate uninstall/response-loss races,
reinstall and cleanup only on an explicitly allocated disposable installation.
Protect rewrite-dev. Local HTTP/PostgreSQL/SDK tests are not native evidence. The [current checklist](../../docs/delivery/state.md) owns installation-specific status, unresolved effects, protected fixtures and exact next owner/operator actions; this runbook does not grant another uninstall or retry.
