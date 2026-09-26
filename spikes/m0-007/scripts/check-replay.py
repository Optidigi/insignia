#!/usr/bin/env python3
"""Compare semantic output, preserve new CI resource/build measurements."""
import json
from pathlib import Path

e = Path(__file__).resolve().parents[1] / "evidence"
retained = json.loads((e / "candidate-replay.json").read_text())["rows"]
current = json.loads((e / "ci-candidate-replay.json").read_text())["rows"]
fields = ("target", "caseName", "signedBuckets", "ordinaryLines", "inputSha256", "outputSha256", "operationCount")
assert [{k: row[k] for k in fields} for row in current] == [
    {k: row[k] for k in fields} for row in retained
], "candidate replay semantic drift"
for row in current:
    assert row["binaryBytes"] <= 256_000, row
    assert row["inputBytes"] <= 128_000, row
    assert row["outputBytes"] <= 20_000, row
    assert row["instructions"] is not None and row["instructions"] <= 11_000_000, row
    assert row["memoryUsageKiB"] is not None and row["memoryUsageKiB"] * 1024 <= 10_000_000, row
    assert row["queryBytes"] <= 3_000, row
print(f"M0-007 candidate replay: {len(current)} cases match semantic outputs; CI build/resource hashes retained separately")
