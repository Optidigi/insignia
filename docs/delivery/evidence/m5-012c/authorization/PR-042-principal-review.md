# PR #42 — external principal review

**Verdict: CHANGES_REQUESTED at the current head. Do not merge.**

## Exact reviewed refs
- Base / effective merge base: `9edc6f3c4d186f760a0fe416bfdbccd8f2989f7e`
- Reviewed head: `4f0ee689218545af7161ce6a6fa4d942d319f533`
- Reviewed tree: `8311e5d9cb2d3909f6c290ee7fee52ac1cdc090b`
- Final-head CI observed: 10/10 SUCCESS, all attempt 1
- Native GitHub reviews: none

## Accepted live evidence
The frozen run safely established: exact owned DRAFT fixture; `includedProducts` positive; app-ID and channel-ID `published_status:...-intended` positive; `publishedOnPublication=false`; `publication_ids` search empty; auth1/read7/update0; no cleanup; closed register. M5-011's one-second conflict and unchanged production availability source remain intact.

## Material finding
The frozen association search was `id:10490211467547 publication_ids:339456917787`, with the numeric publication ID unquoted. Shopify staff has documented this exact parser issue: the publication ID should be phrase-quoted; an unquoted numeric value is parsed differently and can return incorrect results.

The retained debug evidence records metadata presence/shape/no-warning only. It does not retain a parsed-search tree proving the unquoted value was interpreted as the intended exact filter. Therefore the association-negative result is unqualified as an exact publication-association predicate.

The code then treats this unqualified result as equivalent to three explicit configured-intent surfaces and makes it sufficient for canonical `INCONSISTENT`. That interpretation is not accepted.

Official semantics independently support the other three facts: `Publication.includedProducts` is inclusion independent of effective publication; `{channel/app}-intended` means added but not yet published; `publishedOnPublication=false` means not effectively published.

## Required correction
Preserve raw live evidence and the frozen run's own classification unchanged as historical execution output. On the same PR branch:
1. quote the future association filter as `publication_ids:'339456917787'`;
2. stop treating `publication_ids` as an equivalent configured-intent vote;
3. classify configured intent only from includedProducts + app-intended + channel-intended;
4. retain publication_ids as separate diagnostic evidence;
5. update report/state/recommendation to distinguish frozen harness classification from principal adjudication;
6. add focused regressions;
7. perform no provider/browser/credential action;
8. return fresh final-head reviews and natural CI.

No merge, cleanup, production adapter correction or successor slice is authorized before rereview.
