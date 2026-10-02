# M5-007R4 — versions-list flag correction and conditional capture

## Goal

Correct the proven local argument conflict without changing the remote target or permission envelope. Complete the original read-only sequence if the corrected command 1 succeeds.

Baseline: current `main` remains `9dc728b21d58a1687fae7221e64225373bbbbecb`. Reverify before execution.

Use actual GPT-6.1-sol/high and repository-pinned `diagnosing-bugs`, `writing-for-agents`, `code-review`, and `handoff`.

## 1. Reuse accepted safety evidence

Reverify:
- isolated Shopify CLI package is still 4.8.2 by package-file read;
- the 25 previously reviewed CLI hashes still match;
- plugin registry remains absent;
- closed M5-004/M5-005 registers remain unchanged;
- previous sanitizer source is unchanged and its ten offline controls still pass.

Do not rerun the complete launch review when those exact inputs match. A changed hash, plugin state, sanitizer, or CLI package reopens the relevant local review and stops Shopify execution until resolved.

The prior global installation remains untouched and unused.

## 2. Prepare an unambiguous scratch version context

Create a fresh mode-0700 scratch root outside repository/worktrees.

For the versions-list context:
- create a dedicated `version-context` directory;
- place exactly one public app configuration at `shopify.app.toml`;
- derive it byte-for-byte from the already-tracked public configuration for the exact app, except filename only; do not edit its semantic values;
- no second `shopify.app*.toml`, `.shopify` preference, extension TOML, `.env`, dependency tree, credential/cache copy, or ancestor app config may be discoverable;
- record source path/blob/hash as **local input**, not remote evidence.

This local file may contain historical scope declarations. They are not evidence and must never be interpreted as the result of this capture.

The separate capture directory for command 2 starts empty as before.

## 3. Corrected command 1

Run the fixed-client versions-list operation once using:
- `--client-id <the exact fixed client ID already authorized in M5-007>`
- `--path <fresh version-context>`
- `--json`

**Do not pass `--config`.**

The public command shape is therefore:

`shopify app versions list --client-id <FIXED_CLIENT_ID> --path <VERSION_CONTEXT> --json`

Use only:
- pinned Node 24.21.0;
- retained isolated Shopify CLI 4.8.2;
- process-local `CI=1`;
- `SHOPIFY_CLI_NO_ANALYTICS=1`;
- `SHOPIFY_CLI_FORCE_AUTO_UPGRADE` explicitly unset;
- existing same-account CLI session/cache;
- noninteractive execution;
- 120-second process deadline.

Retain raw stdout/stderr privately before sanitization exactly as established in R3.

The prior device-initiation authority remains unchanged: one incidental logical initiation may occur naturally, but no code display, browser opening, polling, consent, or login completion is authorized.

### Success criterion

Command 1 exits 0 and its sanitized JSON/output identifies the exact expected app/version context without ambiguity.

If it fails, times out, requires interactive auth completion, attempts install/update, or resolves another app: STOP. Commands 2–3 remain locked. No retry.

## 4. Commands 2 and 3 after command-1 success only

Command 2: run the previously approved fixed-client `app config link` once into the fresh empty capture directory, using its already-approved `--client-id`, `--path`, and `--file-name` shape. Do not add `--config`, `--force`, reset, deploy, or other flags.

Command 3: repeat the corrected versions-list command from §3 exactly once.

Any failure stops immediately; no fallback or retry.

The before/after version observations must identify the same active version. An intervening difference is evidence, not authority to repair.

## 5. Evidence interpretation

The generated config is transformed CLI evidence, not a raw server payload and not a complete released-extension manifest.

For every relevant field distinguish:
- local scratch input;
- CLI-generated value;
- CLI default/fallback;
- earlier API observation;
- earlier native Dashboard observation;
- NOT_OBSERVED.

The historical nine-scope TOML remains historical input. Do not relabel it as downloaded configuration.

## 6. Return boundary

If useful new configuration evidence is obtained, return one docs/evidence-only PR from current main with:
- exact refs;
- public argv/accounting;
- sanitized capture provenance;
- before/after version observations;
- one concrete proposed access remedy or decisive prerequisite;
- fresh scoped GPT-6.1-sol/high Spec and Standards/security reviews;
- applicable automatic CI.

If command 1 again stops on a routine local/auth prerequisite, return a local evidence package only—no redundant PR.

No access repair, scope change, reinstall, preview/release, product/Function/billing/commerce operation, M5-004/M5-005 replay, M6/M7, activation, RELEASE_BOUND claim, gate pass or launch is authorized.
