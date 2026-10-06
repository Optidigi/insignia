# PR #42 — external principal rereview

**Verdict: APPROVED for normal merge at corrected final head.**

Exact binding:
- Base/effective merge base: `9edc6f3c4d186f760a0fe416bfdbccd8f2989f7e`
- Approved head: `022f5ea238444e3ae2fcd93bb571162ccde63fd6`
- Approved tree: `759634634ba8e2362ff6736fe4412e8fe2178614`
- PR state at rereview: open, non-draft, unmerged, mergeable
- Current main: exact base above
- Native GitHub reviews: none
- Final-head workflows: 10/10 SUCCESS, all attempt 1

The correction from prior reviewed head `4f0ee689218545af7161ce6a6fa4d942d319f533` is one commit. It exactly implements the principal finding:
- future association filter is `publication_ids:'339456917787'`;
- configured-intent consensus uses only `includedProducts`, app-ID intended and channel-ID intended;
- association remains diagnostic-only;
- three positive intent surfaces with DRAFT/effective-false classify `INTENT_CONFIRMED`;
- disagreement among the three actual intent surfaces remains `INCONSISTENT`;
- effective publication remains separate;
- historical frozen M5-012 `INCONSISTENT` output and all raw live evidence remain unchanged;
- the closed historical register gains no retroactive cleanup authority.

Focused 35/35 and all 14 permitted root stages passed. Fresh GPT-6.1-sol/high Spec and Standards/security reviews report no unresolved material findings. Production availability source/build and M5-011's one-second conflict remain unchanged.

Principal adjudication of the existing live evidence is therefore: **configured intent observed / effective publication false**. Cross-transition invariance is still not proven, and no production adapter correction is approved here.
