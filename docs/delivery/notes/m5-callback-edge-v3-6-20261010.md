# M5 callback edge — Traefik 3.6 source boundary

Research date: 10 October 2026. W8 base: `b2a874089482ec6f98938385da65453bd3b85d11`. Public primary-source research only; no native requests, host access, deployment or provider changes. Historical VPS evidence naming Traefik `v3.6.9` is not proof of today's binary/configuration; independent current metadata read remains pending. Canonical app `insignia-app.optidigi.nl`, Active `1158986629121`, scopes and Functions stay unchanged. Native uninstall-generation authority and privacy remain blocked.

**Shared HTTP router observability false alone is INSUFFICIENT for confidential callback URIs.**

## Verified schema and scope

Both [v3.6.0 schema](https://github.com/traefik/traefik/blob/v3.6.0/pkg/config/dynamic/http_config.go#L79-L95) and [v3.6.9 schema](https://github.com/traefik/traefik/blob/v3.6.9/pkg/config/dynamic/http_config.go#L124-L139) define optional boolean `accessLogs`, `metrics`, `tracing` inside an HTTP router's `observability`. Tagged [router documentation](https://github.com/traefik/traefik/blob/v3.6.9/docs/content/routing/routers/index.md#L807-L907) supplies false examples and explains entrypoint inheritance. A router's explicit configuration overrides entrypoint defaults; global signals must exist to produce output.

Illustrative dynamic-file fragment, containing only a public placeholder hostname:

```yaml
http:
  routers:
    callback-experiment:
      rule: "Host(`callback.example.invalid`)"
      service: callback-experiment
      observability:
        accessLogs: false
        metrics: false
        tracing: false
```

[v3.6.9 observability manager](https://github.com/traefik/traefik/blob/v3.6.9/pkg/server/middleware/observability.go#L116-L195) gates those three signals using this configuration. [Router construction](https://github.com/traefik/traefik/blob/v3.6.9/pkg/server/router/router.go#L209-L266) applies it to selected routers; unmatched requests reach a separate default 404 handler with entrypoint/default observability. Wrong Host, missing router or configuration failure therefore need separate coverage. Host-only matching keeps a future random 256-bit confidential callback path out of routing configuration; it does not hide the incoming URI from the edge.

## Verified exposure paths

- With access logging enabled for the applicable handler, [logger.go](https://github.com/traefik/traefik/blob/v3.6.9/pkg/middlewares/accesslog/logger.go#L171-L262) constructs `RequestPath` using path, raw path and query. Its [field emission](https://github.com/traefik/traefik/blob/v3.6.9/pkg/middlewares/accesslog/logger.go#L326-L364) can keep request/response header values according to field policy. The inspected access logger records body size, not body bytes; that is no all-components body-absence proof.
- Before router selection, [denyFragment](https://github.com/traefik/traefik/blob/v3.6.9/pkg/server/server_entrypoint_tcp.go#L630-L646) runs outside router observability. Its [DEBUG message](https://github.com/traefik/traefik/blob/v3.6.9/pkg/server/server_entrypoint_tcp.go#L711-L725) includes `req.URL.RawPath`. Malformed requests are not uniformly covered by router suppression; the HTTP server also has an independent DEBUG error logger.
- The [recovery middleware](https://github.com/traefik/traefik/blob/v3.6.9/pkg/middlewares/recovery/recovery.go#L37-L50), wrapped around the muxer, logs `req.URL` on aborted requests at DEBUG and recovered panic at ERROR, with panic value/stack. This includes path/query independently of the three switches. Disabling DEBUG alone cannot eliminate the ERROR branch.
- [Proxy error logging](https://github.com/traefik/traefik/blob/v3.6.9/pkg/proxy/httputil/proxy.go#L97-L116) emits error values independently. The optional [fast proxy](https://github.com/traefik/traefik/blob/v3.6.9/pkg/proxy/fast/proxy.go#L153-L160) can construct an error containing an invalid Upgrade header value. Actual proxy mode, plugins and error content are host unknowns; no blanket header/body suppression follows.

## Cloudflare and host unknowns

[Cloudflare HTTP logs](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/) offer full path/query via `ClientRequestURI` and configured custom request headers. [WAF payload logging](https://developers.cloudflare.com/waf/managed-rules/payload-logging/) can retain encrypted matched sensitive values; encryption is not absence or erasure. Origin router settings cannot govern these upstream copies. [DNS-only](https://developers.cloudflare.com/dns/proxy-status/) bypasses Cloudflare's HTTP proxy, but a proxied CNAME chain can still proxy traffic. Current DNS/proxy chain, WAF/Workers/log exports, retention, origin collectors, stderr/journal, backups and TLS behavior are UNKNOWN, not privately safe by default.

## Narrow TCP passthrough alternative — source and inference

Tagged [documentation](https://github.com/traefik/traefik/blob/v3.6.9/docs/content/routing/routers/index.md#L1382-L1408) says passthrough forwards encrypted traffic unchanged. [Manager source](https://github.com/traefik/traefik/blob/v3.6.9/pkg/server/router/tcp/manager.go#L280-L305) installs a raw TCP handler for passthrough, bypassing the terminating `TLSHandler`. [TCP proxy source](https://github.com/traefik/traefik/blob/v3.6.9/pkg/tcp/proxy.go#L25-L73) copies connection bytes; its logs concern connection metadata/errors.

```yaml
tcp:
  routers:
    callback-tls-experiment:
      entryPoints: [websecure]
      rule: "HostSNI(`callback.example.invalid`)"
      service: callback-tls-experiment
      tls:
        passthrough: true
```

The broad docs say TCP precedes HTTP; exact [v3.6.9 dispatch](https://github.com/traefik/traefik/blob/v3.6.9/pkg/server/router/tcp/router.go#L177-L208) checks a specific HTTPS SNI match before specific TCP TLS, then HTTPS/TCP catch-alls. Require a unique ephemeral public hostname with no conflicting HTTP TLS mapping; keep canonical HTTP routers intact. Correctly selected passthrough bypasses shared HTTP recovery and cannot expose decrypted URI/header/body there by construction. This is conditional source reasoning, not live route proof; wrong/missing SNI and route drift can reach shared HTTPS fallback.

The destination must terminate TLS separately, then forward to the existing app-bound loopback receiver. DNS-only with no Cloudflare HTTP proxy, no other terminating CDN, and qualified destination logging are necessary assumptions. TLS key/certificate issuance, dedicated edge process, DNS changes, provider acceptance and allocation are UNKNOWN/unallocated. This may avoid global shared log changes or another VPS; it qualifies neither relay nor callback pipeline.

## Smallest qualification proposal — inference, NOT_RUN

After explicit host-change/resource permission and TLS-edge qualification, qualify one bounded passthrough route to the existing app-bound receiver on `127.0.0.1`, using synthetic nonsecret markers only. Keep the capability path out of config; do not generate/register a real callback URI yet.

Freeze binary digest, resolved routing/entrypoint/logging config and all accessible sinks. Exercise markers independently in path, query, header and body through matched success/reject, wrong/missing SNI/Host, malformed request, backend refusal/timeout and client abort. No native panic induction. Verify TLS termination identity, intended receiver responses and working sink capture; search emitted, buffered and exported records after flush/rotation.

STOP on a marker outside the permitted encrypted receiver record, missing sink/provider visibility, drift, redirect, unexpected route or unverifiable cleanup. The shared HTTP option needs qualified treatment of known ERROR URL logging; a clean finite sentinel run cannot disprove that branch. Passthrough needs proof of bypass and destination controls before real URI generation. Failure means revise the concrete edge/log-copy treatment, not declare privacy passed. Documentation establishes schema and hazards; native qualification, delayed erasure and external-copy/key-backup controls remain separate blocked evidence.
