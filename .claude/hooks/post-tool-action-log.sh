#!/bin/bash
# PostToolUse — appends every non-Task tool call to .claude/logs/actions.log.
# Provides a per-session action trail consumed by /cost-report.
#
# Reads JSON payload from stdin:
#   .tool_name  — name of the tool that just ran
#   .tool_input — input arguments (truncated to 120 chars to avoid log bloat)

LOG_DIR=".claude/logs"
LOG_FILE="$LOG_DIR/actions.log"

PAYLOAD=$(cat)

TOOL_NAME=$(echo "$PAYLOAD" | jq -r '.tool_name // empty' 2>/dev/null)

# Task invocations are handled by post-agent-log.sh — skip them here
if [ -z "$TOOL_NAME" ] || [ "$TOOL_NAME" = "Task" ]; then
  exit 0
fi

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")

# Capture first 120 chars of the raw tool_input as context (single line, escaped)
TOOL_INPUT_RAW=$(echo "$PAYLOAD" | jq -c '.tool_input // {}' 2>/dev/null | head -c 120)
TOOL_INPUT_SAFE=$(echo "$TOOL_INPUT_RAW" | sed 's/\\/\\\\/g; s/"/\\"/g')

printf '{"ts":"%s","tool":"%s","input":"%s"}\n' \
  "$TIMESTAMP" \
  "$TOOL_NAME" \
  "$TOOL_INPUT_SAFE" \
  >> "$LOG_FILE"

exit 0
