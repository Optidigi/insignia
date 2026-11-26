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

build_workspace() {
  timed check:style corepack pnpm check:style
  timed build corepack pnpm build
}

check_workspace() {
  local check
  for check in check:types check:ui test:operations test:unit test:runtime-inventory \
    test:runtime test:vectors check:boundaries check:secrets; do
    timed "$check" corepack pnpm "$check"
  done
}

check_functions() {
  timed check:rust corepack pnpm check:rust
  INSIGNIA_FUNCTION_RUNNER=.m1-artifacts/tools/function-runner-9.2.3 \
    timed 'Production Functions vectors' node scripts/functions/production-vectors.mts
  INSIGNIA_FUNCTION_RUNNER=.m1-artifacts/tools/function-runner-9.2.3 \
    timed 'Public configuration vectors' node scripts/functions/public-config.mts
  timed 'Artifact manifest' node scripts/functions/artifact-manifest.mts
}

check_web() {
  timed 'Web tests' corepack pnpm --filter @insignia/web test
}

check_storefront() {
  timed 'Storefront tests' corepack pnpm --filter @insignia/storefront test
}

case "${1:-all}" in
  build) build_workspace ;;
  workspace) check_workspace ;;
  functions) check_functions ;;
  web) check_web ;;
  storefront) check_storefront ;;
  browser)
    check_web
    check_storefront
    ;;
  publication)
    timed 'Publication geometry stress' corepack pnpm test:publication-stress
    timed 'Missing renderer control' corepack pnpm test:renderer-control
    ;;
  all)
    build_workspace
    check_workspace
    check_functions
    check_web
    check_storefront
    ;;
  *) echo "Unknown workspace check suite: $1" >&2; exit 2 ;;
esac
