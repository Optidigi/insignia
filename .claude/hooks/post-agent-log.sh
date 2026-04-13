#!/bin/bash
# PostToolUse — logs agent (Task) invocations to .claude/logs/session.log.
# Provides a token-level audit trail for /cost-report.
#
# Reads JSON payload from stdin (provided by the harness):
#   .tool_name       — the tool that was called (e.g. "Task")
#   .tool_input      — JSON input to the tool
#   .transcript_path — path to the session JSONL transcript
#
# Per-agent token counts are derived from the transcript by summing all
# assistant-turn usage fields and diffing against the last recorded total.
# State is persisted in .claude/logs/.token_state (four space-separated integers).
#
# Requires: jq  OR  python3  (uses whichever is available)

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$REPO_ROOT/.claude/bin:$PATH"

LOG_DIR=".claude/logs"
LOG_FILE="$LOG_DIR/session.log"
STATE_FILE="$LOG_DIR/.token_state"
HELPER="$(dirname "$0")/_json.py"

PAYLOAD=$(cat)

# ── JSON helpers ──────────────────────────────────────────────────────────────
# json_get <json-string> <key> [key2 ...]  → value or empty
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

# ── Tool name check ───────────────────────────────────────────────────────────
TOOL_NAME=$(json_get "$PAYLOAD" tool_name)

if [ -z "$TOOL_NAME" ] || [ "$TOOL_NAME" != "Task" ]; then
  exit 0
fi

mkdir -p "$LOG_DIR"

# ── Agent identity ────────────────────────────────────────────────────────────
TOOL_INPUT_RAW=$(json_get "$PAYLOAD" tool_input)

AGENT_NAME="unknown"
DESCRIPTION=""

if [ -n "$TOOL_INPUT_RAW" ]; then
  SUBAGENT=$(json_get "$TOOL_INPUT_RAW" subagent_type)
  DESCRIPTION=$(json_get "$TOOL_INPUT_RAW" description)
  if [ -n "$SUBAGENT" ] && [ "$SUBAGENT" != "null" ]; then
    AGENT_NAME="$SUBAGENT"
  elif [ -n "$DESCRIPTION" ] && [ "$DESCRIPTION" != "null" ]; then
    AGENT_NAME=$(echo "$DESCRIPTION" | awk '{print $1,$2,$3,$4}')
  fi
fi

# ── Token delta from transcript ───────────────────────────────────────────────
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
  fi
fi

# ── Write JSONL log entry ─────────────────────────────────────────────────────
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
DESCRIPTION_SAFE=$(printf '%s' "$DESCRIPTION" | sed 's/\\/\\\\/g; s/"/\\"/g' | head -c 200)

printf '{"ts":"%s","agent":"%s","input_tokens":%d,"output_tokens":%d,"cache_read":%d,"cache_write":%d,"description":"%s"}\n' \
  "$TIMESTAMP" "$AGENT_NAME" \
  "$INPUT_DELTA" "$OUTPUT_DELTA" "$CACHE_READ_DELTA" "$CACHE_WRITE_DELTA" \
  "$DESCRIPTION_SAFE" \
  >> "$LOG_FILE"

exit 0
