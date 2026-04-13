---
name: cost-report
description: "Display a token-level usage report for the current session, broken down per agent with estimated costs. Optionally clears the logs."
arguments:
  action:
    description: "Optional. Pass 'clear' to reset both session.log and actions.log after viewing."
    required: false
---

## Steps

1. Check if `.claude/logs/session.log` exists. If not, report:
   ```
   No agent invocations logged yet. Run a /build or /fix session first.
   ```
   and exit.

2. Read `.claude/logs/session.log`. Each line is a JSON object:
   ```json
   {"ts":"...","agent":"...","input_tokens":N,"output_tokens":N,"cache_read":N,"cache_write":N,"description":"..."}
   ```

3. For each agent, look up its model tier:

   | Agent | Model |
   |---|---|
   | main | Sonnet |
   | researcher | Haiku |
   | tester | Haiku |
   | implementer | Sonnet |
   | reviewer | Sonnet |
   | debugger | Sonnet |
   | architect | Sonnet |
   | opus-decision | Opus |

   `main` is the primary conversation thread. Unknown agents default to Sonnet.

4. Compute estimated cost per agent using these per-million-token rates
   (approximate — verify current pricing at anthropic.com/pricing):

   | Tier | Input $/M | Output $/M |
   |---|---|---|
   | Haiku | $0.80 | $4.00 |
   | Sonnet | $3.00 | $15.00 |
   | Opus | $15.00 | $75.00 |

   `cost = (input_tokens / 1_000_000 * input_rate) + (output_tokens / 1_000_000 * output_rate)`

5. Aggregate and display:

```
=== Session Usage Report ===

Agent           Model    Calls   Input tok   Output tok   Cache read   Est. cost
─────────────────────────────────────────────────────────────────────────────────
researcher      Haiku       3       4,210          891          210      $0.007
tester          Haiku       5       8,102        1,432          540      $0.012
implementer     Sonnet      4      18,340        3,210        1,200      $0.103
reviewer        Sonnet      2       9,120        1,640          800      $0.052
architect       Sonnet      1       5,200          820          300      $0.028
opus-decision   Opus        1       3,400          430          100      $0.083
─────────────────────────────────────────────────────────────────────────────────
TOTAL                      16      48,372        8,423        3,150      $0.285

Token breakdown:
  Input    48,372  (of which cache-read: 3,150 | cache-write: 1,400)
  Output    8,423
  Total    56,795

Model distribution:
  Haiku    8 calls (50%) — est. $0.019
  Sonnet   7 calls (44%) — est. $0.183
  Opus     1 call  ( 6%) — est. $0.083

Log period: <first-ts> → <last-ts>
```

6. If `.claude/logs/actions.log` exists, show the 20 most recent tool actions:

```
Recent actions (last 20):
  10:22:55  Read
  10:22:58  Bash
  10:23:01  Grep
  10:23:04  Edit
  ...

Total tool calls this session: 47
  Read: 12   Bash: 10   Grep: 9   Edit: 8   Write: 4   Glob: 4
```

   Parse each line as JSON: `{"ts":"...","tool":"...","input":"..."}`.
   Group by tool name for the summary counts.

7. If action is `clear`:
   ```bash
   > .claude/logs/session.log
   > .claude/logs/actions.log
   rm -f .claude/logs/.token_state
   ```
   Report: `Session logs cleared.`

## Notes

- Estimated costs are approximations based on public list prices. Actual billing
  may differ due to batching, caching credits, or price changes.
- Cache-read tokens are billed at a lower rate (~10% of input price); the cost
  estimate above uses the full input rate, so real cost may be slightly lower.
- The `.claude/logs/.token_state` file tracks cumulative transcript token totals
  between agent invocations to compute per-agent deltas. It is also cleared by
  `clear`.
