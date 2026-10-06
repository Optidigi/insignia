# M5-012C — association-query interpretation correction

## Scope
Correct PR #42 locally only. Do not access Shopify.

## Source correction
In `scripts/m5-012/documents.mjs`, change the association search to exact phrase quoting:

`id:10490211467547 publication_ids:'339456917787'`

Preserve the single quotes exactly inside the GraphQL query. Do not change other live-query semantics.

## Classification correction
Configured-intent consensus uses exactly:
- Publication.includedProducts;
- app-ID `published_status:294412484609-intended`;
- channel-ID `published_status:339456917787-intended`.

`publication_ids` is diagnostic only. It must not force configured intent to INCONSISTENT.

Classification:
- three positives + DRAFT + effective false => `INTENT_CONFIRMED`;
- three negatives + effective false => `NO_INTENT_OBSERVED`;
- disagreement among those three => `INCONSISTENT`.

Do not invent a guaranteed semantic for publication_ids. Official wording says “associated”; community evidence on DRAFT products suggests narrower/published-only behavior. Keep that limitation explicit.

## Evidence preservation
Do not modify canonical live register, qualification, closed receipt, raw request/response evidence, or historical M5-011 evidence.

Reporting must state:
- executed frozen harness classified INCONSISTENT;
- principal review found the fourth predicate unqualified due unquoted search syntax;
- accepted live facts are three qualified intent positives and effective false;
- the closed run never had cleanup authority.

## Tests and return
Add regressions proving:
1. association search contains quoted publication ID;
2. three intent positives classify INTENT_CONFIRMED even when association is empty;
3. disagreement among the three actual intent surfaces remains INCONSISTENT;
4. effective publication remains a separate dimension;
5. this correction cannot retroactively authorize cleanup.

Run applicable focused/root/style/secret checks, fresh GPT-6.1-sol/high Spec and Standards/security reviews, and natural exact-head CI. Return the same PR #42 for principal rereview. Do not merge.

No Shopify/API/browser/credential operation, fixture archive, new product, production availability change, scope/version mutation, M6/M7, activation, RELEASE_BOUND/gate pass or launch.
