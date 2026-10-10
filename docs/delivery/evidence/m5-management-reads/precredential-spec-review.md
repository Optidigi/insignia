**Spec/correctness: PartnerR1 requires changes; common, SchemaR2 and VersionR6 are CLEAR.** Fresh read-only reviews ran through explicitly configured GPT-6.1-sol/high agents.

| Candidate | Verdict | Freeze SHA-256 |
|---|---|---|
| Common auth | **CLEAR** | `2a16e8efd40a5cbe4f913f4903f3c16ceff351b5cfb448aeed7c42e8859b93f8` |
| SchemaR2 | **CLEAR** | `40e1fc98111dc690a912212cbc08b896054a653976c4fc6637b27c6500c3b608` |
| VersionR6 | **CLEAR** | `441da974395b8bd996708afad5447856bcc74214664d94c36496f6c6dd3dd319` |
| PartnerR1 | **CHANGES_REQUESTED** | `de682d77ec4cdb4b37bffe12cd5e381f2bb1e75775e54de201e338e8c902236e` |

Partner blocker: [collector.mjs:117](/home/serveradmin/insignia-milestone-autonomy-handoff/partner-lifecycle-readonly-preparation-20261010/collector.mjs:117) compares wall time only against the run’s starting time. Dispatch samples of origin, origin+30 seconds, then origin+10 seconds therefore accept a rollback. This contradicts the specified per-dispatch rollback check and can delay allocation-expiry enforcement.

Smallest fix: track the last observed wall-clock sample and reject any decrease before transport dispatch. Add a synthetic regression for rollback above the starting time, then refreeze and obtain fresh reviews.

The CLEAR candidates preserve official noPrompt authentication and exact getter/class binding, schema metadata-only projection and parent validation, original version-query ASTs, fail-closed module classification, null/empty privacy-URI STOP behavior, and closed-stream timeout settlement UNKNOWN. Historical failures remain preserved; bracketing supplies no continuous-Active, ABA or complete-platform proof.

Verification covered the full current implementation and interacting source. All **270 frozen entries**, **604 original archive files**, preservation manifests and relevant Node/compiler pins matched. Independently executed controls passed: five common-auth tests, schema projection/workflow/parser checks, 28 version pure controls and four Partner normalizer checks. These counts overlap.

Writable process/loopback fixtures were source/log inspected, **not independently rerun**. Current official Partner documentation retrieval was **NOT_RUN** under the network prohibition. No native or credential helper execution, SDK import, credential/session/cache access, environment-value inspection, closed raw-capture access or modification occurred.

Every candidate must be CLEAR before native. PartnerR1 currently prevents that condition. Native behavior, artifact readiness, genuine uninstall/privacy qualification, G7 and M5 remain **UNQUALIFIED**; this report supplies no CI-completion or Standards/security verdict.