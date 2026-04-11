#!/bin/bash
# PostToolUse — compresses test output into a token-cheap summary.
# Reads from stdin (the test tool output).

TMPFILE=$(mktemp)
cat > "$TMPFILE"

# Framework-agnostic count extraction
PASSED=$(grep -cE "\b(PASS(ED)?|ok)\b" "$TMPFILE" 2>/dev/null || echo 0)
FAILED=$(grep -cE "\bFAIL(ED)?\b" "$TMPFILE" 2>/dev/null || echo 0)
ERRORS=$(grep -cE "\bERROR\b" "$TMPFILE" 2>/dev/null || echo 0)

# Duration — try to extract from common summary lines
DURATION=$(grep -oE "[0-9]+\.[0-9]+\s*s(econds?)?" "$TMPFILE" | tail -1 || echo "")

echo "=== Test summary ==="
echo "Passed: $PASSED  |  Failed: $FAILED  |  Errors: $ERRORS${DURATION:+  |  Time: $DURATION}"

if [ "$FAILED" -gt 0 ] || [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "Failing tests (first 10):"
  grep -E "\bFAIL(ED)?\b|\bERROR\b" "$TMPFILE" | head -10 | sed 's/^/  /'
  echo ""
  echo "First error context:"
  grep -A 5 -m 1 -E "\bFAIL(ED)?\b|\bERROR\b" "$TMPFILE" | head -8 | sed 's/^/  /'
fi

rm -f "$TMPFILE"
exit 0
