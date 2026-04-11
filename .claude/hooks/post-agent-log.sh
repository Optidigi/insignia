#!/bin/bash
# PostToolUse — logs agent (Task) invocations to .claude/logs/session.log.
# Provides a token-level audit trail for /cost-report.
#
# Reads JSON payload from stdin (provided by the harness):
#   .tool_name      — the tool that was called (e.g. "Task")
#   .tool_input     — JSON input to the tool
#   .transcript_path — path to the session JSONL transcript
#
# Per-agent token counts are derived from the transcript by summing all
# assistant-turn usage fields and diffing against the last recorded total.
# State is persisted in .claude/logs/.token_state (two space-separated integers).

LOG_DIR=".claude/logs"
LOG_FILE="$LOG_DIR/session.log"
STATE_FILE="$LOG_DIR/.token_state"

# Read full stdin payload once
PAYLOAD=$(cat)

TOOL_NAME=$(echo "$PAYLOAD" | jq -r '.tool_name // empty' 2>/dev/null)

# Only act on Task invocations
if [ "${TOOL_NAME:-}" != "Task" ]; then
  exit 0
fi

mkdir -p "$LOG_DIR"

# ── Agent identity ────────────────────────────────────────────────────────────
TOOL_INPUT=$(echo "$PAYLOAD" | jq -r '.tool_input // empty' 2>/dev/null)

AGENT_NAME="unknown"
DESCRIPTION=""
if command -v jq >/dev/null 2>&1 && [ -n "$TOOL_INPUT" ]; then
  SUBAGENT=$(echo "$TOOL_INPUT"  | jq -r '.subagent_type // empty' 2>/dev/null)
  DESCRIPTION=$(echo "$TOOL_INPUT" | jq -r '.description // empty' 2>/dev/null)
  if [ -n "$SUBAGENT" ] && [ "$SUBAGENT" != "null" ]; then
    AGENT_NAME="$SUBAGENT"
  elif [ -n "$DESCRIPTION" ] && [ "$DESCRIPTION" != "null" ]; then
    AGENT_NAME=$(echo "$DESCRIPTION" | awk '{print $1,$2,$3,$4}')
  fi
fi

# ── Token delta from transcript ───────────────────────────────────────────────
INPUT_DELTA=0
OUTPUT_DELTA=0
CACHE_READ_DELTA=0
CACHE_WRITE_DELTA=0

TRANSCRIPT=$(echo "$PAYLOAD" | jq -r '.transcript_path // empty' 2>/dev/null)

if command -v jq >/dev/null 2>&1 && [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  # Sum all assistant-turn usage fields across the entire transcript
  TOTALS=$(jq -sc '
    [ .[] | select(.message.usage != null) | .message.usage ] |
    {
      input:       (map(.input_tokens                  // 0) | add // 0),
      output:      (map(.output_tokens                 // 0) | add // 0),
      cache_read:  (map(.cache_read_input_tokens        // 0) | add // 0),
      cache_write: (map(.cache_creation_input_tokens    // 0) | add // 0)
    }
  ' "$TRANSCRIPT" 2>/dev/null)

  if [ -n "$TOTALS" ]; then
    CUR_IN=$(echo    "$TOTALS" | jq '.input'       2>/dev/null || echo 0)
    CUR_OUT=$(echo   "$TOTALS" | jq '.output'      2>/dev/null || echo 0)
    CUR_CR=$(echo    "$TOTALS" | jq '.cache_read'  2>/dev/null || echo 0)
    CUR_CW=$(echo    "$TOTALS" | jq '.cache_write' 2>/dev/null || echo 0)

    # Load previous cumulative totals (default 0 if file absent)
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

    # Clamp negatives (can happen if transcript was rotated)
    [ "$INPUT_DELTA"       -lt 0 ] && INPUT_DELTA=0
    [ "$OUTPUT_DELTA"      -lt 0 ] && OUTPUT_DELTA=0
    [ "$CACHE_READ_DELTA"  -lt 0 ] && CACHE_READ_DELTA=0
    [ "$CACHE_WRITE_DELTA" -lt 0 ] && CACHE_WRITE_DELTA=0

    # Persist new cumulative totals
    echo "$CUR_IN $CUR_OUT $CUR_CR $CUR_CW" > "$STATE_FILE"
  fi
fi

# ── Write JSONL log entry ─────────────────────────────────────────────────────
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")

# Escape description for safe JSON embedding
DESCRIPTION_SAFE=$(echo "$DESCRIPTION" | sed 's/\\/\\\\/g; s/"/\\"/g' | head -c 200)

printf '{"ts":"%s","agent":"%s","input_tokens":%d,"output_tokens":%d,"cache_read":%d,"cache_write":%d,"description":"%s"}\n' \
  "$TIMESTAMP" \
  "$AGENT_NAME" \
  "$INPUT_DELTA" \
  "$OUTPUT_DELTA" \
  "$CACHE_READ_DELTA" \
  "$CACHE_WRITE_DELTA" \
  "$DESCRIPTION_SAFE" \
  >> "$LOG_FILE"

exit 0
