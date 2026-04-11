---
name: stack
description: "Plugin detection and stack-specific conventions. Loaded by the architect at session start to configure which tools and commands are available."
---

## Plugin detection

Run these checks via `Bash` at session start. Record results for the session.

```bash
# Superpowers
ls .superpowers/ 2>/dev/null && echo "SP_INSTALLED=true" || echo "SP_INSTALLED=false"

# Context7 MCP
cat ~/.claude/mcp_config.json 2>/dev/null | grep -q "context7" \
  && echo "CTX7_INSTALLED=true" || echo "CTX7_INSTALLED=false"

# Sequential Thinking MCP
cat ~/.claude/mcp_config.json 2>/dev/null | grep -q "sequential-thinking" \
  && echo "SEQ_INSTALLED=true" || echo "SEQ_INSTALLED=false"
```

## Plugin behaviour matrix

| Plugin | Detected | Architect behaviour |
|---|---|---|
| Superpowers | Yes | Replace planning step with `/sp:plan`, TDD with `/sp:tdd`, debug with `/sp:debug` |
| Superpowers | No | Use native `architect` skill planning format |
| Context7 | Yes | `researcher` fetches live docs for third-party APIs |
| Context7 | No | `researcher` uses training knowledge — flag if API is recent |
| Sequential Thinking | Yes | Architect activates it before every `opus-decision` call |
| Sequential Thinking | No | Opus proceeds with standard reasoning |
| Language server | Yes | `implementer` runs type-check after every file edit |
| Language server | No | `implementer` skips type-check step |

## Stack detection

Detect the project stack from config files. Record for the session.

```bash
# JS/TS
[ -f package.json ] && cat package.json | grep -E '"(next|react|vue|svelte|express|fastify)"'
# Python
[ -f pyproject.toml ] && grep tool.poetry pyproject.toml | head -3
[ -f requirements.txt ] && head -5 requirements.txt
# Rust
[ -f Cargo.toml ] && grep "^name\|^edition" Cargo.toml
# Go
[ -f go.mod ] && head -3 go.mod
# Infra
[ -f terraform.tf ] || ls *.tf 2>/dev/null && echo "TERRAFORM=true"
[ -f docker-compose.yml ] && echo "COMPOSE=true"
```

## Stack-specific conventions

### TypeScript / Node
- Type-check command: `npx tsc --noEmit`
- Lint: `npx eslint` or `npx biome check`
- Test runner: `jest`, `vitest`, or `playwright` — detect from package.json scripts
- Format hook uses: `biome format --write` (preferred) or `prettier --write`

### Python
- Type-check: `pyright` or `mypy`
- Lint/format: `ruff check --fix && ruff format`
- Test runner: `pytest` — detect from pyproject.toml
- Format hook uses: `ruff format`

### Rust
- Type-check: `cargo check`
- Lint: `cargo clippy`
- Test: `cargo test`
- Format hook uses: `rustfmt`

### Go
- Type-check: `go build ./...`
- Lint: `golangci-lint run`
- Test: `go test ./...`
- Format hook uses: `goimports`

## Incremental test scripts

The platform expects two scripts in `scripts/`:
- `scripts/test-changed.sh` — runs tests for changed files only
- `scripts/test-all.sh` — runs the full suite

If these don't exist, run `/init` before the first `/build`. The `/init` command
detects the stack and writes the correct templates for the detected test runner.
Do not write these scripts by hand or approximate them inline.
