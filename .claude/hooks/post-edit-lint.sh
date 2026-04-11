#!/bin/bash
# PostToolUse — auto-formats a file after every edit.
# Called with: $1 = file path

FILE_PATH="$1"
[[ -z "$FILE_PATH" ]] && exit 0
[[ -f "$FILE_PATH" ]] || exit 0

case "$FILE_PATH" in
  *.py)
    if command -v ruff >/dev/null 2>&1; then
      ruff check --fix --quiet "$FILE_PATH" || true
      ruff format --quiet "$FILE_PATH" || true
    fi
    ;;
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    if command -v biome >/dev/null 2>&1; then
      biome format --write --quiet "$FILE_PATH" || true
    elif command -v prettier >/dev/null 2>&1; then
      prettier --write --log-level silent "$FILE_PATH" || true
    fi
    ;;
  *.rs)
    if command -v rustfmt >/dev/null 2>&1; then
      rustfmt --edition 2021 "$FILE_PATH" || true
    fi
    ;;
  *.go)
    if command -v goimports >/dev/null 2>&1; then
      goimports -w "$FILE_PATH" || true
    elif command -v gofmt >/dev/null 2>&1; then
      gofmt -w "$FILE_PATH" || true
    fi
    ;;
  *.md)
    if command -v prettier >/dev/null 2>&1; then
      prettier --write --log-level silent "$FILE_PATH" || true
    fi
    ;;
esac

exit 0
