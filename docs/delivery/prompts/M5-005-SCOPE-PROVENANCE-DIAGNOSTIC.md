# M5-005 — read-only scope-provenance diagnostic

## Outcome and authority

Explain, as far as bounded observations permit, why the M5-004 direct client_credentials bearer returned `currentAppInstallation.accessScopes: []` despite historical nine-grant observations. Return one diagnostic/evidence PR with the cross-surface facts, supported interpretation, remaining uncertainty and the smallest proposed next action. **Diagnosis, not repair or another availability experiment.** An honest unresolved result is valid when the allowed observations do not distinguish the causes.

Execution requires the owner-forwarded launch in this package and the verified normal merge of PR #30 at head `30f00935f90f7564d426838487b3a6e5f37a9e01`, tree `e772af245c7f09c59d398656e16305adfeaea005`, from base `a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30`. External approval: `PR-030-principal-review.md`. Approval alone is not resource authority.

One root operator/writer; two fresh independent read-only local review axes. Use actual **GPT-6.1-sol/high**, the established tooling and repository-pinned skills. Only the root operator may use the named existing credential route. Public documentation and GitHub reads are allowed; Shopify writes other than the single expressly allowed token issuance are not.

## 1. Establish the exact starting point

Verify the real PR #30 merge, its ordered parents and approved tree, then create one new branch from that exact main. Stop on ref mismatch or new work requiring adjudication; preserve it. Import the approval, this brief and concise AGENTS/state pointers on the new branch, not as a new commit on PR #30 before merge.

Read AGENTS, ledger, operating model, M5-004 report and complete live register/identity/cleanup evidence, tooling register, M5-002R's scope chronology and PR-028R3's subsequent disposition. Inspect only relevant tracked app configurations and retained sanitized receipts. A local TOML is a declaration, not proof of what is currently released or granted. M5-004's auth response did not preserve the token scope field; do not invent its value or search private logs for the bearer.

Retain M5-004's closed register and original observations byte-for-byte. The diagnostic uses a new canonical register at `/home/serveradmin/insignia-m5-005-handoff/run`; its budget is whole-slice across all restarts/worktrees. Existing history or an interrupted/unknown request stops ordinary re-entry rather than resetting counters or reissuing a token.

Completion: the approved baseline and historical/current distinctions are recorded, without asserting a cause.

## 2. Build one small, read-only diagnostic

Expected changes: `scripts/m5-005/`, focused tests, minimal root/CI wiring, `docs/delivery/evidence/m5-005/`, report and delivery pointers. Production packages/apps, SQL, protocol, auth flows, M5-004 operator and its grant guard remain unchanged. Reuse the established simple reservation/lock, protected credential parsing and source-binding patterns as appropriate; do not generalize a fixture mutation engine, add a new evidence/authentication service, install skills or build a platform-wide preflight framework.

Before credential metadata/content access or authenticated browser/API work: commit/freeze executing source and relevant built inputs, run focused negative tests and applicable root checks, complete both fresh full-source safety reviews and all applicable exact-source CI. Review the actual outbound allowlist and sanitizer. Evidence-only later changes remain distinct from the live source. A source change after observing a live failure does not authorize another live attempt.

Use the actual diagnostic entry point for tests. Cover wrong identity/host/API/method/document, no mutations, exhausted/unknown/reopened register, no duplicate request or late continuation, missing/null/malformed/empty scope distinctions, disagreements between surfaces and nonleaking auth projection. Use synthetic credentials/HTTP only. No arbitrary target/query/credential-path flags in the live entry point. Count outbound attempts, including failures; disable retries and redirects.

Completion: one reviewed operator can issue only the four requests below, and cannot interpret any scope result as mutation permission.

## 3. Exact resource and permission envelope

| Identity | Required value |
|---|---|
| App | gid://shopify/App/429028933633 |
| Client | 1443cf6d03d39edae7c101a943c5c684 |
| Store | insignia-rewrite-dev.myshopify.com |
| Shop | gid://shopify/Shop/105501393179 |
| Installation | gid://shopify/AppInstallation/1054356963611 |

