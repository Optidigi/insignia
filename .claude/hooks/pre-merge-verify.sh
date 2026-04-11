#!/bin/bash
# PreToolUse — blocks commit/merge unless tests and linter pass.
# On protected branches (main, master, release/*, hotfix/*): runs full suite.
# On feature branches: runs incremental suite only (full suite runs at PR merge).

set -euo pipefail

echo "=== Pre-merge verification ==="

# Detect branch type
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
IS_PROTECTED=false
if echo "$BRANCH" | grep -qE "^(main|master|release/|hotfix/)"; then
  IS_PROTECTED=true
fi

# Choose test scope based on branch
if [ "$IS_PROTECTED" = true ]; then
  TEST_SCRIPT="scripts/test-all.sh"
  echo "Protected branch ($BRANCH) — running full suite."
else
  if [ -f scripts/test-changed.sh ]; then
    TEST_SCRIPT="scripts/test-changed.sh"
    echo "Feature branch ($BRANCH) — running incremental suite."
  else
    TEST_SCRIPT="scripts/test-all.sh"
    echo "Feature branch ($BRANCH) — scripts/test-changed.sh not found, falling back to full suite."
  fi
fi

# 1. Test suite
TEST_EXIT=0
if [ -f "$TEST_SCRIPT" ]; then
  bash "$TEST_SCRIPT" || TEST_EXIT=$?
else
  echo "WARNING: $TEST_SCRIPT not found. Run /init to scaffold test scripts." >&2
  TEST_EXIT=0
fi

# 2. Linter
LINT_EXIT=0
if [ -f package.json ]; then
  if command -v jq >/dev/null 2>&1 && jq -e '.scripts.lint' package.json >/dev/null 2>&1; then
    echo "Running lint..."
    npm run lint --if-present || LINT_EXIT=$?
  fi
elif [ -f pyproject.toml ] && command -v ruff >/dev/null 2>&1; then
  echo "Running ruff check..."
  ruff check . || LINT_EXIT=$?
elif [ -f Cargo.toml ] && command -v cargo >/dev/null 2>&1; then
  echo "Running cargo clippy..."
  cargo clippy -- -D warnings || LINT_EXIT=$?
fi

# 3. Type check (if available)
TC_EXIT=0
if [ -f package.json ] && command -v tsc >/dev/null 2>&1; then
  echo "Running type check..."
  npx tsc --noEmit || TC_EXIT=$?
elif [ -f pyproject.toml ] && command -v pyright >/dev/null 2>&1; then
  echo "Running pyright..."
  pyright || TC_EXIT=$?
fi

# Report
if [ "$TEST_EXIT" -ne 0 ] || [ "$LINT_EXIT" -ne 0 ] || [ "$TC_EXIT" -ne 0 ]; then
  echo ""
  echo "Pre-merge verification FAILED:" >&2
  [ "$TEST_EXIT"  -ne 0 ] && echo "  - Tests failed (exit $TEST_EXIT)" >&2
  [ "$LINT_EXIT"  -ne 0 ] && echo "  - Lint failed (exit $LINT_EXIT)" >&2
  [ "$TC_EXIT"    -ne 0 ] && echo "  - Type check failed (exit $TC_EXIT)" >&2
  echo "Fix all errors before committing." >&2
  exit 1
fi

echo ""
echo "Pre-merge verification PASSED."
exit 0
