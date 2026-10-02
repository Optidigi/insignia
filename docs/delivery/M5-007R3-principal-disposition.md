# M5-007R3 principal disposition — CONFIRMED_LOCAL_ARGUMENT_ERROR

## Accepted result

Command 1 failed before useful capture with:

`--config=m5-002 cannot also be provided when using --client-id`

Exit code: 2. Duration: approximately 0.771 seconds. No signal or timeout.

Authentication, device initiation and network activity remain UNKNOWN and must not be inferred from this parser/CLI failure.

Commands 2–3 correctly remained locked. No retry or PR occurred.

## Independent source adjudication

Pinned Shopify CLI 4.8.2 source defines the common app flags so that `client-id` is exclusive with `config`. `path` is not exclusive with `client-id`.

The `app versions list` command passes:
- `flags.path` as the local app directory;
- `flags['client-id']` as the explicit remote app identifier;
- `flags.config` only as an optional local config-name selector.

Therefore the smallest correction is to retain `--client-id` and `--path`, remove `--config`, and make the scratch version-context contain exactly one unambiguous default config file. No remote target is broadened by that correction.

## Disposition

Authorize one corrected command-1 attempt. On clean success and exact app/version confirmation, commands 2 and 3 may proceed once each under the existing M5-007R2/R3 safety envelope.
