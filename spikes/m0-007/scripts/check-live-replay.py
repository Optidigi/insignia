#!/usr/bin/env python3
"""Keep CI's exact-preview replay equal to the retained local observation."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "evidence"
expected = json.loads((root / "live-replay.json").read_text())
actual = json.loads((root / "ci-live-replay.json").read_text())
assert len(expected["rows"]) == 20
assert actual == expected
assert all(row["exactOutputMatch"] for row in actual["rows"])
assert all(row["liveFuelConsumed"] == row["replayInstructions"] for row in actual["rows"])
print("20 retained live Function inputs replayed against exact preview Wasm: outputs and instructions match")