Credential route only: `/home/serveradmin/.local/share/insignia-public-app/server.env`, variables `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`. Reuse private file/directory ownership checks and data parsing; do not source/execute the file, inspect unrelated entries, search alternate credentials, print secrets or request their contents from the user. This own-organization development diagnostic is not the public-merchant production authentication design.

| Whole-slice operation | Maximum |
|---|---:|
| Existing client_credentials exchange to this store | 1 |
| Fixed identity/granted-scopes GraphQL request | 1 |
| Fixed app-declared-scopes GraphQL request | 1 |
| GET `/admin/oauth/access_scopes.json`, same bearer | 1 |
| Product, inventory, publication, policy, key, Function, billing or commerce mutations | 0 |
| Scope/consent/install changes, credential rotation, token refresh or alternate-token issuance | 0 |
| Shopify CLI app execute/dev/clean/deploy/release or app-version/configuration changes | 0 |

The three API reads all use the single newly issued bearer in memory. No product/catalog data reads, live introspection, pagination, query fallbacks, grant probes by attempted writes or second samples. Capture local start/receipt times; bound responses to 128 KiB and each request including credential/body handling to a finite 12-second maximum. Reservation precedes dispatch, and expired work cannot initiate a late request. Unknown outcomes consume their allowance and do not permit automatic replay. Use ordinary dependency/GitHub/public schema tools separately; they do not grant more Shopify calls.

### Optional existing-session native inspection

After the same offline gate, the root may inspect **two relevant read-only Dev Dashboard views** for this exact app: Versions/current released-version details, and the app/development overview showing preview status if available there. Use an already authenticated browser session and the established exact-app navigation. No login/consent flow, embedded-app launch, credentials/settings-secret page, save/create/publish/release/install/development action or broad account exploration. If a view is unavailable, record NOT_OBSERVED and continue only the independently permitted diagnostic.

Retain only displayed app/version identity, released-versus-draft label, scope declaration, preview status and observation time. Do not export cookies, tokens, complete screenshots containing account details, network traces or UI request bodies. The three-call API budget is for the explicit diagnostic requests; native UI background traffic is not independently counted and must not be represented as part of a globally complete HTTP count. These two view inspections are a separate bounded permission, not permission to replay internal Dashboard APIs.

## 4. Capture and compare the surfaces once

**Token response.** Perform the one allowed client_credentials exchange with the existing route. Validate a usable bearer/expiry in memory. Persist only HTTP outcome, observation times, numeric expiry and a sanitized scope projection: field presence, JSON type, valid normalized handles, and duplicate/malformed indicators. Missing, null, malformed and explicitly empty remain distinct. Never persist or hash the full auth body, access token, secret, headers or any bearer-derived identifier. A digest of a safe projection must be labelled as such, not a raw-response digest. Keep the existing token request format; changing it to test another hypothesis is not authorized.

**First GraphQL read.** POST only to the existing `/admin/api/2026-07/graphql.json`, using the M5-004 identity document's fields:

```graphql
query M5005Identity {
  shop { id myshopifyDomain plan { partnerDevelopment displayName } }
  currentAppInstallation { id app { id apiKey } accessScopes { handle } }
}
```

Require the exact shop/app/client/installation/development identity before further programmatic API reads. Scope equality is deliberately **not** the identity gate for this read-only diagnostic: an empty result is evidence to compare. This does not relax M5-004 or any production authorization guard. Identity failure, unusable authentication, timeout/unknown work or inability to verify the target ends programmatic work.

**Remaining two reads.** With that same bearer and verified identity, inspect:

```graphql
query M5005DeclaredScopes {
  currentAppInstallation {
    id
    app { id apiKey requestedAccessScopes { handle } optionalAccessScopes { handle } }
  }
}
```

