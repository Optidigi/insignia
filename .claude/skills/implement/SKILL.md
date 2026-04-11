---
name: implement
description: "Coding standards and patterns for the implementer agent. Loaded before any code-writing step."
---

## Universal coding standards

These apply regardless of language or stack:

1. **Read before writing.** Always read the file you are about to edit.
   Understand the surrounding context — naming conventions, import style,
   error handling patterns — before making a change.

2. **Match the existing style.** If the codebase uses 2-space indentation,
   use 2 spaces. If it uses named exports, use named exports. Do not
   introduce a new style without a specific instruction to do so.

3. **One change per step.** Each `implementer` invocation should produce
   a single, coherent, reviewable change. Do not bundle unrelated fixes.

4. **Leave it cleaner than you found it.** Fix obvious issues adjacent to
   your change (unused imports, missing types), but do not refactor beyond
   the plan step.

5. **Handle errors explicitly.** Do not swallow exceptions. Propagate errors
   to the caller or log with sufficient context. Never use bare `except:`
   or empty `catch {}`.

6. **No magic numbers or strings.** Extract constants with descriptive names.

7. **No dead code.** Remove commented-out code, unused variables, and
   unreachable branches. If something is kept for reference, add a comment
   explaining why.

## Security defaults

These are non-negotiable in every implementation:

- Never hardcode secrets, API keys, or credentials. Use environment variables.
- Validate and sanitise all external input before use.
- Use parameterised queries — never string-concatenate SQL.
- Set least-privilege defaults for any new IAM role, permission, or API scope.
- Do not log sensitive fields (passwords, tokens, PII).

## Type safety

- In TypeScript: avoid `any`. Use `unknown` and narrow explicitly.
- In Python: annotate all function signatures. Use `Optional` / `|` syntax.
- In Rust: prefer `Result<T, E>` over `unwrap()` in library code.
- In Go: handle all errors — do not assign to `_` unless truly irrelevant.

## Documentation

- Public functions, classes, and modules get a doc comment on the first pass.
- Doc comments state: what it does, parameters, return value, and exceptions.
- Do not document the obvious (`// increment i by 1`).
- Update existing docs when changing behaviour they describe.

## Commit discipline

- One logical change per commit.
- Commit message: `<type>(<scope>): <description>` (conventional commits).
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `infra`.
- Do not commit generated files, `.env`, or build artifacts.
