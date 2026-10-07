# PR #47 — external principal review

**Verdict: APPROVED for normal merge.**

Exact binding:
- repository/PR `Optidigi/insignia #47`
- base/effective merge base `d0efd626222047a2047573f678b019cd7b1802a9`
- approved head `857e0db43918dada608af8aa63654756673c6ba7`
- approved tree `dcd5aca2e0f4152b9eb07b7b1616f0d309ecf4a7`
- final-head CI 10/10 SUCCESS, all attempt 1
- native GitHub reviews none
- fresh full-source GPT-6.1-sol/high reviews: no unresolved material findings

PR #46 normal merge `d0efd626222047a2047573f678b019cd7b1802a9` has the approved ordered parents/tree.

## M5-016 accepted result

Classification: `DIRECT_ONLY`.

Exact Publication `gid://shopify/Publication/339456917787`:
- exists;
- autoPublish=true;
- supportsFuturePublishing=false;
- AppCatalog `gid://shopify/AppCatalog/188090286363`;
- exact includedProducts contains exact Product `gid://shopify/Product/10495813091611`.

Complete generic discovery:
- `publications(catalogType:APP)` omitted the target;
- `catalogs(type:APP)` omitted the target AppCatalog and target Publication;
- both connections were complete, provider-successful and non-ambiguous.

Therefore exact-ID intent is available only once a Publication ID is already known. It is not a complete discovery authority for arbitrary hidden/non-effective configured intent.

No production correction was implemented. That is correct.

## Cleanup accepted

The exact disposable fixture was archived once.

Final verified state:
- ARCHIVED;
- target publishedOnPublication=false;
- no effective resourcePublications;
- onlineStoreUrl=null;
- publishedAt=null.

Accounting:
- auth1;
- GraphQL6;
- archive update1;
- all other mutations0;
- 7 serial durable events;
- pending null;
- unknown mutations0.

Phase A is closed/sealed and provider authority is false. No more operation on this fixture is authorized.

## Platform adjudication

The v2 design assumes complete configured-intent discovery. Live evidence has disproved that assumption for a real third-party AppCatalog on the pinned stable API.

Do not:
- hard-code Copilot or Publication339456917787;
- treat exact-ID resolution as generic discovery;
- remove the effective-ID subset check while continuing to claim complete configured-intent authority;
- rely on current `channels` as a generic enumeration of every third-party channel.

A future API surface may improve this. Current unstable/release-candidate documentation exposes `allChannels`, but the production app is pinned to a stable version and no current production decision may depend on that future surface.

## New supported guarantee

For the current platform, the strongest implementable hold guarantee is:

1. capture exact effective publication/online-store state before holding;
2. direct-resolve every currently effective Publication ID and confirm this product is included;
3. move to DRAFT and require effective visibility zero while those original Publication anchors remain included;
4. restore the original status;
5. require the exact original effective membership/online-store semantics to return;
6. if a settled restore returns different effective visibility, compensate once back to DRAFT and leave operator-held.

This does not claim complete discovery of hidden non-effective configured intent.

Actual visible scheduled/staged publication remains unsupported/fail-closed.

This is the v3 contract authorized for M5-017.