and one GET to `https://insignia-rewrite-dev.myshopify.com/admin/oauth/access_scopes.json` with no query parameters. The GET is an explicit diagnostic exception, not adoption of REST for product implementation. Validate the GraphQL documents against the pinned 2026-07 schema using public/offline tooling before live work. A documentation redirect to `latest` is not an API upgrade. If a metadata field cannot be validated offline, mark that entire request NOT_RUN rather than experimenting with alternate live documents.

For these two independent reads, a permission/schema/shape response is a recorded diagnostic outcome, not a retry trigger. The other expressly allowed read may still execute when exact identity and a usable bearer remain established; token-invalid/identity-mismatched/unknown pending work ends all programmatic requests. Do not reinterpret an error/missing field as an empty array. Record field-level presence/type and exact validated handles; allowlist any retained error codes/messages and safe request/version identifiers instead of dumping responses or headers.

Completion: every permitted surface has one bound observation or an explicit NOT_RUN/NOT_OBSERVED reason; no further attempt occurs even if nine grants now appear.

## 5. Diagnose without silently reconciling conflicts

Present one chronological matrix separating:

- historical pre-preview empty and post-preview/cleanup nine-grant observations, their CLI/preview route and exact refs;
- M5-004's direct client_credentials identity result and its source/time;
- this diagnostic's token-associated scopes, installation scope view, REST scope view and app-declared scopes;
- any directly observed current released-version declaration/preview status, separately from local configuration.

Do not request `availableAccessScopes` as evidence of grants: all requestable scopes are not installed permissions. Likewise, requested/optional scopes alone do not prove what a token can do or what an exact released version contains.

Use falsifiable interpretations, not a predetermined diagnosis. Agreement on empty token/granted/declaration views supports a configuration/context explanation but does not prove who changed it or when. A nonempty token/REST view with an empty GraphQL view establishes a discrepancy to investigate, not permission to bypass the guard. Nonempty declarations with empty grants do not identify a repair by themselves. A new all-nine result proves that observation only; it does not erase the earlier empty result or authorize the product experiment. The method may narrow the cause without proving it.

Return the strongest supported explanation, competing explanations not excluded, and the smallest subsequent repair or qualification proposal with exact resources and permission needed. No preview, new app version, scope approval, reinstallation, credentials switch or M5-004 run may execute here. No architecture decision is reopened merely because the development access contexts differ.

## 6. Deliver and stop

Commit minimal sanitized observations and request counts, exact live/final source distinctions, the comparison/interpretation, cleanup status and remaining prerequisite. Close only the new operator's settled resources; retain its register and preserve all shared infrastructure and historical processes. No cleanup mutation is needed in this read-only slice.

Obtain fresh full-source completed-change Spec/correctness and Standards/security reviews and all applicable final-head CI. Retain the root/no-retry 100-case stress and existing regression checks; use the pinned workspace scripts. Do not rerun the unchanged 100001-row benchmark solely for this diagnostic; bind unchanged inputs. DB-free skips and separately executed integration evidence stay explicit. Preserve any failed CI attempt; an unchanged-head infrastructure retry is reported as a retry, never first-attempt success. Do not repeatedly rerun application failures to obtain green.

Return **one diagnostic PR and stop for principal review**. Its merge, access repair, availability retry, full M5/G6/G7 acceptance, RELEASE_BOUND/recovery, M6/M7, production activation and launch remain unauthorized.

## Skills and references

Use repository-pinned `diagnosing-bugs` for captured-response comparison and falsifiable diagnosis; `tdd` with tests/mocking references for the operator; `code-review` for the two independent axes; `writing-for-agents` for records; `handoff` for transfer. Scope and owner authority override skill defaults. `grilling` is only for a genuinely new product/architecture decision, not a repeated baseline interview.

Public primary references checked by the principal on 2 October 2026; documentation is not store evidence:
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant — token response scope field and own-organization route requirements.
- https://shopify.dev/docs/api/admin-rest/usage/access-scopes — the documented single granted-scope GET.
- https://shopify.dev/docs/api/admin-graphql/2026-07/objects/App — app scope metadata; web selector may redirect, so validate the fixed query offline.
- https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes — requested versus granted scope concepts.
