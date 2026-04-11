#!/bin/bash
# PreToolUse — blocks writes to protected paths outside approved commands.
# Called with: $1 = tool name, $2 = JSON input

TOOL_NAME="$1"
INPUT_JSON="$2"

[[ "$TOOL_NAME" =~ ^(Edit|Write|MultiEdit)$ ]] || exit 0

# Extract file_path — prefer jq, fall back to sed
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(echo "$INPUT_JSON" | jq -r '.file_path // empty')
else
  FILE_PATH=$(echo "$INPUT_JSON" | sed -n 's/.*"file_path"\s*:\s*"\([^"]*\)".*/\1/p')
fi

[[ -z "$FILE_PATH" ]] && exit 0

# Protected path patterns
PROTECTED_PATTERNS=(
  "^infra/"
  "^terraform/"
  "^tf/"
  "^migrations/"
  "^db/migrations/"
  "^\.github/workflows/"
  "^docker/"
  "^Dockerfile"
  "\.env"
  "^\.env"
)

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if echo "$FILE_PATH" | grep -qE "$pattern"; then
    echo "BLOCKED: '$FILE_PATH' is a protected path." >&2
    echo "Use /platform-change to modify infrastructure, migration, or CI files." >&2
    exit 2
  fi
done

exit 0
