# M5-007R4 — fixed-client configuration capture

## Outcome and authority

All three newly authorized official CLI operations succeeded once. The before/after reads identify active **insignia-1**, `gid://shopify/Version/1146748534785`. The initially empty capture directory produced a public exact-client configuration with explicit CLI fields `scopes = ""`, `optional_scopes = []`, `use_legacy_install_flow = false`, `application_url = "https://example.com"`, `embedded = true`, empty redirects and webhook API `2026-07`.

These are **CLI-transformed configuration fields**, not raw provider response fields, effective grants or a complete released-extension manifest. No access repair or platform gate is claimed.

Owner-forwarded [R4 brief](prompts/M5-007R4-FLAG-CORRECTION-AND-CAPTURE.md) and attributed [R3 principal disposition](M5-007R3-principal-disposition.md) authorize this flag correction and conditional sequence, not a merge of this PR. Actual GPT-6.1-sol/high root is the sole writer/operator. Repository-pinned diagnosing-bugs, writing-for-agents, code-review and handoff are applied within the active permission boundary. [Authority receipt](evidence/m5-007r4/authority.json).

Remote main was verified before execution and again before branch creation at **9dc728b21d58a1687fae7221e64225373bbbbecb**, tree **4177381a98d2d3b07264572a01ce53abdb7e565e**. This docs/evidence branch starts there. PR34's prior normal merge and reviewed head remain untouched. Final successor refs belong in the PR packet/body after commit.

## Eligible launch and local input

Direct package-file/symlink checks verified retained isolated Shopify CLI **4.8.2** and exact `/home/serveradmin/insignia-pf001-tools/shopify/node_modules/@shopify/cli/bin/run.js`. Exact pinned Node `/home/serveradmin/.local/opt/node-v24.21.0-linux-x64/bin/node --version` returned **v24.21.0**; no Shopify version/help command was run. All 25 [retained source hashes](evidence/m5-007r4/reused-launch-policy.json) matched before and after, and the source-resolved Oclif registry stayed filesystem-confirmed absent. The [retained restricted GPT-6.1-sol/high launch review](evidence/m5-007r4/reused-launch-security-review.md) and [safe same-launch settings](evidence/m5-007r4/reused-launch-settings.json) are reused, not newly repeated or represented as authentication proof.

Previous sanitizer and synthetic-control source are byte-identical to the R3 checked archive; ten fresh pure controls passed before dispatch. The private raw-output-first loop was reused with the authorized argv correction. No unapproved CLI/plugin/install modification occurred. The earlier global-install incident remains **untouched, unused and unresolved**.

Fresh version context contained exactly one default `shopify.app.toml`, byte-identical to tracked `shopify.app.m5-002.toml` at the verified base, source blob **9075867d0b8e9701ef5067d9b220532fe49495ba**, SHA256 **e94b9b5e3e597c131d55f3bb91726f69d0bea662eb55470d2a9e3f0b5ffd503e**. Only the filename changed. No extra app/extension TOML, dependency tree, .env, preference or credential/cache copy was seeded, and ancestors had no app config. Its nine scopes are **historical local input only**, never the captured result. The separate command-2 capture started empty.

Every child used the previous fresh allowlist: original HOME/USER/LOGNAME; pinned Node PATH plus /usr/bin:/bin; CI=1, SHOPIFY_CLI_NO_ANALYTICS=1, LANG=C.UTF-8, TZ=UTC, TERM=dumb, NO_COLOR=1, FORCE_COLOR=0. SHOPIFY_CLI_FORCE_AUTO_UPGRADE and other non-allowlisted overrides were absent. Noninteractive; no TTY; closed stdin. Same-account official cache/renewal stayed on its normal route; no manual credential read/copy occurred. This is three logical operations, not a literal HTTP/token packet count.

## Actual sequence and initial checker limitation

Each reservation preceded launch. [Public argv/cwd/environment/times and results](evidence/m5-007r4/register.json) record the entire three-slot run.

