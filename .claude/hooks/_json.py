#!/usr/bin/env python3
"""
Minimal JSON helper for agent-kit hooks.
Used as a jq fallback when jq is not installed.

Commands (all read JSON from stdin unless noted):
  get <key> [key2 ...]     — nested key lookup, prints value (or nothing)
  compact                  — print compact JSON (no pretty-printing)
  transcript <path>        — parse JSONL transcript, print token totals as JSON
"""
import sys, json

def get_nested(data, *keys):
    v = data
    for k in keys:
        v = v.get(k) if isinstance(v, dict) else None
        if v is None:
            return None
    return v

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""

    if cmd == "get":
        keys = sys.argv[2:]
        try:
            data = json.load(sys.stdin)
            v = get_nested(data, *keys) if keys else data
            if v is None:
                pass
            elif isinstance(v, (dict, list)):
                print(json.dumps(v))
            else:
                print(v)
        except Exception:
            pass

    elif cmd == "compact":
        try:
            print(json.dumps(json.load(sys.stdin), separators=(",", ":")))
        except Exception:
            print("{}")

    elif cmd == "transcript":
        path = sys.argv[2] if len(sys.argv) > 2 else ""
        totals = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
        try:
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        usage = get_nested(json.loads(line), "message", "usage")
                        if usage:
                            totals["input"]       += usage.get("input_tokens",                0) or 0
                            totals["output"]      += usage.get("output_tokens",               0) or 0
                            totals["cache_read"]  += usage.get("cache_read_input_tokens",     0) or 0
                            totals["cache_write"] += usage.get("cache_creation_input_tokens", 0) or 0
                    except Exception:
                        pass
        except Exception:
            pass
        print(json.dumps(totals))

if __name__ == "__main__":
    main()
