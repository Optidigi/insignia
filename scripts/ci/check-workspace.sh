#!/usr/bin/env bash
set -euo pipefail

if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
  printf '\n### Workspace checks\n\n| Check | Result | Seconds |\n| --- | --- | ---: |\n' >> "$GITHUB_STEP_SUMMARY"
fi

timed() {
  local name=$1 started=$SECONDS status=0 result=passed
  shift
  "$@" || status=$?
  if (( status != 0 )); then result=failed; fi
  if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    printf '| %s | %s | %d |\n' "$name" "$result" "$((SECONDS - started))" >> "$GITHUB_STEP_SUMMARY"
  fi
  return "$status"
}

for check in check:style build check:types check:ui test:operations test:unit \
  test:runtime-inventory test:runtime test:vectors check:boundaries check:secrets check:rust; do
  timed "$check" corepack pnpm "$check"
done

INSIGNIA_FUNCTION_RUNNER=.m1-artifacts/tools/function-runner-9.2.3 \
  timed 'Production Functions vectors' node scripts/functions/production-vectors.mts
INSIGNIA_FUNCTION_RUNNER=.m1-artifacts/tools/function-runner-9.2.3 \
  timed 'Public configuration vectors' node scripts/functions/public-config.mts
timed 'Web and storefront browser tests' corepack pnpm test:browser
timed 'Artifact manifest' node scripts/functions/artifact-manifest.mts