| Slot | Operation after exact pinned Node + entrypoint | Exit / duration | Outcome |
|---|---|---|---|
| 1 | `app versions list --client-id 1443cf6d03d39edae7c101a943c5c684 --path <fresh-version-context> --json` | 0 / 4.137 s | Expected active version returned |
| 2 | `app config link --client-id 1443cf6d03d39edae7c101a943c5c684 --path <fresh-empty-capture> --file-name m5-007r2` | 0 / 4.239 s | New exact-client scratch TOML produced |
| 3 | Exact repetition of corrected slot 1 | 0 / 2.630 s | Same active version returned |

No `--config` was passed. No retry, fallback, reset, force, help or other CLI command was used. All processes stayed within the 120-second process-group deadline; no signal, timeout or remaining owned descendants. Consumption is **3/3**, zero remaining.

**Preserved initial checker defect:** slot 1's CLI exited 0, but the local projection initially labelled VERSION_OR_OUTPUT_MISMATCH because it compared only the bare numeric spelling. Inspecting the retained output established exact expected `gid://shopify/Version/1146748534785`, active insignia-1. Before any slot-2 launch, root recorded [the GID adjudication](evidence/m5-007r4/command-1-gid-adjudication.json), preserving the [initial projection](evidence/m5-007r4/command-1-initial-projection.json), then accepted only the same exact numeric ID or exact Shopify Version GID for subsequent projection. This did not accept another version or override a failed CLI command. [Dispatch loop](evidence/m5-007r4/capture-loop-at-command1.py.txt) and [final loop](evidence/m5-007r4/capture-loop.py.txt) remain separately attributable; unchanged sanitizer source is separate. No source-compatible guess or retry replaced the actual observation.

The CLI's JSON version list does not separately return App GID/org. Target binding is its fixed-client lookup plus exact-client local input and the exact known version; it is not a new direct identity query. Before/after equality is temporal corroboration, not an atomic lock against an unseen switch-and-revert. Current preview status and released extension identities remain **NOT_OBSERVED**.

## Captured fields and provenance

[Captured TOML](evidence/m5-007r4/captured-app-config.toml) is non-operative evidence, copied byte-for-byte after public-value/redaction checks; SHA256 **55088880dae5e48293dcf88a58b75c0f62f9c95e2d30943314f310510ea8fc14**. It was generated into an initially empty directory, never merged from the local nine-scope file. [Selected fields](evidence/m5-007r4/capture-fields.json).

| Field | CLI-generated result | Qualification / comparison |
|---|---|---|
| client_id / name | exact designated client / Insignia | Fixed-client generated selection; not a new separate App-GID read |
| access_scopes.scopes | explicit empty string | Current transformed CLI field; not raw remote spelling or current installation grants; agrees directionally with earlier M5-005 explicit API empties |
| optional_scopes | explicit empty array | CLI mapping/schema defaults may contribute; not independent proof of raw optional-list emptiness |
| use_legacy_install_flow | false | Consistent with M5-006 native active-release detail |
| application_url / embedded | example.com / true | Transformed value; URL normalization/defaults may contribute; matches earlier native display |
| auth.redirect_urls | explicit empty array | CLI transformation/defaults may contribute; not a raw response claim |
| webhooks.api_version | 2026-07 | CLI-produced value; matches earlier native display |
| complete released extension manifest | NOT_OBSERVED | Configuration export is not an extension export; missing sections are not zero extensions |
| dev preview / current effective grants | NOT_OBSERVED | No browser or direct Admin request was authorized in R4 |

Installed mapping `kE/Zo` and `UW` fallback behavior were already audited in M5-007R/R2. This run did not capture intermediate module responses or which default contributed to each field. The row-level caveats therefore remain. A generated empty field is not relabelled an explicit raw provider empty.

## Scope history and one proposed next decision

[M5-005](M5-005-REPORT.md) retains its direct, earlier token/requested/optional/installation/REST EMPTY observations. [M5-006](M5-006-REPORT.md) retains Active/Released insignia-1 and example.com/embedded/legacy/webhook display, with scope lists and extensions unobserved. R4 now adds an empty-directory official CLI configuration corroborated by the same active-version bracket. The earlier nine dev grants remain an earlier context-specific observation, not a repair target or a current guarantee. No revocation, provider defect or historical scope-change cause is inferred.

