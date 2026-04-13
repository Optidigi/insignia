#!/bin/bash
# PostToolUse — logs every non-Task tool call to .claude/logs/actions.log
# and tracks main-thread token usage in .claude/logs/session.log.
#
# Reads JSON payload from stdin:
#   .tool_name       — name of the tool that just ran
#   .tool_input      — input arguments (truncated to 120 chars)
#   .transcript_path — path to the session JSONL transcript
#
# Token deltas are computed from the transcript and logged as agent="main".
# The shared .token_state file is also used by post-agent-log.sh (Task hook),
# so all usage — main thread and subagents — is tracked from one baseline.
#
# Requires: jq  OR  python3  (uses whichever is available)

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$REPO_ROOT/.claude/bin:$PATH"

LOG_DIR=".claude/logs"
SESSION_LOG="$LOG_DIR/session.log"
ACTIONS_LOG="$LOG_DIR/actions.log"
STATE_FILE="$LOG_DIR/.token_state"
HELPER="$(dirname "$0")/_json.py"

PAYLOAD=$(cat)

# ── JSON helpers ──────────────────────────────────────────────────────────────
json_get() {
  local input="$1"; shift
  if command -v jq >/dev/null 2>&1; then
    local filter
    filter=$(printf '.%s' "$@" | sed 's/\.\././g')
    printf '%s' "$input" | jq -r "${filter} // empty" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 "$HELPER" get "$@" 2>/dev/null
  fi
}

json_compact() {
  local input="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -c '. // {}' 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 "$HELPER" compact 2>/dev/null
  else
    echo "{}"
  fi
}

# ── Tool name check ───────────────────────────────────────────────────────────
TOOL_NAME=$(json_get "$PAYLOAD" tool_name)

# Task invocations are handled by post-agent-log.sh — skip them here
if [ -z "$TOOL_NAME" ] || [ "$TOOL_NAME" = "Task" ]; then
  exit 0
fi

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")

# ── actions.log entry ─────────────────────────────────────────────────────────
TOOL_INPUT_RAW=$(json_get "$PAYLOAD" tool_input)
TOOL_INPUT_COMPACT=$(json_compact "$TOOL_INPUT_RAW" | head -c 120)
TOOL_INPUT_SAFE=$(printf '%s' "$TOOL_INPUT_COMPACT" | sed 's/\\/\\\\/g; s/"/\\"/g')

printf '{"ts":"%s","tool":"%s","input":"%s"}\n' \
  "$TIMESTAMP" "$TOOL_NAME" "$TOOL_INPUT_SAFE" \
  >> "$ACTIONS_LOG"

# ── Main-thread token delta from transcript ───────────────────────────────────
INPUT_DELTA=0; OUTPUT_DELTA=0; CACHE_READ_DELTA=0; CACHE_WRITE_DELTA=0

TRANSCRIPT=$(json_get "$PAYLOAD" transcript_path)

if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  if command -v jq >/dev/null 2>&1; then
    TOTALS=$(jq -sc '
      [ .[] | select(.message.usage != null) | .message.usage ] |
      {
        input:       (map(.input_tokens                 // 0) | add // 0),
        output:      (map(.output_tokens                // 0) | add // 0),
        cache_read:  (map(.cache_read_input_tokens      // 0) | add // 0),
        cache_write: (map(.cache_creation_input_tokens  // 0) | add // 0)
      }
    ' "$TRANSCRIPT" 2>/dev/null)
  elif command -v python3 >/dev/null 2>&1; then
    TOTALS=$(python3 "$HELPER" transcript "$TRANSCRIPT" 2>/dev/null)
  fi

  if [ -n "$TOTALS" ]; then
    CUR_IN=$(json_get  "$TOTALS" input)
    CUR_OUT=$(json_get "$TOTALS" output)
    CUR_CR=$(json_get  "$TOTALS" cache_read)
    CUR_CW=$(json_get  "$TOTALS" cache_write)

    PREV_IN=0; PREV_OUT=0; PREV_CR=0; PREV_CW=0
    if [ -f "$STATE_FILE" ]; then
      read -r PREV_IN PREV_OUT PREV_CR PREV_CW < "$STATE_FILE" 2>/dev/null || true
      PREV_IN=${PREV_IN:-0}; PREV_OUT=${PREV_OUT:-0}
      PREV_CR=${PREV_CR:-0}; PREV_CW=${PREV_CW:-0}
    fi

    INPUT_DELTA=$(( CUR_IN  - PREV_IN  ))
    OUTPUT_DELTA=$(( CUR_OUT - PREV_OUT ))
    CACHE_READ_DELTA=$(( CUR_CR - PREV_CR ))
    CACHE_WRITE_DELTA=$(( CUR_CW - PREV_CW ))

    [ "$INPUT_DELTA"       -lt 0 ] && INPUT_DELTA=0
    [ "$OUTPUT_DELTA"      -lt 0 ] && OUTPUT_DELTA=0
    [ "$CACHE_READ_DELTA"  -lt 0 ] && CACHE_READ_DELTA=0
    [ "$CACHE_WRITE_DELTA" -lt 0 ] && CACHE_WRITE_DELTA=0

    echo "$CUR_IN $CUR_OUT $CUR_CR $CUR_CW" > "$STATE_FILE"

    # Only write a session.log entry when tokens actually moved
    if [ "$INPUT_DELTA" -gt 0 ] || [ "$OUTPUT_DELTA" -gt 0 ]; then
      printf '{"ts":"%s","agent":"main","input_tokens":%d,"output_tokens":%d,"cache_read":%d,"cache_write":%d,"description":"%s"}\n' \
        "$TIMESTAMP" \
        "$INPUT_DELTA" "$OUTPUT_DELTA" "$CACHE_READ_DELTA" "$CACHE_WRITE_DELTA" \
        "$TOOL_NAME" \
        >> "$SESSION_LOG"
    fi
  fi
fi

exit 0
