# Plugin integration reference

This platform is designed to **complement** plugins, not duplicate them.
When a plugin is installed, the platform defers to it for the tasks it
does best, and uses its own skills only where the plugin has no coverage.

---

## Superpowers

**Install:**
```shell
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers
```

**What it replaces in this platform:**

| Platform native | With Superpowers |
|---|---|
| Architect planning step | `/sp:plan` |
| TDD implementation loop | `/sp:tdd` |
| Debugging loop | `/sp:debug` |
| Structured review | `/sp:review` |

**What the platform still owns:**
- Agent definitions and model routing
- Hook enforcement (lint, risky paths, merge gate)
- Stack and plugin detection
- Infra and release procedures
- The `architect` agent's delegation logic

**Recommended:** install Superpowers. The platform's planning and TDD
skills are functional fallbacks, but Superpowers' production-tested
versions are materially better for medium and large features.

---

## Context7

**Install:** Add to MCP config:
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

**Effect:** The `researcher` agent automatically fetches live, version-specific
library documentation instead of relying on training knowledge. Eliminates
hallucinated API calls on third-party libraries. High value, zero setup cost.

**Recommended:** always install.

---

## Sequential Thinking

**Install:** Add to MCP config:
```json
{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    }
  }
}
```

**Effect:** The `architect` activates Sequential Thinking before every
`opus-decision` invocation to ensure structured, step-by-step reasoning.
Reduces Opus hallucination on complex architectural decisions.

**Recommended:** install when using Opus for architecture or migrations.

---

## Language servers

Install the language server for your stack. The `implementer` agent uses
them for real-time type checking after every file edit.

```shell
# TypeScript
npm install -g typescript-language-server typescript

# Python
pip install pyright

# Rust — included with rustup
rustup component add rust-analyzer

# Go
go install golang.org/x/tools/gopls@latest
```

**Effect:** `implementer` catches type errors before they reach `tester`.
Dramatically reduces the implement→test→fix loop count on typed codebases.

**Recommended:** always install the matching language server.

---

## Plugin vs standalone decision

Use this platform's `.claude/` directory **with** plugins installed.
They are not alternatives — they are layers.

| Layer | Owned by |
|---|---|
| Model routing, agent definitions, hooks | This platform |
| Planning, TDD, structured debugging | Superpowers |
| Live documentation | Context7 |
| Structured Opus reasoning | Sequential Thinking |
| Type safety during implementation | Language servers |

Running plugins without this platform: you get powerful individual tools
but no autonomous delegation, no model routing, no policy enforcement.

Running this platform without plugins: fully functional, but planning and
TDD phases use the native fallback skills instead of Superpowers' more
refined versions.

The combination is the intended setup.
