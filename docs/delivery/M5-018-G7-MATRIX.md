# M5-018 G7 criterion matrix

IN_PROGRESS: local checks and the gated live observation are not final acceptance. Each final criterion receives PASS, BLOCKED_PLATFORM, BLOCKED_RELEASE_BOUND, NOT_APPLICABLE with reason, or FAIL. Local synthetic evidence is kept separate from actual embedded observations. Supported browser coverage remains subject to M10 requalification.

| Criterion | Offline seam/evidence | Live obligation |
|---|---|---|
| Cold embedded launch | Built Astro shell; hydration, authenticated DTO | Stable designated installation |
| Product deep link | Actual production-bundle route | Stable embedded product route |
| Reload | Cookie-free mobile and two-tab browser | Current installation |
| Back/forward | Two-tab browser native back navigation | Platform navigation where applicable |
| Mobile/cookie-restricted | Mobile UA/touch viewport, cookie-free bearer transport | Actual supported device/cookie policy |
| Expired identity | HTTP/auth expiry; mounted page clears private state | Real session expiry where safely available |
| Installation generation | Fresh install check per auth; stale browser request discarded | No reinstall mutation authorized |
| Permitted staff | Signed SDK online staff integration | Current permitted staff |
| Underprivileged staff | Read-only/missing scopes reject mutations | Alternate existing permitted identity, if available |
| Exact shop/install | Current tenant/install/provider identity binding | Designated installation only |
| Cross-shop identifiers | Authenticated HTTP negatives and durable tenant fences | No unrelated-shop access |
| Stale/revoked install | Per-request current installation, no grant cache | No uninstall/revoke operation authorized |
| Private SSR/fragments | Built shell contains no private DTO; API authenticates every request | Stable app document |
| Header mutations | Actual HTTP commands require bearer | Real app save/publish only if stable app capable |
| CSRF/origin/fetch metadata | Missing/wrong Origin and cross-site rejection | Existing chosen bearer model |
| No long-lived custom session | Cookie-omitting fetch; no browser session workaround | Actual embedded identity |
| Idempotent save/publish | PG command digest/replay and HTTP activation reentry | Bounded fixture only if required and safe |
| Ambiguous save | Browser exact durable readback and retained exact request | No blind replay or fabricated result |
| Polaris/Preact hydration/events | Pinned real custom elements on built bundle | Stable iframe scripts/CSP |
| Focus/form behavior | Focused numeric input and owner rerender | Actual embedded components |
| UI/canvas synchronization | Direct Konva owner/scene roundtrip; negative renderer | Actual embedded preview |
| No React/react-konva | Dependency/boundary checks | Same frozen bundle |
| Native refresh | Authenticated refresh/reload with local-edit preservation | Stable embedded refresh |
| Two-tab stale edits | Two real browser tabs, CAS409, explicit winning draft | Existing app state without overwrites |
| Grant-cache refresh | Current online exchange/install on every auth; expired identity | Current actual grants |
| Entitlement/readiness refresh | Production Partner projection and mounted refresh fail closed | Current configured commercial policy |
| Late activation state | Mounted late ACTIVE/pending truth with unsaved edits retained | Actual durable activation if released app capable |
| Production bundle | Astro production server, SDK bundling, CSP/runtime controls | Frozen build and stable app binding |
| FIRST_PUBLICATION/MODE_CHANGE v3 | PG HTTP path, production v3 adapter, immutable evidence | Accepted v3 mechanics; no new lifecycle experiment |
| SAME_MODE no hold | PG HTTP path, no extra status writes | No manufactured hold |
| Historical v1/v2 recovery | Full application/Shopify/PG compatibility and recovery regression | Historical registers never reopened |
| Rehold/restoration operator UX | Existing v3 compensation/claim regression plus state projection | No intentional mismatch live |
| Atomic effective pointer/evidence | PG coordinator transaction/fences | Trusted release required |
| Requested versus effective | Separate immutable IDs and truthful waiting/held/operator states | Never label request effective early |