**One proposed access remedy, contingent on a decisive preservation prerequisite:** a separately authorized development-access configuration amendment from the captured baseline, changing only required declarations from empty to the nine retained development handles and leaving optional scopes empty, example.com, embedded true, legacy false, redirects empty and webhook API2026-07 unchanged. The nine handles are `read_products,write_products,read_cart_transforms,write_cart_transforms,read_validations,write_validations,read_inventory,write_inventory,read_locations`; no new scope is proposed. This does not execute an amendment or establish that every handle is commercially required.

The decisive missing prerequisite is **authoritative current released-extension preservation and competing-preview ownership/state**, plus a verified authoring mechanism that carries those exact existing extensions through a configuration-only change. This capture provides neither the manifest nor such a verified mechanism. Do not deploy the local extension tree, substitute an unqualified local deploy, or infer the version has no extensions. Owner-supplied sanitized active-version manifest/preview evidence is acceptable before principal chooses the bounded authoring/consent method; another identical scope query is unnecessary.

Any approved version-level amendment must account for **all installed stores**, whose current inventory/impact is unobserved here. Existing/competing previews must not be overwritten; any native consent/reauthorization must be explicitly delegated, with no grant guarantee assumed. Verification must separately establish actual installed grants under the intended route and exact preserved version/extensions before a newly authorized M5-004 test. Rollback must identify the retained insignia-1 version and exact extension/config baseline; releasing a previous version is not promised to restore grants. These are conditions for a later concrete authorization, not delegated work. No production merchant auth or RELEASE_BOUND/readiness improvement is claimed.

## Raw material, preservation and review boundary

Raw stdout/stderr remain private mode0600 beneath a mode0700 scratch root, captured before sanitization. They contain unexported actor/output data and are excluded from Git and review archives; no raw-output hashes are exported. Public version selection removes createdBy and message. Stack-free diagnostic projection uses typed placeholders and rejects unsafe/unfamiliar lines; [ten controls](evidence/m5-007r4/sanitizer-controls.json) are synthetic, not live platform tests. Generic UNKNOWN diagnostic category on a successful command means no causal error projected, not command failure.

No updater/install attempt was observed in output; device initiation was not directly established. Those output limits are not zero-network/zero-auth assertions. Successful fixed-client reads establish this CLI route returned metadata; they do not establish merchant-auth scope, consent state or production auth. No device cancellation/expiry request was made. The earlier R2 error stays ORIGINAL_ERROR_NOT_RETAINED / UNKNOWN; R3's incompatible-flag failure is preserved, not rewritten as this successful run.

[Final receipt](evidence/m5-007r4/final-verification.json) and [pre-run hashes](evidence/m5-007r4/preservation-before.json) confirm old canonical registers and R2/R3 artifacts unchanged, source hashes matched and owned CLI groups gone. No app/shop resource cleanup is required for the inspected metadata/config-capture operations. Ordinary official cache/context effects and retained local scratch are disclosed; incidental authentication transaction activity remains unobserved, not asserted absent. No browser, direct API, owner credential file, repair, preview/release, product/Function/billing/commerce action or old-run replay occurred.

This PR changes only documents/evidence and AGENTS/state pointers. It adds no operative helper/TOML, source, dependencies, schema, migration, CI or architecture change. No manual unchanged root/DB/stress/benchmark rerun; applicable automatically triggered final-head CI is reported in the PR packet. Fresh independent restricted GPT-6.1-sol/high scoped Spec and Standards/security reviews assess this complete documentary change. Review reports/settings and final CI/refs follow the final candidate; no principal approval is invented.

Return the one PR and sanitized archive; raw material stays local. Stop for principal review. No successor merge, access remedy, M6/M7, activation, RELEASE_BOUND/gate pass or launch is authorized.
